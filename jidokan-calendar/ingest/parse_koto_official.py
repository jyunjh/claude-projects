#!/usr/bin/env python3
"""
江東区・児童館 公式ページ（city.koto.lg.jp）専用の取り込み（LLM不使用）
======================================================================
江東区の公式「月間予定表」ページは、予定がHTMLの表として構造化されている:
    | 日にち | 曜日 | 予定 | 時間 |
    | 1日   | 水  | (1)パンダさんひろば (2)…  | (1)11時20分～11時50分 (2)… |
日付が各行に明記され、(1)(2)… の番号で「予定」と「時間」が対応するため、
Gemini などのLLMを使わず Python だけで正確に抽出できる（日付ズレも起きない）。

対象は data/centers/koto.json のうち pdfUrl が city.koto.lg.jp のもの（9館）。
サードパーティ運営館（ashita-ba / mommy 等）はこのパーサの対象外。

使い方:
  python3 ingest/parse_koto_official.py            # 9館すべて取り込み、events/koto.json に反映
  python3 ingest/parse_koto_official.py --dry-run   # 保存せず件数だけ表示
"""

import argparse
import html as htmllib
import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest  # valid_event / normalize / dedupe / load_existing / EVENTS_DIR / JST を再利用

CENTERS_JSON = ingest.CENTERS_DIR / "koto.json"
EVENTS_JSON = ingest.EVENTS_DIR / "koto.json"
UA = "Mozilla/5.0 (jidokan-calendar koto-official parser)"


