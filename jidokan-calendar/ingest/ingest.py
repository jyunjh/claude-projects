#!/usr/bin/env python3
"""
児童館イベント取り込みスクリプト（事前取り込み方式 / 実運用版）
================================================================
各児童館がリリースする「月間予定PDF（おたより）」を取得し、Gemini に直接渡して
イベント（日時・内容・対象年齢）を構造化抽出し、data/events.json に保存する。

なぜこの方式か:
  - ブラウザから外部PDFを直接取得すると CORS で弾かれることが多い。
    事前にここで取り込んで JSON 化しておけば、表示アプリは高速・安定・オフラインでも動く。
  - Gemini はマルチモーダルで PDF を直接読めるため、ローカルでのPDFテキスト抽出は不要。
    → Python 標準ライブラリ（urllib / base64 / json / re）のみで完結し、追加インストール不要。

実運用向けの工夫:
  - pdfUrl が PDF 直リンクでなく HTML ページ（おたより一覧/記事）でも、ページ内の
    最初の .pdf リンクを自動で解決して取得する（児童館サイトは記事内にPDFを貼ることが多い）。
  - 抽出結果を検証（日付形式 YYYY-MM-DD / 妥当な期間内 / 重複除去）。
  - 取得日時(generatedAt)とモード(live)を付与し、フロントの鮮度表示に使う。
  - 館ごとに失敗してもスキップして続行し、最後に成功/失敗のサマリを表示。

モデル戦略（stock-analyzer/chat.js と同じ思想）:
  - 通常は gemini-2.5-flash を優先利用。無料枠の上限(HTTP 429)時は flash-lite に自動フォールバック。

使い方（--ward は必須。全区一括は無料枠保護のため不可）:
  export GEMINI_API_KEY=xxxxx          # 無料キー: https://aistudio.google.com/apikey
  python3 ingest/ingest.py --ward edogawa                 # 江戸川区の全館を取り込み
  python3 ingest/ingest.py --ward edogawa --center kasai  # 区内の指定館だけ再取り込み（既存にマージ）
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CENTERS_DIR = DATA_DIR / "centers"   # 区ごとの施設レジストリ centers/<wardId>.json
EVENTS_DIR = DATA_DIR / "events"     # 区ごとの取り込み済みイベント events/<wardId>.json

PRIMARY_MODEL = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-2.5-flash-lite"
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
UA = "jidokan-calendar-ingest/1.0"
JST = timezone(timedelta(hours=9))

# 妥当とみなすイベント日付の範囲（過去/未来に極端な誤抽出を弾く）
PAST_LIMIT_DAYS = 60
FUTURE_LIMIT_DAYS = 400

PROMPT = """以下の資料（PDF・ページのテキスト・画像のいずれか）は、日本の児童館・子育てひろば
（主に東京都 江戸川区・江東区）が公開している「月間イベント予定表（おたより）」です。
掲載されている対象月のイベント・行事・プログラムを、正確に・漏れなく抽出してください。

# 読み取りの注意（正確さ最優先）
- まずPDFの見出しから対象の「年・月」を把握し、各イベントの date をその月の正しい日付にする
  （年の記載が無ければ {year} 年）。
- カレンダー形式（日付のマス目・表）の場合は、各マス目（日付欄）を1つずつ確認し、
  書かれている行事を必ず全て拾う。
- ★日付の取り違えに最大限注意する★: 各マス（日付欄）に印刷されている「数字」を、
  その欄に書かれた行事の date の『日』としてそのまま使う。
  曜日から日付を逆算・補正して動かしてはいけない（1日ずれる原因になる）。
  行事はそれが印刷されているマスの数字の日に置き、隣のマスや上下の行とずらさない。
- 行事名だけが欄に書かれ、時間や対象は別の囲み（説明欄）にある場合も多い。
  その場合は囲みの説明と突き合わせて時間・対象を補う。分からなければ null にしてでも、
  イベント自体は必ず出力する（明らかに行事があるのに空配列を返さない）。
