#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-xl.py — the judge gate (PLANT caught = inversion listed on the planted
# candidate or a lower fidelity than its twin; DUP tied), fidelity = mean of the two judges, an inversion page =
# either judge lists one. #6295's floor is R′ − R and its rule is K − R against that floor, bootstrapped by EDITION.
"""
score-translation.py — $0. Scores the #6295 Step 2 judge outputs and applies the preregistered rule.

  python3 scripts/eval/syriac-pareto-6295/score-translation.py --work <dir> [--round c38]

Writes scripts/eval/results/syriac-pareto-6295/translation-summary.json (numbers only, no source text) and the
blinding keys (judge/key-J*.json) next to it. --round c38 (build-packet.py --round c38) writes
translation-summary-c38.json and judge-c38/: the CLI arms have no repeat, so the rule uses round 1's noise floor f,
and their cost is cli-cost.json's list-price estimate ($0 was billed).
"""
import json, os, random, statistics, sys, re, math

opt = lambda k, d=None: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
W = opt("work"); OUT = "scripts/eval/results/syriac-pareto-6295"; ROUND = opt("round")
RD = {None: {"dir": "judge", "arms": ["R", "R2", "K", "K2"], "base": "R", "out": "translation-summary.json"},
      "c38": {"dir": "judge-c38", "arms": ["R", "K", "C38-R", "C38-K"], "base": "C38-R", "out": "translation-summary-c38.json"}}[ROUND]
JD = RD["dir"]; BASE = RD["base"]
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
pages = {p["slug"]: p for p in json.load(open(f"{W}/seal/pages.json"))}
edition = lambda u: re.sub(r" \(copy [AB]\)$", "", pages[u]["label"])
JUDGES = ["J1", "J2"]; ARMS = RD["arms"]; B = 2000

key, res = {}, {}
for j in JUDGES:
    key[j] = json.load(open(f"{W}/{JD}/key-{j}.json"))
    res[j] = {}
    for f in sorted(os.listdir(f"{W}/{JD}")):
        if f.startswith(f"out-{j}-") and f.endswith(".jsonl"):
            for r in read(f"{W}/{JD}/{f}"): res[j][r["id"]] = r
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
        if s[f"{BASE}_PLANT"].get("inversions") or s[f"{BASE}_PLANT"]["fidelity"] < s[BASE]["fidelity"]: caught += 1
    tied = 0
    for i in dups:
        _, rk = by_name(j, i)
        if any(BASE in g and f"{BASE}_DUP" in g for g in rk): tied += 1
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
if ROUND is None:
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
else:
    # Lite's two drafts are anchors in this round: their billed cost is round 1's; the CLI drafts' is cli-cost.json's.
    r1s = json.load(open(f"{OUT}/translation-summary.json")); cc = json.load(open(f"{OUT}/cli-cost.json"))
    for a in ("R", "K"): arms[a]["usd_per_1k_batch"] = r1s["arms"][a]["usd_per_1k_batch"]
    for a in ("C38-R", "C38-K"):
        c = {p["uid"]: p["usd_batch"] for p in cc["translation"][a[-1]]["per_page"]}
        arms[a]["usd_per_1k_batch"] = round(1000 * statistics.mean(c[u] for u in uids), 3)
        arms[a]["cost_basis"] = "API list price, Batch rate, estimated (cli-cost.json); $0 billed"
    f = r1s["noise_floor"]["f"]
    kr = {"mean": round(statistics.mean(fid["C38-K"][u] - fid["C38-R"][u] for u in uids), 3), "ci95": boot(diff_of("C38-K", "C38-R"), 8395)}
    lite_kr = {"mean": round(statistics.mean(fid["K"][u] - fid["R"][u] for u in uids), 3), "ci95": boot(diff_of("K", "R"), 8396)}
    c38_r_minus_r = {"mean": round(statistics.mean(fid["C38-R"][u] - fid["R"][u] for u in uids), 3), "ci95": boot(diff_of("C38-R", "R"), 8397)}
    c38_k_minus_k = {"mean": round(statistics.mean(fid["C38-K"][u] - fid["K"][u] for u in uids), 3), "ci95": boot(diff_of("C38-K", "K"), 8398)}
    within = kr["ci95"][0] >= -f and arms["C38-K"]["inversion_pages"] <= arms["C38-R"]["inversion_pages"] + 2
    out = {
        "issue": 6295, "generated_by": "scripts/eval/syriac-pareto-6295/score-translation.py --round c38", "grade": "directional (under 30 books)",
        "model": "gemini-3.8-flash-low through the Antigravity CLI (agy -p, subscription, $0), run 2026-10-08; same pinned v13 one-page prompt, byte-identical to the lite arms'",
        "anchors": "R and K are round 1's gemini-3.1-flash-lite drafts, re-judged in the same items as anchors",
        "judges": "two blind Opus judges (claude -p --model opus, subscription), against the Digital Syriac Corpus window",
        "n_pages": len(uids), "n_books": len({pages[u]["bid"] for u in uids}), "n_editions": len(eds), "bootstrap": f"{B} resamples of editions",
        "missing_outputs": missing, "gate": gate, "gate_pass": gate_pass, "judges_within_1_point": round(agree1, 3),
        "arms": arms, "noise_floor": {"from": "round 1 (translation-summary.json): lite's e-text translated twice", "f": f},
        "k_minus_r": kr, "lite_k_minus_r_this_round": lite_kr, "c38_r_minus_lite_r": c38_r_minus_r, "c38_k_minus_lite_k": c38_k_minus_k,
        "rule": {"within_noise_floor": within if gate_pass else None,
                 "test": "lower bound of C38-K − C38-R ≥ −f (round 1's f) and inversion pages C38-K ≤ C38-R + 2",
                 "verdict": (None if not gate_pass else "recommend the re-translation (gemini-3.8-flash)" if within else "keep the Kraken-read translations withheld")},
        "per_page": [{"uid": u, "edition": edition(u), "tier": pages[u]["tier"], **{a: fid[a][u] for a in ARMS}, "inv": {a: rows[u][a]["inv"] for a in ARMS}} for u in uids],
    }
os.makedirs(f"{OUT}/{JD}", exist_ok=True)
json.dump(out, open(f"{OUT}/{RD['out']}", "w"), indent=1, ensure_ascii=False); open(f"{OUT}/{RD['out']}", "a").write("\n")
for j in JUDGES: json.dump(key[j], open(f"{OUT}/{JD}/key-{j}.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k != "per_page"}, indent=1, ensure_ascii=False))
