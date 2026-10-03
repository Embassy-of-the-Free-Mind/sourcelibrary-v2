#!/usr/bin/env python3
"""yigdzin-527: split /root/yig527/todo-all.jsonl into N box shards (default 4).
PRIOR ART: /root/tib-step2/box/todo-main.jsonl was one box, one list (short-proxy pages first). Same idea with N boxes:
pages that already carry a Gemini read (lite or flash, the comparison's population) go first, then the rest in book
order; blocks of 1,000 rows are dealt round-robin so every shard gets a similar mix and books stay mostly contiguous.
Gated pages (todo `gate` set: the Gemini read is Latin/CJK-dominant, a non-Tibetan page) are not read at all.
--keep K: shard K was already started from shards.v1/todo-K.jsonl; it keeps its rows (still in todo, not gated), and
only the rest is re-dealt over the other shards, so no page is read twice.
Out: /root/yig527/shards/todo-<k>.jsonl
"""
import json, os, sys
N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
keep = int(sys.argv[sys.argv.index("--keep") + 1]) if "--keep" in sys.argv else None
D = "/root/yig527"
rows = [json.loads(l) for l in open(f"{D}/todo-all.jsonl")]
ok = {f'{r["book"]}_{int(r["page"]):05d}': r for r in rows if not r.get("gate")}
os.makedirs(f"{D}/shards", exist_ok=True)
fixed = []
if keep is not None:
    for l in open(f"{D}/shards.v1/todo-{keep}.jsonl"):
        r = json.loads(l); s = f'{r["book"]}_{int(r["page"]):05d}'
        if s in ok: fixed.append(ok.pop(s))
order = [r for r in ok.values() if r["prior"] != "none"] + [r for r in ok.values() if r["prior"] == "none"]
others = [k for k in range(N) if k != keep]
buckets = {k: [] for k in range(N)}
if keep is not None: buckets[keep] = fixed
for i in range(0, len(order), 1000):
    buckets[others[(i // 1000) % len(others)]].extend(order[i:i + 1000])
for k, rs in buckets.items():
    with open(f"{D}/shards/todo-{k}.jsonl", "w") as f:
        for r in rs: f.write(json.dumps({"book": r["book"], "page": r["page"], "url": r["url"]}) + "\n")
print({"rows": len(rows), "gated": sum(1 for r in rows if r.get("gate")), "per_shard": {k: len(v) for k, v in buckets.items()}})
