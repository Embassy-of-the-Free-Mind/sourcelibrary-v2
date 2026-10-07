#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-levers/build-ref-packet.py (#6121) cuts blinded items for the 58 sides
# aligned to Stcherbatsky / La Vallée Poussin with PLANT and DUP controls; scripts/eval/tengyur-arms/
# build-packet.py (#5497) does the same against 84000 for 113 sides. Both packets already hold each
# side's source, neighbouring lines and reference cut; this reuses those item fields as they are and
# swaps in #6182's eleven candidates, so the 171 sides are judged in one instrument.
"""
build-tib-packet.py — $0. Blinded reference-judge packet for #6182 (Tibetan, 171 sides × 11 arms).

  python3 scripts/eval/pareto-6182/build-tib-packet.py [--parts 34]
  ... [--arms FP,G38,X,…] [--arms-dir DIR] [--out DIR] [--results DIR] [--seed N]
      a companion packet (another session's arms beside these as anchors): arms not loaded below are read
      from <arms-dir>/<ARM>.jsonl by uid; same item shape, controls and gate.

Writes /root/pareto-6182/tibjudge/in-J{1,2}-NN.jsonl (holds reference text: never committed) and
scripts/eval/results/pareto-6182/tibjudge/key.json. Controls per judge: 8 PLANT (FP beside FP with one
planted reversal, #5829's planter, no-op plants dropped) and 4 DUP (S, an identical S and L31).
"""
import json, os, random, subprocess, sys, glob

W = "/root/pareto-6182"
opt = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
JW = opt("out", f"{W}/tibjudge")
OUT = opt("results", "scripts/eval/results/pareto-6182/tibjudge")
ARMS_DIR = opt("arms-dir", None)
SEED = int(opt("seed", "6182"))
PARTS = int(opt("parts", "34"))
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
rng = random.Random(SEED)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
ARMS = opt("arms", "S,FP,AA,L31,L35,G35,G36,G37,G38,PRO,O").split(",")

# Item context (source, neighbours, reference cut) from the two earlier packets, keyed by page_id.
ctx = {}
for keyf, glob_in in (("scripts/eval/results/tengyur-models-6121/refjudge/key.json", "/root/tlev2/refjudge/in-J1-*.jsonl"),
                      ("/root/tref/judge/key.json", "/root/tref/judge/in-J1-*.jsonl")):
    key = json.load(open(keyf))
    for f in glob.glob(glob_in):
        for it in read(f):
            k = key[it["id"]]
            if k.get("kind") in ("PLANT", "DUP") or "page_id" not in k: continue
            c = {x: it[x] for x in ("text_title", "folio", "source", "prev_side_last_line", "next_side_first_line", "reference_source", "reference", "reference_prev_tail", "reference_next_head") if x in it}
            c["reference_source"] = c.get("reference_source") or "84000: Translating the Words of the Buddha (English, from this Tibetan)"
            ctx.setdefault(k["page_id"], c)

units = [u for u in read(f"{W}/units.jsonl") if u["set"] in ("tib-ref58", "tib-ref113")]
setof = {u["uid"]: u["set"] for u in units}
missing_ctx = [u["uid"] for u in units if u["uid"] not in ctx]
if missing_ctx: sys.exit(f"no item context for {len(missing_ctx)} sides: {missing_ctx[:5]}")

