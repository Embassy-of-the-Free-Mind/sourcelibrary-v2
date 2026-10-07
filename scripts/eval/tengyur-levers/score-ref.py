#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-arms/score.py (#5497) scores the same judge output shape against 84000;
# it is bound to that run's families and arm names. This scores #6121's reference-judge round (S, A, C, P
# against Stcherbatsky / La Vallée Poussin) and writes NUMBERS ONLY: the judges' files quote the
# reference and stay on the box.
"""
score-ref.py — $0. Reads /root/tlev/refjudge/out-J{1,2}-*.jsonl and results/.../refjudge/key.json,
writes results/.../refjudge/scores.json (no quotes).
"""
import collections, glob, itertools, json, random

OUT = "scripts/eval/results/tengyur-levers-6121/refjudge"
key = json.load(open(f"{OUT}/key.json"))
J = {"J1": {}, "J2": {}}
for f in glob.glob("/root/tlev/refjudge/out-J*-*.jsonl"):
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
            ctrl["PLANT"].append({"judge": j, "caught": bool(sc["A_PLANT"]["inversions"]) and not sc["A"]["inversions"] or len(sc["A_PLANT"]["inversions"]) > len(sc["A"]["inversions"]),
                                  "ranked_below": any("A" in t and "A_PLANT" not in t for t in rk[:1])})
        else:
            ctrl["DUP"].append({"judge": j, "tie": any(set(t) == {"S", "S_DUP"} for t in rk), "same_fid": sc["S"]["fidelity"] == sc["S_DUP"]["fidelity"]})
gate = {j: {"plant_caught": sum(x["caught"] for x in ctrl["PLANT"] if x["judge"] == j), "plants": sum(1 for x in ctrl["PLANT"] if x["judge"] == j),
            "dup_tie": sum(x["tie"] for x in ctrl["DUP"] if x["judge"] == j), "dups": sum(1 for x in ctrl["DUP"] if x["judge"] == j)} for j in J}

ARMS = ["S", "A", "C", "P"]
rows = []
for iid, k in key.items():
    if k["kind"] != "ARMS":
        continue
    per = {}
    for j in J:
        sc, rk = unblind(j, iid)
        per[j] = {a: {"fid": sc[a]["fidelity"], "inv": len(sc[a]["inversions"]), "om": len(sc[a]["omissions"]), "inven": len(sc[a]["inventions"]),
                      "span_off": sc[a]["span"] != "same", "rank": next(i for i, t in enumerate(rk) if a in t)} for a in ARMS}
    rows.append({"id": iid, "page_id": k["page_id"], "toh": k["toh"], "J": per})


def summary(rs):
    n = len(rs)
    o = {"sides": n}
    for a in ARMS:
        fid = [sum(r["J"][j][a]["fid"] for j in J) / 2 for r in rs]
        o[a] = {"fidelity_mean": round(sum(fid) / n, 2),
                "inversion_sides_either": sum(1 for r in rs if any(r["J"][j][a]["inv"] for j in J)),
                "inversion_sides_both": sum(1 for r in rs if all(r["J"][j][a]["inv"] for j in J)),
                "inversions_per100_mean_of_judges": round(100 * sum(r["J"][j][a]["inv"] for r in rs for j in J) / (2 * n), 1),
                "omission_sides_either": sum(1 for r in rs if any(r["J"][j][a]["om"] for j in J)),
                "span_off_either": sum(1 for r in rs if any(r["J"][j][a]["span_off"] for j in J)),
                "mean_rank": round(sum(r["J"][j][a]["rank"] for r in rs for j in J) / (2 * n), 2)}
    for x in ["A", "C", "P"]:
        d = [sum(r["J"][j][x]["fid"] - r["J"][j]["S"]["fid"] for j in J) / 2 for r in rs]
        inv = [sum(r["J"][j]["S"]["inv"] - r["J"][j][x]["inv"] for j in J) / 2 for r in rs]
        rng = random.Random(6121)
        bs = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(2000))
        o[f"{x}_vs_S"] = {"fid_diff": round(sum(d) / n, 2), "fid_diff_ci": [round(bs[50], 2), round(bs[1949], 2)],
                          "sides_higher": sum(1 for v in d if v > 0), "sides_lower": sum(1 for v in d if v < 0),
                          "inversions_fewer_per100": round(100 * sum(inv) / n, 1)}
    return o


res = {"gate": gate, "all": summary(rows), "by_text": {t: summary([r for r in rows if r["toh"] == t]) for t in sorted({r["toh"] for r in rows})},
       "judge_fid_agree_within_1": round(sum(abs(r["J"]["J1"][a]["fid"] - r["J"]["J2"][a]["fid"]) <= 1 for r in rows for a in ARMS) / (4 * len(rows)), 3),
       "rows": rows}
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1)
print("gate", gate)
print("agree", res["judge_fid_agree_within_1"])
for k, v in [("all", res["all"])] + list(res["by_text"].items()):
    print("==", k, v["sides"])
    for a in ARMS:
        print("  ", a, v[a])
    for x in ["A", "C", "P"]:
        print("  ", x, "vs S", v[f"{x}_vs_S"])
