#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/build-xl-packet.py — the item line, the label shuffle and the PLANT + DUP
# controls (#5829's planter, no-op plants dropped) are its; #6295 judges against a Syriac e-text instead of a
# published English translation and has four candidates per page, so this writes its own packet.
"""
build-packet.py — $0. Blinded judge packet for #6295 Step 2.

  python3 scripts/eval/syriac-pareto-6295/build-packet.py --work <dir> [--round c38]

Items: every page with a reference window × {R, R2, K, K2} (gemini-3.1-flash-lite translating the e-text window
twice and the served Kraken text twice), labels shuffled per item and per judge. Controls: 8 PLANT (R's English
beside a copy with one planted reversal) and 4 DUP (R, an identical copy of R, and K). Writes
<work>/judge/in-J{1,2}-NN.jsonl (they hold the e-text: never committed) and <work>/judge/key-J{1,2}.json.

--round c38 (added 2026-10-08): a second read with gemini-3.8-flash through the CLI. Items: {R, K, C38-R, C38-K} —
the two lite drafts ride along as anchors, so C38 is compared with lite inside the same item and the round-1 lite
scores stay as published. Controls are made from C38-R (8 PLANT, 4 DUP of C38-R beside itself and C38-K), with
their own seeds; output goes to <work>/judge-c38/.

--round c37 / c36 (added 2026-10-08, job cli-queue-6293): the same design for gemini-3.7-flash and gemini-3.6-flash
through the CLI, one round per tier, each with its own seeds and <work>/judge-c37/ or judge-c36/.
"""
import json, os, random, subprocess, sys

opt = lambda k, d=None: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
W = opt("work"); PARTS = int(opt("parts", "4")); ROUND = opt("round")
ROUNDS = {None: {"dir": "judge", "arms": ["R", "R2", "K", "K2"], "base": "R", "dup_other": "K", "seed": 6295 + 1000, "tag": "6295"},
          "c38": {"dir": "judge-c38", "arms": ["R", "K", "C38-R", "C38-K"], "base": "C38-R", "dup_other": "C38-K", "seed": 6295 + 2000, "tag": "6295|c38"},
          "c37": {"dir": "judge-c37", "arms": ["R", "K", "C37-R", "C37-K"], "base": "C37-R", "dup_other": "C37-K", "seed": 6295 + 3000, "tag": "6295|c37"},
          "c36": {"dir": "judge-c36", "arms": ["R", "K", "C36-R", "C36-K"], "base": "C36-R", "dup_other": "C36-K", "seed": 6295 + 4000, "tag": "6295|c36"}}
RD = ROUNDS[ROUND]
JW = f"{W}/{RD['dir']}"; os.makedirs(JW, exist_ok=True)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
ARMS = RD["arms"]; BASE = RD["base"]
arm = {a: {r["uid"]: r["text"] for r in read(f"{W}/arms/T-{a}.jsonl") if (r.get("text") or "").strip()} for a in ARMS}
pages = {p["slug"]: p for p in json.load(open(f"{W}/seal/pages.json"))}
uids = sorted(u for u in arm[BASE] if all(u in arm[a] for a in ARMS))
missing = sorted(set(arm[BASE]) - set(uids))
ref = {u: open(f"{W}/refs/{u}.txt").read().strip() for u in uids}
note = {"same-edition": "the SOURCE transcribes the same printed edition as the page",
        "other-edition": "the SOURCE is another edition of the same work; small textual variants are expected"}

ctrl_rng = random.Random(RD["seed"])
ctrl = ctrl_rng.sample(uids, min(len(uids), 16))
plant_js = "import { makePlanters } from './scripts/eval/tengyur-characterize/plants.mjs'; import { rng } from './scripts/eval/tengyur-characterize/common.mjs'; const p = makePlanters(rng(Number(process.argv[2]))); const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((x) => x ? p.plantReversal(x) : null)));"
planted = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", plant_js, json.dumps([arm[BASE][u] for u in ctrl]), str(RD["seed"])]))
base = []  # (kind, uid, {name: text}, extra)
for u in uids: base.append(("ARMS", u, {a: arm[a][u] for a in ARMS}, None))
n_plant, used = 0, set()
for u, pl in zip(ctrl, planted):
    t = arm[BASE][u]
    if n_plant == 8 or not pl or pl["old"] == pl["new"]: continue
    new = t.replace(pl["old"], pl["new"], 1)
    if new == t: continue
    base.append(("PLANT", u, {BASE: t, f"{BASE}_PLANT": new}, pl)); n_plant += 1; used.add(u)
dup_pool = [u for u in ctrl if u not in used] + [u for u in ctrl if u in used]
for u in dup_pool[:4]: base.append(("DUP", u, {BASE: arm[BASE][u], f"{BASE}_DUP": arm[BASE][u], RD["dup_other"]: arm[RD["dup_other"]][u]}, None))

for j in ("J1", "J2"):
    rng = random.Random(f"{RD['tag']}|{j}")
    items = list(base); rng.shuffle(items)
    key, lines = {}, []
    for n, (kind, u, cands, extra) in enumerate(items):
        names = list(cands); rng.shuffle(names)
        labels = {f"T{i + 1}": nm for i, nm in enumerate(names)}
        iid = f"{j}-{n:03d}"
        key[iid] = {"kind": kind, "uid": u, "labels": labels, **({"plant": extra} if extra else {})}
        lines.append(json.dumps({"id": iid, "text_title": pages[u]["label"], "source_note": note[pages[u]["tier"]], "source": ref[u],
                                 "candidates": {t: cands[nm] for t, nm in labels.items()}}, ensure_ascii=False))
    per = -(-len(lines) // PARTS)
    for k in range(PARTS):
        chunk = lines[k * per:(k + 1) * per]
        if chunk: open(f"{JW}/in-{j}-{k:02d}.jsonl", "w").write("\n".join(chunk) + "\n")
    json.dump(key, open(f"{JW}/key-{j}.json", "w"), indent=1, ensure_ascii=False)
print(len(uids), "pages judged;", "no full arm set:", missing, "| controls PLANT", n_plant, "DUP", min(4, len(dup_pool)), "| items per judge", len(base))
