"""チラシの取得元ごとの解析（check_flyers.py から使う）。標準ライブラリのみ。

各 adapter は stores.json の source（{"kind", "url", …}）を受け取り、その時点で掲載中のチラシを返す:
  [{"id": "取得元でのチラシID（無ければ画像URLのハッシュ）", "title": str|None,
    "periodText": str|None, "pageUrl": str, "images": ["画像 or PDF のURL", …]}]

取得元を追加するときは関数を書いて ADAPTERS に登録する。
使わない取得元: トクバイ（robots.txt で Claude/Anthropic を拒否）。
"""
from __future__ import annotations

import hashlib
import html
import re
import urllib.parse
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) sale-alert/1.0 (personal use)"
TIMEOUT = 30


def fetch(url: str, referer: str | None = None) -> bytes:
    headers = {"User-Agent": UA, "Accept-Language": "ja"}
    if referer:
        headers["Referer"] = referer
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT) as r:
        return r.read()


def fetch_text(url: str) -> str:
    raw = fetch(url)
    for enc in ("utf-8", "cp932", "euc_jp"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def short_hash(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


def download_images(urls: list[str], dest: Path) -> tuple[list[Path], str]:
    """画像（PDF含む）を dest に保存し、(パス一覧, 全バイト列のハッシュ) を返す"""
    dest.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha1()
    paths = []
    for i, u in enumerate(urls, 1):
        data = fetch(u)
        h.update(data)
        ext = Path(urllib.parse.urlparse(u).path).suffix.lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"):
            ext = ".pdf" if data[:4] == b"%PDF" else ".png" if data[:4] == b"\x89PNG" else ".jpg"
        p = dest / f"{i:02d}{ext}"
        p.write_bytes(data)
        paths.append(p)
    return paths, h.hexdigest()


# ───────── 汎用: ページ内の画像/PDFリンクを正規表現で拾う ─────────

def page_regex(src: dict) -> list[dict]:
    """source: {"kind": "page", "url": ページURL, "pattern": 画像/PDFのURLに一致する正規表現,
                "period": （任意）掲載期間の文言に一致する正規表現}
    ページ内のチラシ画像（またはPDF）を1枚のチラシとして返す。チェーン公式サイトの店舗チラシページ向け。"""
    text = fetch_text(src["url"])
    found = []
    for m in re.finditer(r"""(?:src|href|data-src|content)\s*=\s*["']([^"']+)["']""", text):
        u = urllib.parse.urljoin(src["url"], html.unescape(m.group(1)))
        if re.search(src["pattern"], u) and u not in found:
            found.append(u)
    if not found:
        return []
    period = None
    if src.get("period"):
        pm = re.search(src["period"], re.sub(r"<[^>]+>", " ", text))
        period = re.sub(r"\s+", " ", pm.group(0)).strip() if pm else None
    return [{"id": short_hash(*found), "title": src.get("title"), "periodText": period,
             "pageUrl": src["url"], "images": found}]


# ───────── Shufoo!（robots.txt で許可。個人利用・1日2回・新しい号だけ画像を取得） ─────────

_SHUFOO_ITEM = re.compile(
    r'<li class="shop_chirashi_list_item[^"]*">(.*?)</li>', re.S)


def shufoo(src: dict) -> list[dict]:
    """source: {"kind": "shufoo", "url": "https://www.shufoo.net/pntweb/shopDetail/<shopId>/"}
    店舗ページのチラシ一覧から、号ごとに原寸のページ画像（index/orig/<n>.jpg）を返す。
    id = チラシID（chirashiId）、version = コンテンツID（差し替えで変わる）。"""
    text = fetch_text(src["url"])
    out = []
    for m in _SHUFOO_ITEM.finditer(text):
        li = m.group(1)
        cid = re.search(r"/shopDetail/\d+/(\d+)/", li)
        thumb = re.search(r'src="(//ipqcache\d*\.shufoo\.net/c/[^"]+?/)index/img/thumb/[^"]+"', li)
        content = re.search(r'data-content_id="(\d+)"', li)
        title = re.search(r'class="shop_chirashi_list_title">([^<]+)<', li)
        if not (cid and thumb):
            continue
        base = "https:" + thumb.group(1)
        out.append({
            "id": cid.group(1),
            "version": content.group(1) if content else base,
            "title": html.unescape(title.group(1)).strip() if title else None,
            "periodText": html.unescape(title.group(1)).strip() if title else None,
            "pageUrl": urllib.parse.urljoin(src["url"], f"{cid.group(1)}/"),
            "resolve": lambda base=base: _shufoo_pages(base),
        })
    return out


def _shufoo_pages(base: str) -> list[str]:
    xml = fetch(base + "index/contents.xml").decode("cp932", "replace")
    m = re.search(r"<totalPages>(\d+)</totalPages>", xml)
    n = int(m.group(1)) if m else 1
    return [f"{base}index/orig/{i}.jpg" for i in range(min(n, 12))]


ADAPTERS = {
    "page": page_regex,
    "shufoo": shufoo,
}
