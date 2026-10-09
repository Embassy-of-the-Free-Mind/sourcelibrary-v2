#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-xl.py — this reuses its `norm` and `decode` (the #5695 judge schema)
# and its gate rule (plants ≥ 6/8, duplicates tie ≥ 3/4) and clustered bootstrap. Its run() is bound to #6182's
# nine Gemini arms, costs and J2 subset; this set has C38, CS and (Sanskrit/Pali only) FP, both judges on every
# item, and the strata of the #6331 prereg (2026-10-08-canon-set-judged-6331.md). NUMBERS ONLY: no judge quotes,
# no reference text are written.
"""
score-set.py — $0.  python3 scripts/eval/canon-ref-6331/score-set.py
Reads scripts/eval/results/canon-ref-6331/judge/key.json and the judge out files, writes
scripts/eval/results/canon-ref-6331/judge/scores.json.
"""
import json, glob, random, importlib.util, os, sys

spec = importlib.util.spec_from_file_location("sx", os.path.join(os.path.dirname(__file__), "../pareto-6182/score-xl.py"))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)
JW = "/mnt/HC_Volume_105839809/jobs/judge-set-6331"
OUT = "scripts/eval/results/canon-ref-6331/judge"
B = 2000
key = json.load(open(f"{OUT}/key.json"))["items"]
J = {}
for j in ("J1", "J2"):
    J[j] = {}
    for f in sorted(glob.glob(f"{JW}/judge/out-{j}-*.jsonl")):
        for l in open(f):
            if l.strip():
                o = json.loads(l); J[j][o["id"]] = o
    missing = sorted(set(key) - set(J[j]))
    if missing: sys.exit(f"{j} has no verdict for {len(missing)} items, e.g. {missing[:5]}")
dec = {j: {i: sx.decode(o, key[i]["labels"]) for i, o in J[j].items()} for j in J}

# ── gate (score-xl.py's rule)
gate, controls = {}, []
for j in J:
    g = {"plants": 0, "plant_caught_prereg": 0, "plant_caught_strict": 0, "dups": 0, "dup_tie": 0}
    for i, k in key.items():
        if k["kind"] == "PLANT":
            p, t = dec[j][i]["P_PLANT"], dec[j][i]["P"]
            listed = bool(p["rev"] and not t["rev"]); lower = (p["fid"] or 0) < (t["fid"] or 0)
            g["plants"] += 1; g["plant_caught_prereg"] += bool(listed or lower); g["plant_caught_strict"] += bool(listed and lower)
            controls.append({"judge": j, "item": i, "kind": "PLANT", "how": k["plant"]["how"], "reversal_listed": listed, "lower_fid": lower, "fid": [p["fid"], t["fid"]]})
        elif k["kind"] == "DUP":
            a, b = dec[j][i]["P"], dec[j][i]["P_DUP"]
            tie = a["fid"] == b["fid"] and a["tier"] == b["tier"]
            g["dups"] += 1; g["dup_tie"] += tie
            controls.append({"judge": j, "item": i, "kind": "DUP", "tie": tie, "fid": [a["fid"], b["fid"]]})
    g["pass"] = g["plant_caught_prereg"] >= 6 and g["dup_tie"] >= 3
    gate[j] = g
JP = [j for j in J if gate[j]["pass"]]
assert JP, f"instrument failed: no judge passed the gate {gate}"

rows = []
nulls = 0
for i, k in key.items():
    if k["kind"] != "ARMS": continue
    per = {}
    for j in JP:
        d = {a: v for a, v in dec[j][i].items() if v["fid"] is not None}
        nulls += len(dec[j][i]) - len(d)
        per[j] = d
    arms = sorted(set.intersection(*[set(per[j]) for j in JP]))
    rows.append({"id": i, "uid": k["uid"], "work": k["work"], "lang": k["lang"], "stratum": k["stratum"], "famous": k["famous"], "arms": arms, "J": per})

fid = lambda r, a: sum(r["J"][j][a]["fid"] for j in r["J"]) / len(r["J"])
either = lambda r, a, f: int(any(r["J"][j][a][f] for j in r["J"]))


def boot(rs, stat, seed=6331):
    by = {}
    for r in rs: by.setdefault(r["work"], []).append(r)
    ws, rng, out = sorted(by), random.Random(seed), []
    for _ in range(B):
        d = []
        for w in (rng.choice(ws) for _ in ws):
            g = by[w]; d += [g[rng.randrange(len(g))] for _ in g]
        out.append(stat(d))
    out.sort()
    return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B) - 1], 3)]


