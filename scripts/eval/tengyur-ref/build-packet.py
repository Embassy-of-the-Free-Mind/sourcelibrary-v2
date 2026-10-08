#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs (multi-candidate packet vs an 84000
# reference, shuffled labels) and scripts/eval/tengyur-pilot-qa/build-packet-c.py (PR #5676: wrong-page /
# planted / duplicate controls over single Englishes). Neither pairs two arms over a folio-cut 84000
# reference; the control shapes are theirs, re-cut as two-candidate items.
"""
build-packet.py — blinded two-candidate judge packet for the Tengyur 84000-reference test (#5497).

  python3 build-packet.py <tref-dir> <out-dir> [--seed 5497]

Sample (stratified by text, seed 5497): Toh 3808 50 sides, Toh 1183 25, Toh 1189 25, every side of the
small texts. Each item = one side, candidates A and B in random T1/T2 order. Controls (15 items):
  NEG  5  one candidate is the arm-A English of a side ≥ 30 sides away in the same text (must score ≤ 2)
  PLANT 5 one candidate is a copy of the other with ONE planted reversal (must be flagged/ranked below)
  DUP  5  both candidates are the same arm-A English (must tie, same grade)
Writes items.jsonl (all items, shuffled), key.json (label → arm / control truth), and judge split files
<out>/in-J{1,2}-{1..4}.jsonl: two judges, each sees ALL items, in its own shuffle, cut into 4 parts.
"""
import json, os, random, re, sys

tref, out = sys.argv[1], sys.argv[2]
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 5497
rng = random.Random(seed)
os.makedirs(out, exist_ok=True)

ref = [json.loads(l) for l in open(os.path.join(tref, "ref", "reference.jsonl"))]
st = json.load(open(os.path.join(tref, "arms", "state.json")))
A, B = st["a"], st["b"]
pages = {}
for f in os.listdir(os.path.join(tref, "pages")):
    if f.endswith(".jsonl"):
        for l in open(os.path.join(tref, "pages", f)):
            p = json.loads(l); pages[(p["vol"], p["page_number"])] = p

ref = [r for r in ref if r["page_id"] in A and r["page_id"] in B]
quota = {"toh3808": 50, "toh1183": 25, "toh1189": 25}
by = {}
for r in ref:
    by.setdefault(r["toh"], []).append(r)
sample = []
for toh, rs in sorted(by.items()):
    q = quota.get(toh, len(rs))
    sample += sorted(rng.sample(rs, min(q, len(rs))), key=lambda r: r["page_number"])


def lines(s):
    return [l for l in s.split("\n") if l.strip()]


def base(r):
    prev = pages.get((r["vol"], r["page_number"] - 1)); nxt = pages.get((r["vol"], r["page_number"] + 1))
    return {"text_title": r["title"], "folio": f"vol. {r['vol']}, f. {r['folio']}", "source": r["src"],
            "prev_side_last_line": (lines(prev["src"])[-1] if prev and lines(prev["src"]) else ""),
            "next_side_first_line": (lines(nxt["src"])[0] if nxt and lines(nxt["src"]) else ""),
            "reference": r["ref_en"], "reference_prev_tail": r["ref_prev_tail"], "reference_next_head": r["ref_next_head"]}


items, key = [], {}
for i, r in enumerate(sample):
    iid = f"P{i+1:03d}"
    arms = ["A", "B"]; rng.shuffle(arms)
    pick = lambda arm: (A if arm == "A" else B)[r["page_id"]]["text"]
    it = {"id": iid, **base(r), "candidates": {"T1": pick(arms[0]), "T2": pick(arms[1])}}
    items.append(it)
    key[iid] = {"kind": "pair", "T1": arms[0], "T2": arms[1], "page_id": r["page_id"], "toh": r["toh"], "folio": r["folio"], "vol": r["vol"], "page_number": r["page_number"], "book_id": r["book_id"]}

# Controls draw from referenced sides NOT in the sample (so no judge sees the same page twice).
pool = [r for r in ref if r["page_id"] not in {s["page_id"] for s in sample} and r["toh"] in ("toh3808", "toh1183", "toh1189")]
rng.shuffle(pool)
ctl = pool[:15]

# PLANT: a reversal in one sentence of arm A's English. Rules tried in order; the planted sentence is
# recorded so the score can check the judge quoted it.
FLIPS = [(r"\bis not\b", "is"), (r"\bare not\b", "are"), (r"\bdoes not\b", "does"), (r"\bcannot\b", "can"),
         (r"\bis\b", "is not"), (r"\bare\b", "are not"), (r"\bexists\b", "does not exist"), (r"\bwill\b", "will not")]


def plant(text):
    body = re.sub(r"<(summary|keywords|meta)[^>]*>[\s\S]*?</\1>", "", text)
    sents = [s for s in re.split(r"(?<=[.!?])\s+", body) if 60 < len(s) < 400 and "<" not in s]
    rng.shuffle(sents)
    for s in sents:
        for pat, rep in FLIPS:
            if re.search(pat, s):
                ns = re.sub(pat, rep, s, count=1)
                return text.replace(s, ns, 1), s, ns
    return None, None, None


plants = []
for j, r in enumerate(ctl):
    cid = f"P{len(sample) + j + 1:03d}"
    kind = ["NEG", "PLANT", "DUP"][j % 3]
    real = A[r["page_id"]]["text"]
    if kind == "NEG":
        far = [x for x in by[r["toh"]] if abs(x["page_number"] - r["page_number"]) >= 30 and x["page_id"] in A]
        other = rng.choice(far)
        fake, note = A[other["page_id"]]["text"], {"from": other["folio"]}
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
json.dump([{"id": k, "toh": v["toh"], "folio": v["folio"], "page_id": v["page_id"]} for k, v in key.items() if v["kind"] == "pair"], open(os.path.join(out, "sample.json"), "w"), indent=1)
for judge in (1, 2):
    its = items[:]; random.Random(seed * 10 + judge).shuffle(its)
    k = 4; n = -(-len(its) // k)
    for part in range(k):
        with open(os.path.join(out, f"in-J{judge}-{part+1}.jsonl"), "w") as f:
            for it in its[part * n:(part + 1) * n]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
kinds = {}
for v in key.values():
    kinds[v["kind"]] = kinds.get(v["kind"], 0) + 1
print(f"{len(items)} items: {kinds}; sample by text: { {t: sum(1 for s in sample if s['toh']==t) for t in by} }")
