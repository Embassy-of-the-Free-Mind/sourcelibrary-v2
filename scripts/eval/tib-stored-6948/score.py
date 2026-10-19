#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tib-translator-6948/score.py (#6957) — the per-arm stats, by-book bootstrap and pairwise
# deltas, with score-xl.py's decode / norm / judge_gate imported unchanged; here the arms are STORED, G4L, OP, the
# blocks are the two stored cohorts (S38, S3P; S3P split by source kind, descriptive), and the rule is the brief's.
"""
score.py — $0. Scores the #6948 stored-English run by its prereg (experiments/2026-10-18-tibetan-stored-english-6948.md).
  python3 scripts/eval/tib-stored-6948/score.py
Reads $JOB_SCRATCH/judge/out-J*.jsonl and scripts/eval/results/tib-stored-6948/key.json; writes
scripts/eval/results/tib-stored-6948/scores.json. NUMBERS ONLY: no judge quotes, no arm text.
"""
import json, os, sys, glob, random, importlib.util, collections, datetime
sys.dont_write_bytecode = True

S = os.environ["JOB_SCRATCH"]
OUT = "scripts/eval/results/tib-stored-6948"
spec = importlib.util.spec_from_file_location("score_xl", "scripts/eval/pareto-6182/score-xl.py")
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)
B, SEED = 2000, 6948
CAND = ["STORED", "G4L", "OP"]
items = json.load(open(f"{OUT}/key.json"))["items"]
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
for j in dec:
    for i, d in dec[j].items():
        assert set(d) == set(items[i]["labels"].values()), (j, i, set(d), items[i]["labels"])
        assert all(isinstance(x["fid"], (int, float)) for x in d.values()), (j, i, "null fidelity")
gate = sx.judge_gate(items, dec)
JP = [j for j in ("J1", "J2") if gate[j]["pass"]]
assert JP, "instrument failure: no judge passed the gate"

rows = []
for i, k in items.items():
    if k["kind"] != "ARMS": continue
    rows.append({"id": i, "page_id": k["page_id"], "book": k["book"], "stratum": k["stratum"], "src": k["src"],
                 "arms": sorted(k["labels"].values()), "J": {j: dec[j][i] for j in JP}})


def fid(r, a): return sum(r["J"][j][a]["fid"] for j in r["J"]) / len(r["J"])
def either(r, a, f): return int(any(r["J"][j][a][f] for j in r["J"]))
def both(r, a, f): return int(len(r["J"]) == 2 and all(r["J"][j][a][f] for j in r["J"]))


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
            "reversal_page_ids": [r["id"] for r in rs if either(r, a, "rev")],
            "omission_pages_either": sum(either(r, a, "om") for r in rs), "invention_pages_either": sum(either(r, a, "inven") for r in rs),
            "unreadable_fill_pages_either": sum(either(r, a, "fill") for r in rs), "span_off_pages_either": sum(either(r, a, "span_off") for r in rs),
            "fid_le_3_pages": sum(fid(r, a) <= 3 for r in rs)}


def delta(rs, a, b):
    rs = [r for r in rs if a in r["arms"] and b in r["arms"]]
    if not rs: return None
    d = lambda r: fid(r, a) - fid(r, b)
    return {"pages": len(rs), "mean": round(sum(d(r) for r in rs) / len(rs), 3), "ci": boot(rs, lambda x: sum(d(r) for r in x) / len(x)),
            "higher": sum(d(r) > 0 for r in rs), "lower": sum(d(r) < 0 for r in rs)}


def block(rs):
    shared = [r for r in rs if all(a in r["arms"] for a in CAND)]
    return {"pages": len(rs), "pages_shared": len(shared), "arms_shared": {a: arm_stats(shared, a) for a in CAND},
            "arms_all_pages": {a: arm_stats(rs, a) for a in CAND},
            "deltas": {f"{a}-{b}": delta(shared, a, b) for a, b in (("STORED", "G4L"), ("STORED", "OP"), ("G4L", "OP"))}}


blocks = {"ALL": block(rows)}
for st in ("S38", "S3P"):
    blocks[st] = block([r for r in rows if r["stratum"] == st])
for src in ("derge-tengyur", "bdrc-yigdzin-v1"):
    blocks[f"S3P:{src}"] = block([r for r in rows if r["stratum"] == "S3P" and r["src"] == src])

# the brief's rule, per cohort
rule = {}
for st in ("S38", "S3P"):
    b = blocks[st]; d = b["deltas"]["STORED-G4L"]; s = b["arms_all_pages"]["STORED"]
    rev_share = s["reversal_pages_either"] / s["pages"]
    gap = d["mean"] <= -0.30
    rev = rev_share > 0.10 and s["reversal_pages_both"] >= 1
    rule[st] = {"stored_minus_g4l": d["mean"], "ci": d["ci"], "gap_trigger": gap, "reversal_pages_either": s["reversal_pages_either"],
                "reversal_pages_both": s["reversal_pages_both"], "scored_pages": s["pages"], "reversal_trigger": rev,
                "decision": "RE-TRANSLATE" if gap or rev else "KEEP"}
res = {"scored_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "judges_scoring": JP,
       "gate": {j: gate[j] for j in ("J1", "J2")}, "controls": gate["controls"], "blocks": blocks, "rule": rule,
       "agreement_within_1": round(sum(abs(dec["J1"][r["id"]][a]["fid"] - dec["J2"][r["id"]][a]["fid"]) <= 1 for r in rows for a in r["arms"]) /
                                   sum(len(r["arms"]) for r in rows), 3)}
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1)
print(json.dumps({"gate": {j: {k: gate[j][k] for k in ("plant_caught_prereg", "dup_tie", "pass")} for j in ("J1", "J2")}, "rule": rule}, indent=1))
for st, b in blocks.items():
    print(st, b["pages"], "shared", b["pages_shared"], {a: (b["arms_shared"][a]["fidelity"], b["arms_shared"][a]["ci"], b["arms_all_pages"][a]["reversal_pages_either"], b["arms_all_pages"][a]["reversal_pages_both"]) for a in CAND if b["arms_shared"][a]},
          {k: (v["mean"], v["ci"], v["higher"], v["lower"]) for k, v in b["deltas"].items() if v})
print("agree within 1", res["agreement_within_1"])
