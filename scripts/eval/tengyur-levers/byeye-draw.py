#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-characterize/spotcheck-draw.mjs (#5829) drew findings for a by-eye
# check over one arm; #6121 needs the draw stratified by ARM (5 each of S, A, C, P), per PREREG.md.
"""
byeye-draw.py — $0. Seeded (6121) draw of 20 reversal/agent findings from round 1, 5 per arm, from the
union of the two reviews. Writes results/.../r1/byeye-draw.json (finding + page id) and prints each with
the Tibetan of its item, for reading by eye.
"""
import glob, json, os, random

B = "scripts/eval/results/tengyur-levers-6121/r1"
key = json.load(open(f"{B}/key.json"))
items = {json.loads(l)["id"]: json.loads(l) for l in open("/root/tlev/r1/items.jsonl")}
rev = {"A": {}, "B": {}}
for f in glob.glob(f"{B}/reviews/*.json"):
    for x in json.load(open(f)):
        rev[os.path.basename(f)[0]][x["id"]] = x
rng = random.Random(6121)
draw = []
for arm in ["S", "A", "C", "P"]:
    pool = []
    for iid, k in sorted(key.items()):
        if k["arm"] != arm:
            continue
        for r in "AB":
            for e in rev[r][iid]["errors"]:
                if e["type"] in ("reversal", "agent"):
                    pool.append({"item": iid, "arm": arm, "reviewer": r, "section": k["section"], "page_id": k["page_id"], **{x: e.get(x) for x in ("type", "confidence", "tibetan", "english", "why")}})
    rng.shuffle(pool)
    seen, got = set(), []
    for f in pool:  # one finding per item, so 5 different pages per arm
        if f["item"] in seen:
            continue
        seen.add(f["item"]); got.append(f)
        if len(got) == 5:
            break
    draw += got
json.dump(draw, open(f"{B}/byeye-draw.json", "w"), indent=1, ensure_ascii=False)
for i, f in enumerate(draw, 1):
    print(f"\n#{i} {f['arm']} {f['section']} {f['type']}/{f['confidence']} ({f['item']})")
    print("  TIB:", f["tibetan"])
    print("  ENG:", f["english"])
    print("  WHY:", f["why"])
