#!/usr/bin/env python3
"""yigdzin-527 comparison, step 3 (#4523): Derge positive control on Neyphug Kanjur rGyud Ta, both engines.
PRIOR ART: /root/tibetan-eval/kanjur_align.py (the instrument, run as a subprocess, unchanged) and its `score` /
`--control-shuffle` modes; the pages it is fed are the pairs from export-pairs.mjs. Rules: the pre-registration.
Out: derge-<arm>.jsonl, derge-<arm>-shuffle.jsonl, derge-summary.json in the results dir.
"""
import json, os, re, subprocess, statistics, sys
R = sys.argv[1] if len(sys.argv) > 1 else "/root/yig527/results"
BOOK = "6a3702206b486c89426f8d62"
INDEX = "/root/tibetan-eval/etext-index-full.pkl"
TAG = re.compile(r"<[^>]*>")
rows = [json.loads(l) for l in open(f"{R}/pairs-all.jsonl") if f'"{BOOK}"' in l]
rows = [r for r in rows if r["book"] == BOOK]
res = {"book": BOOK, "pairs": len(rows)}
for arm in ("lite", "yig"):
    p = f"{R}/derge-in-{arm}.jsonl"
    with open(p, "w") as f:
        for r in rows: f.write(json.dumps({"id": r["page_id"], "page": r["page"], "text": TAG.sub(" ", r[arm]), "arm": arm}, ensure_ascii=False) + "\n")
    for shuf in (False, True):
        out = f"{R}/derge-{arm}{'-shuffle' if shuf else ''}.jsonl"
        cmd = ["python3", "/root/tibetan-eval/kanjur_align.py", "score", "--index", INDEX, "--pages", p, "--out", out] + (["--control-shuffle"] if shuf else [])
        subprocess.run(cmd, check=True)
        ids = {json.loads(l)["id"]: json.loads(l) for l in open(out)}
        res[f"{arm}{'_shuffle' if shuf else ''}"] = ids
summ = {"book": BOOK, "pairs": len(rows)}
for arm in ("lite", "yig"):
    xs = [v["identity"] for v in res[arm].values()]; fl = [v["identity"] for v in res[f"{arm}_shuffle"].values()]
    summ[arm] = {"median_identity": round(statistics.median(xs), 4) if xs else None, "shuffle_floor_median": round(statistics.median(fl), 4) if fl else None}
diffs = [res["yig"][k]["identity"] - res["lite"][k]["identity"] for k in res["yig"] if k in res["lite"]]
summ["paired_diff_yig_minus_lite"] = {"median": round(statistics.median(diffs), 4) if diffs else None, "yig_wins": sum(d > 0 for d in diffs),
                                      "lite_wins": sum(d < 0 for d in diffs), "ties": sum(d == 0 for d in diffs)}
y = summ["yig"]
summ["instrument_valid"] = bool(y["median_identity"] is not None and y["median_identity"] - y["shuffle_floor_median"] >= 0.20)
json.dump(summ, open(f"{R}/derge-summary.json", "w"), indent=1)
print(json.dumps(summ, indent=1))
