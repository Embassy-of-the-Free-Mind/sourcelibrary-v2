#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-levers/score-ref.py (#6121: unblinds J1/J2 against key.json, the plant/dup
# gate, fidelity means, inversions, sign-flip p). Its arm list, paths and rule are round 2's; this scores
# the companion packet of PREREG-open-arms.md (6 open arms + FP/G38 anchors) with PREREG.md's gate
# (≥ 6/8 plants, ≥ 3/4 duplicate ties) and rule-B quantities, and adds cost from the arm files.
"""
score-open.py — $0. Reads /root/po6182/refjudge/out-J{1,2}-*.jsonl + results/pareto-6182/open/refjudge/key.json,
writes results/pareto-6182/open/refjudge/scores.json (NUMBERS ONLY: no reference text, no quotes).

  python3 scripts/eval/pareto-6182/score-open.py [--anchor scripts/eval/results/pareto-6182/tibjudge/scores.json]
"""
import glob, json, random, statistics, sys

OUT = "scripts/eval/results/pareto-6182/open/refjudge"
key = json.load(open(f"{OUT}/key.json"))
J = {"J1": {}, "J2": {}}
for f in glob.glob("/root/po6182/refjudge/out-J*-*.jsonl"):
    j = f.split("/")[-1].split("-")[1]
    for l in open(f):
        if l.strip():
            o = json.loads(l); J[j][o["id"]] = o
missing = {j: [i for i in key if i not in J[j]] for j in J}
assert not any(missing.values()), missing
OPEN = ["GM31", "GM26", "QMX", "QPL", "Q27", "DSP"]
ARMS = OPEN + ["FP", "G38"]
MODEL = {"GM31": "gemma-4-31b-it", "GM26": "gemma-4-26b-a4b-it", "QMX": "qwen/qwen3.6-max-preview", "QPL": "qwen/qwen3.6-plus",
         "Q27": "qwen/qwen3.6-27b", "DSP": "deepseek/deepseek-v4-pro", "FP": "gemini-3-flash-preview", "G38": "gemini-3.8-flash"}


def unblind(j, iid):
    o, lab = J[j][iid], key[iid]["labels"]
    return {lab[t]: s for t, s in o["scores"].items()}, [[lab[t] for t in tier] for tier in o["ranking"]]


gate = {}
for j in J:
    pc = pn = dt = dn = 0
    for iid, k in key.items():
        if k["kind"] == "PLANT":
            sc, _ = unblind(j, iid); pn += 1
            pc += len(sc["FP_PLANT"]["inversions"]) > len(sc["FP"]["inversions"]) or sc["FP_PLANT"]["fidelity"] < sc["FP"]["fidelity"]
        elif k["kind"] == "DUP":
            _, rk = unblind(j, iid); dn += 1
            dt += any({"FP", "FP_DUP"} <= set(t) for t in rk)
    gate[j] = {"plant_caught": pc, "plants": pn, "dup_tie": dt, "dups": dn, "pass": pc >= 6 and dt >= 3}

rows = []
for iid, k in key.items():
    if k["kind"] != "ARMS":
        continue
    per = {}
    for j in J:
        sc, rk = unblind(j, iid)
        per[j] = {a: {"fid": sc[a]["fidelity"], "inv": len(sc[a]["inversions"]), "om": len(sc[a]["omissions"]),
                      "rank": next(i for i, t in enumerate(rk) if a in t)} for a in ARMS}
    rows.append({"page_id": k["page_id"], "set": k["set"], "toh": k["toh"], "J": per})

