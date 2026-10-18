#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-xl.py — decode / norm / judge_gate are imported from it unchanged; its
# run_cli() is bound to #6182's arm files and language strata, so the per-arm table, the by-book bootstrap and the
# pairwise deltas are re-stated here for #6948's arms (G4L, F38, OP, PROD) and strata (CANON / OTHER, reference / none).
"""
score.py — $0. Scores #6948 by its preregistration (experiments/2026-10-18-tibetan-translator-85k-6948.md).
  python3 scripts/eval/tib-translator-6948/score.py
Reads $JOB_SCRATCH/judge/out-J*.jsonl, the arm files and scripts/eval/results/tib-translator-6948/key.json; writes
scripts/eval/results/tib-translator-6948/scores.json. NUMBERS ONLY: no judge quotes, no reference or arm text.
"""
import json, os, glob, random, statistics, importlib.util, collections, datetime

S = os.environ["JOB_SCRATCH"]
OUT = "scripts/eval/results/tib-translator-6948"
spec = importlib.util.spec_from_file_location("score_xl", "scripts/eval/pareto-6182/score-xl.py")
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)
B, SEED = 2000, 6948
CAND = ["G4L", "F38", "OP"]
key = json.load(open(f"{OUT}/key.json"))
items = key["items"]
J = {}
for j in ("J1", "J2"):
    J[j] = {}
    for f in sorted(glob.glob(f"{S}/judge/out-{j}-*.jsonl")):
        for l in open(f):
            if l.strip():
                o = json.loads(l); J[j][o["id"]] = o
    miss = [i for i in items if i not in J[j]]
    assert not miss, f"{j} is missing {len(miss)} items: {miss[:5]}"
dec = {j: {i: sx.decode(o, items[i]["labels"]) for i, o in J[j].items() if i in items} for j in J}
for j in dec:  # a label the judge left out of "scores" would silently drop an arm: refuse
    for i, d in dec[j].items():
        assert set(d) == set(items[i]["labels"].values()), (j, i, set(d), items[i]["labels"])
        assert all(isinstance(x["fid"], (int, float)) for x in d.values()), (j, i, "null fidelity")
gate = sx.judge_gate(items, dec)
JP = [j for j in ("J1", "J2") if gate[j]["pass"]]
weights = json.load(open(f"{S}/strata-weights.json"))

rows = []
for i, k in items.items():
    if k["kind"] != "ARMS": continue
    added = {a: sum(sum(1 for x in (J[j][i]["scores"][l].get("invention") or []) if x.get("kind") == "added_fact")
                    for j in JP) for l, a in k["labels"].items()}
    fit = {j: J[j][i].get("reference_fit") for j in J}
    rows.append({"id": i, "page_id": k["page_id"], "book": k["book"], "stratum": k["stratum"], "cell": k["cell"], "ref": k["ref"],
                 "arms": sorted(k["labels"].values()), "J": {j: dec[j][i] for j in JP}, "added": added, "fit": fit})


def fid(r, a): return sum(r["J"][j][a]["fid"] for j in r["J"]) / len(r["J"])
def either(r, a, f): return int(any(r["J"][j][a][f] for j in r["J"]))
def both(r, a, f): return int(all(r["J"][j][a][f] for j in r["J"]))


def boot(rs, stat):
    by = collections.defaultdict(list)
    for r in rs: by[r["book"]].append(r)
    bks, rng, out = sorted(by), random.Random(SEED), []
    for _ in range(B):
        d = []
        for b in (rng.choice(bks) for _ in bks):
            g = by[b]; d += [g[rng.randrange(len(g))] for _ in g]
        out.append(stat(d))
    out.sort()
    return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B) - 1], 3)]


