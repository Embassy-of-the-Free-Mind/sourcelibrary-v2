#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-levers/score-ref.py + score-tib.py (#6182) unblind the Opus judges, run the
# gate and the per-arm summary. This reads THEIR keys and Opus outputs unchanged and adds a third judge (Fable)
# beside them as a robustness check: gate, per-arm means by judge, rank order, inversion κ, >1-point
# disagreements and the self-preference contrast. It changes no Opus number. NUMBERS ONLY: no judge quotes.
"""
fable-judge.py — $0. Fable (`claude-fable-5-1`, subscription) judged the J1 input files of three Tengyur
packets with the same prompt (JUDGE-PROMPT-REF-R3.md), the same blind labels and the same controls:
  main  /root/pareto-6182/tibjudge          171 sides × 11 arms (S FP AA L31 L35 G35 G36 G37 G38 PRO O)
  c38   /root/cli38-6182/refjudge113         113 sides × FP G38 C38
  ctib  /root/pareto-claude-sub-6182/tibjudge 171 sides × CS CH FP G38
  python3 scripts/eval/pareto-6182/fable-judge.py --fable-dir <dir with main/ c38/ ctib/ out-F-*.jsonl> \
      [--disagreements <file>]   # writes scripts/eval/results/pareto-6182/fable-judge.json
"""
import glob, json, random, sys

ARGS = sys.argv
FD = ARGS[ARGS.index("--fable-dir") + 1]
OUT = "scripts/eval/results/pareto-6182/fable-judge.json"
PACKETS = {
    "main": {"key": "scripts/eval/results/pareto-6182/tibjudge/key.json", "opus": "/root/pareto-6182/tibjudge",
             "arms": ["S", "FP", "AA", "L31", "L35", "G35", "G36", "G37", "G38", "PRO", "O"], "claude": ["O"]},
    "c38": {"key": "scripts/eval/results/cli-arm-6182/refjudge113/key.json", "opus": "/root/cli38-6182/refjudge113",
            "arms": ["FP", "G38", "C38"], "claude": []},
    "ctib": {"key": "KEY_CTIB", "opus": "/root/pareto-claude-sub-6182/tibjudge",
             "arms": ["CS", "CH", "FP", "G38"], "claude": ["CS", "CH"]},
}
if "--ctib-key" in ARGS:
    PACKETS["ctib"]["key"] = ARGS[ARGS.index("--ctib-key") + 1]
TOH = {k["page_id"]: k["toh"] for k in json.load(open("/root/tref/judge/key.json")).values() if isinstance(k, dict) and k.get("toh")}
B = 2000


def load(pattern):
    d = {}
    for f in glob.glob(pattern):
        for l in open(f):
            if l.strip():  # a judge can write an item under a neighbour's id (Fable did once: X163 as X164)
                o = json.loads(l); assert o["id"] not in d, f"duplicate id {o['id']} in {f}"; d[o["id"]] = o
    return d


def kappa(f1, f2):
    n = len(f1); po = sum(a == b for a, b in zip(f1, f2)) / n
    p1, p2 = sum(f1) / n, sum(f2) / n; pe = p1 * p2 + (1 - p1) * (1 - p2)
    return round((po - pe) / (1 - pe), 3) if pe < 1 else None


def boot(rows, stat, seed=6182):
    by = {}
    for r in rows: by.setdefault(r["toh"], []).append(r)
    texts, rng, out = sorted(by), random.Random(seed), []
    for _ in range(B):
        draw = []
        for t in (rng.choice(texts) for _ in texts):
            g = by[t]; draw += [g[rng.randrange(len(g))] for _ in g]
        out.append(stat(draw))
    out.sort()
    return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B) - 1], 3)]


res = {"date": "2026-10-08", "judge": "claude-fable-5-1 (subscription, $0), claude -p / Agent subagents, prompt JUDGE-PROMPT-REF-R3.md verbatim, J1's input files",
       "role": "robustness check; the preregistered primary judges (two blind Opus) are unchanged", "packets": {}}
