#!/usr/bin/env python3
"""
公表予定日 — 各指標の「次に新しい値が出る日」を発行体・再配布元の予定表から取る
----------------------------------------------------
すべて無料・APIキー不要。予定は延期されることがある（2025年10月の政府閉鎖など）ので、
推測で日付を作らず、毎回予定表を読み直す。

- FRED の公表カレンダー  https://fred.stlouisfed.org/releases/calendar?rid=<ID>&y=<年>
    CPI・雇用統計・失業保険週次・NY連銀/フィラデルフィア連銀の製造業調査・H.10（ドル）
    時刻は米中部時間（FRED はセントルイス連銀）。BLS の予定表は自動取得を拒否する（403）ため、
    BLS の公表日もここから読む。
- NAHB の公表日ページ（住宅市場指数）  時刻は米東部 10:00
- FRB の FOMC 日程ページ  声明は2日目の米東部 14:00
"""
import html
import re
import sys
from datetime import date, datetime

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from common import http_get  # noqa: E402

UA_WEB = "Mozilla/5.0 (compatible; macro-monitor/1.0)"
FRED_CAL = "https://fred.stlouisfed.org/releases/calendar?rid={rid}&y={y}&pageID={p}"
NAHB_DATES = ("https://www.nahb.org/news-and-economics/housing-economics/indices/"
              "nahb-wells-fargo-housing-market-index-release-dates")
FOMC_PAGE = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _month(word):
    return MONTHS.get(word.strip(". ").lower()[:3])


def fred_release_dates(rid, years, cache_dir=None, use_cache=True, max_age_hours=12):
    """FRED の公表カレンダーから、ある公表物の予定日を返す。

    戻り値: ([{"date": "2026-12-10", "time": "07:30" or None, "released": bool}], source)
    time は米中部時間。予定がまだ出ていない年は空のまま（推測で埋めない）。
    """
    out, src = [], None
    for y in years:
        for page in range(1, 6):          # 1ページ50件。週次でも年に2ページで足りる
            url = FRED_CAL.format(rid=rid, y=y, p=page)
            body, meta = http_get(url, f"fredcal_{rid}_{y}_{page}.html", cache_dir=cache_dir,
                                  use_cache=use_cache, max_age_hours=max_age_hours, ua=None)
            src = src or {"url": FRED_CAL.format(rid=rid, y=y, p=1).replace("&pageID=1", ""),
                          "retrievedAt": meta.get("retrievedAt"), "stale": meta.get("stale", False)}
            rows = [_text(r) for r in re.findall(r"<tr\b.*?</tr>", body.decode("utf-8", "replace"), re.S)]
            n_before = len(out)
            cur = None
            for r in rows:
                m = re.match(r"^[A-Za-z]+day ([A-Za-z]+) (\d{1,2}), (\d{4})( Updated)?$", r)
                if m:
                    cur = {"date": date(int(m.group(3)), _month(m.group(1)), int(m.group(2))).isoformat(),
                           "time": None, "released": bool(m.group(4))}
                    out.append(cur)
                    continue
                t = re.match(r"^(\d{1,2}):(\d{2}) (am|pm)\b", r)
                if t and cur is not None and cur["time"] is None:
                    h = int(t.group(1)) % 12 + (12 if t.group(3) == "pm" else 0)
                    cur["time"] = f"{h:02d}:{t.group(2)}"
            got = len(out) - n_before
            if got < 50:
                break
    uniq = {o["date"]: o for o in out}
    return sorted(uniq.values(), key=lambda o: o["date"]), src


def nahb_release_dates(cache_dir=None, use_cache=True, max_age_hours=24):
    """NAHB の公表日ページ。戻り値: ([{"date", "period": "2026-11"}], source)"""
    body, meta = http_get(NAHB_DATES, "nahb_release_dates.html", cache_dir=cache_dir,
                          use_cache=use_cache, max_age_hours=max_age_hours, ua=UA_WEB)
    out = []
    for r in re.findall(r"<tr\b.*?</tr>", body.decode("utf-8", "replace"), re.S):
        cells = [_text(c) for c in re.findall(r"<t[dh]\b.*?</t[dh]>", r, re.S)]
        if len(cells) < 2:
            continue
        p = re.match(r"^([A-Za-z]+)\.? ?(\d{4})$", cells[0])
        d = re.match(r"^([A-Za-z]+)\.? ?(\d{1,2}), (\d{4})$", cells[1])
        if p and d and _month(p.group(1)) and _month(d.group(1)):
            out.append({"date": date(int(d.group(3)), _month(d.group(1)), int(d.group(2))).isoformat(),
                        "period": f"{p.group(2)}-{_month(p.group(1)):02d}"})
    if not out:
        raise RuntimeError(f"NAHBの公表日の表を読めませんでした: {NAHB_DATES}")
    return out, {"url": NAHB_DATES, "retrievedAt": meta.get("retrievedAt"), "stale": meta.get("stale", False)}


def fomc_meetings(cache_dir=None, use_cache=True, max_age_hours=24):
    """FRB の FOMC 日程。戻り値: ([{"date": 声明の日（2日目）, "sep": 経済見通しの有無}], source)"""
    body, meta = http_get(FOMC_PAGE, "fomc_calendar.html", cache_dir=cache_dir,
                          use_cache=use_cache, max_age_hours=max_age_hours, ua=UA_WEB)
    text = body.decode("utf-8", "replace")
    heads = [(m.start(), int(m.group(1))) for m in re.finditer(r"(\d{4}) FOMC Meetings", text)]
    out = []
    for i, (pos, year) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        block = text[pos:end]
        for mon, days in re.findall(r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>'
                                    r'.*?fomc-meeting__date[^>]*>([^<]+)<', block, re.S):
            mon_parts = [w for w in re.split(r"[/\-\s]+", mon) if _month(w)]
            day_parts = re.findall(r"\d{1,2}", days)
            if not mon_parts or not day_parts:
                continue
            last_mon = _month(mon_parts[-1])
            out.append({"date": date(year, last_mon, int(day_parts[-1])).isoformat(),
                        "sep": "*" in days, "unscheduled": "unscheduled" in days.lower()})
    if not out:
        raise RuntimeError(f"FOMCの日程を読めませんでした: {FOMC_PAGE}")
    uniq = {o["date"]: o for o in out}
    return sorted(uniq.values(), key=lambda o: o["date"]), {
        "url": FOMC_PAGE, "retrievedAt": meta.get("retrievedAt"), "stale": meta.get("stale", False)}


if __name__ == "__main__":
    y = datetime.now().year
    for rid in (10, 50, 180, 321, 351, 17):
        d, _ = fred_release_dates(rid, (y, y + 1))
        nxt = [o for o in d if not o["released"]][:2]
        print(f"FRED rid={rid}: {len(d)}件 次回 {nxt}")
    d, _ = nahb_release_dates()
    print("NAHB:", d[:3])
    d, _ = fomc_meetings()
    print("FOMC:", [o for o in d if o["date"] >= f"{y}-01-01"][:10])
