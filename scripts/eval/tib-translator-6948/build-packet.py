#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/build-xl-packet.py (--g4l, #6750) — the item line, the seeded label shuffle, 8 PLANT
# with #5829's planter and 4 DUP, two judge orders. That script reads #6182's xl records and arm files on the main box;
# this writes the same item line from #6948's sample, arms and 84000 cuts. PLANT uses F38's English (production's
# English exists on only 47 of the 60 pages); DUP is F38, its copy and G4L.
"""
build-packet.py — $0. Blinded judge packet for #6948 (60 Tibetan pages × G4L, F38, OP, PROD where it exists).
  python3 scripts/eval/tib-translator-6948/build-packet.py [--parts 12]
Writes $JOB_SCRATCH/judge/in-J{1,2}-NN.jsonl (holds reference text: never committed) and
scripts/eval/results/tib-translator-6948/key.json (labels, kinds, plants; no text).
"""
import json, os, random, subprocess, sys, glob

S = os.environ["JOB_SCRATCH"]
JW, OUT = f"{S}/judge", "scripts/eval/results/tib-translator-6948"
opt = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
PARTS = int(opt("parts", "12"))
SEED = 6948
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
rng = random.Random(SEED)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
sample = {r["page_id"]: r for r in read(f"{S}/sample.jsonl")}
pages = {r["id"]: r for r in read(f"{S}/sample-pages.jsonl")}
refs = json.load(open(f"{S}/refs.json"))
arm = {a: {r["uid"]: r["text"] for r in read(f"{S}/{a}/{a}.jsonl") if (r.get("text") or "").strip()} for a in ("G4L", "F38")}
op = {}
for r in read(f"{S}/OP/OP.jsonl"):
    if (r.get("text") or "").strip(): op[r["uid"]] = r["text"]
arm["OP"] = op
arm["PROD"] = {pid: p["prod_en"] for pid, p in pages.items() if (p.get("prod_en") or "").strip()}
NOREF = ("No published English translation of this passage is available. Judge every candidate against the Tibetan "
         "source alone, and give reference_fit \"cant_tell\".")


def line(pid, labels):
    p, s = pages[pid], sample[pid]
    o = {"id": None, "lang": "Tibetan", "book": p["book"].get("display_title") or p["book"]["title"]}
    r = refs.get(pid)
    if r:
        o.update(reference_title=r["reference_title"], reference_translator="84000: Translating the Words of the Buddha",
                 reference_year=None, reference_style="literal")
        if r["kind"] == "derge":
            o["reference_note"] = ("The page is this Derge folio side; the reference is 84000's English for the same side, "
                                   "cut at 84000's folio markers (it may start or end a clause off the page).")
        else:
            wide = any(x["cut"] == "passage overlap" for x in r["sides"])
            o["reference_note"] = ("The page is from a manuscript Kangyur, another edition. It was located in the Derge "
                                   "edition by text matching; the reference is 84000's English for that Derge folio and its "
                                   "neighbouring sides, so it is wider than the page: the page lies somewhere inside it."
                                   + (" Here the cut is by whole passages, so it is wider still." if wide else ""))
        o["source"] = p["ocr"]; o["reference"] = r["reference"]
    else:
        o["reference_note"] = NOREF; o["source"] = p["ocr"]; o["reference"] = None
    o["n"] = len(labels); o["translations"] = labels
    return o


def item(pid, cands):
    names = list(cands); rng.shuffle(names)
    lab = {f"T{i + 1}": n for i, n in enumerate(names)}
    return line(pid, {t: cands[n] for t, n in lab.items()}), lab


items, missing = [], {}
for pid in sorted(sample):
    have = {a: arm[a][pid] for a in ("G4L", "F38", "OP", "PROD") if pid in arm[a]}
    for a in ("G4L", "F38", "OP"):
        if a not in have: missing.setdefault(a, []).append(pid)
    it, lab = item(pid, have)
    items.append((it, {"kind": "ARMS", "page_id": pid, "book": sample[pid]["book_id"], "stratum": sample[pid]["stratum"],
                       "cell": sample[pid]["cell"], "ref": refs[pid]["kind"] if pid in refs else None, "labels": lab}))
ids = sorted(u for u in sample if u in arm["F38"] and u in arm["G4L"]); ctrl = rng.sample(ids, 20)
plant_js = ("import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from "
            "'./scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(" + str(SEED) + ")); const t = "
            "JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => x ? p.plantReversal(x) : null)));")
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm["F38"][u] for u in ctrl[:16]])]))
n_plant = 0
for pid, pl in zip(ctrl[:16], planted):
    t = arm["F38"][pid]
    if not pl or pl["old"] == pl["new"] or n_plant == 8: continue
    new = t.replace(pl["old"], pl["new"], 1)
    if new == t: continue
    it, lab = item(pid, {"P": t, "P_PLANT": new})
    items.append((it, {"kind": "PLANT", "page_id": pid, "labels": lab, "plant": pl})); n_plant += 1
for pid in ctrl[16:20]:
    it, lab = item(pid, {"P": arm["F38"][pid], "P_DUP": arm["F38"][pid], "G4L": arm["G4L"][pid]})
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
      "bytes", sizes[0], "-", sizes[-1], "missing", {a: len(v) for a, v in missing.items()}, "plants tried", min(16, len(ctrl)))
