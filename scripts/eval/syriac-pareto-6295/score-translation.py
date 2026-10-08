#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-xl.py — the judge gate (PLANT caught = inversion listed on the planted
# candidate or a lower fidelity than its twin; DUP tied), fidelity = mean of the two judges, an inversion page =
# either judge lists one. #6295's floor is R′ − R and its rule is K − R against that floor, bootstrapped by EDITION.
"""
score-translation.py — $0. Scores the #6295 Step 2 judge outputs and applies the preregistered rule.

  python3 scripts/eval/syriac-pareto-6295/score-translation.py --work <dir>

Writes scripts/eval/results/syriac-pareto-6295/translation-summary.json (numbers only, no source text) and the
blinding keys (judge/key-J*.json) next to it.
"""
import json, os, random, statistics, sys, re, math

opt = lambda k, d=None: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
W = opt("work"); OUT = "scripts/eval/results/syriac-pareto-6295"
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
pages = {p["slug"]: p for p in json.load(open(f"{W}/seal/pages.json"))}
edition = lambda u: re.sub(r" \(copy [AB]\)$", "", pages[u]["label"])
JUDGES = ["J1", "J2"]; ARMS = ["R", "R2", "K", "K2"]; B = 2000

key, res = {}, {}
for j in JUDGES:
    key[j] = json.load(open(f"{W}/judge/key-{j}.json"))
    res[j] = {}
    for f in sorted(os.listdir(f"{W}/judge")):
        if f.startswith(f"out-{j}-") and f.endswith(".jsonl"):
            for r in read(f"{W}/judge/{f}"): res[j][r["id"]] = r
missing = {j: sorted(set(key[j]) - set(res[j])) for j in JUDGES}

def by_name(j, iid):
    r = res[j][iid]; lab = key[j][iid]["labels"]
    return {lab[t]: s for t, s in r["scores"].items() if t in lab}, [[lab[t] for t in grp if t in lab] for grp in r["ranking"]]

gate = {}
for j in JUDGES:
    plants = [i for i, k in key[j].items() if k["kind"] == "PLANT" and i in res[j]]
    dups = [i for i, k in key[j].items() if k["kind"] == "DUP" and i in res[j]]
    caught = 0
    for i in plants:
        s, _ = by_name(j, i)
        if s["R_PLANT"].get("inversions") or s["R_PLANT"]["fidelity"] < s["R"]["fidelity"]: caught += 1
    tied = 0
    for i in dups:
        _, rk = by_name(j, i)
        if any("R" in g and "R_DUP" in g for g in rk): tied += 1
    need_p, need_d = math.ceil(0.75 * len(plants)), math.ceil(0.75 * len(dups))
    gate[j] = {"plants_caught": caught, "plants": len(plants), "dups_tied": tied, "dups": len(dups),
               "pass": len(plants) >= 6 and len(dups) >= 3 and caught >= need_p and tied >= need_d}
gate_pass = all(g["pass"] for g in gate.values())

# Per page × arm, both judges.
rows = {}
for j in JUDGES:
    for i, k in key[j].items():
        if k["kind"] != "ARMS" or i not in res[j]: continue
        s, rk = by_name(j, i)
        for a in ARMS:
            x = rows.setdefault(k["uid"], {}).setdefault(a, {"fid": [], "inv": False, "omi": False, "invent": False})
            x["fid"].append(s[a]["fidelity"]); x["inv"] |= bool(s[a].get("inversions")); x["omi"] |= bool(s[a].get("omissions")); x["invent"] |= bool(s[a].get("inventions"))
uids = sorted(u for u, v in rows.items() if all(len(v[a]["fid"]) == 2 for a in ARMS))
fid = {a: {u: statistics.mean(rows[u][a]["fid"]) for u in uids} for a in ARMS}
agree1 = sum(abs(rows[u][a]["fid"][0] - rows[u][a]["fid"][1]) <= 1 for u in uids for a in ARMS) / max(1, len(uids) * len(ARMS))

eds = sorted({edition(u) for u in uids}); by_ed = {e: [u for u in uids if edition(u) == e] for e in eds}
def boot(fn, seed):
    rnd = random.Random(seed); vals = []
    for _ in range(B):
        us = [u for _ in eds for u in by_ed[eds[rnd.randrange(len(eds))]]]
        vals.append(fn(us))
    vals.sort(); return [round(vals[int(0.025 * B)], 3), round(vals[int(0.975 * B)], 3)]
