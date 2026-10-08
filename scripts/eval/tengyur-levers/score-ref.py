#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-arms/score.py (#5497) scores the same judge output shape against 84000;
# it is bound to that run's families and arm names. This scores #6121's reference-judge round (S, A, C, P
# against Stcherbatsky / La Vallée Poussin) and writes NUMBERS ONLY: the judges' files quote the
# reference and stay on the box.
"""
score-ref.py — $0. Reads /root/tlev/refjudge/out-J{1,2}-*.jsonl and results/.../refjudge/key.json,
writes results/.../refjudge/scores.json (no quotes).

  --round 2      #6121 round 2 (S, A, G38, G35, O)
  --round 6182   #6182 (171 sides × 11 arms, PREREG.md): the same gate/summary/rule code with FP as the
                 floor arm, plus per-stratum scores with by-text bootstrap CIs and rule B (pareto-6182.py)
  --round cli6182 #6182 Antigravity-CLI arm (C38 beside G38 and FP on the 58 sides): round 2's judge gate, then
                 the gate preregistered on #6182 (C38 − G38 by-text bootstrap lower bound > −0.15, and C38
                 inversion sides ≤ G38's + 2), per text and pooled
  --round 6182xl #6182, every language but Tibetan (365 pages × 9 Gemini arms + the tracks' Opus): #5695's
                 judge schema (one reversal, boolean omission), so gate, strata and rule B are score-xl.py's
"""
import collections, glob, itertools, json, random, sys

