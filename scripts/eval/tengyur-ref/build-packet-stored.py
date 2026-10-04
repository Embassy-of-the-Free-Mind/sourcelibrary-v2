#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-ref/build-packet.py (PR #5704: arm A vs arm B over the same 113 sides,
# same controls). This keeps its sample, item shape, controls and judge prompt, and swaps the candidates:
# the English AS STORED in pages.translation.data (what the reader serves) against arm B, plus up to
# 250 more referenced sides. It cannot reuse arm B's verdicts: no stored page equals arm B byte-for-byte.
"""
build-packet-stored.py — blinded two-candidate packet: stored English (S) vs arm B, Tengyur 84000 ref (#5797).

  python3 build-packet-stored.py <tref-dir> <stored.jsonl> <out-dir> [--extra 3808:130,1183:60,1189:60] [--parts 12]

<stored.jsonl>: one line per referenced page {page_id, en, meta} read from Mongo at run time.
Sample = the PR #5704 sample (judge/sample.json) where the page has stored English, then `--extra` more
sides per text, drawn (seed 5797) from referenced sides with stored English not already used.
Controls (15): NEG / PLANT / DUP as in build-packet.py, built on the STORED English.
"""
import json, os, random, re, sys

tref, storedp, out = sys.argv[1], sys.argv[2], sys.argv[3]
argv = sys.argv
extra = dict((f"toh{k}", int(v)) for k, v in (x.split(":") for x in (argv[argv.index("--extra") + 1] if "--extra" in argv else "3808:130,1183:60,1189:60").split(",")))
nparts = int(argv[argv.index("--parts") + 1]) if "--parts" in argv else 12
rng = random.Random(5797)
os.makedirs(out, exist_ok=True)

ref = [json.loads(l) for l in open(os.path.join(tref, "ref", "reference.jsonl"))]
B = json.load(open(os.path.join(tref, "arms", "state.json")))["b"]
S = {}
for l in open(storedp):
    s = json.loads(l)
    if s.get("en"):
        S[s["page_id"]] = s
pages = {}
for f in os.listdir(os.path.join(tref, "pages")):
    if f.endswith(".jsonl"):
        for l in open(os.path.join(tref, "pages", f)):
            p = json.loads(l); pages[(p["vol"], p["page_number"])] = p

ok = [r for r in ref if r["page_id"] in S and r["page_id"] in B]
byid = {r["page_id"]: r for r in ok}
old = [x["page_id"] for x in json.load(open(os.path.join(tref, "judge", "sample.json")))]
sample = [byid[p] for p in old if p in byid]
dropped_old = [p for p in old if p not in byid]
used = {r["page_id"] for r in sample}
for toh, q in sorted(extra.items()):
    pool = [r for r in ok if r["toh"] == toh and r["page_id"] not in used]
    pick = rng.sample(pool, min(q, len(pool)))
    sample += sorted(pick, key=lambda r: r["page_number"])
    used |= {r["page_id"] for r in pick}


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
    iid = f"Q{i+1:03d}"
    arms = ["S", "B"]; rng.shuffle(arms)
    pick = lambda arm: (S[r["page_id"]]["en"] if arm == "S" else B[r["page_id"]]["text"])
    items.append({"id": iid, **base(r), "candidates": {"T1": pick(arms[0]), "T2": pick(arms[1])}})
    key[iid] = {"kind": "pair", "T1": arms[0], "T2": arms[1], "page_id": r["page_id"], "toh": r["toh"], "folio": r["folio"], "vol": r["vol"],
                "page_number": r["page_number"], "book_id": r["book_id"], "in_5704": r["page_id"] in old}

pool = [r for r in ok if r["page_id"] not in used and r["toh"] in ("toh3808", "toh1183", "toh1189")]
rng.shuffle(pool)
ctl = pool[:15]
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
    cid = f"Q{len(sample) + j + 1:03d}"
    kind = ["NEG", "PLANT", "DUP"][j % 3]
    real = S[r["page_id"]]["en"]
    if kind == "NEG":
        far = [x for x in ok if x["toh"] == r["toh"] and abs(x["page_number"] - r["page_number"]) >= 30]
        other = rng.choice(far)
        fake, note = S[other["page_id"]]["en"], {"from": other["folio"]}
    elif kind == "PLANT":
        fake, o, n = plant(real)
        if fake is None:
            kind, fake, note = "DUP", real, {}
        else:
            note = {"old": o, "new": n}; plants.append({"id": cid, "page_id": r["page_id"], **note})
    else:
        fake, note = real, {}
    order = ["real", "ctl"]; rng.shuffle(order)
    c = {"real": real, "ctl": fake}
    items.append({"id": cid, **base(r), "candidates": {"T1": c[order[0]], "T2": c[order[1]]}})
    key[cid] = {"kind": kind, "T1": order[0], "T2": order[1], "page_id": r["page_id"], "toh": r["toh"], "folio": r["folio"], **note}

json.dump(key, open(os.path.join(out, "key.json"), "w"), ensure_ascii=False, indent=1)
json.dump(plants, open(os.path.join(out, "plants.json"), "w"), ensure_ascii=False, indent=1)
json.dump({"dropped_from_5704_sample_no_stored_english": dropped_old,
           "pairs": [{"id": k, "toh": v["toh"], "folio": v["folio"], "page_id": v["page_id"], "in_5704": v["in_5704"]} for k, v in key.items() if v["kind"] == "pair"]},
          open(os.path.join(out, "sample.json"), "w"), indent=1)
for judge in (1, 2):
    its = items[:]; random.Random(5797 * 10 + judge).shuffle(its)
    n = -(-len(its) // nparts)
    for part in range(nparts):
        with open(os.path.join(out, f"in-J{judge}-{part+1}.jsonl"), "w") as f:
            for it in its[part * n:(part + 1) * n]:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
kinds = {}
for v in key.values():
    kinds[v["kind"]] = kinds.get(v["kind"], 0) + 1
print(f"{len(items)} items: {kinds}; from 5704 sample {sum(1 for v in key.values() if v.get('in_5704'))} (dropped {len(dropped_old)}); by text: { {t: sum(1 for s in sample if s['toh']==t) for t in sorted({s['toh'] for s in sample})} }")