def arm_stats(rs, a):
    rs = [r for r in rs if a in r["arms"]]
    n = len(rs)
    if not n: return None
    return {"pages": n, "fidelity": round(sum(fid(r, a) for r in rs) / n, 3), "ci": boot(rs, lambda d: sum(fid(r, a) for r in d) / len(d)),
            "reversal_pages_either": sum(either(r, a, "rev") for r in rs), "reversal_pages_both": sum(both(r, a, "rev") for r in rs),
            "omission_pages_either": sum(either(r, a, "om") for r in rs), "invention_pages_either": sum(either(r, a, "inven") for r in rs),
            "unreadable_fill_pages_either": sum(either(r, a, "fill") for r in rs), "span_off_pages_either": sum(either(r, a, "span_off") for r in rs),
            "added_fact_entries": sum(r["added"].get(a, 0) for r in rs)}


def delta(rs, a, b):
    rs = [r for r in rs if a in r["arms"] and b in r["arms"]]
    if not rs: return None
    d = lambda r: fid(r, a) - fid(r, b)
    return {"pages": len(rs), "mean": round(sum(d(r) for r in rs) / len(rs), 3), "ci": boot(rs, lambda x: sum(d(r) for r in x) / len(x)),
            "higher": sum(d(r) > 0 for r in rs), "lower": sum(d(r) < 0 for r in rs)}


def block(rs):
    shared = [r for r in rs if all(a in r["arms"] for a in CAND)]
    o = {"pages": len(rs), "pages_shared": len(shared), "arms_shared": {a: arm_stats(shared, a) for a in CAND},
         "arms_all_pages": {a: arm_stats(rs, a) for a in CAND + ["PROD"]}, "deltas": {}}
    for a, b in (("G4L", "F38"), ("G4L", "OP"), ("F38", "OP")):
        o["deltas"][f"{a}-{b}"] = delta(shared, a, b)
    prod = [r for r in rs if "PROD" in r["arms"]]
    o["prod_subset"] = {"pages": len(prod), **{f"{a}-PROD": delta(prod, a, "PROD") for a in CAND}, "PROD": arm_stats(prod, "PROD"),
                        **{a: arm_stats(prod, a) for a in CAND}}
    return o


blocks = {"ALL": block(rows), "CANON": block([r for r in rows if r["stratum"] == "CANON"]), "OTHER": block([r for r in rows if r["stratum"] == "OTHER"]),
          "WITH_REFERENCE": block([r for r in rows if r["ref"]]), "NO_REFERENCE": block([r for r in rows if not r["ref"]])}
# frame-weighted pooled mean on the shared pages: stratum means weighted by frame pages
W = {k: v / sum(weights.values()) for k, v in weights.items()}
fw = {}
for a in CAND:
    m = {st: blocks[st]["arms_shared"][a]["fidelity"] for st in ("CANON", "OTHER")}
    fw[a] = round(sum(W[st] * m[st] for st in m), 3)
    sh = {st: [r for r in rows if r["stratum"] == st and all(x in r["arms"] for x in CAND)] for st in ("CANON", "OTHER")}
    fw[a + "_rev_per100"] = round(100 * sum(W[st] * sum(either(r, a, "rev") for r in sh[st]) / len(sh[st]) for st in sh), 1)

# the bar (prereg): best = highest pooled unweighted mean on shared pages among G4L, F38, OP
sh = blocks["ALL"]["arms_shared"]
best = max(CAND, key=lambda a: sh[a]["fidelity"])
bar = {"best": best}
shared_rows = [r for r in rows if all(a in r["arms"] for a in CAND)]
for a in CAND:
    d = delta(shared_rows, a, best) if a != best else {"mean": 0.0, "ci": [0.0, 0.0]}
    scored = blocks["ALL"]["arms_all_pages"][a]
    rev_share = scored["reversal_pages_either"] / scored["pages"]
    bar[a] = {"gap_to_best": d["mean"], "gap_ci": d["ci"], "within_0.20": d["mean"] >= -0.20, "ci_lower_above_-0.20": d["ci"][0] > -0.20,
              "reversal_pages_either": scored["reversal_pages_either"], "scored_pages": scored["pages"], "reversal_share": round(rev_share, 4),
              "reversals_le_2pct": rev_share <= 0.02, "clears": d["mean"] >= -0.20 and rev_share <= 0.02}
choice = "G4L" if bar["G4L"]["clears"] else "F38" if bar["F38"]["clears"] else None

