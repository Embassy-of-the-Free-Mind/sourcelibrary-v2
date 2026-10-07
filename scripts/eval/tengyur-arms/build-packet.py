#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-ref/build-packet.py (PR #5704) — same sample, same item fields, same
# three control shapes; it pairs exactly two arms (A, B). This re-cuts it as two-to-four candidates per
# item with the base arm B in EVERY item, so each lever is graded beside the base on the same page by
# the same judge in the same read.
"""
build-packet.py — blinded multi-candidate judge packet for the Tengyur quality arms (#5497).

  python3 build-packet.py --family F1 --arms B,B2,D,X2 [--seed 5497] [--parts 8]

Pages: the tengyur-ref judged sample (113 sides). An arm enters an item only where it has an English for
that side (C: the 6 sides with a Sanskrit parallel; X3: its 40 sides; E: the sides its detector flagged
AND whose English the second pass changed — an unflagged or unchanged E side IS B's English, and takes B's
grade). An item needs B plus at least one other arm. Candidate order is shuffled per item.
Controls (15 two-candidate items, from referenced sides not in the sample, B's English): NEG 5 (another
side ≥ 30 away), PLANT 5 (one planted reversal), DUP 5 (identical). Seed differs per family so no
control page repeats a sample page.
Writes <out>/<family>/: key.json, plants.json, in-J{1,2}-{1..parts}.jsonl.
"""
import json, os, random, re, sys, glob

arg = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
FAM, ARMS = arg("family", "F1"), arg("arms", "B,B2,D,X2").split(",")
TREF, TARMS = arg("tref", "/root/tref"), arg("tarms", "/root/tarms")
seed = int(arg("seed", "5497")) + sum(map(ord, FAM))
PARTS = int(arg("parts", "8"))
rng = random.Random(seed)
out = os.path.join(TARMS, "judge", FAM)
os.makedirs(out, exist_ok=True)

ref = {}
for l in open(os.path.join(TREF, "ref", "reference.jsonl")):
    r = json.loads(l); ref[r["page_id"]] = r
st = json.load(open(os.path.join(TREF, "arms", "state.json")))
text = {"B": {k: v["text"] for k, v in st["b"].items()}}
for f in glob.glob(os.path.join(TARMS, "arms", "*.jsonl")):
    name = os.path.basename(f)[:-6]
    text[name] = {}
    for l in open(f):
        o = json.loads(l)
        if name == "E" or name.endswith("+E") or "E" in name.split("-")[-1].split("+"):
            if not (o.get("fix") or {}).get("applied"):
                continue  # unchanged: it IS its draft, graded as such
        text[name][o["page_id"]] = o["text"]
text["X3"] = {}
for f in glob.glob(os.path.join(TARMS, "x3", "out-*.jsonl")):
    for l in open(f):
        o = json.loads(l); text["X3"][o["page_id"]] = o["text"]

pages = {}
for f in os.listdir(os.path.join(TREF, "pages")):
    if f.endswith(".jsonl"):
        for l in open(os.path.join(TREF, "pages", f)):
            p = json.loads(l); pages[(p["vol"], p["page_number"])] = p
sample = [s["page_id"] for s in json.load(open("scripts/eval/results/tengyur-ref-2026-10/judge/sample.json"))]


def lines(s):
    return [l for l in s.split("\n") if l.strip()]


def base(r):
    prev = pages.get((r["vol"], r["page_number"] - 1)); nxt = pages.get((r["vol"], r["page_number"] + 1))
    return {"text_title": r["title"], "folio": f"vol. {r['vol']}, f. {r['folio']}", "source": r["src"],
            "prev_side_last_line": (lines(prev["src"])[-1] if prev and lines(prev["src"]) else ""),
            "next_side_first_line": (lines(nxt["src"])[0] if nxt and lines(nxt["src"]) else ""),
            "reference": r["ref_en"], "reference_prev_tail": r["ref_prev_tail"], "reference_next_head": r["ref_next_head"]}


