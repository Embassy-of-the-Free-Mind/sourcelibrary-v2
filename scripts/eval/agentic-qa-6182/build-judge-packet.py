#!/usr/bin/env python3
# PRIOR ART: scripts/eval/canon-ref-6331/build-judge-packet.py — same item line, same PLANT/DUP rule and planter, same
# seed scheme. Changed: the arms are C38 (anchor), SAd, SA, GQ from job agentic-qa-6182, and identical texts are merged
# into one candidate whose label maps to every arm that produced it.
"""
build-judge-packet.py — $0. Blinded reference-judge packet for the #6182 agentic QA arms.

  python3 scripts/eval/agentic-qa-6182/build-judge-packet.py [--parts 25]

Items: 138 units × unique texts of {C38, SAd, SA, GQ}, labels shuffled per item. Controls (both judges): 8 PLANT (SA
beside a copy with one planted reversal) and 4 DUP (SA, an identical copy, C38). Writes
$JW/in-J{1,2}-NN.jsonl (holds reference text: never committed) and scripts/eval/results/agentic-qa-6182/judge/key.json.
"""
import json, os, random, subprocess, sys, glob

D = "/root/cli-set-6331"
REC = "/mnt/HC_Volume_105839809/jobs/zh-set-6331/records.jsonl"
AQ = "/mnt/HC_Volume_105839809/jobs/agentic-qa-6182"
JW = f"{AQ}/judge"
OUT = "scripts/eval/results/agentic-qa-6182/judge"
PARTS = int(sys.argv[sys.argv.index("--parts") + 1]) if "--parts" in sys.argv else 25
SEED = 6182
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
rng = random.Random(SEED)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
recs = {r["id"]: r for r in read(REC)}
units = {u["uid"]: u for u in read(f"{D}/units.jsonl")}
arm = {"C38": {r["uid"]: r["text"] for r in read(f"{D}/arms/C38.jsonl")}, "SA": {}, "SAd": {}, "GQ": {}}
for r in read(f"{AQ}/arms/SA.jsonl"):
    arm["SA"][r["uid"]] = r["text"]; arm["SAd"][r["uid"]] = r["draft"]
for r in read(f"{AQ}/arms/GQ.jsonl"):
    arm["GQ"][r["uid"]] = r["text"]
ARMS = ("C38", "SAd", "SA", "GQ")
missing = [(a, u) for u in units for a in ARMS if not (arm[a].get(u) or "").strip()]
if missing: sys.exit(f"missing arm text: {missing[:5]} ({len(missing)})")


def line(r, labels):
    m = r["reference_meta"]
    o = {"id": None, "track": r["set"], "lang": r["lang"], "reference_title": m.get("title"), "reference_translator": m.get("translator"),
         "reference_year": m.get("year"), "reference_style": m.get("style")}
    if m.get("located"): o["reference_located"] = m["located"]
    if m.get("coverage_note"): o["reference_note"] = m["coverage_note"]
    if r.get("source_prev_tail"): o["source_prev_tail"] = r["source_prev_tail"]
    o["source"] = r["ocr_text"]
    if r.get("source_next_head"): o["source_next_head"] = r["source_next_head"]
    o["reference"] = r["reference_text"]
    o["n"] = len(labels); o["translations"] = labels
    return o


def item(uid, cands, merge=True):
    """cands: name → text. With merge, identical texts become one candidate; the label maps to every name."""
    groups = {}
    for n, t in cands.items():
        groups.setdefault(t.strip() if merge else n, []).append(n)
    gl = list(groups.values()); rng.shuffle(gl)
    lab = {f"T{i + 1}": g for i, g in enumerate(gl)}
    return line(recs[uid], {t: cands[g[0]] for t, g in lab.items()}), lab


items = []
for uid in sorted(units):
    it, lab = item(uid, {a: arm[a][uid] for a in ARMS})
    r = recs[uid]
    items.append((it, {"kind": "ARMS", "uid": uid, "set": r["set"], "lang": r["lang"], "stratum": r["stratum"], "famous": bool(r.get("famous")),
                       "work": r["book_id"], "labels": lab}))
ids = sorted(units); ctrl = rng.sample(ids, 20)
plant_js = ("import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs';"
            f" const p = makePlanters(rng({SEED})); const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => x ? p.plantReversal(x) : null)));")
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm["SA"][u] for u in ctrl[:16]])]))
n_plant = 0
for uid, pl in zip(ctrl[:16], planted):
    t = arm["SA"][uid]
    if not pl or pl["old"] == pl["new"] or n_plant == 8: continue
    new = t.replace(pl["old"], pl["new"], 1)
    if new == t: continue
    it, lab = item(uid, {"P": t, "P_PLANT": new}, merge=False)
    items.append((it, {"kind": "PLANT", "uid": uid, "labels": lab, "plant": pl})); n_plant += 1
for uid in ctrl[16:20]:
    it, lab = item(uid, {"P": arm["SA"][uid], "P_DUP": arm["SA"][uid], "C38": arm["C38"][uid]}, merge=False)
    items.append((it, {"kind": "DUP", "uid": uid, "labels": lab}))
rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it["id"] = f"S{i + 1:03d}"; key[it["id"]] = k
json.dump({"items": key}, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
for f in glob.glob(f"{JW}/in-*.jsonl"): os.remove(f)
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(SEED + 1).sample(items, len(items))
    for p in range(PARTS):
        with open(f"{JW}/in-{j}-{p + 1:02d}.jsonl", "w") as f:
            for it, _ in order[p::PARTS]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
sizes = sorted(os.path.getsize(f) for f in glob.glob(f"{JW}/in-J1-*.jsonl"))
cand = [len(k["labels"]) for _, k in items if k["kind"] == "ARMS"]
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "candidates/item", sum(cand) / len(cand),
      "parts", PARTS, "bytes", sizes[0], "–", sizes[-1])
