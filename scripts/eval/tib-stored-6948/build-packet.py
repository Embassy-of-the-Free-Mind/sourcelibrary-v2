#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tib-translator-6948/build-packet.py (#6957) — the same item line, seeded label shuffle, 8 PLANT
# (#5829's planter) and 4 DUP, two judge orders. That script reads #6957's arms (G4L, F38, OP, PROD) and 84000 cuts;
# here the arms are STORED (pages.translation.data), G4L and OP, every item is source-only, and PLANT/DUP use STORED.
"""
build-packet.py — $0. Blinded judge packet for the #6948 stored-English run (40 pages × STORED, G4L, OP).
  python3 scripts/eval/tib-stored-6948/build-packet.py [--parts 9]
Writes $JOB_SCRATCH/judge/in-J{1,2}-NN.jsonl (holds source and arm text: never committed) and
scripts/eval/results/tib-stored-6948/key.json (labels, kinds, plants; no text).
"""
import json, os, random, subprocess, sys, glob, shutil

S = os.environ["JOB_SCRATCH"]
JW, OUT = f"{S}/judge", "scripts/eval/results/tib-stored-6948"
opt = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
PARTS = int(opt("parts", "9"))
SEED = 6948
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
shutil.copyfile("scripts/eval/translation-vs-reference/JUDGE-PROMPT.md", f"{JW}/PROMPT.md")
rng = random.Random(SEED)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
sample = {r["page_id"]: r for r in read(f"{S}/sample.jsonl")}
pages = {r["id"]: r for r in read(f"{S}/sample-pages.jsonl")}
arm = {"G4L": {r["uid"]: r["text"] for r in read(f"{S}/G4L/G4L.jsonl") if (r.get("text") or "").strip()},
       "OP": {r["uid"]: r["text"] for r in read(f"{S}/OP/OP.jsonl") if (r.get("text") or "").strip()},
       "STORED": {pid: p["stored_en"] for pid, p in pages.items()}}
NOREF = ("No published English translation of this passage is available. Judge every candidate against the Tibetan "
         "source alone, and give reference_fit \"cant_tell\".")


def line(pid, labels):
    p = pages[pid]
    return {"id": None, "lang": "Tibetan", "book": p["book"].get("display_title") or p["book"]["title"], "reference_note": NOREF,
            "source": p["ocr"], "reference": None, "n": len(labels), "translations": labels}


def item(pid, cands):
    names = list(cands); rng.shuffle(names)
    lab = {f"T{i + 1}": n for i, n in enumerate(names)}
    return line(pid, {t: cands[n] for t, n in lab.items()}), lab


items, missing = [], {}
for pid in sorted(sample):
    have = {a: arm[a][pid] for a in ("STORED", "G4L", "OP") if pid in arm[a]}
    for a in ("G4L", "OP"):
        if a not in have: missing.setdefault(a, []).append(pid)
    it, lab = item(pid, have)
    s = sample[pid]
    items.append((it, {"kind": "ARMS", "page_id": pid, "book": s["book_id"], "stratum": s["stratum"], "src": s["kind"], "labels": lab}))
ids = sorted(u for u in sample if u in arm["G4L"]); ctrl = rng.sample(ids, 20)
plant_js = ("import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from "
            "'./scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(" + str(SEED) + ")); const t = "
            "JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => x ? p.plantReversal(x) : null)));")
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm["STORED"][u] for u in ctrl[:16]])]))
n_plant = 0
for pid, pl in zip(ctrl[:16], planted):
    t = arm["STORED"][pid]
    if not pl or pl["old"] == pl["new"] or n_plant == 8: continue
    new = t.replace(pl["old"], pl["new"], 1)
    if new == t: continue
    it, lab = item(pid, {"P": t, "P_PLANT": new})
    items.append((it, {"kind": "PLANT", "page_id": pid, "labels": lab, "plant": pl})); n_plant += 1
for pid in ctrl[16:20]:
    it, lab = item(pid, {"P": arm["STORED"][pid], "P_DUP": arm["STORED"][pid], "G4L": arm["G4L"][pid]})
    items.append((it, {"kind": "DUP", "page_id": pid, "labels": lab}))
rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it["id"] = f"T{i + 1:03d}"; key[it["id"]] = k
json.dump({"items": key, "missing_arm": missing}, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
for f in glob.glob(f"{JW}/in-*.jsonl"): os.remove(f)
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(SEED + 1).sample(items, len(items))
    for p in range(PARTS):
        with open(f"{JW}/in-{j}-{p + 1:02d}.jsonl", "w") as f:
            for it, _ in order[p::PARTS]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
sizes = sorted(os.path.getsize(f) for f in glob.glob(f"{JW}/in-J1-*.jsonl"))
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "parts", PARTS,
      "bytes", sizes[0], "-", sizes[-1], "missing", {a: len(v) for a, v in missing.items()}, "plants", n_plant)