# cost from the arm files: $ per 1,000 pages (Gemma: OpenRouter list on its measured tokens; billed $0 on the Gemini API)
units = {json.loads(l)["uid"] for l in open("/root/pareto-6182/units.jsonl") if json.loads(l)["set"] in ("tib-ref58", "tib-ref113")}
cost = {}
for a in OPEN:
    rs = [json.loads(l) for l in open(f"/root/po6182/arms/{a}.jsonl")]
    rs = [r for r in rs if r["uid"] in units]
    cost[a] = {"usd_per_1k": round(1000 * sum(r["usd_batch"] or 0 for r in rs) / len(rs), 3), "billed_per_1k": round(1000 * sum(r["usd_billed"] or 0 for r in rs) / len(rs), 3),
               "basis": "OpenRouter list price on measured tokens (billed $0 on the Gemini API)" if a.startswith("GM") else "OpenRouter billed usage.cost, realtime (no Batch tier)",
               "providers": sorted({r.get("provider") or "" for r in rs}), "format_fail": sum(not r["format"]["ok"] for r in rs), "pages": len(rs),
               "mean_in": round(statistics.mean(r["in"] for r in rs)), "mean_out": round(statistics.mean(r["out"] for r in rs)), "thinking": sum(r["thinking"] for r in rs)}
# the anchors' Batch $/1,000 from pareto-6182's own collected jobs on the same 171 sides where they ran there (#6121 round 2 figures otherwise)
# StreamLake-only (the pinned provider) for DSP: the first 101 rows also went to Novita/Cloudflare at ~15x
for a in OPEN:
    rs = [json.loads(l) for l in open(f"/root/po6182/arms/{a}.jsonl")]
    by = {}
    for r in rs:
        by.setdefault(r.get("provider") or "", []).append(r)
    cost[a]["per_provider_per_1k"] = {p: round(1000 * sum(x["usd_billed"] or 0 for x in v) / len(v), 3) for p, v in by.items()}
# the anchors: Batch $/1,000 billed in pareto-6182's run (its stage-2 comment on #6182, 2026-10-07)
cost["FP"] = {"usd_per_1k": 1.78, "basis": "Batch, billed in pareto-6182 (stage-2 comment, 2026-10-07)"}
cost["G38"] = {"usd_per_1k": 2.34, "basis": "Batch, billed in pareto-6182 (stage-2 comment, 2026-10-07)"}


def boot(d, seed=6182):
    rng = random.Random(seed); n = len(d)
    bs = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(2000))
    return [round(bs[50], 2), round(bs[1949], 2)]


def summary(rs):
    n = len(rs); o = {"sides": n}
    for a in ARMS:
        fid = [sum(r["J"][j][a]["fid"] for j in J) / 2 for r in rs]
        d = [f - sum(r["J"][j]["FP"]["fid"] for j in J) / 2 for f, r in zip(fid, rs)]
        o[a] = {"model": MODEL[a], "fidelity": round(sum(fid) / n, 2), "fidelity_ci": boot(fid),
                "delta_vs_FP": round(sum(d) / n, 2), "delta_vs_FP_ci": boot(d) if a != "FP" else [0, 0],
                "inversion_pages_per100_either": round(100 * sum(1 for r in rs if any(r["J"][j][a]["inv"] for j in J)) / n, 1),
                "inversions_total": sum(r["J"][j][a]["inv"] for r in rs for j in J),
                "omission_pages_either": sum(1 for r in rs if any(r["J"][j][a]["om"] for j in J)),
                "mean_rank": round(sum(r["J"][j][a]["rank"] for r in rs for j in J) / (2 * n), 2), **cost[a]}
    return o


res = {"gate": gate, "date": "2026-10-07", "packet": "companion (PREREG-open-arms.md), build-open-packet.py, JUDGE-PROMPT-REF-R3.md, 2 Opus judges",
       "all": summary(rows), "by_set": {s: summary([r for r in rows if r["set"] == s]) for s in ("tib-ref58", "tib-ref113")},
       "judge_fid_agree_within_1": round(sum(abs(r["J"]["J1"][a]["fid"] - r["J"]["J2"][a]["fid"]) <= 1 for r in rows for a in ARMS) / (len(ARMS) * len(rows)), 3),
       "per_page": [{"page_id": r["page_id"], "set": r["set"], "fid": {a: sum(r["J"][j][a]["fid"] for j in J) / 2 for a in ARMS},
                     "inv_either": {a: any(r["J"][j][a]["inv"] for j in J) for a in ARMS}} for r in rows]}