def arm_stats(rs, a):
    rs = [r for r in rs if a in r["arms"]]; n = len(rs)
    if not n: return None
    return {"pages": n, "works": len({r["work"] for r in rs}), "fidelity": round(sum(fid(r, a) for r in rs) / n, 3),
            "fidelity_ci_by_text": boot(rs, lambda d: sum(fid(r, a) for r in d) / len(d)),
            "share_ge4": round(sum(fid(r, a) >= 4 for r in rs) / n, 3),
            "reversal_pages_per100": round(100 * sum(either(r, a, "rev") for r in rs) / n, 1),
            "omission_pages_per100": round(100 * sum(either(r, a, "om") for r in rs) / n, 1),
            "invention_pages_per100": round(100 * sum(either(r, a, "inven") for r in rs) / n, 1)}


def delta(rs, a, b):
    rs = [r for r in rs if a in r["arms"] and b in r["arms"]]
    if not rs: return None
    d = lambda r: fid(r, a) - fid(r, b)
    return {"pages": len(rs), "mean": round(sum(map(d, rs)) / len(rs), 3), "ci_by_text": boot(rs, lambda x: sum(map(d, x)) / len(x)),
            "pages_higher": sum(d(r) > 0 for r in rs), "pages_lower": sum(d(r) < 0 for r in rs)}


def verdict(o):
    """PREREG: route = C38 unless CS − C38 CI excludes 0 upward; good enough = fid ≥ 4.0, CI lo ≥ 3.75, share ≥ 4 ≥ 75%, reversal ≤ 10/100."""
    d = o["deltas"]["CS-C38"]
    route = "CS" if d and d["ci_by_text"][0] > 0 else "C38"
    s = o["arms"][route]
    ok = s["fidelity"] >= 4.0 and s["fidelity_ci_by_text"][0] >= 3.75 and s["share_ge4"] >= 0.75 and s["reversal_pages_per100"] <= 10
    return {"route": route, "good_enough": ok, "descriptive_only": o["pages"] < 10}


def group(rs):
    o = {"pages": len(rs), "works": len({r["work"] for r in rs}), "arms": {a: arm_stats(rs, a) for a in ("C38", "CS", "FP")}}
    o["deltas"] = {"C38-CS": delta(rs, "C38", "CS"), "CS-C38": delta(rs, "CS", "C38"), "C38-FP": delta(rs, "C38", "FP"), "CS-FP": delta(rs, "CS", "FP")}
    o["verdict"] = verdict(o)
    return o


zh = [r for r in rows if r["lang"] == "Chinese"]
G = {"Chinese": zh, "Chinese famous": [r for r in zh if r["famous"]], "Chinese not famous": [r for r in zh if not r["famous"]]}
for s in sorted({r["stratum"] for r in zh}): G[f"Chinese {s}"] = [r for r in zh if r["stratum"] == s]
for l in ("Sanskrit", "Pali"):
    G[l] = [r for r in rows if r["lang"] == l]
    G[f"{l} with FP"] = [r for r in G[l] if "FP" in r["arms"]]
res = {"date": "2026-10-08", "judges_scored": JP, "gate": gate, "controls": controls, "null_fidelity_scores_dropped": nulls,
       "groups": {g: group(rs) for g, rs in G.items()}}

# ── inter-judge agreement
if len(JP) == 2:
    pairs = [(r["J"]["J1"][a], r["J"]["J2"][a]) for r in rows for a in r["arms"]]
    x, y = [p[0]["fid"] for p in pairs], [p[1]["fid"] for p in pairs]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    rr = sum((u - mx) * (v - my) for u, v in zip(x, y)) / (sum((u - mx) ** 2 for u in x) * sum((v - my) ** 2 for v in y)) ** 0.5
    f1, f2 = [p[0]["rev"] for p in pairs], [p[1]["rev"] for p in pairs]
    res["agreement"] = {"pairs": len(pairs), "fid_exact": round(sum(u == v for u, v in zip(x, y)) / len(x), 3),
                        "fid_within_1": round(sum(abs(u - v) <= 1 for u, v in zip(x, y)) / len(x), 3), "fid_pearson": round(rr, 3),
                        "reversal_flags": {"J1": sum(f1), "J2": sum(f2), "both": sum(a and b for a, b in zip(f1, f2))},
                        "C38_minus_CS_by_judge": {j: round(sum(r["J"][j]["C38"]["fid"] - r["J"][j]["CS"]["fid"] for r in rows if {"C38", "CS"} <= set(r["arms"])) /
                                                         sum({"C38", "CS"} <= set(r["arms"]) for r in rows), 3) for j in JP}}

