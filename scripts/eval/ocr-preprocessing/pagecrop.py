#!/usr/bin/env python3
# PRIOR ART: gutter.py here (the lane's findGutter port) — it never fires on the published-GT set: the Jerusalem
# SMMJ 36 images are two-page spreads whose fold is a DARK shadow, not an inkless band, and ÖNB Syr. 1 images are
# single leaves (checked by eye 2026-09-29). This is the Syriac analog of the Tibetan leafcrop: crop the reading
# unit from the NATIVE capture, then apply the production 2400 px cap, so a spread's pages gain resolution.
"""pagecrop.py <manifest.json> <native_dir> <out_dir>

Per GT image: paper bbox = largest bright component (Otsu on a blurred 600-px grey). If the bbox aspect > 1.25 it is
a spread: cut at the darkest column (the fold shadow) inside 42-58% of the bbox width; write <slug>.R.jpg (right
page, read first: RTL) and <slug>.L.jpg. Else write <slug>.R.jpg only (the page, background removed). Each crop is
downscaled to <= 2400 px wide with Lanczos, JPEG q95. Prints one JSON meta line per page.
"""
import json
import os
import sys

import cv2
import numpy as np

TARGET_W = 2400


def cap(img):
    h, w = img.shape[:2]
    return img if w <= TARGET_W else cv2.resize(img, (TARGET_W, round(h * TARGET_W / w)), interpolation=cv2.INTER_LANCZOS4)


def paper_bbox(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    s = 600 / g.shape[1]
    small = cv2.GaussianBlur(cv2.resize(g, (600, round(g.shape[0] * s)), interpolation=cv2.INTER_AREA), (9, 9), 0)
    _, m = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return (0, 0, img.shape[1], img.shape[0]), small
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h = stats[k, :4]
    return tuple(int(round(v / s)) for v in (x, y, w, h)), small


def main():
    manifest, native, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    for m in json.load(open(manifest)):
        slug, stem, gset = m["slug"], m["stem"], m["set"]
        cands = [os.path.join(native, gset, f) for f in (f"{stem}.JPG", f"{stem}.jpg", f"images/{stem}.jpg")]
        src = next((c for c in cands if os.path.exists(c)), None)
        if not src:
            print(json.dumps({"slug": slug, "meta": {"arm": "pagecrop", "error": "no native"}})); continue
        img = cv2.imread(src)
        (x, y, w, h), small = paper_bbox(img)
        meta = {"arm": "pagecrop", "native_px": [img.shape[1], img.shape[0]], "bbox": [x, y, w, h]}
        if w / max(1, h) > 1.25:
            g = cv2.cvtColor(img[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY).astype(np.float32)
            prof = cv2.blur(g.mean(axis=0).reshape(1, -1), (31, 1)).ravel()
            a, b = int(w * 0.42), int(w * 0.58)
            cut = x + a + int(np.argmin(prof[a:b]))
            R, L = img[y:y + h, cut:x + w], img[y:y + h, x:cut]
            cv2.imwrite(os.path.join(out, f"{slug}.R.jpg"), cap(R), [cv2.IMWRITE_JPEG_QUALITY, 95])
            cv2.imwrite(os.path.join(out, f"{slug}.L.jpg"), cap(L), [cv2.IMWRITE_JPEG_QUALITY, 95])
            meta.update(spread=True, cut_frac=round((cut - x) / w, 4), out_px=[list(cap(R).shape[1::-1]), list(cap(L).shape[1::-1])])
        else:
            P = cap(img[y:y + h, x:x + w])
            cv2.imwrite(os.path.join(out, f"{slug}.R.jpg"), P, [cv2.IMWRITE_JPEG_QUALITY, 95])
            meta.update(spread=False, out_px=[list(P.shape[1::-1])])
        print(json.dumps({"slug": slug, "meta": meta}))


if __name__ == "__main__":
    main()
