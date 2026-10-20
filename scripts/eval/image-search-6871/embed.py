#!/usr/bin/env python3
# embed.py — text→image retrieval over the #6871 page-image pool, one arm per model (PREREGISTRATION.md, this directory).
#
# PRIOR ART: scripts/gpu/gex45-bench-6871 (the capability card's CLIP / SigLIP2 runs: speed only, no retrieval) and
# scripts/eval/identify-matcher-server.mjs (#3193: SigLIP2 vs CLIP image→image on CPU, transformers.js). This embeds the
# pool and the 60 frozen queries with each model's own processor, on the GPU, and keeps each arm's top 10 per query.
#
#   python embed.py --pool pool.jsonl --img img --queries queries.json --out out [--arms clip,siglip2-base,siglip2-so400m]
# Writes out/<arm>-top.json ({qid: [[page_id, score], ...]}), out/<arm>-speed.json. Stops nothing it did not start.
import argparse, json, os, time

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

ARMS = {
    "clip": "openai/clip-vit-base-patch32",              # the model behind clip_embeddings
    "siglip2-base": "google/siglip2-base-patch16-224",
    "siglip2-so400m": "google/siglip2-so400m-patch14-384",
}
ap = argparse.ArgumentParser()
ap.add_argument("--pool", required=True); ap.add_argument("--img", required=True)
ap.add_argument("--queries", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--arms", default=",".join(ARMS)); ap.add_argument("--batch", type=int, default=64); ap.add_argument("--k", type=int, default=10)
ap.add_argument("--cpu", action="store_true", help="smoke test only: fp32 on CPU")
ap.add_argument("--limit", type=int, default=0)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
pool = [json.loads(l) for l in open(a.pool) if l.strip()]
pool = [p for p in pool if os.path.exists(os.path.join(a.img, p["id"] + ".jpg"))]
if a.limit: pool = pool[: a.limit]
DEV, DT = ("cpu", torch.float32) if a.cpu else ("cuda", torch.float16)
qs = json.load(open(a.queries))["queries"]
print(f"pool {len(pool)} images, {len(qs)} queries", flush=True)

for arm in a.arms.split(","):
    name = ARMS[arm]
    model = AutoModel.from_pretrained(name, dtype=DT).to(DEV).eval()
    proc = AutoProcessor.from_pretrained(name)
    t0 = time.time(); feats = []
    with torch.inference_mode():
        for i in range(0, len(pool), a.batch):
            ims = [Image.open(os.path.join(a.img, p["id"] + ".jpg")).convert("RGB") for p in pool[i: i + a.batch]]
            x = proc(images=ims, return_tensors="pt").to(DEV)
            f = model.get_image_features(pixel_values=x["pixel_values"].to(DT))
            f = f.pooler_output if hasattr(f, "pooler_output") else f
            feats.append(torch.nn.functional.normalize(f.float(), dim=-1))
        img = torch.cat(feats)
        secs = time.time() - t0
        # SigLIP2 was trained with max_length 64 padding; CLIP with its own 77-token padding
        tx = proc(text=[q["query"] for q in qs], padding="max_length", max_length=64 if "siglip" in arm else 77, truncation=True, return_tensors="pt").to(DEV)
        t = model.get_text_features(**{k: v for k, v in tx.items() if k in ("input_ids", "attention_mask")})
        t = t.pooler_output if hasattr(t, "pooler_output") else t
        t = torch.nn.functional.normalize(t.float(), dim=-1)
        sim = t @ img.T
        top = sim.topk(a.k, dim=1)
    res = {q["qid"]: [[pool[j]["id"], round(float(s), 4)] for s, j in zip(top.values[n].tolist(), top.indices[n].tolist())] for n, q in enumerate(qs)}
    json.dump(res, open(os.path.join(a.out, f"{arm}-top.json"), "w"), indent=0)
    json.dump({"arm": arm, "model": name, "images": len(pool), "secs": round(secs, 1), "images_per_sec": round(len(pool) / secs, 1),
               "peak_vram_mib": round(torch.cuda.max_memory_allocated() / 2**20) if DEV == "cuda" else None}, open(os.path.join(a.out, f"{arm}-speed.json"), "w"))
    print(f"{arm}: {len(pool) / secs:.0f} img/s", flush=True)
    del model
    if DEV == "cuda": torch.cuda.empty_cache()
