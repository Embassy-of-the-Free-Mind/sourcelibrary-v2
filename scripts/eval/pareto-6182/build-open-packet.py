#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-levers/build-ref-packet.py (#6121 round 2: the 58 sides, item fields from
# ref-pages + align-*.jsonl, PLANT/DUP controls via tengyur-characterize/plants.mjs) and
# scripts/eval/tengyur-arms/build-packet.py (#5497: the 113 sides, item fields from /root/tref). Neither
# takes an arm list from another work dir or both page sets at once; #6182's own reference packet builder
# did not exist yet when the open arms finished. This cuts the companion packet of PREREG-open-arms.md
# with those two builders' item shapes and PREREG.md's controls (8 PLANT, 4 DUP per judge).
"""
build-open-packet.py — $0. Blinded companion judge packet for the open arms of #6182 (Tengyur, 171 sides).

  python3 scripts/eval/pareto-6182/build-open-packet.py [--parts 16]

Items: each of the 171 sides (tib-ref58 + tib-ref113) with candidates GM31, GM26, QMX, QPL, Q27, DSP (from
/root/po6182/arms) and two anchors: FP (tib-ref58: round-1 `A`, tib-ref113: #5497 `B2`, as PREREG.md) and
G38 (tib-ref58: round 2, tib-ref113: pareto-6182 arms/G38.jsonl). Labels shuffled per item, seed 6182.
Controls on sides drawn from the 171 (seed 6182): PLANT 8 = FP beside FP with one planted reversal
(5 negation flips, 3 agent swaps; no-op and "we <verb>s" plants are filtered); DUP 4 = FP, an identical FP
and G38. Writes /root/po6182/refjudge/in-J{1,2}-{n}.jsonl (holds reference text: never committed) and
scripts/eval/results/pareto-6182/open/refjudge/key.json (no text).
"""
import json, os, random, re, subprocess, sys

