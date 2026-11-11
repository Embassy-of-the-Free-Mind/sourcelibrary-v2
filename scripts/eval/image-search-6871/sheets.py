#!/usr/bin/env python3
# sheets.py — blind contact sheets for the #6871 image-search judgement (PREREGISTRATION.md, this directory).
# PRIOR ART: scripts/eval/identify-bench.mjs builds no sheets (rank of a known true image); the #5664 contact sheets
# render text under crops. Here: per query, the union of every arm's top 10, shuffled by a hash, numbered, no arm shown.
#   python sheets.py --out out --img img --queries queries.json --sheets sheets   → sheets/<qid>-<n>.jpg + sheets/key.json
import argparse, glob, hashlib, json, os
from PIL import Image, ImageDraw, ImageFont
ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--img", required=True)
ap.add_argument("--queries", required=True); ap.add_argument("--sheets", required=True); a = ap.parse_args()
os.makedirs(a.sheets, exist_ok=True)
tops = {os.path.basename(f)[:-9]: json.load(open(f)) for f in glob.glob(os.path.join(a.out, "*-top.json"))}
qs = json.load(open(a.queries))["queries"]
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
except OSError: font = ImageFont.load_default()
CELL, COLS, PER = 340, 5, 10
key = {}
for q in qs:
    ids = sorted({pid for arm in tops.values() for pid, _ in arm[q["qid"]]}, key=lambda p: hashlib.sha1((q["qid"] + p).encode()).hexdigest())
    key[q["qid"]] = {"query": q["query"], "images": ids}
    for s in range(0, len(ids), PER):
        chunk = ids[s: s + PER]; rows = (len(chunk) + COLS - 1) // COLS
        sheet = Image.new("RGB", (COLS * CELL, rows * CELL), "white"); d = ImageDraw.Draw(sheet)
        for k, pid in enumerate(chunk):
            im = Image.open(os.path.join(a.img, pid + ".jpg")).convert("RGB"); im.thumbnail((CELL - 12, CELL - 12))
            x, y = (k % COLS) * CELL, (k // COLS) * CELL
            sheet.paste(im, (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
            n = s + k + 1; d.rectangle([x + 2, y + 2, x + 62, y + 50], fill="yellow"); d.text((x + 8, y + 4), str(n), fill="black", font=font)
            d.rectangle([x, y, x + CELL - 1, y + CELL - 1], outline="gray")
        sheet.save(os.path.join(a.sheets, f"{q['qid']}-{s // PER + 1}.jpg"), quality=85)
json.dump(key, open(os.path.join(a.sheets, "key.json"), "w"), indent=0)
print(f"{len(qs)} queries, {sum(len(v['images']) for v in key.values())} images to judge")