DIS = []
for name, P in PACKETS.items():
    key = json.load(open(P["key"]))
    J = {"J1": load(f"{P['opus']}/out-J1-*.jsonl"), "J2": load(f"{P['opus']}/out-J2-*.jsonl"), "F": load(f"{FD}/{name}/out-F-*.jsonl")}
    miss = {j: sum(1 for i in key if i not in J[j]) for j in J}
    BASE = "FP"

    def unblind(j, iid):  # a score with a list field left out (1 Fable record, X063: no "inversions") counts as empty
        o, lab = J[j][iid], key[iid]["labels"]
        return {lab[t]: s for t, s in o["scores"].items()}, [[lab[t] for t in tier] for tier in o["ranking"]]

    gate = {}
    for j in J:
        pl_c = pl_n = dup_t = dup_n = strict = 0
        for iid, k in key.items():
            if k["kind"] == "ARMS" or iid not in J[j]: continue
            sc, rk = unblind(j, iid)
            if k["kind"] == "PLANT":
                p, t = sc[f"{BASE}_PLANT"], sc[BASE]; pl_n += 1
                pi, ti = p.get("inversions", []), t.get("inversions", [])
                caught = bool(pi) and not ti or len(pi) > len(ti)
                pl_c += caught or p["fidelity"] < t["fidelity"]; strict += caught and p["fidelity"] < t["fidelity"]
            else:
                dup_n += 1; dup_t += any(set(t) == {"S", "S_DUP"} for t in rk)
        gate[j] = {"plants": pl_n, "plant_caught": pl_c, "plant_caught_strict": strict, "dups": dup_n, "dup_tie": dup_t,
                   "pass": pl_n > 0 and pl_c >= 0.75 * pl_n and dup_t >= 0.75 * dup_n}
    rows = []
    for iid, k in key.items():
        if k["kind"] != "ARMS" or any(iid not in J[j] for j in J): continue
        per = {}
        for j in J:
            sc, rk = unblind(j, iid)
            per[j] = {a: {"fid": sc[a]["fidelity"], "inv": len(sc[a].get("inversions", [])), "om": len(sc[a].get("omissions", [])),
                          "inven": len(sc[a].get("inventions", [])), "rank": next(i for i, t in enumerate(rk) if a in t)} for a in P["arms"]}
        toh = k.get("toh") or (k["text"] if k.get("set") == "tib-ref58" else TOH[k["page_id"]])
        rows.append({"id": iid, "page_id": k["page_id"], "toh": toh, "set": k.get("set") or "tib-ref113", "J": per})
    A, n = P["arms"], len(rows)
    if not n:
        res["packets"][name] = {"items_missing": miss, "sides_scored": 0, "gate": gate}
        continue
    O_ = lambda r, a: (r["J"]["J1"][a]["fid"] + r["J"]["J2"][a]["fid"]) / 2
    means = {j: {a: round(sum(r["J"][j][a]["fid"] for r in rows) / n, 3) for a in A} for j in J}
    means["Opus (J1+J2)/2"] = {a: round(sum(O_(r, a) for r in rows) / n, 3) for a in A}
    order = {j: sorted(A, key=lambda a: -m[a]) for j, m in means.items()}
    diff = {a: {"F_minus_Opus": round(means["F"][a] - means["Opus (J1+J2)/2"][a], 3),
                "ci_by_text": boot(rows, lambda d, a=a: sum(r["J"]["F"][a]["fid"] - O_(r, a) for r in d) / len(d))} for a in A}

    def pair(x, y):
        xs = [r["J"][x][a]["fid"] for r in rows for a in A]; ys = [r["J"][y][a]["fid"] for r in rows for a in A]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        cov = sum((u - mx) * (v - my) for u, v in zip(xs, ys)); vx = sum((u - mx) ** 2 for u in xs); vy = sum((v - my) ** 2 for v in ys)
        f1 = [r["J"][x][a]["inv"] > 0 for r in rows for a in A]; f2 = [r["J"][y][a]["inv"] > 0 for r in rows for a in A]
        return {"fid_exact": round(sum(u == v for u, v in zip(xs, ys)) / len(xs), 3), "fid_within_1": round(sum(abs(u - v) <= 1 for u, v in zip(xs, ys)) / len(xs), 3),
                "fid_pearson": round(cov / (vx * vy) ** 0.5, 3) if vx and vy else None, "inversion_flag_kappa": kappa(f1, f2),
                "inversion_flags": {x: sum(f1), y: sum(f2), "both": sum(a and b for a, b in zip(f1, f2))}}
    agree = {"J1~J2": pair("J1", "J2"), "F~J1": pair("F", "J1"), "F~J2": pair("F", "J2")}
    # inversion sides per 100, per judge
    inv100 = {j: {a: round(100 * sum(r["J"][j][a]["inv"] > 0 for r in rows) / n, 1) for a in A} for j in J}
    # >1 point: Fable differs from the Opus mean by more than one grade
    dis = [(r, a) for r in rows for a in A if abs(r["J"]["F"][a]["fid"] - O_(r, a)) > 1]
    dis_either = [(r, a) for r in rows for a in A if max(abs(r["J"]["F"][a]["fid"] - r["J"][j][a]["fid"]) for j in ("J1", "J2")) > 1]
    dis_both1 = [(r, a) for r in rows for a in A if min(abs(r["J"]["F"][a]["fid"] - r["J"][j][a]["fid"]) for j in ("J1", "J2")) >= 1]
    inv_split = [(r, a) for r in rows for a in A if (r["J"]["F"][a]["inv"] > 0) != (r["J"]["J1"][a]["inv"] > 0) == (r["J"]["J2"][a]["inv"] > 0)]
    for r, a in sorted(set(map(lambda x: (x[0]["id"], x[1]), dis_either + dis_both1 + inv_split))):
        r = next(x for x in rows if x["id"] == r)
        DIS.append({"packet": name, "id": r["id"], "page_id": r["page_id"], "toh": r["toh"], "arm": a,
                    "F": r["J"]["F"][a]["fid"], "J1": r["J"]["J1"][a]["fid"], "J2": r["J"]["J2"][a]["fid"],
                    "inv": {j: r["J"][j][a]["inv"] for j in J}})
    # self-preference: Claude arm minus the mean of the non-Claude arms, per judge; F − Opus contrast by-text CI
    selfp = {}
    nonc = [a for a in A if a not in P["claude"] and a not in ("S", "AA")]  # S and AA are FP's engine; keep lanes only
    for c in P["claude"]:
        rel = lambda r, j, c=c: r["J"][j][c]["fid"] - sum(r["J"][j][b]["fid"] for b in nonc) / len(nonc)
        relO = lambda r, c=c: (rel(r, "J1") + rel(r, "J2")) / 2
        selfp[c] = {"vs": nonc, "Opus_J1": round(sum(rel(r, "J1") for r in rows) / n, 3), "Opus_J2": round(sum(rel(r, "J2") for r in rows) / n, 3),
                    "Opus_mean": round(sum(relO(r) for r in rows) / n, 3), "Fable": round(sum(rel(r, "F") for r in rows) / n, 3),
                    "Fable_minus_Opus": round(sum(rel(r, "F") - relO(r) for r in rows) / n, 3),
                    "Fable_minus_Opus_ci_by_text": boot(rows, lambda d, rel=rel, relO=relO: sum(rel(r, "F") - relO(r) for r in d) / len(d)),
                    "rank_of_arm": {j: order[j].index(c) + 1 for j in order}}
    res["packets"][name] = {"items_missing": miss, "sides_scored": n, "gate": gate, "arm_means_by_judge": means,
                            "arm_order_by_judge": order, "fable_minus_opus_by_arm": diff, "inversion_sides_per100_by_judge": inv100,
                            "agreement": agree, "disagreements_gt1": len(dis), "disagreements_gt1_either_judge": len(dis_either),
                            "fable_off_both_opus_by_ge1": len(dis_both1), "inversion_flag_fable_alone": len(inv_split), "self_preference": selfp}
