#!/usr/bin/env python3
"""#8182 step 2: how much of each drawn Tibetan page is in BoCorpus (the corpus Yigdzin's synthetic training pages were
rendered from, PROVENANCE.md). Measured, not inferred from a title.

PRIOR ART: none for BoCorpus (no script in scripts/eval or scripts/audit reads it; `git grep -i bocorpus` hits only
PROVENANCE.md). The n-gram-hit shape follows the recitation read-off of
scripts/eval/experiments/2026-10-12-paddle-zh-correct-vs-redo-6561.md (long n-gram hits against a reference), here
against a whole corpus instead of one aligned text.

Input: served.jsonl (group, book_id, page_number, text: our served OCR of the page; private) and bo_corpus.parquet
(openpecha/BoCorpus, CC0). Output, one row a page: the share of the page's distinct syllable 6-grams found anywhere in
BoCorpus, and the collection holding most of them. No text is written.

Run: python overlap.py served.jsonl bo_corpus.parquet out.jsonl
"""
import json, re, sys
from collections import Counter, defaultdict

import pyarrow.parquet as pq

N = 6
SPLIT = re.compile(r"[་།-༔\s༄-༊]+")   # tsheg, shad family, head marks, whitespace


def syls(text):
    return [s for s in SPLIT.split(text) if s]


def grams(ss):
    return {"་".join(ss[i:i + N]) for i in range(len(ss) - N + 1)}


def main(served_path, corpus_path, out_path):
    pages = [json.loads(l) for l in open(served_path, encoding="utf-8")]
    want = defaultdict(set)                                     # gram -> page indexes
    page_grams = []
    for i, p in enumerate(pages):
        g = grams(syls(p["text"]))
        page_grams.append(g)
        for x in g:
            want[x].add(i)
    hit = [set() for _ in pages]
    by_coll = [Counter() for _ in pages]
    t = pq.read_table(corpus_path, columns=["collection", "text"])
    colls, texts = t.column("collection").to_pylist(), t.column("text").to_pylist()
    for d, (coll, text) in enumerate(zip(colls, texts)):
        ss = syls(text or "")
        for k in range(len(ss) - N + 1):
            x = "་".join(ss[k:k + N])
            ps = want.get(x)
            if ps:
                for i in ps:
                    if x not in hit[i]:
                        hit[i].add(x)
                    by_coll[i][coll] += 1
        if d % 100 == 0:
            print(f"doc {d}/{len(texts)}", file=sys.stderr, flush=True)
    with open(out_path, "w") as f:
        for i, p in enumerate(pages):
            n = len(page_grams[i])
            top = by_coll[i].most_common(1)
            f.write(json.dumps({"group": p["group"], "book_id": p["book_id"], "page_number": p["page_number"], "grams": n,
                                "hit": len(hit[i]), "share": round(len(hit[i]) / n, 4) if n else None,
                                "top_collection": top[0][0] if top else None}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(*sys.argv[1:4])
