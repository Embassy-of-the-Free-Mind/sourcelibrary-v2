#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-levers/score-ref.py (#6121) reads the judge files, unblinds, runs the gate,
# the per-arm summary and round 2's rule; it calls this with its rows (`--round 6182`), so none of that is
# rewritten here. This adds what PREREG.md asks beyond round 2: strata, by-text bootstrap CIs (sides of one
# text are not independent), inter-judge agreement and rule B. NUMBERS ONLY: no judge quotes are written.
"""
score-tib.py — $0. Not run directly:
  python3 scripts/eval/tengyur-levers/score-ref.py --round 6182
writes scripts/eval/results/pareto-6182/tibjudge/scores.json.
"""
import json, random

# $ / 1,000 pages at the Batch rate, billed on this run (#6182 stage-2 comment, ledger.jsonl). S and AA are
# production's engine (FP). O is the Opus ceiling at the API list rate (#6121), never a lane.
COST = {"L31": 0.83, "L35": 1.27, "FP": 1.78, "S": 1.78, "AA": 1.78, "G37": 2.33, "G38": 2.34, "G36": 2.36,
        "G35": 5.48, "PRO": 15.41, "O": 19.1}
GEMINI = ["FP", "L31", "L35", "G35", "G36", "G37", "G38", "PRO"]   # rule B candidates (S, AA = FP's engine)
SECTION = {"D4231": "Pramāṇa", "D3862": "Madhyamaka", "toh3808": "Prajñāpāramitā",
           "toh1183": "Tantra", "toh1189": "Tantra", "toh1777": "Tantra", "toh1996": "Tantra",
           "toh4377": "Miscellaneous (sna tshogs)", "toh4400a": "Miscellaneous (sna tshogs)", "toh3990": "Sūtra commentary"}  # Derge Tengyur catalogue ranges
B = 2000


