#!/usr/bin/env python3
# PRIOR ART: scripts/eval/translation-vs-reference/build-packet.mjs (#5695) builds the blinded xl packets, controls
# and key from records in its README format; pareto-6182/load-xl.mjs writes those records (without candidates) to
# /root/pareto-6182/xl/records.jsonl. This only fills `candidates` for the open-arm companion packet of
# PREREG-open-arms.md (the open arms that ran on xl, plus production and G38 from pareto-6182's arm files) and
# hands the records to build-packet.mjs unchanged.
"""
build-open-xl.py — $0. Writes /root/po6182/xl/records.jsonl (holds reference text: outside the repo, never committed).

  python3 scripts/eval/pareto-6182/build-open-xl.py --arms GM31,GM26,QPL,DSP
  node scripts/eval/translation-vs-reference/build-packet.mjs --input /root/po6182/xl/records.jsonl --out /root/po6182/xljudge --seed 61820 --chunk 8
"""
import json, os, sys

OPEN = sys.argv[sys.argv.index("--arms") + 1].split(",")
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
units = {u["uid"]: u for u in read("/root/pareto-6182/units.jsonl") if u["set"] == "xl"}
text = {a: {r["uid"]: r["text"] for r in read(f"/root/po6182/arms/{a}.jsonl")} for a in OPEN}
for a in ("FP", "L31", "G38"):
    text[a] = {r["uid"]: r["text"] for r in read(f"/root/pareto-6182/arms/{a}.jsonl")}
PROD = {"gemini-3-flash-preview": "FP", "gemini-3.1-flash-lite": "L31"}
out, miss = [], []
for r in read("/root/pareto-6182/xl/records.jsonl"):
    if not r.get("reference_text"):
        continue
    u = units[r["id"]]
    prod = PROD[u["prod_model"]]
    cands = [{"arm": a, "text": text[a].get(r["id"], "")} for a in OPEN] + [{"arm": "PROD", "text": text[prod].get(r["id"], "")}, {"arm": "G38", "text": text["G38"].get(r["id"], "")}]
    miss += [(r["id"], c["arm"]) for c in cands if not c["text"].strip()]
    out.append({"track": r["track"], "lang": r["lang"], "book_id": r["book_id"], "page_number": r["page_number"], "source_text": r["ocr_text"],
                "reference_text": r["reference_text"], "reference_meta": r["reference_meta"], "source_prev_tail": r.get("source_prev_tail"),
                "source_next_head": r.get("source_next_head"), "candidates": cands, "prod_arm": prod, "uid": r["id"]})
os.makedirs("/root/po6182/xl", exist_ok=True)
with open("/root/po6182/xl/records.jsonl", "w") as f:
    for o in out:
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
print(len(out), "records; missing candidate texts:", len(miss), miss[:5])
