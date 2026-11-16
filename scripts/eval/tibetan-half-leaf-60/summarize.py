#!/usr/bin/env python3
"""summarize.py — per group x arm table, paired differences to arm A with page-bootstrap intervals, the dropped-line
proxy, the controls, and the per-page score file for the repo (#60). No reference text and no page text is written.

PRIOR ART: scripts/eval/tibetan-nyingma-reference/summarize.py (median/IQR/>=0.9 per stratum, one arm, no pairing).

Usage: python3 summarize.py <jobdir> <out-dir>   -> <out-dir>/per-page-scores.jsonl, <out-dir>/summary.json
"""
import json, random, statistics as st, sys
from pathlib import Path

ARMS = ["A", "A2", "W", "B", "C", "C3"]
GROUPS = [("kangyur", "EAP310"), ("nyingma", "EAP310"), ("nyingma", "EAP105")]
BOOT = 10000


def load(f):
    return [json.loads(l) for l in open(f) if l.strip()] if Path(f).exists() else []


def q(v, p):
    v = sorted(v); i = (len(v) - 1) * p; lo = int(i); hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def stats(v):
    if not v:
        return None
    return {"n": len(v), "median": round(st.median(v), 3), "q1": round(q(v, .25), 3), "q3": round(q(v, .75), 3),
            "ge090": sum(x >= 0.90 for x in v), "lt070": sum(x < 0.70 for x in v)}


def paired(d, seed=60):
    if not d:
        return None
    rng = random.Random(seed); n = len(d)
    boots = sorted(st.median(rng.choices(d, k=n)) for _ in range(BOOT))
    return {"n": n, "median_diff": round(st.median(d), 4), "ci95": [round(boots[int(.025 * BOOT)], 4),
            round(boots[int(.975 * BOOT) - 1], 4)], "mean_diff": round(st.mean(d), 4),
            "better": sum(x > 0.005 for x in d), "worse": sum(x < -0.005 for x in d)}


def main():
    J = Path(sys.argv[1]); out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    meta = {m["id"]: m for m in load(J / "score-in" / "pages-meta.jsonl")}
    sc = {}  # (arm, id) -> score row
    for arm in ARMS:
        for s in ("kangyur", "nyingma"):
            for r in load(J / "scores" / f"{arm}-{s}.jsonl"):
                sc[(arm, r["id"])] = r
    rows = []
    for pid, m in meta.items():
        row = {"id": pid, "book_id": pid.rsplit("_", 1)[0], "page_number": int(pid.rsplit("_", 1)[1]), "set": m["set"],
               "collection": m["collection"], "frame_w": m["w"], "frame_h": m["h"], "guttered": m["guttered"],
               "leaf_cut": m["A_path"], "leaves": m["A_n"], "identity_2026_10_01": m["old_identity"]}
        for arm in ARMS:
            r = sc.get((arm, pid))
            if r is None:
                continue
            row[arm] = {"identity": r.get("identity", 0.0), "retrieval": r.get("retrieval", 0.0),
                        "n_syllables": r.get("n_syllables", 0), "lines": m.get(arm, {}).get("lines")}
            if arm in ("C", "C3"):
                row[arm].update({k: m[arm].get(k) for k in ("mismatch_leaves", "joins", "no_overlap")})
        rows.append(row)
    with open(out / "per-page-scores.jsonl", "w") as f:
        for r in sorted(rows, key=lambda r: (r["set"], r["collection"], r["id"])):
            f.write(json.dumps(r) + "\n")

    summ = {"groups": {}}
    for s, c in GROUPS:
        g = [r for r in rows if r["set"] == s and r["collection"] == c]
        G = {"n_pages": len(g), "stored_2026_10_01": stats([r["identity_2026_10_01"] for r in g])}
        for arm in ARMS:
            have = [r for r in g if arm in r]
            if not have:
                continue
            e = {"all": stats([r[arm]["identity"] for r in have]),
                 "off_index": sum(r[arm]["retrieval"] < 0.05 for r in have)}
            pa = [r for r in have if "A" in r]
            if arm != "A":
                e["paired_vs_A"] = paired([r[arm]["identity"] - r["A"]["identity"] for r in pa])
                dl = [r[arm]["lines"] - r["A"]["lines"] for r in pa if r[arm]["lines"] is not None]
                e["lines_vs_A"] = {"fewer": sum(x < 0 for x in dl), "more": sum(x > 0 for x in dl),
                                   "same": sum(x == 0 for x in dl), "median": st.median(dl) if dl else None}
            else:
                e["paired_vs_stored"] = paired([r["A"]["identity"] - r["identity_2026_10_01"] for r in pa])
            if arm in ("C", "C3"):
                clean = [r for r in pa if not r[arm]["mismatch_leaves"]]
                e["mismatch_pages"] = len(pa) - len(clean)
                e["clean"] = stats([r[arm]["identity"] for r in clean])
                e["paired_vs_A_clean"] = paired([r[arm]["identity"] - r["A"]["identity"] for r in clean])
                e["joins"] = sum(r[arm]["joins"] or 0 for r in pa); e["no_overlap"] = sum(r[arm]["no_overlap"] or 0 for r in pa)
            G[arm] = e
        summ["groups"][f"{s}-{c}"] = G
    summ["controls"] = {}
    for name in ("noise05-kangyur", "noise05-gpb"):
        v = load(J / "scores" / "controls" / f"{name}.jsonl")
        if v:
            summ["controls"][name] = {**stats([r.get("identity", 0) for r in v]), "hit": sum(bool(r.get("hit")) for r in v)}
    for s in ("kangyur", "nyingma"):
        v = load(J / "scores" / f"chance-A-{s}.jsonl")
        if v:
            summ["controls"][f"shuffle-A-{s}"] = stats([r.get("identity", 0) for r in v])
    json.dump(summ, open(out / "summary.json", "w"), indent=1)
    print(json.dumps(summ, indent=1))


if __name__ == "__main__":
    main()
