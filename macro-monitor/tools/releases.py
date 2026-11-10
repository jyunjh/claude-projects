#!/usr/bin/env python3
"""
公表カレンダー — 「どの指標の値が、いつ新しくなるか」を日本時間で組み立てる
----------------------------------------------------
- 予定日は tools/sources/schedule.py が予定表から読んだものだけを使う。推測で日付を作らない。
  予定表にまだ載っていない先の月は、カレンダーにも出さない。
- 公表時刻は米国の時刻で書かれているので、日本時間に直す（夏時間・冬時間も zoneinfo で正しく扱う）。
- 画面の値が実際に変わるのは、公表の後の最初の定時更新（平日 08:37 JST）。それも並べて出す。
"""
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "sources"))

import schedule as SCH  # noqa: E402

JST = ZoneInfo("Asia/Tokyo")
CT = ZoneInfo("America/Chicago")      # FRED の公表カレンダーの時刻
ET = ZoneInfo("America/New_York")

# 定時更新: .github/workflows/pages.yml の cron "37 23 * * 0-4"（UTC の日〜木 23:37 = JST の月〜金 08:37）
RUN_UTC = time(23, 37)
RUN_UTC_WEEKDAYS = {6, 0, 1, 2, 3}    # Python の weekday(): 月=0 … 日=6
# 公表から FRED などに載るまでの余裕
POST_DELAY = timedelta(minutes=20)

# カレンダーに載せる公表物。indicators は、その公表で値が変わるカードの id
RELEASES = [
    {"id": "cpi", "short": "CPI", "title": "消費者物価指数（CPI）", "by": "米労働統計局（BLS）",
     "fred": 10, "indicators": ["cpi"], "freq": "月次"},
    {"id": "jobs", "short": "雇用統計", "title": "雇用統計（フルタイム/パート・政府雇用）", "by": "米労働統計局（BLS）",
     "fred": 50, "indicators": ["laborQuality"], "freq": "月次"},
    {"id": "claims", "short": "失業保険", "title": "失業保険申請（継続受給者数）", "by": "米労働省（DOL）",
     "fred": 180, "indicators": ["laborQuality"], "freq": "週次", "weekly": True},
    {"id": "empire", "short": "NY連銀", "title": "NY連銀 Empire State 製造業調査", "by": "NY連銀",
     "fred": 321, "indicators": ["pmi", "newOrders"], "freq": "月次"},
    {"id": "philly", "short": "フィラ連銀", "title": "フィラデルフィア連銀 製造業調査", "by": "フィラデルフィア連銀",
     "fred": 351, "indicators": ["pmi", "newOrders"], "freq": "月次"},
    {"id": "nahb", "short": "NAHB", "title": "NAHB 住宅市場指数", "by": "全米住宅建設業者協会（NAHB）",
     "indicators": ["nahb"], "freq": "月次"},
    {"id": "fomc", "short": "FOMC", "title": "FOMC 声明（政策金利の決定）", "by": "FRB",
     "indicators": ["clock18"], "freq": "年8回"},
    {"id": "h10", "short": "ドル指数", "title": "ドル指数（FRB H.10・週次で公表）", "by": "FRB",
     "fred": 17, "indicators": ["twd"], "freq": "週次", "weekly": True},
]

# 予定日を持たない（ほぼ毎日動く・不定期）指標
NOT_SCHEDULED = [
    {"indicators": ["yieldCurve"], "text": "毎営業日（米財務省の利回り。翌朝の定時更新で反映）"},
    {"indicators": ["per"], "text": "毎日（multpl の推定値が日々動く。決算が出そろうと確定値に置き換わる）"},
    {"indicators": ["cbDiffusion"], "text": "不定期（BIS が各国の政策金利をまとめて更新する。公表日の予定表は無い）"},
]


def next_run(after_utc):
    """after_utc 以降の最初の定時更新（UTC）。"""
    d = after_utc.date()
    for k in range(0, 10):
        day = d + timedelta(days=k)
        run = datetime.combine(day, RUN_UTC, tzinfo=timezone.utc)
        if day.weekday() in RUN_UTC_WEEKDAYS and run >= after_utc:
            return run
    return None