# calls, attempts, seconds
calls = collections.Counter()
for l in open("/var/log/sourcelibrary/agy-calls.jsonl"):
    if '"tib-translator-6948"' in l:
        c = json.loads(l)
        if c.get("kind") == "translate": calls[c["model"]] += 1
timing = {}
for a, model in (("G4L", "gemini-4-argon-low"), ("F38", "gemini-3.8-flash-low")):
    raw = [json.loads(l) for l in open(f"{S}/{a}/raw.jsonl") if l.strip()]
    secs = [r["secs"] for r in raw if r.get("secs") is not None]
    per_page = collections.defaultdict(float)
    for r in raw:
        if r.get("secs") is not None: per_page[r["uid"]] += r["secs"]
    v = sorted(per_page.values())
    failed = sum(1 for l in open(f"{S}/{a}/failed.jsonl") if l.strip())
    timing[a] = {"calls": calls[model], "pages": 60, "calls_per_page": round(calls[model] / 60, 3), "failed_reads": failed,
                 "secs_per_page_median": round(statistics.median(v), 1), "secs_per_page_p90": round(v[int(0.9 * len(v)) - 1], 1),
                 "secs_per_call_median": round(statistics.median(secs), 1)}
    cpp = calls[model] / 60
    timing[a]["pages_per_day_at_500_calls"] = round(500 / cpp)
    timing[a]["days_for_85k"] = round(85000 / (500 / cpp))
    timing[a]["days_for_86952_frame"] = round(86952 / (500 / cpp))
    timing[a]["days_for_79621_without_left_to_84000"] = round((86952 - 7114) / (500 / cpp))
opr = {}
for l in open(f"{S}/OP/OP.jsonl"):
    r = json.loads(l); opr[r["uid"]] = r
timing["OP"] = {"pages": 60, "failed_reads": sum(1 for r in opr.values() if not r["text"]), "secs_per_page_median": round(statistics.median(r["secs"] for r in opr.values()), 1),
                "attempts_gt1": sum(1 for r in opr.values() if r["attempts"] > 1)}
fits = collections.Counter((r["ref"] or "none", r["fit"][j]) for r in rows for j in r["fit"])
res = {"scored_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "judges_scoring": JP,
       "gate": {j: gate[j] for j in ("J1", "J2")}, "blocks": blocks, "frame_weighted": {"weights": weights, **fw}, "bar": bar, "choice": choice,
       "timing": timing, "reference_fit": {f"{a}|{b}": n for (a, b), n in sorted(fits.items(), key=str)},
       "agreement_within_1": round(sum(abs(rows_j1 - rows_j2) <= 1 for rows_j1, rows_j2 in
                                       ((dec["J1"][r["id"]][a]["fid"], dec["J2"][r["id"]][a]["fid"]) for r in rows for a in r["arms"])) /
                                   sum(len(r["arms"]) for r in rows), 3)}
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1)
print(json.dumps({"gate": {j: {k: gate[j][k] for k in ("plant_caught_prereg", "dup_tie", "pass")} for j in ("J1", "J2")}, "choice": choice, "bar": bar}, indent=1))
for st in ("ALL", "CANON", "OTHER", "WITH_REFERENCE", "NO_REFERENCE"):
    b = blocks[st]
    print(st, b["pages"], "shared", b["pages_shared"], {a: (b["arms_shared"][a]["fidelity"], b["arms_shared"][a]["ci"], b["arms_all_pages"][a]["reversal_pages_either"], b["arms_all_pages"][a]["reversal_pages_both"]) for a in CAND},
          {k: (v["mean"], v["ci"], v["higher"], v["lower"]) for k, v in b["deltas"].items() if v})
    p = b["prod_subset"]
    print("   PROD subset", p["pages"], p["PROD"] and (p["PROD"]["fidelity"], p["PROD"]["ci"], p["PROD"]["reversal_pages_either"]), {a: p[f"{a}-PROD"] and (p[f"{a}-PROD"]["mean"], p[f"{a}-PROD"]["ci"]) for a in CAND})
print("frame-weighted", fw); print("timing", json.dumps(timing)); print("fit", res["reference_fit"]); print("agree within 1", res["agreement_within_1"])