# Anchoring (PREREG-open-arms.md): fid(production in pareto-6182's packet) + Δ(arm − production here); drift of G38 − FP between packets.
if "--anchor" in sys.argv:
    an = json.load(open(sys.argv[sys.argv.index("--anchor") + 1]))
    res["anchor"] = an  # filled by the caller's shape; see verdict
# Frontier inside this packet (rule B): non-dominated on (cost ≤, fidelity ≥); margin = best − 0.25 and reversals ≤ best + 8/100.
A = res["all"]
best = max(ARMS, key=lambda a: A[a]["fidelity"])
res["frontier"] = sorted([a for a in ARMS if not any(A[b]["usd_per_1k"] <= A[a]["usd_per_1k"] and A[b]["fidelity"] >= A[a]["fidelity"] and (A[b]["usd_per_1k"], A[b]["fidelity"]) != (A[a]["usd_per_1k"], A[a]["fidelity"]) for b in ARMS)], key=lambda a: A[a]["usd_per_1k"])
res["dominated"] = {a: next(b for b in sorted(ARMS, key=lambda b: A[b]["usd_per_1k"]) if A[b]["usd_per_1k"] <= A[a]["usd_per_1k"] and A[b]["fidelity"] >= A[a]["fidelity"] and b != a) for a in ARMS if a not in res["frontier"]}
res["best"] = best
res["inside_margin"] = [a for a in ARMS if A[a]["fidelity"] >= A[best]["fidelity"] - 0.25 and A[a]["inversion_pages_per100_either"] <= A[best]["inversion_pages_per100_either"] + 8]
# Points for the frontier chart (build-translation-pareto.mjs shape: one row per arm, stratum Tibetan)
pts = [{"stratum": "Tibetan", "set": "tib-ref58+tib-ref113", "arm": a, "model": A[a]["model"], "open_weights": a in ("GM31", "GM26", "Q27", "DSP"),
        "fidelity": A[a]["fidelity"], "fidelity_ci": A[a]["fidelity_ci"], "delta_vs_production": A[a]["delta_vs_FP"], "delta_ci": A[a]["delta_vs_FP_ci"],
        "reversal_pages_per100": A[a]["inversion_pages_per100_either"], "usd_per_1k": A[a]["usd_per_1k"], "cost_basis": A[a]["basis"], "sides": A["sides"],
        "packet": "companion (open arms + FP/G38 anchors)", "date": "2026-10-07"} for a in ARMS]
json.dump(pts, open("scripts/eval/results/pareto-6182/open/frontier-points.json", "w"), indent=1)
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1)
print("gate", gate, "agree", res["judge_fid_agree_within_1"])
for name, s in [("ALL", res["all"])] + list(res["by_set"].items()):
    print(f"== {name} ({s['sides']} sides)")
    for a in sorted(ARMS, key=lambda a: -s[a]["fidelity"]):
        x = s[a]
        print(f"  {a:5} {x['model']:28} fid {x['fidelity']:.2f} {x['fidelity_ci']}  Δ/FP {x['delta_vs_FP']:+.2f} {x['delta_vs_FP_ci']}  inv-pages/100 {x['inversion_pages_per100_either']:5.1f}  inv {x['inversions_total']:3}  rank {x['mean_rank']:.2f}  $/1K {x['usd_per_1k']}")
for a in OPEN:
    print(a, {k: v for k, v in cost[a].items() if k not in ("usd_per_1k",)})
print("frontier", res["frontier"], "dominated", res["dominated"], "best", res["best"], "inside margin", res["inside_margin"])