- 翌月のミニカレンダー・「来月の予告」など、対象月以外の日付のものは含めない。
- 時刻は「10:30〜11:15」等の表記から start / end をできるだけ正確に取る。
- 対象年齢は「対象: 0歳」「2〜3歳」「未就学児」「乳児/幼児」「小学生」「どなたでも」等から判断し、
  ageMin / ageMax（歳の整数）と、原文に近い ageLabel を両方入れる。
  目安: 「0〜2歳」→min0,max2 ／「○か月」→0歳扱いで min0 ／「未就学児」→min0,max5 ／
        「幼児」→min3,max5 ／「小学生」→min6,max12 ／不明は null。

# 期間（連日）開催の扱い ★重要
- 「7月1日〜7月7日」「期間中」「毎日」のように複数日連続で開催されるものは、
  日ごとに分けず必ず 1件にまとめ、date=開始日 / dateEnd=終了日 とする。
- 1日だけの単発イベントは dateEnd を null にする。

# 含めないもの
- 開館時間・休館日・利用案内・持ち物のみの注記・申込方法など「イベントでないもの」。
- 日付が特定できないもの。まったく同一内容の重複。

# 出力（JSON 配列のみ。前置き・説明・コードフェンスは書かない）
各要素のキー:
- date: "YYYY-MM-DD"
- dateEnd: "YYYY-MM-DD" または null（連日開催の終了日）
- start: "HH:MM" または null
- end: "HH:MM" または null
- title: イベント名（簡潔に）
- description: 補足（無ければ ""）
- ageMin: 整数の歳 または null
- ageMax: 整数の歳 または null
- ageLabel: 原文に近い対象表記（例 "0〜2歳", "小学生", "どなたでも"）"""


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def html_to_text(html):
    """HTML から可視テキストをざっくり抽出（script/style 除去・タグ除去・空白整理）。"""
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?is)<br\s*/?>", "\n", html)
    html = re.sub(r"(?is)</(p|div|tr|li|h[1-6])>", "\n", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">"))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def fetch_source(url):
    """予定表の元データを取得する。PDF直リンク・HTMLページ・画像のいずれにも対応。
    戻り値: (mime, data_bytes, used_url)。
      - PDF:   ("application/pdf", bytes, url)
      - 画像:  ("image/jpeg" 等, bytes, url)
      - HTML:  ページ内に .pdf があればそのPDFを、無ければ本文テキストを
               ("text/plain", text_bytes, url) で返す。"""
    data, ctype = http_get(url)
    ct = ctype.lower()
    if "application/pdf" in ct or url.lower().endswith(".pdf"):
        return "application/pdf", data, url
    if ct.startswith("image/"):
        return ct.split(";")[0].strip(), data, url
    # HTML: まず埋め込みPDFを優先、無ければページ本文テキストを使う
    html = data.decode("utf-8", "ignore")
    hrefs = re.findall(r'href=["\']([^"\']+?\.pdf)["\']', html, flags=re.IGNORECASE)
    if hrefs:
        pdf_url = urllib.parse.urljoin(url, hrefs[0])
        pdf_bytes, _ = http_get(pdf_url)
        return "application/pdf", pdf_bytes, pdf_url
    text = html_to_text(html)
    if len(text) < 50:
        raise RuntimeError("ページから予定表テキスト・PDF・画像を取得できませんでした")
    return "text/plain", text.encode("utf-8"), url


def _source_part(mime, data):
    if mime == "text/plain":
        return {"text": "以下は予定表ページから抽出したテキストです:\n\n"
                        + data.decode("utf-8")[:120000]}
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode("ascii")}}


def _gemini_call(parts, api_key, max_tokens, log, retries=3):
    """Gemini を呼び本文テキストを返す。
    429(上限)/503(混雑)/通信エラーは指数バックオフで再試行し、flash→lite もフォールバック。"""
    body = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {"responseMimeType": "application/json",
                             "temperature": 0, "maxOutputTokens": max_tokens},
    }).encode("utf-8")
    last_err = None
    for model in (PRIMARY_MODEL, FALLBACK_MODEL):
        url = f"{API_BASE}/{model}:generateContent?key={api_key}"
        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, data=body,
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=180) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                cand = (payload.get("candidates") or [{}])[0]
                finish = cand.get("finishReason")
                text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts") or [])
                log(f"    [{model}] finishReason={finish} / 応答 {len(text)} 文字")
                if finish == "MAX_TOKENS":
                    raise RuntimeError("応答が途中で切れました(MAX_TOKENS)。maxOutputTokens を増やしてください。")
                if not text.strip():
                    raise RuntimeError(f"空の応答(finishReason={finish})。")
                return text
            except urllib.error.HTTPError as e:
                last_err = f"HTTP {e.code}"
                if e.code in (429, 503) and attempt < retries - 1:
                    wait = 5 * (2 ** attempt)  # 5,10,20s
                    log(f"    {model} {e.code}（{'上限' if e.code==429 else '混雑'}）→ {wait}s 待って再試行 {attempt+2}/{retries}")
                    time.sleep(wait)
                    continue
                if e.code in (429, 503):
                    break  # このモデルは諦めて次モデルへ
                raise RuntimeError(f"Gemini エラー ({model}): HTTP {e.code} "
                                   f"{e.read().decode('utf-8', 'ignore')[:200]}")
            except urllib.error.URLError as e:
                last_err = str(e)
                if attempt < retries - 1:
                    time.sleep(5 * (2 ** attempt)); continue
                break
    raise RuntimeError(f"Gemini 呼び出しに失敗（上限/混雑が継続）: {last_err}")


def detect_period(mime, data, api_key, fallback_year, log=lambda *a: None):
    """この号が何年・何月のものかを軽く問い合わせる。(year, month) を返す（不明は month=None）。"""
    q = (f"この資料は何年・何月の予定表（おたより）ですか。"
         f"JSONで {{\"year\": 整数, \"month\": 整数}} だけを返す。"
         f"年が読めなければ year は {fallback_year}。月が読めなければ month は null。")
    try:
        text = _gemini_call([_source_part(mime, data), {"text": q}], api_key, 200, log)
        obj = json.loads(text)
        y = int(obj.get("year") or fallback_year)
        mo = obj.get("month")
        return y, (int(mo) if mo else None)
    except Exception as e:
        log(f"    年月の判定に失敗（曜日表なしで続行）: {e}")
        return fallback_year, None


def weekday_table(year, month):
    """その月の各日の曜日対応表（Geminiの日付合わせ用の参照）。"""
    import calendar
    wd = "月火水木金土日"
    n = calendar.monthrange(year, month)[1]
    days = " ".join(f"{d}日({wd[date(year, month, d).weekday()]})" for d in range(1, n + 1))
    return f"{year}年{month}月の各日の曜日: {days}"


def gemini_extract(mime, data, api_key, year, log=lambda *a: None, hint=""):
    """予定表データ(PDF/画像/テキスト)を Gemini に渡してイベント配列(list[dict])を得る。"""
    source_part = _source_part(mime, data)
    instruction = PROMPT.format(year=year)
    if hint:
        instruction += ("\n\n# 日付の参照表（必ずこれに従って date を決める）\n" + hint
                        + "\n各行事の date は、PDFに印刷された曜日と上の表で一致する日にすること。"
                        "ずれていると気づいたら表に合わせて必ず直す。")
    # 思考(thinking)は日付・曜日合わせに有効なので残し、出力枠を広く取って途中切れを防ぐ
    text = _gemini_call([source_part, {"text": instruction}], api_key, 32768, log)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"JSON解析に失敗。先頭: {text[:160]}")


_date_re = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_time_re = re.compile(r"^\d{1,2}:\d{2}$")


def valid_event(ev, today):
    """日付の形式・妥当性チェック。OKなら正規化済み date 文字列を返し、NGなら None。"""
    d = (ev.get("date") or "").strip()
    if not _date_re.match(d):
        return None
    try:
        dt = datetime.strptime(d, "%Y-%m-%d").date()
    except ValueError:
        return None
    if dt < today - timedelta(days=PAST_LIMIT_DAYS):
        return None
    if dt > today + timedelta(days=FUTURE_LIMIT_DAYS):
        return None
    return d


def normalize(ev, center_id, idx):
    """抽出結果を events.json のスキーマへ正規化。"""
    def s(v):
        v = ("" if v is None else str(v)).strip()
        return v or None
    def i(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    t = s(ev.get("start"))
    d = ev["date"].strip()
    de = s(ev.get("dateEnd"))
    if not (de and _date_re.match(de) and de > d):
        de = None  # 終了日が不正/開始日以前なら単発扱い
    return {
        "id": f"{center_id}-{idx:03d}",
        "centerId": center_id,
        "date": d,
        "dateEnd": de,
        "start": t if (t and _time_re.match(t)) else None,
        "end": (lambda e: e if (e and _time_re.match(e)) else None)(s(ev.get("end"))),
        "title": s(ev.get("title")) or "（無題）",
        "description": (str(ev.get("description") or "")).strip(),
        "ageMin": i(ev.get("ageMin")),
        "ageMax": i(ev.get("ageMax")),
        "ageLabel": s(ev.get("ageLabel")) or "対象年齢の記載なし",
    }


def dedupe(events):
    """centerId + date + start + title が同一のものを除去。"""
    seen, out = set(), []
    for e in events:
        key = (e["centerId"], e["date"], e["start"], e["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def load_existing(events_path):
    """既存 events/<ward>.json を {mode, generatedAt, events} 形式 or 旧配列形式の両対応で読む。"""
    if not events_path.exists():
        return []
    raw = json.loads(events_path.read_text(encoding="utf-8"))
    return raw.get("events", []) if isinstance(raw, dict) else raw


def run_ingest(api_key, ward, center=None, year=None, log=print):
    """取り込み本体。CLI / ローカルサーバー(serve.py) の両方から呼ぶ。
    data/centers/<ward>.json を読み、data/events/<ward>.json を書き出し、サマリ dict を返す。
    例外は呼び出し側へ。ward は必須（全区一括は無料枠保護のため不可）。"""
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("Gemini APIキーが指定されていません。")
    ward = (ward or "").strip()
    if not ward:
        raise ValueError("区ID（ward）が指定されていません。例: --ward edogawa")
    year = year or date.today().year

    centers_json = CENTERS_DIR / f"{ward}.json"
    events_json = EVENTS_DIR / f"{ward}.json"
    if not centers_json.exists():
        raise ValueError(f"区 '{ward}' の施設レジストリ {centers_json} がありません。")

    centers = json.loads(centers_json.read_text(encoding="utf-8"))
    if center:
        centers = [c for c in centers if c["id"] == center]
        if not centers:
            raise ValueError(f"児童館ID '{center}' が {centers_json.name} に見つかりません。")

    # 既存データを館ごとに保持。成功した館だけ差し替え、失敗館は前回データを残す
    # （ネットワーク不調や上限で全データが消えるのを防ぐ）。
    by_center = {}
    for e in load_existing(events_json):
        by_center.setdefault(e.get("centerId"), []).append(e)

    today = date.today()
    ok, failed = [], []
    for idx, c in enumerate(centers):
        cid, name, url = c["id"], c.get("name", c["id"]), c.get("pdfUrl")
        if not url:
            log(f"[skip] {name}: pdfUrl が未設定")
            failed.append({"name": name, "error": "pdfUrl 未設定"})
            continue
        if idx > 0:
            time.sleep(4)  # 無料枠のレート上限を避けるためのスロットル
        log(f"[取得] {name}")
        try:
            mime, data, used = fetch_source(url)
            kind = {"application/pdf": "PDF", "text/plain": "HTMLテキスト"}.get(mime, mime)
            if used != url:
                log(f"    取得元を解決: {used}（{kind}）")
            else:
                log(f"    形式: {kind}")
            # 号の年月を判定し、曜日対応表を渡してカレンダーの日付ズレを防ぐ。
            # まずPDFのファイル名から月を読めれば、API呼び出し(=無料枠消費)を1回節約する。
            py, pm = year, None
            mfn = re.search(r"(?<!\d)(\d{1,2})\.pdf(?:$|[?#])", used or url)
            if mfn and 1 <= int(mfn.group(1)) <= 12:
                pm = int(mfn.group(1))
                log(f"    対象月をURLから判定: {pm}月")
            else:
                py, pm = detect_period(mime, data, api_key, year, log=log)
            hint = weekday_table(py, pm) if pm else ""
            if pm:
                log(f"    対象: {py}年{pm}月（曜日表を付与）")
            events = gemini_extract(mime, data, api_key, py, log=log, hint=hint)
            if not isinstance(events, list):
                raise RuntimeError("Gemini が配列を返しませんでした")
            kept, dropped = [], 0
            for e in events:
                if valid_event(e, today):
                    kept.append(normalize(e, cid, len(kept) + 1))
                else:
                    dropped += 1
            by_center[cid] = kept  # 成功 → この館の分だけ差し替え
            ok.append({"name": name, "kept": len(kept), "dropped": dropped})
            log(f"    → {len(kept)} 件抽出（無効 {dropped} 件を除外）")
        except Exception as e:
            log(f"    !! 失敗のためスキップ（前回データを保持）: {e}")
            failed.append({"name": name, "error": str(e)})

    collected = dedupe([e for evs in by_center.values() for e in evs])
    collected.sort(key=lambda e: (e.get("date") or "", e.get("start") or ""))

    generated_at = datetime.now(JST).isoformat(timespec="seconds")
    out = {"mode": "live", "generatedAt": generated_at, "events": collected}
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    events_json.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")

    return {"ward": ward, "generatedAt": generated_at, "total": len(collected),
            "ok": ok, "failed": failed, "outfile": str(events_json)}


def main():
    ap = argparse.ArgumentParser(description="児童館PDF→イベントJSON 取り込み（実運用版）")
    ap.add_argument("--ward", required=True,
                    help="取り込む区のID（必須。例: edogawa）。data/centers/<ward>.json を読む")
    ap.add_argument("--center", help="区内のこの館IDだけ再取り込み（既存JSONにマージ）")
    ap.add_argument("--year", type=int, default=date.today().year,
                    help="年の記載が無いPDFを補完する年（既定: 今年）")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        sys.exit("環境変数 GEMINI_API_KEY が未設定です。 https://aistudio.google.com/apikey で無料取得できます。")

    try:
        summary = run_ingest(api_key, args.ward, center=args.center, year=args.year)
    except ValueError as e:
        sys.exit(str(e))

    print("\n==== 取り込みサマリ ====")
    for o in summary["ok"]:
        print(f"  ✓ {o['name']}: {o['kept']} 件")
    for f in summary["failed"]:
        print(f"  ✗ {f['name']}: {f['error']}")
    print(f"合計 {summary['total']} 件を {summary['outfile']} に書き出しました"
          f"（成功 {len(summary['ok'])} 館 / 失敗 {len(summary['failed'])} 館）。")
    if summary["failed"]:
        sys.exit(2)  # 失敗があれば非ゼロ終了（CI等で検知しやすく）


if __name__ == "__main__":
    main()
