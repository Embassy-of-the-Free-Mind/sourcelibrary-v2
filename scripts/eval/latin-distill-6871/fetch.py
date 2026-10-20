#!/usr/bin/env python3
# fetch.py — the training images for the #6871 Latin distillation, long side ≤ 2,400 px (the #5924 bake-off's feed rule).
# PRIOR ART: scripts/eval/latin-bakeoff-5924/fetch-chunk.py (same downscale rule, for backlog pages with no label).
#   python fetch.py <rows.jsonl> <img dir>     resumable; a failed page is listed in <img dir>/failed.txt
import io, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
rows, out = [json.loads(l) for l in open(sys.argv[1]) if l.strip()], sys.argv[2]
os.makedirs(out, exist_ok=True)
def get(r):
    dst = os.path.join(out, r["id"] + ".jpg")
    if os.path.exists(dst): return None
    try:
        with urllib.request.urlopen(urllib.request.Request(r["src"], headers={"User-Agent": "sourcelibrary-eval"}), timeout=120) as f:
            im = Image.open(io.BytesIO(f.read())).convert("RGB")
        if max(im.size) > 2400:
            s = 2400 / max(im.size); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        im.save(dst + ".tmp", "JPEG", quality=92); os.replace(dst + ".tmp", dst)
    except Exception as e:
        return f"{r['id']}\t{e!r}"
with ThreadPoolExecutor(12) as ex:
    bad = [x for x in ex.map(get, rows) if x]
open(os.path.join(out, "failed.txt"), "a").write("".join(b + "\n" for b in bad))
print(f"fetched; failed {len(bad)}")