PARTS = int(sys.argv[sys.argv.index("--parts") + 1]) if "--parts" in sys.argv else 16
SEED = 6182
JW, OUT = "/root/po6182/refjudge", "scripts/eval/results/pareto-6182/open/refjudge"
os.makedirs(JW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
OPEN = ["GM31", "GM26", "QMX", "QPL", "Q27", "DSP"]
rng = random.Random(SEED)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
units = [u for u in read("/root/pareto-6182/units.jsonl") if u["set"] in ("tib-ref58", "tib-ref113")]
S58 = [u["uid"] for u in units if u["set"] == "tib-ref58"]
S113 = [u["uid"] for u in units if u["set"] == "tib-ref113"]

# ---- candidate texts
text = {a: {r["uid"]: r["text"] for r in read(f"/root/po6182/arms/{a}.jsonl")} for a in OPEN}
text["FP"] = {**{r["page_id"]: r["text"] for r in read("/root/tlev/arms/A-ref.jsonl")}, **{r["page_id"]: r["text"] for r in read("/root/tarms/arms/B2.jsonl")}}
text["G38"] = {**{r["page_id"]: r["text"] for r in read("/root/tlev/arms/G38-ref.jsonl")}, **{r["uid"]: r["text"] for r in read("/root/pareto-6182/arms/G38.jsonl") if r["uid"] in set(S113)}}
ARMS = OPEN + ["FP", "G38"]
for a in ARMS:
    miss = [u for u in S58 + S113 if not text[a].get(u)]
    assert not miss, (a, len(miss))

# ---- item fields: tib-ref58 as round 2, tib-ref113 as #5497
pages58 = {r["page_id"]: r for r in read("/root/tlev/ref-pages.jsonl")}
align = {}
for t in ("D3862", "D4231"):
    rows = sorted(read(f"/root/tlev/ref/align-{t}.jsonl"), key=lambda a: a["page_number"])
    for i, a in enumerate(rows):
        a["prev_tail"] = rows[i - 1]["ref_text"][-300:] if i else ""
        a["next_head"] = rows[i + 1]["ref_text"][:300] if i + 1 < len(rows) else ""
        align[a["page_id"]] = a
ref113 = {r["page_id"]: r for r in read("/root/tref/ref/reference.jsonl")}
tpages = {}
for f in os.listdir("/root/tref/pages"):
    if f.endswith(".jsonl"):
        for p in read(os.path.join("/root/tref/pages", f)):
            tpages[(p["vol"], p["page_number"])] = p
lines = lambda s: [l for l in s.split("\n") if l.strip()]


def base(uid):
    if uid in pages58:
        p, a = pages58[uid], align[uid]
        return {"text_title": f"{p['text_toh']} ({p['titles'].get('tibetan')})", "folio": p["folio"], "source": p["bo"],
                "prev_side_last_line": p["prev_last"], "next_side_first_line": p["next_first"], "reference_source": a["ref_source"],
                "reference": a["ref_text"], "reference_prev_tail": a["prev_tail"], "reference_next_head": a["next_head"]}, p["text_toh"]
    r = ref113[uid]
    prev, nxt = tpages.get((r["vol"], r["page_number"] - 1)), tpages.get((r["vol"], r["page_number"] + 1))
    return {"text_title": r["title"], "folio": f"vol. {r['vol']}, f. {r['folio']}", "source": r["src"],
            "prev_side_last_line": lines(prev["src"])[-1] if prev and lines(prev["src"]) else "",
            "next_side_first_line": lines(nxt["src"])[0] if nxt and lines(nxt["src"]) else "",
            "reference_source": "84000: Translating the Words of the Buddha (eval only, CC BY-NC-ND)",
            "reference": r["ref_en"], "reference_prev_tail": r["ref_prev_tail"], "reference_next_head": r["ref_next_head"]}, r["toh"]


def item(uid, cands):
    names = list(cands); rng.shuffle(names)
    lab = {f"T{i + 1}": n for i, n in enumerate(names)}
    b, toh = base(uid)
    return {"id": None, **b, "candidates": {t: cands[n] for t, n in lab.items()}}, lab, toh


items = []
for uid in S58 + S113:
    it, lab, toh = item(uid, {a: text[a][uid] for a in ARMS})
    items.append((it, {"kind": "ARMS", "page_id": uid, "set": "tib-ref58" if uid in pages58 else "tib-ref113", "toh": toh, "labels": lab}))

# ---- controls (PREREG.md: 8 PLANT, 4 DUP)
pool = S58 + S113; pool = rng.sample(pool, len(pool))
js = ("import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs';"
      "const p = makePlanters(rng(%d)); const t = JSON.parse(process.argv[1]);"
      "console.log(JSON.stringify(t.map((x) => [p.plantReversal(x.t), p.plantAgent(x.t)])));" % SEED)
cand = pool[:40]
got = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", js, json.dumps([{"t": text["FP"][u]} for u in cand])]))
plants, used = [], set()
want = {"negation": 5, "agent": 3}
for uid, (rev, ag) in zip(cand, got):
    for kind, pl in (("negation", rev), ("agent", ag)):
        if not pl or want[kind] == 0 or uid in used:
            continue
        if pl["old"] == pl["new"] or re.search(r"\bwe \w+s\b", pl["new"]) and not re.search(r"\bwe \w+s\b", pl["old"]):
            continue
        want[kind] -= 1; used.add(uid)
        plants.append((uid, kind, pl))
assert len(plants) == 8, len(plants)
for uid, kind, pl in plants:
    it, lab, toh = item(uid, {"FP": text["FP"][uid], "FP_PLANT": text["FP"][uid].replace(pl["old"], pl["new"], 1)})
    items.append((it, {"kind": "PLANT", "plant_kind": kind, "page_id": uid, "labels": lab, "plant": pl}))
for uid in [u for u in pool[40:] if u not in used][:4]:
    it, lab, toh = item(uid, {"FP": text["FP"][uid], "FP_DUP": text["FP"][uid], "G38": text["G38"][uid]})
    items.append((it, {"kind": "DUP", "page_id": uid, "labels": lab}))

rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it["id"] = f"O{i + 1:03d}"; key[it["id"]] = k
json.dump(key, open(f"{OUT}/key.json", "w"), indent=1, ensure_ascii=False)
for j in ("J1", "J2"):
    order = items[:] if j == "J1" else random.Random(SEED + 5).sample(items, len(items))
    for p in range(PARTS):
        with open(f"{JW}/in-{j}-{p + 1}.jsonl", "w") as f:
            for it, _ in order[p::PARTS]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
print(len(items), "items", {k: sum(1 for _, x in items if x["kind"] == k) for k in ("ARMS", "PLANT", "DUP")}, "parts", PARTS, "per judge")