def run(rows, J, ARMS, gate, summary, perm_p, OUT):
    NJ = len(J)
    fid = lambda r, a: sum(r["J"][j][a]["fid"] for j in J) / NJ
    cnt = lambda r, a, f: sum(r["J"][j][a][f] for j in J) / NJ

    def boot(rs, stat, seed=6182):
        """Two-stage by-text bootstrap: texts with replacement, then sides within each drawn text."""
        by = {}
        for r in rs:
            by.setdefault(r["toh"], []).append(r)
        texts, rng, out = sorted(by), random.Random(seed), []
        for _ in range(B):
            draw = []
            for t in (rng.choice(texts) for _ in texts):
                g = by[t]; draw += [g[rng.randrange(len(g))] for _ in g]
            out.append(stat(draw))
        out.sort()
        return [round(out[int(0.025 * B)], 2), round(out[int(0.975 * B) - 1], 2)]

    def arm_stats(rs, a):
        n = len(rs)
        return {"fidelity": round(sum(fid(r, a) for r in rs) / n, 3),
                "fidelity_ci_by_text": boot(rs, lambda d: sum(fid(r, a) for r in d) / len(d)),
                "inversion_sides_per100_either": round(100 * sum(any(r["J"][j][a]["inv"] for j in J) for r in rs) / n, 1),
                "inversions_per100": round(100 * sum(cnt(r, a, "inv") for r in rs) / n, 1),
                "omissions_per100": round(100 * sum(cnt(r, a, "om") for r in rs) / n, 1),
                "inventions_per100": round(100 * sum(cnt(r, a, "inven_n") for r in rs) / n, 1),
                "span_off_sides_either": sum(any(r["J"][j][a]["span_off"] for j in J) for r in rs)}

    def delta(rs, a, b):
        d = lambda r: fid(r, a) - fid(r, b)
        return {"mean": round(sum(d(r) for r in rs) / len(rs), 3), "ci_by_text": boot(rs, lambda x: sum(d(r) for r in x) / len(x)),
                "sides_higher": sum(d(r) > 0 for r in rs), "sides_lower": sum(d(r) < 0 for r in rs)}

    def stratum(rs):
        o = {"sides": len(rs), "texts": sorted({r["toh"] for r in rs}), "arms": {a: arm_stats(rs, a) for a in ARMS}}
        o["vs_S"] = {a: delta(rs, a, "S") for a in ARMS if a != "S"}
        o["vs_FP"] = {a: delta(rs, a, "FP") for a in ARMS if a != "FP"}
        return o

    sets = {"tib-ref113 (fresh, rule A)": [r for r in rows if r["set"] == "tib-ref113"],
            "tib-ref58 (round 2's sides)": [r for r in rows if r["set"] == "tib-ref58"],
            "pooled 171 (rule B)": rows}
    for sec in ("Pramāṇa", "Madhyamaka", "Prajñāpāramitā", "Tantra", "Miscellaneous (sna tshogs)"):
        sets[f"section: {sec}"] = [r for r in rows if SECTION[r["toh"]] == sec]
    for t in ("toh3808", "toh1183", "toh1189"):   # PREREG: per text with >= 20 sides
        sets[f"text: {t}"] = [r for r in rows if r["toh"] == t]
    strata = {k: stratum(v) for k, v in sets.items()}

    # Rule A (PREREG.md, round 2's rule) on the 113 fresh sides; score-ref.py's summary() computes it.
    s113 = summary(sets["tib-ref113 (fresh, rule A)"])
    ruleA = {"tib-ref113": s113["G38_rule"], "tib-ref58 (in-sample, reported)": summary(sets["tib-ref58 (round 2's sides)"])["G38_rule"],
             "pooled 171 (reported)": summary(rows)["G38_rule"]}
    ruleA["by_text_gain_ci_113"] = strata["tib-ref113 (fresh, rule A)"]["vs_S"]["G38"]["ci_by_text"]
    for t in ("toh3808", "toh1183", "toh1189"):
        ruleA[f"text {t}"] = summary(sets[f"text: {t}"])["G38_rule"]

    # Rule B (PREREG.md) on the pooled Tibetan stratum.
    P = strata["pooled 171 (rule B)"]
    fidB = {a: P["arms"][a]["fidelity"] for a in ARMS}
    revB = {a: P["arms"][a]["inversion_sides_per100_either"] for a in ARMS}
    frontier, dominated = [], {}
    LANES = GEMINI + ["O"]   # S and AA are FP's engine at FP's price: one lane, plotted as FP
    for a in LANES:
        by = [b for b in LANES if b != a and COST[b] <= COST[a] and fidB[b] >= fidB[a] and (COST[b] < COST[a] or fidB[b] > fidB[a])]
        if by: dominated[a] = sorted(by, key=lambda b: (-fidB[b], COST[b]))[0]
        else: frontier.append(a)
    best = max(GEMINI, key=lambda a: fidB[a])
    inside = [a for a in GEMINI if fidB[a] >= fidB[best] - 0.25 and revB[a] <= revB[best] + 8]
    rec = sorted(inside, key=lambda a: (COST[a], -fidB[a]))[0]
    floor = P["vs_FP"]["AA"]
    prop = None
    if rec != "FP":
        d = P["vs_FP"][rec]
        if COST[rec] > COST["FP"]:
            checks = {"ci_excludes_0": d["ci_by_text"][0] > 0, "outside_AA_floor_ci": d["mean"] > floor["ci_by_text"][1], "delta_ge_0.25": d["mean"] >= 0.25}
        else:
            checks = {"non_inferior_lower_bound_gt_-0.25": d["ci_by_text"][0] > -0.25}
        prop = {"arm": rec, "delta_vs_FP": d, "checks": checks, "routing_proposal": all(checks.values())}
    d38 = P["vs_FP"]["G38"]   # the arm rule A is about, against the card's costlier-arm effect rule
    g38_effect = {"delta_vs_FP": d38, "ci_excludes_0": d38["ci_by_text"][0] > 0, "outside_AA_floor_ci": d38["mean"] > floor["ci_by_text"][1],
                  "delta_ge_0.25": d38["mean"] >= 0.25}
    g38_effect["routing_proposal"] = all(v for k, v in g38_effect.items() if k != "delta_vs_FP")
    ntexts = len(P["texts"])
    ruleB = {"fidelity": fidB, "inversion_sides_per100": revB, "usd_per_1k_batch": {a: COST[a] for a in ARMS},
             "frontier": sorted(frontier, key=lambda a: COST[a]), "dominated_by": dominated, "best_gemini": best,
             "inside_margin": sorted(inside, key=lambda a: COST[a]), "recommended": rec, "AA_floor_vs_FP": floor, "G38_effect_rule_vs_FP": g38_effect,
             "proposal": prop, "grade": f"{ntexts} referenced texts: " + ("exploratory" if ntexts < 30 else "directional" if ntexts < 50 else "decision")}

    # Inter-judge agreement (on the ARMS items; the two judges saw the same items in different orders).
    agree = None
    if NJ == 2:
        j1, j2 = J
        pairs = [(r["J"][j1][a], r["J"][j2][a]) for r in rows for a in ARMS]
        x, y = [p[0]["fid"] for p in pairs], [p[1]["fid"] for p in pairs]
        mx, my = sum(x) / len(x), sum(y) / len(y)
        cov = sum((u - mx) * (v - my) for u, v in zip(x, y))
        r_ = cov / (sum((u - mx) ** 2 for u in x) * sum((v - my) ** 2 for v in y)) ** 0.5
        f1 = [bool(p[0]["inv"]) for p in pairs]; f2 = [bool(p[1]["inv"]) for p in pairs]
        po = sum(a == b for a, b in zip(f1, f2)) / len(f1); p1, p2 = sum(f1) / len(f1), sum(f2) / len(f2)
        pe = p1 * p2 + (1 - p1) * (1 - p2)
        means = {j: {a: round(sum(r["J"][j][a]["fid"] for r in rows) / len(rows), 3) for a in ARMS} for j in J}
        order = {j: sorted(ARMS, key=lambda a: -means[j][a]) for j in J}
        agree = {"fid_exact": round(sum(u == v for u, v in zip(x, y)) / len(x), 3), "fid_within_1": round(sum(abs(u - v) <= 1 for u, v in zip(x, y)) / len(x), 3),
                 "fid_pearson": round(r_, 3), "inversion_flag_agree": round(po, 3), "inversion_flag_kappa": round((po - pe) / (1 - pe), 3),
                 "inversion_sides_flagged": {j1: sum(f1), j2: sum(f2), "both": sum(a and b for a, b in zip(f1, f2))},
                 "arm_means_by_judge": means, "arm_order_by_judge": order,
                 "G38_minus_S_by_judge": {j: round(means[j]["G38"] - means[j]["S"], 3) for j in J}}

    res = {"date": "2026-10-07", "judges_scored": J, "gate": gate, "rule_A": ruleA, "rule_B": ruleB, "agreement": agree,
           "strata": strata, "not_in_this_instrument": {"Vinaya": 0, "Jātaka": 0},
           "rows": [{k: v for k, v in r.items()} for r in rows]}
    json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1, ensure_ascii=False)
    print("gate", {j: {k: v for k, v in g.items()} for j, g in gate.items() if j != "controls"})
    print("rule A", json.dumps(ruleA, ensure_ascii=False, indent=1))
    print("rule B", json.dumps({k: v for k, v in ruleB.items()}, ensure_ascii=False, indent=1))
    print("agreement", json.dumps(agree, indent=1))
    for k, v in strata.items():
        print(f"== {k}: {v['sides']} sides, {len(v['texts'])} texts")
        for a in ARMS:
            s = v["arms"][a]
            print(f"  {a:4} fid {s['fidelity']:.2f} {s['fidelity_ci_by_text']}  inv-sides/100 {s['inversion_sides_per100_either']:5}  inv/100 {s['inversions_per100']:5}  om/100 {s['omissions_per100']:5}  inven/100 {s['inventions_per100']:5}"
                  + (f"  Δ vs S {v['vs_S'][a]['mean']:+.2f} {v['vs_S'][a]['ci_by_text']}" if a != "S" else ""))
