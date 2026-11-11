#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tib-translator-6948/sample.py — the same walk (sort by page id, shuffle with Random(6948), one
# page per book, ≥ 150 Tibetan syllables); here the strata are the two stored-English cohorts and the walk stops at 20.
"""
sample.py — $0, read-only. Reads $JOB_SCRATCH/frame.jsonl (frame.mjs), writes $JOB_SCRATCH/sample.jsonl:
20 pages per cohort (gemini-3.8-flash-low, gemini-3-flash-preview), one per book, ≥ 150 syllables, seed 6948.
Prereg: scripts/eval/experiments/2026-10-18-tibetan-stored-english-6948.md
"""
import json, os, random, collections

S = os.environ["JOB_SCRATCH"]
COHORTS = {"gemini-3.8-flash-low": "S38", "gemini-3-flash-preview": "S3P"}
rows = [json.loads(l) for l in open(f"{S}/frame.jsonl") if l.strip()]
picked = []
for model, tag in COHORTS.items():
    pool = sorted((r for r in rows if r["cohort"] == model), key=lambda r: r["page_id"])
    random.Random(6948).shuffle(pool)
    books, short = set(), 0
    for r in pool:
        if r["book_id"] in books: continue
        if r["syl"] < 150: short += 1; continue
        books.add(r["book_id"]); r["stratum"] = tag; picked.append(r)
        if len(books) == 20: break
    print(tag, model, "picked", len(books), "skipped short", short, collections.Counter(r["kind"] for r in picked if r["stratum"] == tag))
with open(f"{S}/sample.jsonl", "w") as f:
    for r in picked: f.write(json.dumps(r, ensure_ascii=False) + "\n")
json.dump(dict(collections.Counter(COHORTS[r["cohort"]] for r in rows)), open(f"{S}/strata-weights.json", "w"))