ROUND = sys.argv[sys.argv.index("--round") + 1] if "--round" in sys.argv else "1"
if ROUND == "6182xl":  # J1 on every item, J2 on the preregistered subset (J2-subset.json); out-J2s-* are J2's
    import hashlib, importlib.util
    OUT, JW = "scripts/eval/results/pareto-6182/xljudge", "/root/pareto-6182/xljudge"
    key = json.load(open(f"{OUT}/key.json"))
    subset = json.load(open(f"{JW}/J2-subset.json"))["ids"]
    assert hashlib.sha256(",".join(subset).encode()).hexdigest().startswith("e3413c8bb1ed6b57"), "J2 subset changed"
    J = {"J1": {}, "J2": {}}
    for f in glob.glob(f"{JW}/out-J*-*.jsonl"):
        j = "J2" if "-J2" in f else "J1"
        for l in open(f):
            if l.strip():
                o = json.loads(l); J[j][o["id"]] = o
    missing = {"J1": [i for i in key["items"] if i not in J["J1"]], "J2": [i for i in subset if i not in J["J2"]]}
    assert not any(missing.values()), missing
    spec = importlib.util.spec_from_file_location("p6182xl", "scripts/eval/pareto-6182/score-xl.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.run(key=key, J=J, OUT=OUT, subset=subset)
    sys.exit(0)
P6182 = ROUND == "6182"
CLI = ROUND == "cli6182"
R2 = ROUND == "2" or P6182 or CLI  # 6182 applies round 2's rule (PREREG.md rule A), FP in A's place
OUT = {"1": "scripts/eval/results/tengyur-levers-6121/refjudge", "2": "scripts/eval/results/tengyur-models-6121/refjudge",
       "6182": "scripts/eval/results/pareto-6182/tibjudge", "cli6182": "scripts/eval/results/cli-arm-6182/refjudge"}[ROUND]
JW = {"1": "/root/tlev/refjudge", "2": "/root/tlev2/refjudge", "6182": "/root/pareto-6182/tibjudge", "cli6182": "/root/tlev3/refjudge"}[ROUND]
BASE = "FP" if P6182 or CLI else "A"  # the production rerun: planted twin and rule-A floor
key = json.load(open(f"{OUT}/key.json"))
if P6182:  # this key has no toh: the 113 take it from #5497's key, the 58 from the set's text label
    toh = {k["page_id"]: k["toh"] for k in json.load(open("/root/tref/judge/key.json")).values() if isinstance(k, dict) and k.get("toh")}
    for k in key.values():
        if k["kind"] == "ARMS":
            k["toh"] = k["text"] if k["set"] == "tib-ref58" else toh[k["page_id"]]
J = {"J1": {}, "J2": {}}
for f in glob.glob(f"{JW}/out-J*-*.jsonl"):
    j = f.split("/")[-1].split("-")[1]
    for l in open(f):
        if l.strip():
            o = json.loads(l); J[j][o["id"]] = o
missing = {j: [i for i in key if i not in J[j]] for j in J}
assert not any(missing.values()), missing


def unblind(j, iid):
    o, lab = J[j][iid], key[iid]["labels"]
    return {lab[t]: s for t, s in o["scores"].items()}, [[lab[t] for t in tier] for tier in o["ranking"]]


ctrl = {"PLANT": [], "DUP": []}
for iid, k in key.items():
    if k["kind"] == "ARMS":
        continue
    for j in J:
        sc, rk = unblind(j, iid)
        if k["kind"] == "PLANT":
            pl, tw = sc[f"{BASE}_PLANT"], sc[BASE]
            ctrl["PLANT"].append({"judge": j, "item": iid, "caught": bool(pl["inversions"]) and not tw["inversions"] or len(pl["inversions"]) > len(tw["inversions"]),
                                  "lower_fid": pl["fidelity"] < tw["fidelity"],
                                  "ranked_below": any(BASE in t and f"{BASE}_PLANT" not in t for t in rk[:1])})
        else:
            ctrl["DUP"].append({"judge": j, "tie": any(set(t) == {"S", "S_DUP"} for t in rk), "same_fid": sc["S"]["fidelity"] == sc["S_DUP"]["fidelity"]})
gate = {j: {"plant_caught": sum(x["caught"] for x in ctrl["PLANT"] if x["judge"] == j), "plants": sum(1 for x in ctrl["PLANT"] if x["judge"] == j),
            "dup_tie": sum(x["tie"] for x in ctrl["DUP"] if x["judge"] == j), "dups": sum(1 for x in ctrl["DUP"] if x["judge"] == j)} for j in J}

if P6182:  # PREREG.md: caught = reversal listed OR a lower fidelity than its twin, in >= 6 of 8; duplicates tie in >= 3 of 4
    for j, g in gate.items():
        mine = [x for x in ctrl["PLANT"] if x["judge"] == j]
        g["plant_caught_prereg"] = sum(x["caught"] or x["lower_fid"] for x in mine)
        g["plant_caught_strict"] = sum(x["caught"] and x["lower_fid"] for x in mine)
        g["pass"] = g["plant_caught_prereg"] >= 6 and g["dup_tie"] >= 3
    gate["controls"] = ctrl
    J = {j: v for j, v in J.items() if gate[j]["pass"]}  # PREREG: score only with the judge(s) that pass
    assert J, "instrument failed: no judge passed the gate"
elif R2:  # preregistered judge gate: each judge catches >= 5 of 6 plants and ties >= 3 of 4 duplicates
    for g in gate.values():
        g["pass"] = g["plant_caught"] >= 5 and g["dup_tie"] >= 3

ARMS = (["FP", "C38", "G38"] if CLI else ["S", "FP", "AA", "L31", "L35", "G35", "G36", "G37", "G38", "PRO", "O"] if P6182 else
        ["S", "A", "G38", "G35", "O"] if R2 else ["S", "A", "C", "P"])
NEW = ARMS[1:]
rows = []
for iid, k in key.items():
    if k["kind"] != "ARMS":
        continue
    per = {}
    for j in J:
        sc, rk = unblind(j, iid)
        per[j] = {a: {"fid": sc[a]["fidelity"], "inv": len(sc[a]["inversions"]), "om": len(sc[a]["omissions"]), "inven": len(sc[a]["inventions"]),
                      "span_off": sc[a]["span"] != "same", "inven_n": len(sc[a]["inventions"]), "rank": next(i for i, t in enumerate(rk) if a in t)} for a in ARMS}
    rows.append({"id": iid, "page_id": k["page_id"], "toh": k["toh"], "set": k.get("set"), "J": per})
NJ = len(J)


def summary(rs):
    n = len(rs)
    o = {"sides": n}
    for a in ARMS:
        fid = [sum(r["J"][j][a]["fid"] for j in J) / NJ for r in rs]
        o[a] = {"fidelity_mean": round(sum(fid) / n, 2),
                "inversion_sides_either": sum(1 for r in rs if any(r["J"][j][a]["inv"] for j in J)),
                "inversion_sides_both": sum(1 for r in rs if all(r["J"][j][a]["inv"] for j in J)),
                "inversions_per100_mean_of_judges": round(100 * sum(r["J"][j][a]["inv"] for r in rs for j in J) / (NJ * n), 1),
                "omission_sides_either": sum(1 for r in rs if any(r["J"][j][a]["om"] for j in J)),
                "span_off_either": sum(1 for r in rs if any(r["J"][j][a]["span_off"] for j in J)),
                "mean_rank": round(sum(r["J"][j][a]["rank"] for r in rs for j in J) / (NJ * n), 2)}
    for x in NEW:
        d = [sum(r["J"][j][x]["fid"] - r["J"][j]["S"]["fid"] for j in J) / NJ for r in rs]
        inv = [sum(r["J"][j]["S"]["inv"] - r["J"][j][x]["inv"] for j in J) / NJ for r in rs]
        rng = random.Random(6121)
        bs = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(2000))
        o[f"{x}_vs_S"] = {"fid_diff": round(sum(d) / n, 2), "fid_diff_ci": [round(bs[50], 2), round(bs[1949], 2)],
                          "sides_higher": sum(1 for v in d if v > 0), "sides_lower": sum(1 for v in d if v < 0),
                          "inversions_fewer_per100": round(100 * sum(inv) / n, 1)}
    if R2:  # the preregistered rule (PREREG-R2.md)
        dA = o[f"{BASE}_vs_S"]["fid_diff_raw"] = sum(sum(r["J"][j][BASE]["fid"] - r["J"][j]["S"]["fid"] for j in J) / NJ for r in rs) / n
        invS = sum(r["J"][j]["S"]["inv"] for r in rs for j in J)
        for x in NEW[1:]:
            d = [sum(r["J"][j][x]["fid"] - r["J"][j]["S"]["fid"] for j in J) / NJ for r in rs]
            invX = sum(r["J"][j][x]["inv"] for r in rs for j in J)
            p = perm_p(d, 6182 if P6182 else 6121)
            c1, c2, c3 = sum(d) / n > abs(dA), p < 0.10, invX <= invS
            o[f"{x}_rule"] = {"gain": round(sum(d) / n, 3), "floor_abs_A": round(abs(dA), 3), "p_one_sided": round(p, 4), "inversions_X": invX, "inversions_S": invS,
                              "beats_floor": c1, "p_lt_0.10": c2, "inversions_ok": c3, "worth_priced_retranslation": bool(c1 and c2 and c3)}
    return o


