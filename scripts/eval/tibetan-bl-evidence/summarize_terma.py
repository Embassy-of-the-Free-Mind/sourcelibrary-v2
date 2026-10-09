#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-nyingma-reference/summarize.py — same stats() shape (median/IQR/>=0.9/off-index);
# extended to one block per work group, and split by whether the book's DISCOVERY pages found a printed witness.
"""Summarise run_terma.sh into summary.json (run from /root/tib-bl-evidence)."""
import json, statistics, sys
from collections import defaultdict
from pathlib import Path

R = Path("results")


def load(p):
    return [json.loads(l) for l in open(p)] if Path(p).exists() else []


def stats(xs, rets=None):
    xs = sorted(xs)
    if not xs:
        return {"n": 0}
    q = statistics.quantiles(xs, n=4) if len(xs) > 1 else [xs[0]] * 3
    out = {"n": len(xs), "median": round(statistics.median(xs), 3), "q1": round(q[0], 3), "q3": round(q[2], 3),
           "ge09": sum(x >= 0.9 for x in xs), "lt05": sum(x < 0.5 for x in xs)}
    if rets is not None:
        out["off_index"] = sum(r < 0.05 for r in rets)
        out["share_off_index"] = round(out["off_index"] / len(rets), 3)
    return out


def scored(rows):
    rows = [r for r in rows if "error" not in r]
    return [r["identity"] for r in rows], [r.get("retrieval", 0.0) for r in rows]


# a book "has a witness" when one of its two discovery pages put >= 0.2 of its shingles in one e-text file
best = defaultdict(float)
for f in ("discovery-main.json", "discovery-ucb.json"):
    for r in json.load(open(f)):
        if r["top"]:
            best[r["book_id"]] = max(best[r["book_id"]], r["top"][0]["share"])
meta = {}
for l in open("draw/terma-scored.jsonl"):
    r = json.loads(l); meta[r["id"]] = r
summary = {"groups": {}, "pooled": {}}
pooled = defaultdict(list)
for d in sorted(p for p in R.iterdir() if p.is_dir()):
    g = d.name
    rows = load(d / "scored.jsonl")
    for r in rows:
        r.update(verdict=meta[r["id"]]["verdict"], book_id=meta[r["id"]]["book_id"], witness=best[meta[r["id"]]["book_id"]] >= 0.2)
    by = defaultdict(list)
    for r in rows:
        by[r["verdict"]].append(r)
        pooled[(r["verdict"], r["witness"])].append(r)
    refmeta = json.load(open(f"refs/{g}/meta.json"))
    summary["groups"][g] = {
        "reference": {"files": len(refmeta["files"]), "pages": sum(f["pages"] for f in refmeta["files"]),
                      "collections": sorted({f["coll"] for f in refmeta["files"]}),
                      "w": sorted({f["w"] for f in refmeta["files"] if f["w"]}),
                      "licence": sorted({f["licence"] or "CC-BY-4.0 (Zenodo 821218 deposit; no per-file statement)" for f in refmeta["files"]})},
        "books": len({r["book_id"] for r in rows}),
        "books_with_witness": len({r["book_id"] for r in rows if r["witness"]}),
        "positive_noise05": stats([r["identity"] for r in load(d / "control-noise05.jsonl")]),
        "chance_shuffle": stats(scored(load(d / "chance-shuffle.jsonl"))[0]),
        "negative_kanjur": stats(*scored(load(d / "negative-kanjur.jsonl"))),
        "by_verdict": {k: stats(*scored(v)) for k, v in sorted(by.items())},
        "serve_with_witness": stats(*scored([r for r in by.get("SERVE", []) if r["witness"]])),
        "serve_without_witness": stats(*scored([r for r in by.get("SERVE", []) if not r["witness"]])),
    }
summary["pooled"] = {f"{v}|{'witness' if w else 'no-witness'}": stats(*scored(rs)) for (v, w), rs in sorted(pooled.items())}
summary["pooled_by_verdict"] = {v: stats(*scored([r for (vv, _w), rs in pooled.items() if vv == v for r in rs]))
                                for v in sorted({v for v, _ in pooled})}
allserve = sorted((r for (v, w), rs in pooled.items() if v == "SERVE" and w for r in rs if "error" not in r), key=lambda r: r["identity"])
summary["serve_witness_pages"] = [[r["identity"], r.get("retrieval"), f"https://sourcelibrary.org/book/{r['book_id']}?page={meta[r['id']]['page_number']}", meta[r["id"]]["title"]] for r in allserve]
json.dump(summary, open(R / "summary.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(summary, indent=1, ensure_ascii=False))
