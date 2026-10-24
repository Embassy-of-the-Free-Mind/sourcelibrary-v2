#!/usr/bin/env python3
# summarize.py — the numbers Derek asked for (#6871, 2026-10-21) from the two manifest.json files embed-shards.py wrote:
# end-to-end and GPU-only throughput, R2 read volume, disk per 1M vectors, and what that implies for the ~20.7M pages.
#   python summarize.py out/crops out/pilot > summary.json
import json, os, sys

FULL = 20_700_000
res = {}
for d in sys.argv[1:]:
    if not os.path.exists(os.path.join(d, "manifest.json")): res[os.path.basename(d.rstrip("/"))] = "not started"; continue
    m = json.load(open(os.path.join(d, "manifest.json"))); t = m["totals"]; sh = m["shards"]
    ok = t["ok"] or 1
    cache = {}
    for s in sh:
        for k, v in s["cf_cache"].items(): cache[k] = cache.get(k, 0) + v
    r = {"rows": m["manifest_rows"], "shards_done": f'{m["shards_done"]}/{m["shards_total"]}', "ok": t["ok"], "failed": t["failed"],
         "img_per_s_end_to_end": round(t["ok"] / t["wall_s"], 1) if t["wall_s"] else None,
         "gpu_img_per_s": round(t["ok"] / t["gpu_s"], 1) if t["gpu_s"] else None,
         "gpu_busy_frac": round(t["gpu_s"] / t["wall_s"], 2) if t["wall_s"] else None,
         "mean_fetch_s": round(sum(s["fetch_s_sum"] for s in sh) / max(1, t["rows"]), 3),
         "mean_decode_s": round(sum(s["decode_s_sum"] for s in sh) / max(1, t["ok"]), 3),
         "read_gb": round(t["bytes"] / 1e9, 2), "mb_per_image": round(t["bytes"] / max(1, t["rows"]) / 1e6, 3),
         "cf_cache": cache, "vec_mb": round(t["vec_bytes"] / 1e6, 1),
         "disk_gb_per_1m_vectors": round(t["vec_bytes"] / ok * 1e6 / 1e9, 2),
         "peak_vram_mib": max((s["peak_vram_mib"] or 0 for s in sh), default=None)}
    if os.path.basename(d.rstrip("/")) == "pilot" and r["img_per_s_end_to_end"]:
        r["full_20_7M"] = {"days_end_to_end": round(FULL / r["img_per_s_end_to_end"] / 86400, 1),
                           "days_gpu_only": round(FULL / r["gpu_img_per_s"] / 86400, 1) if r["gpu_img_per_s"] else None,
                           "read_tb": round(r["mb_per_image"] * FULL / 1e6, 2),
                           "vectors_gb_fp16": round(r["disk_gb_per_1m_vectors"] * FULL / 1e6, 1)}
    res[os.path.basename(d.rstrip("/"))] = r
print(json.dumps(res, indent=1))
