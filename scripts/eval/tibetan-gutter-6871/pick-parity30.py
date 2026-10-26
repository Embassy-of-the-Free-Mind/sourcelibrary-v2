#!/usr/bin/env python3
# pick-parity30.py — the 30 guttered pages the vLLM 0.29 parity run reads (#6871, job yig-vllm-6871).
# PRIOR ART: draw.mjs (this directory) drew the 30 REFERENCE pages from Mongo; this draws from pages the HF full run
# already read (full/<id>.txt + full/timings*.jsonl on gex45), so every pick has an HF read to compare against.
# Text pages only (HF output >= 100 tokens): a blank on both sides says nothing about parity. Seeded, so re-runnable.
#   python3 pick-parity30.py /root/jobs/tib-gutter-6871 > parity30.jsonl
import glob, json, os, random, sys

J = sys.argv[1]
src = {r["id"]: r["src"] for r in map(json.loads, open(f"{J}/full.jsonl"))}
tok = {}
for f in glob.glob(f"{J}/full/timings*.jsonl"):
    for r in map(json.loads, open(f)):
        tok[r["id"]] = r["tokens"]
ok = sorted(i for i, t in tok.items() if t >= 100 and os.path.exists(f"{J}/full/{i}.txt") and i in src)
for i in random.Random(6871).sample(ok, 30):
    print(json.dumps({"id": i, "src": src[i], "hf_tokens": tok[i]}))