def perm_p(d, seed=6121):
    """One-sided paired sign-flip p for mean(d) > 0. Exact when ≤ 20 nonzero, else 10,000 draws."""
    nz = [x for x in d if x]
    obs = sum(d)
    if not nz:
        return 1.0
    if len(nz) <= 20:
        tot = ge = 0
        for signs in itertools.product((1, -1), repeat=len(nz)):
            tot += 1; ge += sum(s * abs(x) for s, x in zip(signs, nz)) >= obs - 1e-9
        return ge / tot
    rng = random.Random(seed)
    ge = sum(sum(abs(x) * rng.choice((1, -1)) for x in nz) >= obs - 1e-9 for _ in range(10000))
    return (ge + 1) / 10001


if P6182:  # rule A's numbers above; strata, by-text CIs and rule B live beside this file's caller
    import importlib.util
    spec = importlib.util.spec_from_file_location("p6182", "scripts/eval/pareto-6182/score-tib.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.run(rows=rows, J=list(J), ARMS=ARMS, gate=gate, summary=summary, perm_p=perm_p, OUT=OUT)
    sys.exit(0)
if CLI:  # the gate preregistered on #6182 (2026-10-08 "taking this: … Antigravity CLI" comment)
    B, SECTION = 2000, {"D4231": "Pramana", "D3862": "Madhyamaka"}
    fid = lambda r, a: sum(r["J"][j][a]["fid"] for j in J) / NJ

    def boot(rs, stat, seed=6182):  # score-tib.py's two-stage by-text bootstrap: texts, then sides within each
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
        return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B) - 1], 3)]

    def stratum(rs):
        n, o = len(rs), {"sides": len(rs), "texts": sorted({r["toh"] for r in rs})}
        for a in ARMS:
            o[a] = {"fidelity_mean": round(sum(fid(r, a) for r in rs) / n, 3),
                    "inversion_sides_either": sum(any(r["J"][j][a]["inv"] for j in J) for r in rs),
                    "inversion_sides_both": sum(all(r["J"][j][a]["inv"] for j in J) for r in rs),
                    "inversions_total_both_judges": sum(r["J"][j][a]["inv"] for r in rs for j in J),
                    "omissions_per_side": round(sum(r["J"][j][a]["om"] for r in rs for j in J) / (NJ * n), 2),
                    "omission_sides_either": sum(any(r["J"][j][a]["om"] for j in J) for r in rs),
                    "inventions_per_side": round(sum(r["J"][j][a]["inven"] for r in rs for j in J) / (NJ * n), 2),
                    "invention_sides_either": sum(any(r["J"][j][a]["inven"] for j in J) for r in rs),
                    "span_off_either": sum(any(r["J"][j][a]["span_off"] for j in J) for r in rs),
                    "mean_rank": round(sum(r["J"][j][a]["rank"] for r in rs for j in J) / (NJ * n), 2)}
        for x, y in (("C38", "G38"), ("C38", "FP"), ("G38", "FP")):
            d = lambda r: fid(r, x) - fid(r, y)
            o[f"{x}-{y}"] = {"mean": round(sum(d(r) for r in rs) / n, 3), "ci_by_text": boot(rs, lambda v: sum(d(r) for r in v) / len(v)),
                             "sides_higher": sum(d(r) > 0 for r in rs), "sides_lower": sum(d(r) < 0 for r in rs)}
        return o

    res = {"gate": gate, "judge_gate_pass": all(g["pass"] for g in gate.values()),
           "pooled": stratum(rows), **{SECTION[t]: stratum([r for r in rows if r["toh"] == t]) for t in sorted(SECTION)}}
    P = res["pooled"]
    res["prereg_gate"] = {"lower_bound_C38_minus_G38": P["C38-G38"]["ci_by_text"][0], "lower_bound_gt_-0.15": P["C38-G38"]["ci_by_text"][0] > -0.15,
                          "C38_inversion_sides": P["C38"]["inversion_sides_either"], "G38_inversion_sides": P["G38"]["inversion_sides_either"],
                          "inversions_ok": P["C38"]["inversion_sides_either"] <= P["G38"]["inversion_sides_either"] + 2}
    res["prereg_gate"]["pass"] = res["judge_gate_pass"] and res["prereg_gate"]["lower_bound_gt_-0.15"] and res["prereg_gate"]["inversions_ok"]
    res["judge_fid_agree_within_1"] = round(sum(abs(r["J"]["J1"][a]["fid"] - r["J"]["J2"][a]["fid"]) <= 1 for r in rows for a in ARMS) / (len(ARMS) * len(rows)), 3)
    res["rows"] = rows
    json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))
    sys.exit(0)
res = {"gate": gate, "all": summary(rows), "by_text": {t: summary([r for r in rows if r["toh"] == t]) for t in sorted({r["toh"] for r in rows})},
       "judge_fid_agree_within_1": round(sum(abs(r["J"]["J1"][a]["fid"] - r["J"]["J2"][a]["fid"]) <= 1 for r in rows for a in ARMS) / (len(ARMS) * len(rows)), 3),
       "rows": rows}
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1)
print("gate", gate)
print("agree", res["judge_fid_agree_within_1"])
for k, v in [("all", res["all"])] + list(res["by_text"].items()):
    print("==", k, v["sides"])
    for a in ARMS:
        print("  ", a, v[a])
    for x in NEW:
        print("  ", x, "vs S", v[f"{x}_vs_S"])
        if f"{x}_rule" in v:
            print("     RULE", v[f"{x}_rule"])
