#!/usr/bin/env python3
# PRIOR ART: /root/tibetan-eval/kanjur_align.py `retrieve` (shingle votes against ONE pre-built index). Building an
# index over the whole BDRC dump does not fit this box's RAM, so this inverts it: the ~265 discovery pages are the
# index, and the dump is streamed past them once. Same tokeniser and 6-syllable shingle as the aligner.
"""Find which BDRC e-text (if any) carries each BL terma/biography book, from its DISCOVERY pages only.

  python3 discover_refs.py --pages draw/terma-discovery.jsonl --etexts bdrc-etexts.jsonl.gz [bdrc-ucb.jsonl.gz] --out discovery.json
Per discovery page: share of its shingles found in the best e-text file (rid), and that file's W, title, licence.
"""
import argparse, gzip, json, sys
from collections import defaultdict, Counter
sys.path.insert(0, "/root/tibetan-eval")
from kanjur_align import syllables, SHINGLE, TSHEG  # noqa: E402


def shingles(syls):
    return {TSHEG.join(syls[j:j + SHINGLE]) for j in range(len(syls) - SHINGLE + 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", required=True)
    ap.add_argument("--etexts", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    q = [json.loads(l) for l in open(a.pages)]
    inv = defaultdict(list)
    nsh = {}
    for i, p in enumerate(q):
        s = shingles(syllables(p["text"]))
        nsh[i] = len(s)
        for k in s:
            inv[k].append(i)
    hits = defaultdict(Counter)      # query idx -> Counter(rid -> distinct shingles matched)
    meta = {}
    seen = defaultdict(set)          # (query, rid) -> shingles already counted
    for f in a.etexts:
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for n, line in enumerate(fh):
                r = json.loads(line)
                rid = r["rid"]
                for _pn, t in r["pages"]:
                    syls = syllables(t)
                    for j in range(len(syls) - SHINGLE + 1):
                        k = TSHEG.join(syls[j:j + SHINGLE])
                        qs = inv.get(k)
                        if qs:
                            for qi in qs:
                                if k not in seen[(qi, rid)]:
                                    seen[(qi, rid)].add(k)
                                    hits[qi][rid] += 1
                                    meta[rid] = {"coll": r["coll"], "w": r["w"], "title": (r["title"] or "")[:160], "licence": r["licence"]}
                if n % 2000 == 0:
                    print(f, n, file=sys.stderr, flush=True)
    out = []
    for i, p in enumerate(q):
        top = hits[i].most_common(3)
        out.append({"id": p["id"], "book_id": p["book_id"], "work": p["work"], "title": p["title"], "n_shingles": nsh[i],
                    "top": [{"rid": rid, "share": round(c / max(1, nsh[i]), 3), **meta[rid]} for rid, c in top]})
    json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