MINE = {"S", "FP", "AA", "L31", "L35", "G35", "G36", "G37", "G38", "PRO", "O"}
def load(arm):
    if arm not in MINE:
        return {r["uid"]: r["text"] for r in read(f"{ARMS_DIR}/{arm}.jsonl")}
    if arm in ("S", "L31", "L35", "G36", "G37", "O"):
        rows = read(f"{W}/arms/{arm}.jsonl")
        out = {r["uid"]: r["text"] for r in rows}
        if arm == "O":  # round 2's O for the 58
            out.update({r["page_id"]: r["text"] for r in read("/root/tlev/arms/O-ref.jsonl")})
        return out
    if arm == "FP":   # 58: round-1 A; 113: #5497 B2
        return {**{r["page_id"]: r["text"] for r in read("/root/tlev/arms/A-ref.jsonl")},
                **{r["page_id"]: r["text"] for r in read("scripts/eval/results/tengyur-arms-2026-10/arms/B2.jsonl")}}
    if arm == "AA":   # 58: new; 113: #5497 B
        return {**{r["uid"]: r["text"] for r in read(f"{W}/arms/AA.jsonl")}, **{r["page_id"]: r["text"] for r in read("/root/tref/arms/B.jsonl")}}
    old = {"G35": "G35", "G38": "G38", "PRO": "P"}[arm]   # 58: rounds 1–2; 113: new
    return {**{r["page_id"]: r["text"] for r in read(f"/root/tlev/arms/{old}-ref.jsonl")}, **{r["uid"]: r["text"] for r in read(f"{W}/arms/{arm}.jsonl")}}

arm = {a: load(a) for a in ARMS}
holes = {a: [u["uid"] for u in units if not (arm[a].get(u["uid"]) or "").strip()] for a in ARMS}
holes = {a: h for a, h in holes.items() if h}
if holes and "--allow-holes" not in sys.argv: sys.exit(f"missing arm outputs: { {a: len(h) for a, h in holes.items()} }")

def item(pid, cands):
    names = list(cands); rng.shuffle(names)
    lab = {f"T{i + 1}": n for i, n in enumerate(names)}
    return {"id": None, **ctx[pid], "candidates": {t: cands[n] for t, n in lab.items()}}, lab

items = []
for u in units:
    pid = u["uid"]
    have = {a: arm[a][pid] for a in ARMS if (arm[a].get(pid) or "").strip()}
    it, lab = item(pid, have)
    items.append((it, {"kind": "ARMS", "page_id": pid, "set": setof[pid], "text": ctx[pid]["text_title"].split(" ")[0], "labels": lab}))
ids = [u["uid"] for u in units]
ctrl = rng.sample(ids, 16)
plant_js = "import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(6182)); const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => p.plantReversal(x))));"
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm["FP"][pid] for pid in ctrl[:12]])]))
n_plant = 0
for pid, pl in zip(ctrl[:12], planted):
    if not pl or pl["old"] == pl["new"] or n_plant == 8: continue
    new = arm["FP"][pid].replace(pl["old"], pl["new"], 1)
    if new == arm["FP"][pid]: continue
    it, lab = item(pid, {"FP": arm["FP"][pid], "FP_PLANT": new})
    items.append((it, {"kind": "PLANT", "page_id": pid, "labels": lab, "plant": pl})); n_plant += 1
D1, D2 = (ARMS[0], ARMS[1]) if "S" not in ARMS or "L31" not in ARMS else ("S", "L31")
for pid in ctrl[12:16]:
    it, lab = item(pid, {D1: arm[D1][pid], f"{D1}_DUP": arm[D1][pid], D2: arm[D2][pid]})
    items.append((it, {"kind": "DUP", "page_id": pid, "labels": lab}))
rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it["id"] = f"X{i + 1:03d}"; key[it["id"]] = k
json.dump(key, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
for f in glob.glob(f"{JW}/in-*.jsonl"): os.remove(f)
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(SEED + 1).sample(items, len(items))
    for p in range(PARTS):
        with open(f"{JW}/in-{j}-{p + 1:02d}.jsonl", "w") as f:
            for it, _ in order[p::PARTS]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
sizes = sorted(os.path.getsize(f) for f in glob.glob(f"{JW}/in-J1-*.jsonl"))
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "parts", PARTS, "per judge; part bytes", sizes[0], "–", sizes[-1], "; holes", {a: len(h) for a, h in holes.items()})
