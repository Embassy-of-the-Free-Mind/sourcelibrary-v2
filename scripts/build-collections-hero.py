#!/usr/bin/env python3
"""Build the static Collections hero mosaic (public/collections-hero.jpg).

The /collections hero is a single compressed image (one fast static request)
rather than N <img> loads or an on-the-fly PNG. This script composites a
16x3 grid of collection cover illustrations into a ~290KB progressive JPEG.

Re-run when the cover set should change:
    python3 scripts/build-collections-hero.py

Requires Pillow (`pip install pillow`). Pulls covers from the live public
site, so no DB credentials are needed.
"""
import io
import re
import urllib.request

from PIL import Image

SITE = "https://sourcelibrary.org"
TILE, COLS, ROWS = 160, 16, 3
COUNT = COLS * ROWS
OUT = "public/collections-hero.jpg"

# Hand-picked covers pinned to the front (must match COLLECTION_COVER_OVERRIDES).
FRONT = [
    "https://images.sourcelibrary.org/gallery/695201adab34727b1f0419c7/695201adab34727b1f0419cc-0.jpg",
    "https://images.sourcelibrary.org/gallery/69e9618b2beefe2f6f72bcd1/69e9618b2beefe2f6f72bd7d-0.jpg",
]


def fetch_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")


def fetch_image(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=20).read()
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return None


def source_id(u):
    m = re.search(r"/(gallery|pages|archived)/([^/]+)/", u)
    return m.group(2) if m else u


def collect_urls():
    html = fetch_text(f"{SITE}/collections/all") + fetch_text(f"{SITE}/collections")
    urls = sorted(set(re.findall(r"https://images\.sourcelibrary\.org/[^\"&\\]+\.jpg", html)))
    urls = [u for u in urls if "thumb" not in u]
    # Prefer extracted illustrations, then pages, then raw book scans.
    urls.sort(key=lambda u: (0 if "/gallery/" in u else 1 if "/pages/" in u else 2, u))
    seen, picked = set(), []
    for u in urls:  # one tile per source for variety
        sid = source_id(u)
        if sid in seen:
            continue
        seen.add(sid)
        picked.append(u)
    return FRONT + [u for u in picked if u not in FRONT]


def main():
    canvas = Image.new("RGB", (COLS * TILE, ROWS * TILE), (26, 22, 18))
    tiles = []
    for u in collect_urls():
        if len(tiles) >= COUNT:
            break
        im = fetch_image(u)
        if im is None:
            continue
        w, h = im.size
        s = min(w, h)
        im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
        tiles.append(im.resize((TILE, TILE), Image.LANCZOS))
    if not tiles:
        raise SystemExit("no tiles fetched")
    for idx in range(COUNT):
        r, c = divmod(idx, COLS)
        canvas.paste(tiles[idx % len(tiles)], (c * TILE, r * TILE))
    canvas.save(OUT, "JPEG", quality=72, optimize=True, progressive=True)
    print(f"wrote {OUT} {canvas.size}")


if __name__ == "__main__":
    main()