def fetch_html(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def cell_text(td):
    """<td>内テキストを正規化。1行事＝1ブロック（<p>/<br>/<li>）を改行として残す。"""
    s = re.sub(r"</(p|div|li)>|<br\s*/?>", "\n", td, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = htmllib.unescape(s)
    return s


def split_numbered(text):
    """予定/時間セルを個々の項目に分解して番号付き辞書で返す。
    "(1)A (2)B" → {1:"A", 2:"B"}。番号が無ければ改行（=<p>/<br>区切り）で分割し
    {1:一行目, 2:二行目, ...}。改行も番号も無ければ {1: 全体}。"""
    if re.search(r"\(\d+\)", text):
        parts = re.split(r"\((\d+)\)", text)
        out = {}
        for i in range(1, len(parts), 2):
            n = int(parts[i])
            val = parts[i + 1].strip() if i + 1 < len(parts) else ""
            out[n] = val
        return out
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return {i + 1: ln for i, ln in enumerate(lines)}


def parse_time(text):
    """"11時20分～11時50分" / "16時～17時" → ("11:20","11:50")。取れなければ (None,None)。"""
    def hm(seg):
        m = re.search(r"(\d{1,2})時(?:(\d{1,2})分)?", seg)
        if not m:
            return None
        return f"{int(m.group(1)):02d}:{int(m.group(2) or 0):02d}"
    m = re.split(r"[～〜~\-−]", text, maxsplit=1)
    start = hm(m[0]) if m else None
    end = hm(m[1]) if len(m) > 1 else None
    return start, end


# 予定として扱わない注記（イベントではない行・空欄・休館/なし 等）
SKIP_TITLE = re.compile(
    r"^(休館日?|おやすみ|なし|無し|―+|—+|-+|・+|　*"
    r"|\d{1,2}時(?:\d{1,2}分)?(?:まで|から)?開館"
    r"|開館時間.*|利用案内.*)$")
TIME_HDR = re.compile(r"\d{1,2}時")


def find_month_tables(hz):
    """全角正規化済みHTMLから [(month, table_html), ...] を返す。
    月見出し（N月のカレンダー/予定/行事 等）と各テーブルの位置関係で対応付ける。
    見出しが無いテーブルはテーブル内の 'N月' から推定する。"""
    markers = [(m.start(), int(m.group(1)))
               for m in re.finditer(r"(\d{1,2})月の(?:カレンダー|予定|行事|休館日)", hz)]
    out = []
    for tm in re.finditer(r"<table[^>]*>.*?</table>", hz, re.S):
        tb = tm.group(0)
        if "日にち" not in tb and "曜日" not in tb:
            continue
        month = None
        before = [mo for pos, mo in markers if pos < tm.start()]
        if before:
            month = before[-1]
        else:
            mm = re.search(r"(\d{1,2})月", htmllib.unescape(re.sub(r"<[^>]+>", " ", tb)))
            if mm:
                month = int(mm.group(1))
        if month:
            out.append((month, tb))
    return out


def parse_table(table, year, month):
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
    if not rows:
        return []
    # ヘッダ行を探す（先頭に「8月」だけのキャプション行がある館があるため）
    hdr_i = 0
    for i, r in enumerate(rows):
        cells = [cell_text(x) for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
        if any("日にち" in c or "曜" in c for c in cells):
            hdr_i = i
            break
    header = [cell_text(x).strip() for x in
              re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", rows[hdr_i], re.S)]
    rows = rows[hdr_i:]

    # 列の役割を判定: 日にち / 曜日 / 時間列 / 時間帯列(ヘッダが"9時~13時"等) / 予定列
    day_col = wd_col = time_col = None
    plan_cols = []  # (index, slot_time or None, label or None)
    for idx, h in enumerate(header):
        if "日にち" in h or (idx == 0 and "日" in h):
            day_col = idx
        elif "曜" in h:
            wd_col = idx
        elif h == "時間":
            time_col = idx
        elif TIME_HDR.search(h):
            plan_cols.append((idx, h, None))          # 時間帯列: ヘッダの時刻を適用
        elif idx >= 2:
            plan_cols.append((idx, None, h or None))  # 予定/内容/行事/対象別 列
    if day_col is None:
        day_col = 0
    if not plan_cols:
        return []

    events = []
    for tr in rows[1:]:
        tds = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)
        if len(tds) <= day_col:
            continue
        # 日付セルは「1日」でも「1」でも可（先頭の1〜2桁数字を採用）
        dm = re.match(r"\s*(\d{1,2})", cell_text(tds[day_col]))
        if not dm:
            continue
        day = int(dm.group(1))
        try:
            d = date(year, month, day).isoformat()
        except ValueError:
            continue
        times = split_numbered(cell_text(tds[time_col])) if (time_col is not None and len(tds) > time_col) else {}
        for idx, slot, label in plan_cols:
            if len(tds) <= idx:
                continue
            plans = split_numbered(cell_text(tds[idx]))
            for n, title in plans.items():
                title = re.sub(r"\s+", " ", title).strip()
                if not title or SKIP_TITLE.match(title):
                    continue
                if slot:                       # 時間帯列: ヘッダの時刻
                    start, end = parse_time(slot)
                else:                          # 時間列の (n) と対応
                    start, end = parse_time(times.get(n, ""))
                events.append({
                    "date": d, "dateEnd": None, "start": start, "end": end,
                    "title": title,
                    "description": (f"対象: {label}" if label and label not in ("予定", "内容", "行事") else ""),
                    "ageMin": None, "ageMax": None,
                    "ageLabel": label if (label and label not in ("予定", "内容", "行事")) else None,
                })
    return events


def parse_center(url, fallback_year):
    raw = fetch_html(url)
    hz = unicodedata.normalize("NFKC", raw)
    ym = re.search(r"更新日[：:]\s*(\d{4})年", hz)
    year = int(ym.group(1)) if ym else fallback_year

    tables = find_month_tables(hz)
    if not tables:
        raise RuntimeError("予定表テーブルが見つかりませんでした")
    latest = max(t[0] for t in tables)          # ★最新月を選ぶ（8月号が出ていれば8月）
    events = []
    for month, tb in tables:
        if month == latest:
            events.extend(parse_table(tb, year, month))
    if not events:
        raise RuntimeError(f"{latest}月のイベントを抽出できませんでした")
    return events, latest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--year", type=int, default=date.today().year)
    args = ap.parse_args()

    centers = json.loads(CENTERS_JSON.read_text(encoding="utf-8"))
    official = [c for c in centers if "city.koto.lg.jp" in (c.get("pdfUrl") or "")]

    today = date.today()
    by_center = {}
    for e in ingest.load_existing(EVENTS_JSON):
        by_center.setdefault(e.get("centerId"), []).append(e)

    ok, failed = [], []
    for i, c in enumerate(official):
        cid, name, url = c["id"], c.get("name", c["id"]), c["pdfUrl"]
        if i > 0:
            time.sleep(1)
        try:
            raw, month = parse_center(url, args.year)
            kept = []
            for e in raw:
                if ingest.valid_event(e, today):
                    kept.append(ingest.normalize(e, cid, len(kept) + 1))
            by_center[cid] = kept  # 成功した館だけ差し替え（失敗館は前回分を保持）
            ok.append((name, len(kept)))
            print(f"[OK] {name}: {month}月 {len(kept)} 件")
        except Exception as e:
            failed.append((name, str(e)))
            print(f"[NG] {name}: {e}", file=sys.stderr)

    collected = ingest.dedupe([e for evs in by_center.values() for e in evs])
    collected.sort(key=lambda e: (e.get("date") or "", e.get("start") or ""))
    print(f"\n江東公式 {len(ok)}/{len(official)} 館成功 / events/koto.json 合計 {len(collected)} 件")

    if args.dry_run:
        print("(dry-run: 保存しません)")
        return
    out = {"mode": "live",
           "generatedAt": datetime.now(ingest.JST).isoformat(timespec="seconds"),
           "events": collected}
    EVENTS_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"→ {EVENTS_JSON} を更新")


if __name__ == "__main__":
    main()
