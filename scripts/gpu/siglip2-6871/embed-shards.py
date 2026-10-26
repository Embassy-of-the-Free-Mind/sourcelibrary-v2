#!/usr/bin/env python3
# embed-shards.py — SigLIP2-so400m image vectors to FILES, one resumable shard at a time (#6871 row 8, Derek 2026-10-21).
#
# PRIOR ART: scripts/eval/image-search-6871/embed.py (the eval: same model, processor, fp16, normalised image features,
# local 768 px JPEGs, no shards) and fetch.py there (≤ 768 px LANCZOS). This fetches straight from the URL into memory
# (no image is written to disk), resizes the same way, and writes per shard:
#   shard-NNNNN.f16.npy   (n, 1152) float16, L2-normalised, rows in the order of shard-NNNNN.ids.jsonl
#   shard-NNNNN.ids.jsonl the manifest rows embedded (failed rows are in shard-NNNNN.failed.jsonl, not in the vectors)
#   shard-NNNNN.json      the checkpoint: written last, atomically; a shard with it is skipped on resume
# and manifest.json (model, revision, preprocessing, every finished shard + totals) after every shard.
#   python embed-shards.py --manifest crops.jsonl --out out/crops [--shard 10000] [--procs 12 --workers 8] [--deadline EPOCH]
# Fetch + decode run in --procs worker processes of --workers threads each (fetchlib.py: R2 direct, keep-alive), a batch
# per task, so the GPU loop only stacks tensors (pilot: 24 threads in this process, GPU busy 0.33).
import argparse, json, multiprocessing as mp, os, sys, time
from collections import deque
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import torch
from transformers import AutoModel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib

