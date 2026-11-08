"""merge_sales.py の蓄積・更新規則のテスト（一時ディレクトリで実行）"""
import datetime as dt, json, os, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SCRIPT = HERE / "ingest" / "merge_sales.py"
today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
D = lambda n: (today + dt.timedelta(days=n)).isoformat()
fails = []

def check(cond, msg):
    if not cond: fails.append(msg)

with tempfile.TemporaryDirectory() as tmp:
    data = Path(tmp)
    (data / "stores.json").write_text(json.dumps({"stores": [{"id": "s1"}, {"id": "s2"}]}))
    (data / "flyers.json").write_text(json.dumps({"flyers": [{"key": "s1:test:1", "storeId": "s1", "hash": "h1"}]}))
    env = dict(os.environ, SALE_ALERT_DATA=str(data))

    def run(records, *extra):
        f = data / "in.json"
        f.write_text(json.dumps(records, ensure_ascii=False))
        p = subprocess.run([sys.executable, str(SCRIPT), "--file", str(f), *extra], env=env, capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def sales():
        return json.loads((data / "sales.json").read_text())["sales"]

    base = [
        {"title": "国産豚こま切れ", "spec": "100gあたり", "price": 98, "priceTaxIncl": 105.84, "priceText": "本体98円", "validFrom": D(0), "validTo": D(2), "category": "肉"},
        {"title": "たまご", "spec": "10個", "price": 198, "validFrom": D(1), "validTo": D(1), "conditions": "お一人様1点", "category": "卵・乳"},
    ]
    rc, out = run(base, "--flyer", "s1:test:1")
    check(rc == 0, "初回反映が成功: " + out)
    first = (data / "sales.json").read_text()
    check(len(sales()) == 2, "2件入る")
    check(sales()[0]["storeId"] == "s1", "チラシの店が入る")
    check(json.loads((data / "flyers.json").read_text())["flyers"][0]["ingestedHash"] == "h1", "ingestedHash を記録")

    rc, out = run(base, "--flyer", "s1:test:1")
    second = (data / "sales.json").read_text()
    strip = lambda s: {k: v for k, v in json.loads(s).items() if k != "generatedAt"}
    check(strip(first) == strip(second) and "unchanged 2" in out, "冪等（generatedAt 以外同一）: " + out)

    changed = [dict(base[0], price=88, priceTaxIncl=95.04)]  # 卵が消え、豚こまが値下げ
    rc, out = run(changed, "--flyer", "s1:test:1")
    s = {x["title"]: x for x in sales()}
    check(s["国産豚こま切れ"]["price"] == 88 and s["国産豚こま切れ"]["history"][0]["price"] == 98, "価格変更が history に残る")
    check(s["たまご"]["status"] == "withdrawn", "差し替えで消えた品は withdrawn")

    rc, out = run([dict(base[0], validFrom=D(-400), validTo=D(-398))], "--check", "--flyer", "s1:test:1")
    check(rc == 2 and "許容範囲" in out, "年の取り違えを拒否")
    rc, out = run([dict(base[0], price=98, priceTaxIncl=980)], "--check", "--flyer", "s1:test:1")
    check(rc == 2 and "税込" in out, "税込の桁違いを拒否")
    rc, out = run([dict(base[0], storeId="s2")], "--check", "--flyer", "s1:test:1")
    check(rc == 2, "チラシの店と違う storeId を拒否")
    rc, out = run([{"title": "牛乳", "price": 158, "validFrom": D(0)}], "--inbox", "in-1", "--store", "s2")
    check(rc == 0 and any(x["flyerKey"] == "inbox:in-1" and x["validTo"] == D(0) for x in sales()), "受付箱由来・validTo 省略は単日: " + out)

print("NG\n" + "\n".join(fails) if fails else "OK (merge)")
sys.exit(1 if fails else 0)
