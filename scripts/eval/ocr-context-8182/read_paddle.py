#!/usr/bin/env python3
"""#8182: PaddleOCR-VL-1.6 as the print lane serves it (scripts/gpu/paddle-print-gpu.sh: genai server on vLLM,
use_layout_detection=False, max side 0), over the composed test images. Text = the pipeline's parsing blocks, one per
line, as paddle-zh-run.py writes them. Files only.

PRIOR ART: scripts/gpu/paddle-zh-run.py (the served runner: R2 fetch, manifest, per-page watchdog). It reads pages by
book and page number from R2; these are local test images, so this is its pipeline call and block assembly alone.

Run: python read_paddle.py --todo rows.jsonl --out DIR [--server-url http://127.0.0.1:8118/v1]
rows: {"id": "<stem>__<image>[__r2]", "path": "<png>"}  -> DIR/<id>.txt (or .err)
"""
import argparse, json, os, time
ap = argparse.ArgumentParser(); ap.add_argument("--todo", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--server-url", default="http://127.0.0.1:8118/v1"); a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
from paddleocr import PaddleOCRVL  # noqa: E402
pipe = PaddleOCRVL(use_layout_detection=False, vl_rec_backend="vllm-server", vl_rec_server_url=a.server_url)


def blocks_of(res):
    j = res.json if hasattr(res, "json") else res
    if isinstance(j, dict) and "res" in j: j = j["res"]
    blocks = []
    for b in (j.get("parsing_res_list") or []) if isinstance(j, dict) else []:
        c = b.get("block_content") if isinstance(b, dict) else getattr(b, "content", None)
        if c and str(c).strip(): blocks.append(str(c).strip())
    if not blocks:
        md = getattr(res, "markdown", None)
        if isinstance(md, dict): md = md.get("markdown_texts")
        if md: blocks.append(str(md).strip())
    return blocks


for line in open(a.todo):
    r = json.loads(line); dst = os.path.join(a.out, r["id"] + ".txt")
    if os.path.exists(dst): continue
    t0 = time.time()
    try:
        res = list(pipe.predict(r["path"]))
        text = "\n".join(b for x in res for b in blocks_of(x))
        open(dst, "w").write(text)
    except Exception as e:  # noqa: BLE001
        open(os.path.join(a.out, r["id"] + ".err"), "w").write(repr(e)[:500])
    print(json.dumps({"id": r["id"], "secs": round(time.time() - t0, 1)}), flush=True)
