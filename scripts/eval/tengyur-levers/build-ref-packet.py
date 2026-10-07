#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-arms/build-packet.py (#5497) cuts blinded two-to-four-candidate items
# against 84000's English, with PLANT and DUP controls. Same item shape here; the pages are the sides
# aligned to a published translation for #6121 step 4, and the candidates are S, A, C, P.
"""
build-ref-packet.py — $0. Blinded reference-judge packet for #6121 step 4.

  python3 scripts/eval/tengyur-levers/build-ref-packet.py

Items: 58 aligned sides × candidates {S, A, C, P} (order shuffled per item). Controls: PLANT 6 (A beside
A with one planted reversal, #5829's planter run in node) and DUP 4 (S beside an identical S).
Writes /root/tlev/refjudge/in-J{1,2}-{1..8}.jsonl (holds reference text: never committed) and
scripts/eval/results/tengyur-levers-6121/refjudge/key.json.
"""
import json, os, random, subprocess

W = "/root/tlev"
OUT = "scripts/eval/results/tengyur-levers-6121/refjudge"
os.makedirs(f"{W}/refjudge", exist_ok=True); os.makedirs(OUT, exist_ok=True)
rng = random.Random(6121 + 4)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
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
for a in ("A", "C", "P"):
    arm[a] = {o["page_id"]: o["text"] for o in read(f"{W}/arms/{a}-ref.jsonl")}


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


items, key = [], {}
for pid in pages:
    it, lab = item(pid, {a: arm[a][pid] for a in ("S", "A", "C", "P")})
    items.append((it, {"kind": "ARMS", "page_id": pid, "toh": pages[pid]["text_toh"], "labels": lab}))
ids = list(pages)
ctrl = rng.sample(ids, 10)
plant_js = "import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(6125)); const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => p.plantReversal(x))));"
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm["A"][pid] for pid in ctrl[:6]])]))
for pid, pl in zip(ctrl[:6], planted):
    if not pl:
        continue
    it, lab = item(pid, {"A": arm["A"][pid], "A_PLANT": arm["A"][pid].replace(pl["old"], pl["new"], 1)})
    items.append((it, {"kind": "PLANT", "page_id": pid, "labels": lab, "plant": pl}))
for pid in ctrl[6:]:
    it, lab = item(pid, {"S": arm["S"][pid], "S_DUP": arm["S"][pid]})
    items.append((it, {"kind": "DUP", "page_id": pid, "labels": lab}))
rng.shuffle(items)
for i, (it, k) in enumerate(items):
    it["id"] = f"R{i + 1:03d}"
    key[it["id"]] = k
json.dump(key, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
parts = 8
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(6121 + 5).sample(items, len(items))
    for p in range(parts):
        with open(f"{W}/refjudge/in-{j}-{p + 1}.jsonl", "w") as f:
            for it, _ in order[p::parts]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "parts", parts, "per judge")
