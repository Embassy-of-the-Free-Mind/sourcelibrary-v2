#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-arms/build-packet.py (#5497) cuts blinded two-to-four-candidate items
# against 84000's English, with PLANT and DUP controls. Same item shape here; the pages are the sides
# aligned to a published translation for #6121 step 4, and the candidates are S, A, C, P.
"""
build-ref-packet.py — $0. Blinded reference-judge packet for #6121 step 4.

  python3 scripts/eval/tengyur-levers/build-ref-packet.py
  python3 scripts/eval/tengyur-levers/build-ref-packet.py --round 2    # S, A, G38, G35, O → /root/tlev2/refjudge
  python3 scripts/eval/tengyur-levers/build-ref-packet.py --round cli6182   # #6182 CLI arm: C38, G38, FP → /root/tlev3/refjudge
                 (FP on these sides is round 1's A, as pareto-6182/PREREG.md names it; plants are FP beside FP)
  python3 scripts/eval/tengyur-levers/build-ref-packet.py --round cli6182-113   # the same arms on #6182's 113 fresh
                 84000 sides (tib-ref113) → /root/cli38-6182/refjudge113. Item context (source, neighbours, 84000 cut)
                 is #5497's packet's, as pareto-6182/build-tib-packet.py takes it; FP = #5497 B2, G38 and S =
                 /root/pareto-6182/arms, C38 = /root/cli38-6182/C38-*.jsonl. Same controls (6 PLANT, 4 DUP); 12 parts.

Items: 58 aligned sides × candidates {S, A, C, P} (order shuffled per item). Controls: PLANT 6 (A beside
A with one planted reversal, #5829's planter run in node) and DUP 4 (S beside an identical S).
Writes /root/tlev/refjudge/in-J{1,2}-{1..8}.jsonl (holds reference text: never committed) and
scripts/eval/results/tengyur-levers-6121/refjudge/key.json.
"""
import json, os, random, subprocess, sys

W = "/root/tlev"
ROUND = sys.argv[sys.argv.index("--round") + 1] if "--round" in sys.argv else "1"
C113 = ROUND == "cli6182-113"
CLI = ROUND == "cli6182" or C113  # #6182: gemini-3.8-flash through the Antigravity CLI (C38) beside the API's G38 and FP
R2 = ROUND == "2" or CLI
ARMS = ["FP", "C38", "G38"] if CLI else ["S", "A", "G38", "G35", "O"] if R2 else ["S", "A", "C", "P"]
BASE = "FP" if CLI else "A"  # the planted twin
FILE = {"FP": "A"}  # FP's text on the 58 sides is round 1's A
JW = "/root/cli38-6182/refjudge113" if C113 else "/root/tlev3/refjudge" if CLI else "/root/tlev2/refjudge" if R2 else f"{W}/refjudge"
OUT = ("scripts/eval/results/cli-arm-6182/refjudge113" if C113 else "scripts/eval/results/cli-arm-6182/refjudge" if CLI else "scripts/eval/results/tengyur-models-6121/refjudge" if R2
       else "scripts/eval/results/tengyur-levers-6121/refjudge")
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
rng = random.Random(6182 + 113 if C113 else 6182 + 3 if CLI else 6121 + 4 + (20 if R2 else 0))
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
if C113:
    import glob
    U = [u["uid"] for u in read("/root/pareto-6182/units.jsonl") if u["set"] == "tib-ref113"]
    tkey = json.load(open("/root/tref/judge/key.json"))
    pages, toh = {}, {}
    for f in sorted(glob.glob("/root/tref/judge/in-J1-*.jsonl")):
        for it in read(f):
            k = tkey[it["id"]]
            if k.get("kind") != "pair": continue
            c = {x: it[x] for x in ("text_title", "folio", "source", "prev_side_last_line", "next_side_first_line", "reference_source", "reference", "reference_prev_tail", "reference_next_head") if x in it}
            c["reference_source"] = c.get("reference_source") or "84000: Translating the Words of the Buddha (English, from this Tibetan)"
            pages.setdefault(k["page_id"], c); toh[k["page_id"]] = k["toh"]
    pages = {pid: pages[pid] for pid in U}  # KeyError = a side with no context: stop
    by_uid = lambda p: {r["uid"]: r["text"] for r in read(p)}
    arm = {"S": by_uid("/root/pareto-6182/arms/S.jsonl"), "G38": by_uid("/root/pareto-6182/arms/G38.jsonl"),
           "FP": {r["page_id"]: r["text"] for r in read("scripts/eval/results/tengyur-arms-2026-10/arms/B2.jsonl")},
           "C38": {r["uid"]: r["text"] for f in sorted(glob.glob("/root/cli38-6182/C38-*.jsonl")) for r in read(f) if r["uid"] in pages}}
    holes = {a: sum(1 for pid in pages if not (arm[a].get(pid) or "").strip()) for a in arm}
    assert not any(holes.values()), holes
    for pid in pages:
        pages[pid]["text_toh"] = toh[pid]