def _event(rel, d, t_local, tz, released, extra=None):
    """1件の公表予定を日本時間に直して組み立てる。t_local が無ければ日付だけ。"""
    y, m, dd = (int(x) for x in d.split("-"))
    if t_local:
        hh, mm = (int(x) for x in t_local.split(":"))
        local = datetime(y, m, dd, hh, mm, tzinfo=tz)
        jst = local.astimezone(JST)
        run = next_run(local.astimezone(timezone.utc) + POST_DELAY)
        ev = {"date": jst.date().isoformat(), "timeJst": jst.strftime("%H:%M"),
              "usDate": d, "usTime": f"{t_local}（{'米中部' if tz is CT else '米東部'}）"}
    else:
        # 時刻不明: 米国のその日の終わりに出たとみなして反映日を出す（遅めに見積もる）
        local = datetime(y, m, dd, 23, 59, tzinfo=ET)
        run = next_run(local.astimezone(timezone.utc))
        ev = {"date": d, "timeJst": None, "usDate": d, "usTime": None}
    ev.update({"id": rel["id"], "short": rel["short"], "title": rel["title"],
               "indicators": rel["indicators"], "weekly": bool(rel.get("weekly")),
               "released": bool(released),
               "reflect": run.astimezone(JST).strftime("%Y-%m-%d %H:%M") if run else None})
    if extra:
        ev.update(extra)
    return ev


def build(now=None, cache_dir=None, use_cache=True, log=print):
    """公表カレンダーを組み立てる。1つの予定表が読めなくても、他は出す。

    戻り値: {"events": [...], "next": {指標id: {...}}, "releases": [...], "notScheduled": [...],
             "range": [最初の日, 最後の日], "errors": [...], "sources": [...]}
    """
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(JST).date()
    first = (today.replace(day=1) - timedelta(days=1)).replace(day=1)     # 前月の1日から
    years = (today.year, today.year + 1)
    events, errors, sources = [], [], []
    fetched = set()

    for rel in RELEASES:
        try:
            if "fred" in rel:
                rows, src = SCH.fred_release_dates(rel["fred"], years, cache_dir=cache_dir, use_cache=use_cache)
                for r in rows:
                    events.append(_event(rel, r["date"], r["time"], CT, r["released"]))
                sources.append({"name": f"FRED 公表カレンダー — {rel['title']}", "url": src["url"],
                                "retrievedAt": src["retrievedAt"], "stale": bool(src.get("stale"))})
            elif rel["id"] == "nahb":
                rows, src = SCH.nahb_release_dates(cache_dir=cache_dir, use_cache=use_cache)
                for r in rows:
                    released = r["date"] < today.isoformat()
                    events.append(_event(rel, r["date"], "10:00", ET, released,
                                         {"period": r["period"]}))
                sources.append({"name": "NAHB — HMI Release Dates", "url": src["url"],
                                "retrievedAt": src["retrievedAt"], "stale": bool(src.get("stale"))})
            elif rel["id"] == "fomc":
                rows, src = SCH.fomc_meetings(cache_dir=cache_dir, use_cache=use_cache)
                for r in rows:
                    note = "経済見通し（SEP）あり" if r["sep"] else None
                    released = r["date"] < today.isoformat()
                    events.append(_event(rel, r["date"], "14:00", ET, released,
                                         {"note": note} if note else None))
                sources.append({"name": "FRB — FOMC Meeting Calendars", "url": src["url"],
                                "retrievedAt": src["retrievedAt"], "stale": bool(src.get("stale"))})
            fetched.add(rel["id"])
            log(f"  ✓ 公表予定 {rel['short']}")
        except Exception as e:  # noqa: BLE001
            errors.append({"source": f"公表予定 {rel['short']}", "message": str(e)})
            log(f"  ✗ 公表予定 {rel['short']}: {e}")

    # FRED の「Updated」印は、公表当日の米国時間の朝まで付かない。日本時間の今と比べて上書きする
    now_jst = now.astimezone(JST).strftime("%Y-%m-%d %H:%M")
    for ev in events:
        stamp = f"{ev['date']} {ev['timeJst'] or '23:59'}"
        ev["released"] = ev["released"] or stamp <= now_jst
        ev["reflected"] = bool(ev["reflect"]) and ev["reflect"] <= now_jst

    events = [e for e in events if e["date"] >= first.isoformat()]
    events.sort(key=lambda e: (e["date"], e["timeJst"] or "99:99", e["id"]))

    return {
        "today": today.isoformat(),
        "events": events,
        "next": next_updates(events, now_jst),
        "releases": [{k: r[k] for k in ("id", "short", "title", "by", "freq", "indicators")}
                     | {"weekly": bool(r.get("weekly")), "available": r["id"] in fetched,
                        # 予定表に載っている最後の日。これより先の月は「まだ予定が出ていない」と画面に出す
                        "scheduledThrough": max((e["date"] for e in events if e["id"] == r["id"]), default=None)}
                     for r in RELEASES],
        "notScheduled": NOT_SCHEDULED,
        "range": [first.isoformat(), events[-1]["date"] if events else first.isoformat()],
        "runText": "公表のあと最初の定時更新（平日 08:37 JST）で画面に反映される",
        "errors": errors,
        "sources": sources,
    }