res["disagreements_gt1_total"] = len(DIS)
json.dump(res, open(OUT, "w"), indent=1, ensure_ascii=False)
if "--disagreements" in ARGS:
    json.dump(DIS, open(ARGS[ARGS.index("--disagreements") + 1], "w"), indent=0)
for name, p in res["packets"].items():
    print(f"== {name}: {p['sides_scored']} sides, missing {p['items_missing']}, gate F {p['gate']['F']}")
    if not p["sides_scored"]: continue
    for j, o in p["arm_order_by_judge"].items(): print(f"  order {j:15} {' > '.join(o)}")
    for a, d in p["fable_minus_opus_by_arm"].items():
        print(f"  {a:4} J1 {p['arm_means_by_judge']['J1'][a]:.2f} J2 {p['arm_means_by_judge']['J2'][a]:.2f} F {p['arm_means_by_judge']['F'][a]:.2f}  F−Opus {d['F_minus_Opus']:+.2f} {d['ci_by_text']}  inv/100 J1 {p['inversion_sides_per100_by_judge']['J1'][a]} J2 {p['inversion_sides_per100_by_judge']['J2'][a]} F {p['inversion_sides_per100_by_judge']['F'][a]}")
    print("  agreement", json.dumps(p["agreement"]))
    print("  >1pt", p["disagreements_gt1"], "either", p["disagreements_gt1_either_judge"], "off-both", p["fable_off_both_opus_by_ge1"], "inv-alone", p["inversion_flag_fable_alone"], " self-pref", json.dumps(p["self_preference"]))
