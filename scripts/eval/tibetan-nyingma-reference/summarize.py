#!/usr/bin/env python3
# PRIOR ART: /root/tibetan-eval/redraw-2026-10-01/summ_redraw.py (Hetzner) — same median/IQR/ge09/lt05 shape,
# extended with the served-verdict split and the off-index (retrieval ~ 0) share this question needs.
"""Summarise the Nyingma-reference scoring run into summary.json (run from /root/nyingma-ref)."""
import json, statistics
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
           "ge09": sum(x >= 0.9 for x in xs), "share_ge09": round(sum(x >= 0.9 for x in xs) / len(xs), 3),
           "lt05": sum(x < 0.5 for x in xs)}
    if rets is not None:
        out["retrieval_lt005"] = sum(r < 0.05 for r in rets)
        out["share_off_index"] = round(sum(r < 0.05 for r in rets) / len(rets), 3)
    return out


def scored(rows):
    rows = [r for r in rows if "error" not in r]
    return [r["identity"] for r in rows], [r.get("retrieval", 0.0) for r in rows]


meta = {json.loads(l)["id"]: json.loads(l) for l in open("draw/nyingma-sample.jsonl")}
ny = load(R / "nyingma.jsonl")
by = defaultdict(list)
for r in ny:
    by[meta[r["id"]]["verdict"]].append(r)
summary = {
    "reference": json.load(open("Gpb.opf/meta.json")),
    "controls": {
        "positive_noise05": stats([r["identity"] for r in load(R / "control-noise05.jsonl")]),
        "positive_noise05_hit_rate": round(sum(r["hit"] for r in load(R / "control-noise05.jsonl")) / max(1, len(load(R / "control-noise05.jsonl"))), 3),
        "positive_noise05_span2": stats([r["identity"] for r in load(R / "control-noise05-span2.jsonl")]),
        "chance_shuffle": stats(scored(load(R / "chance-shuffle.jsonl"))[0]),
        "negative_kanjur_vs_nyingma": stats(*scored(load(R / "negative-kanjur.jsonl"))),
    },
    "bridge_bl_other_2026-10-01": stats(*scored(load(R / "bridge-bl-other.jsonl"))),
    "nyingma_all_one_per_book_per_class": stats(*scored(ny)),
    "nyingma_by_served_verdict": {k: stats(*scored(v)) for k, v in sorted(by.items())},
    "too_short": sum("error" in r for r in ny),
}
# The headline is SERVE (one page per book, the served text a reader sees).
worst = sorted((r for r in by.get("SERVE", []) if "error" not in r), key=lambda r: r["identity"])[:8]
summary["worst_serve"] = [[r["identity"], r.get("retrieval"), f"https://sourcelibrary.org/book/{meta[r['id']]['book_id']}?page={meta[r['id']]['page_number']}", meta[r["id"]]["title"]] for r in worst]
json.dump(summary, open(R / "summary.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(summary, indent=1, ensure_ascii=False))
