#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-levers/sample.mjs and pareto-6182 draws sample sides of ONE canon by seed; #6750 reused
# #6182's pages. Nothing draws from #6948's frame (Yigdzin + Derge pages with no English) by stratum, one page per book.
"""
sample.py — $0, read-only. The #6948 sample: 30 CANON + 30 OTHER pages, one per book, ≥ 150 syllables, seed 6948.
  python3 scripts/eval/tib-translator-6948/sample.py      reads $JOB_SCRATCH/frame.jsonl, writes $JOB_SCRATCH/sample-candidates.jsonl
The syllable check needs the page text; fetch-pages.mjs reads it for the candidate list (in walk order) and
`sample.py --finish` applies the check and writes sample.jsonl. Prereg: experiments/2026-10-18-tibetan-translator-85k-6948.md
"""
import json, os, re, random, sys, collections

S = os.environ["JOB_SCRATCH"]
CANON = re.compile(r"kanjur|kangyur|tengyur|tanjur|bka['’]? ?['’]?gyur|bstan ?['’]?gyur|བཀའ་འགྱུར|བསྟན་འགྱུར|derge"
                   r"|^(kanjur )?['’]?bum\s+\S+$|khri brgyad stong|nyi khri|brgyad stong", re.I)
CELLS = ("Y_unverified", "Y_stale", "Y_none", "D_none")


def syls(s):  # tengyur-ref/build-reference.py's syls(), verbatim
    return [x for x in re.split(r"[་།\s༄༅༔༑]+", re.sub(r"[#{}\[\]()0-9a-zA-Z,.]", " ", s)) if x]


def stratum(r):
    return "CANON" if r["cell"] == "D_none" or CANON.search((r["title"] or "").strip()) else "OTHER"


rows = [json.loads(l) for l in open(f"{S}/frame.jsonl") if l.strip()]
rows = [r for r in rows if r["cell"] in CELLS]
for r in rows: r["stratum"] = stratum(r)
if "--finish" not in sys.argv:
    w = collections.Counter(r["stratum"] for r in rows)
    json.dump(dict(w), open(f"{S}/strata-weights.json", "w"))
    with open(f"{S}/sample-candidates.jsonl", "w") as f:
        for st in ("CANON", "OTHER"):
            pool = sorted((r for r in rows if r["stratum"] == st), key=lambda r: r["page_id"])
            random.Random(6948).shuffle(pool)
            for r in pool[:1500]: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("weights", dict(w))
else:
    text = {}
    for l in open(f"{S}/candidate-pages.jsonl"):
        p = json.loads(l); text[p["id"]] = p["ocr"]
    picked = []
    for st in ("CANON", "OTHER"):
        pool = sorted((r for r in rows if r["stratum"] == st), key=lambda r: r["page_id"])
        random.Random(6948).shuffle(pool)
        books, n, short = set(), 0, 0
        for r in pool:
            if r["book_id"] in books: continue
            t = text.get(r["page_id"])
            if t is None: sys.exit(f"no text fetched for {r['page_id']}: extend the candidate list")
            if len(syls(t)) < 150: short += 1; continue
            books.add(r["book_id"]); r["syllables"] = len(syls(t)); picked.append(r); n += 1
            if n == 30: break
        print(st, "picked", n, "skipped short", short)
    with open(f"{S}/sample.jsonl", "w") as f:
        for r in picked: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(collections.Counter((r["stratum"], r["cell"]) for r in picked))