else:
    pages = {r["page_id"]: r for r in read(f"{W}/ref-pages.jsonl")}
    align = {}
    for t in ("D3862", "D4231"):
        rows = read(f"{W}/ref/align-{t}.jsonl")
        rows.sort(key=lambda a: a["page_number"])
        for i, a in enumerate(rows):
            a["prev_tail"] = rows[i - 1]["ref_text"][-300:] if i else ""
            a["next_head"] = rows[i + 1]["ref_text"][:300] if i + 1 < len(rows) else ""
            align[a["page_id"]] = a
    arm = {"S": {k: v["en"] for k, v in pages.items()}}
    for a in ARMS:
        if a != "S":
            arm[a] = {o["page_id"]: o["text"] for o in read(f"{W}/arms/{FILE.get(a, a)}-ref.jsonl")}


def item(pid, cands):
    p, a = pages[pid], align[pid]
    names = list(cands)
    rng.shuffle(names)
    lab = {f"T{i + 1}": n for i, n in enumerate(names)}
    return {
        "id": None, "text_title": f"{p['text_toh']} ({p['titles'].get('tibetan')})", "folio": p["folio"], "source": p["bo"],
        "prev_side_last_line": p["prev_last"], "next_side_first_line": p["next_first"],
        "reference_source": a["ref_source"], "reference": a["ref_text"], "reference_prev_tail": a["prev_tail"], "reference_next_head": a["next_head"],
        "candidates": {t: cands[n] for t, n in lab.items()},
    }, lab


if C113:
    def item(pid, cands):
        names = list(cands)
        rng.shuffle(names)
        lab = {f"T{i + 1}": n for i, n in enumerate(names)}
        ctx = {x: v for x, v in pages[pid].items() if x != "text_toh"}
        return {"id": None, **ctx, "candidates": {t: cands[n] for t, n in lab.items()}}, lab


items, key = [], {}
for pid in pages:
    it, lab = item(pid, {a: arm[a][pid] for a in ARMS})
    items.append((it, {"kind": "ARMS", "page_id": pid, "toh": pages[pid]["text_toh"], "labels": lab}))
ids = list(pages)
ctrl = rng.sample(ids, 10)
plant_js = "import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(" + str(6184 if C113 else 6183 if CLI else 6145 if R2 else 6125) + ")); const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => p.plantReversal(x))));"
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm[BASE][pid] for pid in ctrl[:6]])]))
for pid, pl in zip(ctrl[:6], planted):
    if not pl:
        continue
    it, lab = item(pid, {BASE: arm[BASE][pid], f"{BASE}_PLANT": arm[BASE][pid].replace(pl["old"], pl["new"], 1)})
    items.append((it, {"kind": "PLANT", "page_id": pid, "labels": lab, "plant": pl}))
for pid in ctrl[6:]:
    it, lab = item(pid, {"S": arm["S"][pid], "S_DUP": arm["S"][pid]})
    items.append((it, {"kind": "DUP", "page_id": pid, "labels": lab}))
rng.shuffle(items)
for i, (it, k) in enumerate(items):
    it["id"] = f"R{i + 1:03d}"
    key[it["id"]] = k
json.dump(key, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
parts = 12 if C113 else 6 if CLI else 10 if R2 else 8
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(6182 + 114 if C113 else 6182 + 5 if CLI else 6121 + 5 + (20 if R2 else 0)).sample(items, len(items))
    for p in range(parts):
        with open(f"{JW}/in-{j}-{p + 1}.jsonl", "w") as f:
            for it, _ in order[p::parts]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "parts", parts, "per judge")
