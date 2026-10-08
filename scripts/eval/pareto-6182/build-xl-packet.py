#!/usr/bin/env python3
# PRIOR ART: scripts/eval/translation-vs-reference/build-packet.mjs (#5695) writes the item line every
# track's judges read (packetLine: reference title/translator/year/style/located/note, source with its
# neighbours, reference, translations T1..Tn) with wrong-page and duplicate controls over the harness's
# record format. #6182's candidates live in its own arm files keyed by uid and its gate is the Tengyur
# packet's (PLANT + DUP, build-tib-packet.py), so this writes the same item line from those files.
"""
build-xl-packet.py — $0. Blinded reference-judge packet for #6182, every language but Tibetan.

  python3 scripts/eval/pareto-6182/build-xl-packet.py [--parts 64]

Items: 365 pages × {L31, AA, FP, L35, G35, G36, G37, G38, PRO} (+ O, the track's own Opus arm, where it
exists), labels shuffled per item. Controls per judge: 8 PLANT (the page's production English beside a
copy with one planted reversal, #5829's planter; no-op plants dropped) and 4 DUP (production, an
identical copy and G38). Writes /root/pareto-6182/xljudge/in-J{1,2}-NN.jsonl (holds reference text:
never committed) and scripts/eval/results/pareto-6182/xljudge/key.json.
"""
import json, os, random, subprocess, sys, glob

W = "/root/pareto-6182"
opt = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
JW, OUT = f"{W}/xljudge", "scripts/eval/results/pareto-6182/xljudge"
PARTS = int(opt("parts", "64"))
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
rng = random.Random(6182 + 1000)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
GEM = ["L31", "AA", "FP", "L35", "G35", "G36", "G37", "G38", "PRO"]
recs = {r["id"]: r for r in read(f"{W}/xl/records.jsonl") if r.get("reference_text")}
units = {u["uid"]: u for u in read(f"{W}/units.jsonl") if u["set"] == "xl"}
arm = {a: {r["uid"]: r["text"] for r in read(f"{W}/arms/{a}.jsonl") if r["uid"] in units and (r.get("text") or "").strip()} for a in GEM}
PROD = {"gemini-3.1-flash-lite": "L31", "gemini-3-flash-preview": "FP"}
# The track's own Opus arm (a context request, run on the subscription): judged beside, never a lane.
opus = {}
for uid, r in recs.items():
    for name, x in (r.get("prior_arms") or {}).items():
        if name in ("opus", "O") and (x.get("text") or "").strip(): opus[uid] = x["text"]

def line(r, iid, labels):
    m = r["reference_meta"]
    o = {"id": iid, "track": r["track"], "lang": r["lang"], "reference_title": m.get("title"), "reference_translator": m.get("translator"),
         "reference_year": m.get("year"), "reference_style": m.get("style")}
    if m.get("located"): o["reference_located"] = m["located"]
    if m.get("coverage_note"): o["reference_note"] = m["coverage_note"]
    if r.get("source_prev_tail"): o["source_prev_tail"] = r["source_prev_tail"]
    o["source"] = r["ocr_text"]
    if r.get("source_next_head"): o["source_next_head"] = r["source_next_head"]
    o["reference"] = r["reference_text"]
    o["n"] = len(labels); o["translations"] = labels
    return o

def item(uid, cands):
    names = list(cands); rng.shuffle(names)
    lab = {f"T{i + 1}": n for i, n in enumerate(names)}
    return line(recs[uid], None, {t: cands[n] for t, n in lab.items()}), lab

items, refused = [], {}
for uid in units:
    have = {a: arm[a][uid] for a in GEM if uid in arm[a]}
    for a in GEM:
        if a not in have: refused.setdefault(a, []).append(uid)
    if uid in opus: have["O"] = opus[uid]
    it, lab = item(uid, have)
    items.append((it, {"kind": "ARMS", "page_id": uid, "lang": recs[uid]["lang"], "track": recs[uid]["track"], "prod": PROD[units[uid]["prod_model"]], "labels": lab}))
ids = sorted(units); ctrl = rng.sample(ids, 20)
prod_text = lambda uid: arm[PROD[units[uid]["prod_model"]]].get(uid)
plant_js = "import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(6182 + 1000)); const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => x ? p.plantReversal(x) : null)));"
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([prod_text(u) for u in ctrl[:16]])]))
n_plant = 0
for uid, pl in zip(ctrl[:16], planted):
    t = prod_text(uid)
    if not t or not pl or pl["old"] == pl["new"] or n_plant == 8: continue
    new = t.replace(pl["old"], pl["new"], 1)
    if new == t: continue
    it, lab = item(uid, {"P": t, "P_PLANT": new})
    items.append((it, {"kind": "PLANT", "page_id": uid, "labels": lab, "plant": pl})); n_plant += 1
for uid in [u for u in ctrl[16:] if prod_text(u) and u in arm["G38"]][:4]:
    it, lab = item(uid, {"P": prod_text(uid), "P_DUP": prod_text(uid), "G38": arm["G38"][uid]})
    items.append((it, {"kind": "DUP", "page_id": uid, "labels": lab}))
rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it["id"] = f"L{i + 1:03d}"; key[it["id"]] = k
json.dump({"items": key, "refused_after_retry": refused}, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
for f in glob.glob(f"{JW}/in-*.jsonl"): os.remove(f)
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(6182 + 1001).sample(items, len(items))
    for p in range(PARTS):
        with open(f"{JW}/in-{j}-{p + 1:02d}.jsonl", "w") as f:
            for it, _ in order[p::PARTS]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
sizes = sorted(os.path.getsize(f) for f in glob.glob(f"{JW}/in-J1-*.jsonl"))
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "with O", len(opus), "parts", PARTS, "bytes", sizes[0], "–", sizes[-1], "refused", {a: len(v) for a, v in refused.items()})