mean_of = lambda a: (lambda us: statistics.mean(fid[a][u] for u in us))
diff_of = lambda a, b: (lambda us: statistics.mean(fid[a][u] - fid[b][u] for u in us))
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(100 * (c - h), 1), round(100 * (c + h), 1)]

arms = {}
for n, a in enumerate(ARMS):
    inv = sum(rows[u][a]["inv"] for u in uids)
    arms[a] = {"fidelity": round(statistics.mean(fid[a].values()), 3), "fidelity_ci95": boot(mean_of(a), 6295 + n),
               "share_ge4": round(sum(fid[a][u] >= 4 for u in uids) / len(uids), 3),
               "inversion_pages": inv, "reversals_per_100": round(100 * inv / len(uids), 1), "reversals_ci95": wilson(inv, len(uids)),
               "omission_pages": sum(rows[u][a]["omi"] for u in uids), "invention_pages": sum(rows[u][a]["invent"] for u in uids)}
for a in ARMS:  # billed tokens of this run at the Batch rate, per 1,000 pages, over the judged pages
    bill = {r["uid"]: r for r in read(f"{W}/arms/T-{a}.jsonl")}
    arms[a]["usd_per_1k_batch"] = round(1000 * statistics.mean(bill[u]["usd_batch"] for u in uids), 3)
    arms[a]["thinking_tokens"] = sum(bill[u].get("thinking", 0) for u in uids)
floor_ci = boot(diff_of("R2", "R"), 7295)
f = max(abs(floor_ci[0]), abs(floor_ci[1]))
kr = {"mean": round(statistics.mean(fid["K"][u] - fid["R"][u] for u in uids), 3), "ci95": boot(diff_of("K", "R"), 8295)}
k2r2 = {"mean": round(statistics.mean(fid["K2"][u] - fid["R2"][u] for u in uids), 3), "ci95": boot(diff_of("K2", "R2"), 8296)}
within = kr["ci95"][0] >= -f and arms["K"]["inversion_pages"] <= arms["R"]["inversion_pages"] + 2
out = {
    "issue": 6295, "generated_by": "scripts/eval/syriac-pareto-6295/score-translation.py", "grade": "directional (under 30 books)",
    "model": "gemini-3.1-flash-lite (Batch, thinking budget 0, pinned v13 one-page prompt)",
    "judges": "two blind Opus judges (claude -p --model opus, subscription), against the Digital Syriac Corpus window",
    "n_pages": len(uids), "n_books": len({pages[u]["bid"] for u in uids}), "n_editions": len(eds), "bootstrap": f"{B} resamples of editions",
    "missing_outputs": missing, "gate": gate, "gate_pass": gate_pass, "judges_within_1_point": round(agree1, 3),
    "arms": arms, "noise_floor": {"r2_minus_r_mean": round(statistics.mean(fid["R2"][u] - fid["R"][u] for u in uids), 3), "ci95": floor_ci, "f": round(f, 3)},
    "k_minus_r": kr, "k2_minus_r2": k2r2,
    "rule": {"within_noise_floor": within if gate_pass else None,
             "test": "lower bound of K − R ≥ −f and inversion pages K ≤ R + 2",
             "verdict": (None if not gate_pass else "recommend the re-translation (gemini-3.1-flash-lite)" if within else "keep the Kraken-read translations withheld")},
    "per_page": [{"uid": u, "edition": edition(u), "tier": pages[u]["tier"], **{a: fid[a][u] for a in ARMS}, "inv": {a: rows[u][a]["inv"] for a in ARMS}} for u in uids],
}
os.makedirs(f"{OUT}/judge", exist_ok=True)
json.dump(out, open(f"{OUT}/translation-summary.json", "w"), indent=1, ensure_ascii=False); open(f"{OUT}/translation-summary.json", "a").write("\n")
for j in JUDGES: json.dump(key[j], open(f"{OUT}/judge/key-{j}.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: out[k] for k in ("n_pages", "gate", "gate_pass", "judges_within_1_point", "arms", "noise_floor", "k_minus_r", "k2_minus_r2", "rule")}, indent=1, ensure_ascii=False))