# ── by-eye (read from text) against the judges
be_key = json.load(open(f"{JW}/byeye/key.json"))
be = {}
for f in glob.glob(f"{JW}/byeye/out-*.jsonl"):
    for l in open(f):
        if l.strip():
            o = json.loads(l); lab = be_key[o["id"]]
            be[o["id"]] = {lab[x]: {"fid": o[x]["fidelity"], "rev": len(o[x].get("reversals") or []), "om": len(o[x].get("omissions") or [])} for x in ("A", "B")}
            be[o["id"]]["better"] = {"A": lab["A"], "B": lab["B"], "TIE": "TIE"}[o["better"]]
by_uid = {r["uid"]: r for r in rows}
cmp = []
for uid, v in sorted(be.items()):
    r = by_uid[uid]; jf = {a: round(fid(r, a), 2) for a in ("C38", "CS")}
    jb = "TIE" if jf["C38"] == jf["CS"] else max(jf, key=jf.get)
    cmp.append({"uid": uid, "stratum": r["stratum"], "reader": {a: v[a]["fid"] for a in ("C38", "CS")}, "judges": jf, "reader_better": v["better"], "judges_better": jb,
                "reader_reversals": {a: v[a]["rev"] for a in ("C38", "CS")}, "judge_reversal": {a: either(r, a, "rev") for a in ("C38", "CS")},
                "gap_ge_1.5": [a for a in ("C38", "CS") if abs(v[a]["fid"] - jf[a]) >= 1.5]})
n = len(cmp)
res["byeye"] = {"label": "read from text (typed corpora; no page image); Opus readers, not scholars", "units": n,
                "reader_mean": {a: round(sum(c["reader"][a] for c in cmp) / n, 3) for a in ("C38", "CS")},
                "judges_mean_same_units": {a: round(sum(c["judges"][a] for c in cmp) / n, 3) for a in ("C38", "CS")},
                "reader_better_counts": {k: sum(c["reader_better"] == k for c in cmp) for k in ("C38", "CS", "TIE")},
                "judges_better_counts": {k: sum(c["judges_better"] == k for c in cmp) for k in ("C38", "CS", "TIE")},
                "opposite_preference": [c["uid"] for c in cmp if {c["reader_better"], c["judges_better"]} == {"C38", "CS"}],
                "gaps_ge_1.5": [{"uid": c["uid"], "arms": c["gap_ge_1.5"], "reader": c["reader"], "judges": c["judges"]} for c in cmp if c["gap_ge_1.5"]],
                "reader_reversal_units": {a: sum(c["reader_reversals"][a] > 0 for c in cmp) for a in ("C38", "CS")},
                "judge_reversal_units": {a: sum(c["judge_reversal"][a] for c in cmp) for a in ("C38", "CS")},
                "rows": cmp}
res["rows"] = [{"uid": r["uid"], "lang": r["lang"], "stratum": r["stratum"], "famous": r["famous"], "work": r["work"],
                "fid": {a: round(fid(r, a), 2) for a in r["arms"]}, "rev": {a: either(r, a, "rev") for a in r["arms"]}} for r in rows]
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1, ensure_ascii=False)

print("gate", {j: g for j, g in gate.items()}, "nulls", nulls)
print("agreement", json.dumps(res.get("agreement")))
for g, o in res["groups"].items():
    print(f"\n== {g}: {o['pages']} units, {o['works']} works  verdict {o['verdict']}")
    for a, s in o["arms"].items():
        if s: print(f"  {a:4} fid {s['fidelity']:.2f} {s['fidelity_ci_by_text']} ≥4 {s['share_ge4']:.0%}  rev {s['reversal_pages_per100']} om {s['omission_pages_per100']} inv {s['invention_pages_per100']}  (n={s['pages']})")
    for k, d in o["deltas"].items():
        if d and k != "CS-C38": print(f"  {k}: {d['mean']:+.2f} {d['ci_by_text']} n={d['pages']} hi/lo {d['pages_higher']}/{d['pages_lower']}")
print("\nbyeye", json.dumps({k: v for k, v in res["byeye"].items() if k != "rows"}, ensure_ascii=False))
