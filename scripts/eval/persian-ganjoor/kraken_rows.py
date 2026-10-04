#!/usr/bin/env python3
"""kraken_rows.py — turn one Kraken model's per-page .txt output into sample.jsonl rows for persian_align.py (#5525).

PRIOR ART: scripts/eval/persian-ganjoor/ocr_flash.mjs writes the same row shape for the Gemini arms; this is its
Kraken twin. Text is Kraken's line output in blla reading order (one line per segmented baseline), NFC-normalised
(the OpenITI models emit NFD); the page metadata comes from the Stage 1 sample, minus its served text.

Usage: kraken_rows.py <sample.jsonl> <strata.json> <outdir-of-one-model> <arm-label> > rows.jsonl
"""
import json, os, sys, unicodedata

sample, strata_path, outdir, arm = sys.argv[1:5]
strata = json.load(open(strata_path))
for line in open(sample):
    r = json.loads(line)
    if (strata.get(r["id"]) or {}).get("stratum") != "manuscript": continue
    p = os.path.join(outdir, r["id"] + ".txt")
    if not os.path.exists(p):
        print(f"missing {p}", file=sys.stderr); continue
    text = unicodedata.normalize("NFC", open(p, encoding="utf-8").read())
    r.pop("text", None)
    r.update({"arm": arm, "text": text, "n_lines_raw": sum(1 for ln in text.splitlines() if ln.strip())})
    print(json.dumps(r, ensure_ascii=False))
