#!/usr/bin/env python3
# PRIOR ART: hetzner:/root/tibetan-eval/cohort-held-sample.mjs and the #4722 score-guard draw (leaf-run-logs/score-pages.jsonl)
# — both sample Derge-aligned pages but with several pages per book and no interior rule; #5250 needs one interior page
# per book, the locus FIXED before any arm runs, and the book's modal line count. Runs on Hetzner (index + texts live there).
"""Draw the Tibetan referenced substratum for #5250.

Rule (pre-registered on #5250): cohort books, seed 5250, one INTERIOR page per book (skip first 15% and last 5% of
the book's page numbers). A page is referenced when the production read (txt-yigdzin, post per-leaf re-read)
retrieves a Derge e-text locus at window-2 identity >= 0.85 (the #4742 identity floor). Most cohort books are not
Kanjur works (first pass: 11 of 70 books aligned), so candidates are the books with >= 5 pages whose 2026-09-28 verdict
rule was `derge` (verdicts-yig2-20260928T1700Z.jsonl), and tries are drawn from those pages' interior subset. Up to 3
tries per book; every try is logged. The 18 #4722 control pages' books are
excluded here (they are their own substratum). The locus (vol, imgnum) is stored and every arm is later scored
against THAT window, so a retrieval shift can never pass for a reading change.

Out: /root/pp5250/tibetan/referenced.jsonl  {book, page, vol, imgnum, identity_prod, n_syl_prod, lines_prod, mode}
     /root/pp5250/tibetan/draw-log.jsonl    one row per try
"""
import json
import os
import random
import sys
from collections import Counter, defaultdict

sys.path.insert(0, "/root/tibetan-eval")
import pickle  # noqa: E402

import kanjur_align as ka  # noqa: E402

TXT = "/root/tibetan-reocr/txt-yigdzin"
OUT = "/root/pp5250/tibetan"
N_WANT = int(os.environ.get("N_WANT", 100))
os.makedirs(OUT, exist_ok=True)


def nlines(t):
    return sum(1 for l in t.split("\n") if l.strip())


def main():
    cohort = [l.strip() for l in open("/root/tibetan-reocr/cohort-book-ids.txt") if l.strip()]
    ctrl_books = {json.loads(l)["book"] for l in open("/root/tibetan-reocr/_tmp-reread-control18.jsonl")}
    pages = defaultdict(list)
    for f in os.listdir(TXT):
        if f.endswith(".txt"):
            b, p = f[:-4].rsplit("_", 1)
            pages[b].append(int(p))
    idx = pickle.load(open("/root/tibetan-eval/etext-index-full.pkl", "rb"))
    rng = random.Random(5250)
    derge = defaultdict(set)
    for l in open("/root/tibetan-reocr/verdicts-yig2-20260928T1700Z.jsonl"):
        v = json.loads(l)
        if v.get("rule") == "derge":
            derge[v["book"]].add(int(v["page"]))
    books = [b for b in cohort if b in pages and b not in ctrl_books and len(pages[b]) >= 20 and len(derge[b]) >= 5]
    rng.shuffle(books)
    log = open(f"{OUT}/draw-log.jsonl", "w")
    out = []
    for b in books:
        if len(out) >= N_WANT:
            break
        ps = sorted(pages[b])
        lo, hi = int(len(ps) * 0.15), int(len(ps) * 0.95)
        interior = [p for p in ps[lo:hi] if p in derge[b]] or ps[lo:hi]
        tries = rng.sample(interior, min(3, len(interior)))
        for p in tries:
            text = open(f"{TXT}/{b}_{p:05d}.txt", encoding="utf-8").read()
            s = ka.score_page(idx, text)
            row = {"book": b, "page": p, **{k: s.get(k) for k in ("identity", "vol", "imgnum", "n_syllables", "error")}}
            log.write(json.dumps(row) + "\n")
            if s.get("identity", 0) >= 0.85 and s.get("window") == 2:
                modes = Counter()
                for q in ps:
                    modes[nlines(open(f"{TXT}/{b}_{q:05d}.txt", encoding="utf-8").read())] += 1
                mode = max((c, n) for n, c in modes.items() if n > 0)[1]
                out.append({"book": b, "page": p, "vol": s["vol"], "imgnum": s["imgnum"],
                            "identity_prod": s["identity"], "n_syl_prod": s["n_syllables"],
                            "lines_prod": nlines(text), "mode": mode, "book_pages": len(ps)})
                break
        log.flush()
    with open(f"{OUT}/referenced.jsonl", "w") as f:
        for r in out:
            f.write(json.dumps(r) + "\n")
    print(json.dumps({"referenced": len(out), "books_tried": sum(1 for _ in open(f"{OUT}/draw-log.jsonl"))}))


if __name__ == "__main__":
    main()