items, key = [], {}
for pid in sample:
    r = ref[pid]
    arms = [a for a in ARMS if pid in text.get(a, {})]
    if "B" not in arms or len(arms) < 2:
        continue
    rng.shuffle(arms)
    labels = [f"T{i+1}" for i in range(len(arms))]
    iid = f"{FAM}-{len(items)+1:03d}"
    items.append({"id": iid, **base(r), "candidates": {l: text[a][pid] for l, a in zip(labels, arms)}})
    key[iid] = {"kind": "multi", "labels": dict(zip(labels, arms)), "page_id": pid, "toh": r["toh"], "folio": r["folio"], "vol": r["vol"], "page_number": r["page_number"], "book_id": r["book_id"]}

pool = [r for r in ref.values() if r["page_id"] not in set(sample) and r["toh"] in ("toh3808", "toh1183", "toh1189") and r["page_id"] in text["B"]]
pool.sort(key=lambda r: r["page_id"]); rng.shuffle(pool)
FLIPS = [(r"\bis not\b", "is"), (r"\bare not\b", "are"), (r"\bdoes not\b", "does"), (r"\bcannot\b", "can"),
         (r"\bis\b", "is not"), (r"\bare\b", "are not"), (r"\bexists\b", "does not exist"), (r"\bwill\b", "will not")]


def plant(t):
    body = re.sub(r"<(summary|keywords|meta)[^>]*>[\s\S]*?</\1>", "", t)
    sents = [s for s in re.split(r"(?<=[.!?])\s+", body) if 60 < len(s) < 400 and "<" not in s]
    rng.shuffle(sents)
    for s in sents:
        for pat, rep in FLIPS:
            if re.search(pat, s):
                ns = re.sub(pat, rep, s, count=1)
                return t.replace(s, ns, 1), s, ns
    return None, None, None


plants = []
by = {}
for r in ref.values():
    by.setdefault(r["toh"], []).append(r)
for j, r in enumerate(pool[:15]):
    cid = f"{FAM}-C{j+1:02d}"
    kind = ["NEG", "PLANT", "DUP"][j % 3]
    real = text["B"][r["page_id"]]
    if kind == "NEG":
        far = [x for x in by[r["toh"]] if abs(x["page_number"] - r["page_number"]) >= 30 and x["page_id"] in text["B"]]
        other = rng.choice(far); fake, note = text["B"][other["page_id"]], {"from": other["folio"]}
    elif kind == "PLANT":
        fake, old, new = plant(real)
        if fake is None:
            kind, fake, note = "DUP", real, {}
        else:
            note = {"old": old, "new": new}; plants.append({"id": cid, "page_id": r["page_id"], **note})
    else:
        fake, note = real, {}
    order = ["real", "ctl"]; rng.shuffle(order)
    c = {"real": real, "ctl": fake}
    items.append({"id": cid, **base(r), "candidates": {"T1": c[order[0]], "T2": c[order[1]]}})
    key[cid] = {"kind": kind, "T1": order[0], "T2": order[1], "page_id": r["page_id"], "toh": r["toh"], "folio": r["folio"], **note}

json.dump(key, open(os.path.join(out, "key.json"), "w"), ensure_ascii=False, indent=1)
json.dump(plants, open(os.path.join(out, "plants.json"), "w"), ensure_ascii=False, indent=1)
for judge in (1, 2):
    its = items[:]; random.Random(seed * 10 + judge).shuffle(its)
    n = -(-len(its) // PARTS)
    for part in range(PARTS):
        with open(os.path.join(out, f"in-J{judge}-{part+1}.jsonl"), "w") as f:
            for it in its[part * n:(part + 1) * n]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
from collections import Counter
print(json.dumps({"family": FAM, "items": len(items), "kinds": Counter(v["kind"] for v in key.values()),
                  "arm_presence": Counter(a for v in key.values() if v["kind"] == "multi" for a in v["labels"].values()),
                  "cands_per_item": Counter(len(v["labels"]) for v in key.values() if v["kind"] == "multi")}))