MODEL = "google/siglip2-so400m-patch14-384"
ap = argparse.ArgumentParser()
ap.add_argument("--manifest", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--shard", type=int, default=10000); ap.add_argument("--workers", type=int, default=8)
ap.add_argument("--procs", type=int, default=12); ap.add_argument("--inflight", type=int, default=3, help="batches in flight per process")
ap.add_argument("--batch", type=int, default=64); ap.add_argument("--deadline", type=float, default=0)
ap.add_argument("--mem-fraction", type=float, default=0.6)
ap.add_argument("--cpu", action="store_true", help="smoke test only: fp32 on CPU, no card (use with --limit)")
ap.add_argument("--limit", type=int, default=0)
a = ap.parse_args()
DEV, DT = ("cpu", torch.float32) if a.cpu else ("cuda", torch.float16)
os.makedirs(a.out, exist_ok=True)
rows = [json.loads(l) for l in open(a.manifest) if l.strip()]
if a.limit: rows = rows[: a.limit]
nshards = (len(rows) + a.shard - 1) // a.shard
# a shard checkpoint only means something for the same rows cut the same way: refuse to resume into a changed run
fp = {"manifest": os.path.abspath(a.manifest), "rows": len(rows), "shard": a.shard, "model": MODEL,
      "first": rows[0]["id"] if rows else None, "last": rows[-1]["id"] if rows else None}
fpp = os.path.join(a.out, "run.json")
if os.path.exists(fpp) and json.load(open(fpp)) != fp:
    sys.exit(f"{fpp} is from a different run ({json.load(open(fpp))} vs {fp}): use a new --out")
json.dump(fp, open(fpp, "w"))
print(f"{a.manifest}: {len(rows)} rows, {nshards} shards of {a.shard}", flush=True)

# fork the fetch processes BEFORE anything touches CUDA (a forked child must never inherit a CUDA context); with fork
# the executor starts all of them on the first submit, so this warm-up call is that point
pool = ProcessPoolExecutor(a.procs, mp_context=mp.get_context("fork"), initializer=fetchlib.init, initargs=(a.workers,))
pool.submit(fetchlib.load_batch, []).result()
if DEV == "cuda": torch.cuda.set_per_process_memory_fraction(a.mem_fraction)
model = AutoModel.from_pretrained(MODEL, dtype=DT).to(DEV).eval()
SNAPS = os.path.expanduser("~/.cache/huggingface/hub/models--google--siglip2-so400m-patch14-384/snapshots")
snap = sorted(os.listdir(SNAPS))[0] if os.path.isdir(SNAPS) else "?"

def write_manifest():
    done = sorted(f for f in os.listdir(a.out) if f.startswith("shard-") and f.endswith(".json"))
    sh = [json.load(open(os.path.join(a.out, f))) for f in done]
    tot = {k: sum(x[k] for x in sh) for k in ("rows", "ok", "failed", "bytes", "wall_s", "gpu_s", "vec_bytes")}
    json.dump({"model": MODEL, "revision": snap, "dim": 1152, "dtype": "float16", "normalised": True,
               "preprocess": "PIL draft(768) → long side ≤ 768 LANCZOS → Siglip2 processor (384×384)",
               "source_manifest": os.path.abspath(a.manifest), "manifest_rows": len(rows), "shard_size": a.shard,
               "shards_total": nshards, "shards_done": len(sh), "totals": tot, "shards": sh,
               "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
              open(os.path.join(a.out, "manifest.json.tmp"), "w"), indent=1)
    os.replace(os.path.join(a.out, "manifest.json.tmp"), os.path.join(a.out, "manifest.json"))

stopped = False
for k in range(nshards):
    tag = f"shard-{k:05d}"
    if os.path.exists(os.path.join(a.out, tag + ".json")): continue
    if a.deadline and time.time() > a.deadline:
        print(f"deadline reached before {tag}; resume re-runs from here", flush=True); stopped = True; break
    part = rows[k * a.shard:(k + 1) * a.shard]
    t0 = time.time(); gpu_s = 0.0; vecs, ok_rows, bad, stats = [], [], [], []

    def ahead(part, window=a.procs * a.inflight):   # in order, at most `window` batches decoded ahead (≈ 56 MB each)
        q = deque()
        for b in range(0, len(part), a.batch):
            q.append((part[b:b + a.batch], pool.submit(fetchlib.load_batch, part[b:b + a.batch])))
            if len(q) >= window: r0, fu = q.popleft(); yield r0, fu.result()
        while q: r0, fu = q.popleft(); yield r0, fu.result()

    for rows_b, (X, ok, sts) in ahead(part):
        stats.extend(sts); okset = set(ok)
        bad.extend({**r, "err": st["err"]} for n, (r, st) in enumerate(zip(rows_b, sts)) if n not in okset)
        if not ok: continue
        g0 = time.time()
        with torch.inference_mode():
            f = model.get_image_features(pixel_values=torch.from_numpy(X).to(DEV, DT))
            f = f.pooler_output if hasattr(f, "pooler_output") else f
            f = torch.nn.functional.normalize(f.float(), dim=-1).half().cpu().numpy()
        if DEV == "cuda": torch.cuda.synchronize()
        gpu_s += time.time() - g0
        vecs.append(f); ok_rows.extend(rows_b[n] for n in ok)
    V = np.concatenate(vecs) if vecs else np.zeros((0, 1152), np.float16)
    np.save(os.path.join(a.out, tag + ".f16.npy"), V)
    with open(os.path.join(a.out, tag + ".ids.jsonl"), "w") as f: f.writelines(json.dumps(r) + "\n" for r in ok_rows)
    with open(os.path.join(a.out, tag + ".failed.jsonl"), "w") as f: f.writelines(json.dumps(r) + "\n" for r in bad)
    wall = time.time() - t0
    cache = {}
    for st in stats: cache[st["cache"] or "none"] = cache.get(st["cache"] or "none", 0) + 1
    rec = {"shard": k, "rows": len(part), "ok": len(ok_rows), "failed": len(bad), "bytes": sum(s["bytes"] for s in stats),
           "fetch_s_sum": round(sum(s["fetch_s"] for s in stats), 1), "decode_s_sum": round(sum(s["decode_s"] for s in stats), 1),
           "wall_s": round(wall, 1), "gpu_s": round(gpu_s, 1), "vec_bytes": os.path.getsize(os.path.join(a.out, tag + ".f16.npy")),
           "img_per_s": round(len(ok_rows) / wall, 1), "gpu_img_per_s": round(len(ok_rows) / gpu_s, 1) if gpu_s else None,
           "cf_cache": cache, "peak_vram_mib": round(torch.cuda.max_memory_allocated() / 2**20) if DEV == "cuda" else None,
           "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    json.dump(rec, open(os.path.join(a.out, tag + ".json.tmp"), "w"))
    os.replace(os.path.join(a.out, tag + ".json.tmp"), os.path.join(a.out, tag + ".json"))
    write_manifest()
    print(json.dumps(rec), flush=True)
write_manifest()
pool.shutdown(wait=True, cancel_futures=True)
del model
if DEV == "cuda": torch.cuda.empty_cache()
sys.exit(75 if stopped else 0)
