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

使い方:
  export GEMINI_API_KEY=xxxxx          # 無料キー: https://aistudio.google.com/apikey
  python3 ingest/ingest.py             # 全館を取り込み
  python3 ingest/ingest.py --center kasai   # 指定した館だけ再取り込み（既存にマージ）
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CENTERS_JSON = DATA_DIR / "centers.json"
EVENTS_JSON = DATA_DIR / "events.json"

PRIMARY_MODEL = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-2.5-flash-lite"
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
UA = "jidokan-calendar-ingest/1.0"
JST = timezone(timedelta(hours=9))

# 妥当とみなすイベント日付の範囲（過去/未来に極端な誤抽出を弾く）
PAST_LIMIT_DAYS = 60
FUTURE_LIMIT_DAYS = 400

PROMPT = """このPDFは日本の児童館・子育てひろばが公開している月間イベント予定表（おたより）です。
記載されているイベント・行事・プログラムを漏れなく抽出してください。

出力は JSON 配列のみ。各要素は次のキーを持つこと:
- date: "YYYY-MM-DD"。年の記載が無ければ {year} 年として補完する。
- start: 開始時刻 "HH:MM"（不明なら null）
- end: 終了時刻 "HH:MM"（不明なら null）
- title: イベント名（短く）
- description: 内容の補足（無ければ ""）
- ageMin: 対象年齢の下限（整数の歳。乳児/0歳は0、小学生は6 等。不明なら null）
- ageMax: 対象年齢の上限（整数の歳。小学生は12 等。不明なら null）
- ageLabel: PDF原文に近い対象表記（例 "0〜2歳", "小学生", "どなたでも"）

ルール:
- 日付が確実に特定できないイベントは含めない。
- 開館時間・休館日など「イベントではないもの」は含めない。
- 説明・前置き・コードフェンスは書かず、JSON 配列だけを返す。"""


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def resolve_pdf(url):
    """pdfUrl を取得。HTML ページならページ内の最初の .pdf リンクを解決して再取得する。
    戻り値: (pdf_bytes, used_url)"""
    data, ctype = http_get(url)
    if "application/pdf" in ctype.lower() or url.lower().endswith(".pdf"):
        return data, url
    # HTML とみなして PDF リンクを探す
    html = data.decode("utf-8", "ignore")
    hrefs = re.findall(r'href=["\']([^"\']+?\.pdf)["\']', html, flags=re.IGNORECASE)
    if not hrefs:
        raise RuntimeError("ページ内に PDF リンクが見つかりませんでした（pdfUrl を直リンクに更新してください）")
    pdf_url = urllib.parse.urljoin(url, hrefs[0])
    pdf_bytes, _ = http_get(pdf_url)
    return pdf_bytes, pdf_url


def gemini_extract(pdf_bytes, api_key, year):
    """PDFバイト列を Gemini に渡してイベント配列(list[dict])を得る。"""
    body = json.dumps({
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": "application/pdf",
                                 "data": base64.b64encode(pdf_bytes).decode("ascii")}},
                {"text": PROMPT.format(year=year)},
            ]
        }],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }).encode("utf-8")

    last_err = None
    for model in (PRIMARY_MODEL, FALLBACK_MODEL):
        url = f"{API_BASE}/{model}:generateContent?key={api_key}"
        req = urllib.request.Request(url, data=body,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            if e.code == 429:
                print(f"    {model} が上限(429)。{FALLBACK_MODEL} にフォールバックします。")
                continue
            raise RuntimeError(f"Gemini エラー ({model}): HTTP {e.code} "
                               f"{e.read().decode('utf-8', 'ignore')[:200]}")
    raise RuntimeError(f"Gemini 呼び出しに失敗しました: {last_err}")


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
    return {
        "id": f"{center_id}-{idx:03d}",
        "centerId": center_id,
        "date": ev["date"].strip(),
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


def load_existing():
    """既存 events.json を {mode, generatedAt, events} 形式 or 旧配列形式の両対応で読む。"""
    if not EVENTS_JSON.exists():
        return []
    raw = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))
    return raw.get("events", []) if isinstance(raw, dict) else raw


def run_ingest(api_key, center=None, year=None, log=print):
    """取り込み本体。CLI / ローカルサーバー(serve.py) の両方から呼ぶ。
    events.json を書き出し、サマリ dict を返す。例外は呼び出し側へ。"""
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("Gemini APIキーが指定されていません。")
    year = year or date.today().year

    centers = json.loads(CENTERS_JSON.read_text(encoding="utf-8"))
    if center:
        centers = [c for c in centers if c["id"] == center]
        if not centers:
            raise ValueError(f"児童館ID '{center}' が centers.json に見つかりません。")

    # 単館モードでは既存イベントを残し、その館の分だけ差し替える
    collected = []
    if center:
        collected = [e for e in load_existing() if e.get("centerId") != center]

    today = date.today()
    ok, failed = [], []
    for c in centers:
        cid, name, url = c["id"], c.get("name", c["id"]), c.get("pdfUrl")
        if not url:
            log(f"[skip] {name}: pdfUrl が未設定")
            failed.append({"name": name, "error": "pdfUrl 未設定"})
            continue
        log(f"[取得] {name}")
        try:
            pdf, used = resolve_pdf(url)
            if used != url:
                log(f"    PDFリンクを解決: {used}")
            events = gemini_extract(pdf, api_key, year)
            if not isinstance(events, list):
                raise RuntimeError("Gemini が配列を返しませんでした")
            kept, dropped = [], 0
            for e in events:
                if valid_event(e, today):
                    kept.append(normalize(e, cid, len(kept) + 1))
                else:
                    dropped += 1
            collected.extend(kept)
            ok.append({"name": name, "kept": len(kept), "dropped": dropped})
            log(f"    → {len(kept)} 件抽出（無効 {dropped} 件を除外）")
        except Exception as e:
            log(f"    !! 失敗のためスキップ: {e}")
            failed.append({"name": name, "error": str(e)})

    collected = dedupe(collected)
    collected.sort(key=lambda e: (e.get("date") or "", e.get("start") or ""))

    generated_at = datetime.now(JST).isoformat(timespec="seconds")
    out = {"mode": "live", "generatedAt": generated_at, "events": collected}
    EVENTS_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")

    return {"generatedAt": generated_at, "total": len(collected), "ok": ok, "failed": failed}


def main():
    ap = argparse.ArgumentParser(description="児童館PDF→イベントJSON 取り込み（実運用版）")
    ap.add_argument("--center", help="この館IDだけ再取り込み（既存JSONにマージ）")
    ap.add_argument("--year", type=int, default=date.today().year,
                    help="年の記載が無いPDFを補完する年（既定: 今年）")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        sys.exit("環境変数 GEMINI_API_KEY が未設定です。 https://aistudio.google.com/apikey で無料取得できます。")

    try:
        summary = run_ingest(api_key, center=args.center, year=args.year)
    except ValueError as e:
        sys.exit(str(e))

    print("\n==== 取り込みサマリ ====")
    for o in summary["ok"]:
        print(f"  ✓ {o['name']}: {o['kept']} 件")
    for f in summary["failed"]:
        print(f"  ✗ {f['name']}: {f['error']}")
    print(f"合計 {summary['total']} 件を {EVENTS_JSON} に書き出しました"
          f"（成功 {len(summary['ok'])} 館 / 失敗 {len(summary['failed'])} 館）。")
    if summary["failed"]:
        sys.exit(2)  # 失敗があれば非ゼロ終了（CI等で検知しやすく）


if __name__ == "__main__":
    main()
