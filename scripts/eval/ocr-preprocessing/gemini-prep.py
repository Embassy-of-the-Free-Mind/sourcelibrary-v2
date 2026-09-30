#!/usr/bin/env python3
# PRIOR ART: tibetan-prep.py here (same arms via preprocess.py); scripts/eval/lib/runners.mjs fetchImage (the eval
# fetch, JS). This is the Python fetch + arm-image step for the #5250 Gemini strata, run on Hetzner before any call.
"""gemini-prep.py <dir>: reads <dir>/pages.jsonl, fetches each image once (<dir>/native/<slug>.jpg, polite UA,
0.3 s between requests), writes <dir>/img/<arm>/<slug>.jpg for the six whole-page arms (production 2400 px cap
first, JPEG q95) and <dir>/prep-meta.jsonl. A failed fetch is a logged skip, never a silent drop."""
import json
import os
import sys
import time

import cv2
import numpy as np
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import preprocess as pp  # noqa: E402

UA = "SourceLibrary-eval/0.1 (OCR preprocessing experiment #5250; contact: library@sourcelibrary.org)"


def main():
    d = sys.argv[1]
    os.makedirs(f"{d}/native", exist_ok=True)
    meta = open(f"{d}/prep-meta.jsonl", "a")
    s = requests.Session(); s.headers["User-Agent"] = UA
    for l in open(f"{d}/pages.jsonl"):
        r = json.loads(l); slug = r["slug"]
        nat = f"{d}/native/{slug}.jpg"
        if not os.path.exists(nat):
            time.sleep(0.3)
            try:
                resp = s.get(r["image_url"], timeout=90)
            except Exception as e:
                meta.write(json.dumps({"slug": slug, "skip": f"fetch:{type(e).__name__}"}) + "\n"); continue
            if resp.status_code != 200 or len(resp.content) < 3000:
                meta.write(json.dumps({"slug": slug, "skip": f"http:{resp.status_code}:{len(resp.content)}b"}) + "\n"); continue
            open(nat, "wb").write(resp.content)
        img = cv2.imdecode(np.fromfile(nat, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            meta.write(json.dumps({"slug": slug, "skip": "undecodable"}) + "\n"); continue
        am = {}
        for arm in pp.ARMS:
            os.makedirs(f"{d}/img/{arm}", exist_ok=True)
            out, m = pp.apply(arm, img)
            cv2.imwrite(f"{d}/img/{arm}/{slug}.jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 95])
            am[arm] = {**m, "out_px": list(out.shape[1::-1])}
        meta.write(json.dumps({"slug": slug, "native_px": list(img.shape[1::-1]), "arms": am}) + "\n"); meta.flush()
    print("prep done")


if __name__ == "__main__":
    main()
