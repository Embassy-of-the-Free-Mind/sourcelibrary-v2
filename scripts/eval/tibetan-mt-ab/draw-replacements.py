#!/usr/bin/env python3
# PRIOR ART: the 2026-09-12 draw that produced handoffs/data/2026-09-25-mtab/mtab-candidates.json
# (ops repo, scratch of job 92486ce4) — same concordance, same identity floor, one page per book;
# it is not in either repo, so the replacement draw is recorded here. /root/tibetan-reocr/candidates.mjs
# draws OCR cohorts, not 84000-matched pages.
"""
draw-replacements.py — top up the #4742 sample when a drawn page's 84000 reference cannot be
located (Toh 8 volumes 22–25 are not in the cached TEI; Toh 557's TEI ends before folio 63).

Same criteria as the original draw: concordance-eap.jsonl rows with Derge identity >= 0.85, one
page per book, books not already in the sample, a Yigdzin read of >= 800 characters. Prints the
candidates in identity order; extract-84000-refs.py then says which resolve.

  python3 draw-replacements.py <concordance.jsonl> <existing-candidates.json> <yigdzin-dir> <out.json> [n]
"""
import json
import os
import re
import sys

conc, existing, yig_dir, out_path = sys.argv[1:5]
n = int(sys.argv[5]) if len(sys.argv) > 5 else 12
used = {c["book"] for c in json.load(open(existing, encoding="utf8"))}
best = {}
for line in open(conc, encoding="utf8"):
    r = json.loads(line)
    if r["book"] in used or r.get("identity", 0) < 0.85 or not r.get("published_84000"):
        continue
    f = f"{yig_dir}/{r['book']}_{int(r['page']):05d}.txt"
    if not os.path.exists(f):
        continue
    t = re.sub(r"<[^>]+>|\s", "", open(f, encoding="utf8").read())
    if len(t) < 800:
        continue
    r["yig_chars"] = len(t)
    if r["book"] not in best or r["identity"] > best[r["book"]]["identity"]:
        best[r["book"]] = r
rows = sorted(best.values(), key=lambda r: -r["identity"])[:n]
json.dump(rows, open(out_path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
for r in rows:
    print(r["book"], r["page"], r["identity"], r["toh"], f"V{r['vol']}", r["folio"], r["yig_chars"])
