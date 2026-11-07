#!/usr/bin/env python3
# spotcheck.py — text→image search over the FILES embed-shards.py wrote (#6871 row 8, step 1 of the full-run brief).
#
# PRIOR ART: scripts/eval/image-search-6871/embed.py (same model, same text preprocessing: raw lower-cased query,
# padding max_length 64; but it embeds its own 15K pool and keeps one arm's top 10). This embeds only the queries and
# searches the shard vectors already on disk, per set (pilot pages, gallery crops), and reports hubness: pages that
# turn up in the top 10 of many unrelated queries are the blank pages, covers or colour cards that would dominate.
#   python spotcheck.py --queries q.json --sets pilot=out/pilot,crops=out/crops --out spot.json [--k 10] [--cpu]
# q.json: {"queries": [{"qid", "query"}, ...]}. CPU is enough (70 queries); no card, nothing written but --out.
import argparse, collections, glob, json, os

import numpy as np
import torch
from transformers import AutoModel, AutoProcessor

MODEL = "google/siglip2-so400m-patch14-384"
ap = argparse.ArgumentParser()
ap.add_argument("--queries", required=True); ap.add_argument("--sets", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--k", type=int, default=10); ap.add_argument("--cpu", action="store_true")
a = ap.parse_args()
DEV, DT = ("cpu", torch.float32) if a.cpu else ("cuda", torch.float16)
qs = json.load(open(a.queries))["queries"]
model = AutoModel.from_pretrained(MODEL, dtype=DT).to(DEV).eval()
proc = AutoProcessor.from_pretrained(MODEL)
with torch.inference_mode():
    tx = proc(text=[q["query"].lower() for q in qs], padding="max_length", max_length=64, truncation=True, return_tensors="pt").to(DEV)
    t = model.get_text_features(**{k: v for k, v in tx.items() if k in ("input_ids", "attention_mask")})
    t = t.pooler_output if hasattr(t, "pooler_output") else t
    T = torch.nn.functional.normalize(t.float(), dim=-1).cpu().numpy()

res = {"model": MODEL, "k": a.k, "sets": {}}
for spec in a.sets.split(","):
    name, d = spec.split("=", 1)
    ids, vecs = [], []
    for npy in sorted(glob.glob(os.path.join(d, "shard-*.f16.npy"))):
        tag = npy[: -len(".f16.npy")]
        if not os.path.exists(tag + ".json"): continue   # unfinished shard
        vecs.append(np.load(npy).astype(np.float32)); ids.extend(json.loads(l) for l in open(tag + ".ids.jsonl"))
    V = np.concatenate(vecs); assert len(V) == len(ids), (name, len(V), len(ids))
    S = T @ V.T
    top = np.argsort(-S, axis=1)[:, : a.k]
    hub = collections.Counter(int(j) for row in top for j in row)
    res["sets"][name] = {
        "n": len(ids),
        "top": {q["qid"]: [{**ids[j], "score": round(float(S[n, j]), 4)} for j in top[n]] for n, q in enumerate(qs)},
        # a page in the top k of ≥ 5 different queries is a hub: it answers everything, so it answers nothing
        "hubs": [{**ids[j], "queries": c} for j, c in hub.most_common(25) if c >= 5],
        "distinct_in_top": len(hub), "slots": len(qs) * a.k,
    }
    print(f"{name}: {len(ids)} vectors, {len(hub)} distinct pages in {len(qs) * a.k} top-{a.k} slots, "
          f"{sum(1 for c in hub.values() if c >= 5)} hubs (≥5 queries)", flush=True)
json.dump(res, open(a.out, "w"), indent=0, ensure_ascii=False)
