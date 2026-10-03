#!/usr/bin/env python3
"""yigdzin-527: split /root/yig527/todo-all.jsonl into N box shards (default 4).
PRIOR ART: /root/tib-step2/box/todo-main.jsonl was one box, one list (short-proxy pages first). Same idea with N boxes:
pages that already carry a Gemini read (lite or flash, the comparison's population) go first, then the rest in book
order; blocks of 1,000 rows are dealt round-robin so every shard gets a similar mix and books stay mostly contiguous.
Out: /root/yig527/shards/todo-<k>.jsonl
"""
import json, os, sys
N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
D = "/root/yig527"
rows = [json.loads(l) for l in open(f"{D}/todo-all.jsonl")]
first = [r for r in rows if r["prior"] != "none"]; rest = [r for r in rows if r["prior"] == "none"]
order = first + rest
os.makedirs(f"{D}/shards", exist_ok=True)
outs = [open(f"{D}/shards/todo-{k}.jsonl", "w") for k in range(N)]
cnt = [0] * N
for i in range(0, len(order), 1000):
    k = (i // 1000) % N
    for r in order[i:i + 1000]:
        outs[k].write(json.dumps({"book": r["book"], "page": r["page"], "url": r["url"]}) + "\n"); cnt[k] += 1
print({"rows": len(order), "gemini_first": len(first), "per_shard": cnt})