def next_updates(events, now_jst):
    """カードに出す「次の更新」。指標ごとに、まだ画面に反映されていない最も早い予定。"""
    out = {}
    upcoming = [e for e in events if not e["reflected"]]
    for ind in ("cpi", "laborQuality", "nahb", "clock18", "twd"):
        evs = [e for e in upcoming if ind in e["indicators"]]
        main = [e for e in evs if not e["weekly"]]
        pick = (main or evs)[:1]
        if pick:
            e = pick[0]
            item = _next_item(e)
            if ind == "laborQuality":
                wk = [x for x in evs if x["weekly"]][:1]
                if wk:
                    item["also"] = f"継続受給者数は毎週（次回 {_md(wk[0])}）"
            out[ind] = item
    # 地区連銀PMI: NY連銀とフィラデルフィア連銀の両方が出そろった日に値が出る
    by_month = {}
    for e in events:
        if e["id"] in ("empire", "philly"):
            by_month.setdefault(e["date"][:7], {})[e["id"]] = e
    for m in sorted(by_month):
        pair = by_month[m]
        if len(pair) == 2 and not all(x["reflected"] for x in pair.values()):
            later = max(pair.values(), key=lambda x: (x["date"], x["timeJst"] or ""))
            item = _next_item(later)
            item["also"] = f"NY連銀 {_md(pair['empire'])}・フィラデルフィア連銀 {_md(pair['philly'])} の両方がそろった日に更新"
            out["pmi"] = dict(item)
            out["newOrders"] = dict(item)
            break
    for ns in NOT_SCHEDULED:
        for ind in ns["indicators"]:
            out[ind] = {"text": ns["text"], "date": None}
    return out


WD = "月火水木金土日"


def _md(e):
    y, m, d = (int(x) for x in e["date"].split("-"))
    return f"{m}/{d}（{WD[date(y, m, d).weekday()]}）"


def _next_item(e):
    t = f" {e['timeJst']}" if e["timeJst"] else ""
    reflect = ""
    if e["reflect"]:
        rd = datetime.strptime(e["reflect"], "%Y-%m-%d %H:%M")
        reflect = f"、画面への反映は {rd.month}/{rd.day}（{WD[rd.weekday()]}）{rd:%H:%M}"
    return {"date": e["date"], "timeJst": e["timeJst"], "release": e["id"], "reflect": e["reflect"],
            "released": e["released"],
            "text": f"{e['short']} {_md(e)}{t}（日本時間）{'に公表済み' if e['released'] else 'に公表予定'}{reflect}"}


if __name__ == "__main__":
    cal = build()
    for k, v in cal["next"].items():
        print(f"{k:13} {v['text']}" + (f" ／ {v['also']}" if v.get("also") else ""))
    print(len(cal["events"]), "件", cal["range"], "errors:", cal["errors"])
    for e in cal["events"][:12]:
        print(e["date"], e["timeJst"], e["short"], "済" if e["released"] else "予定", "反映", e["reflect"])
