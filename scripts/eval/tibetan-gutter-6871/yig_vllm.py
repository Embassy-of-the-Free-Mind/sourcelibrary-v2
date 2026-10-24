#!/usr/bin/env python3
# yig_vllm.py — the same whole-page Yigdzin read as yig_page.py, batched under vLLM for a full run (#6871 row 4).
#
# PRIOR ART: yig_page.py (this directory; HF transformers, ~2.5 min/page here because the HF DRY processor runs per
# step in Python: fine for 30 pages, a week for 5,132). This follows the model card's vLLM recipe instead:
# `vllm_paddleocr_seqpos` with OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential, greedy, the repo's DRYLogitsProcessor at
# 0.8 / 1.75 / 12. Same manifest and output contract as yig_page.py: DIR/<id>.txt, DIR/<id>.err, DIR/timings.jsonl.
#
#   OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential python yig_vllm.py --manifest todo.jsonl --out DIR [--mode page|bands]
import argparse, io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

os.environ.setdefault("OCR_VLLM_IMAGE_TOKEN_POSITIONS", "sequential")
import numpy as np
from PIL import Image
from huggingface_hub import hf_hub_download
from vllm import LLM, SamplingParams

REPO, REV = "BDRC/tibetan-ocr", "50506eb6d8ed8738df86b448f6f6cdc688de29ea"
PROMPT = "Extract all Tibetan text. Preserve line breaks."

ap = argparse.ArgumentParser()
ap.add_argument("--manifest", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--mode", choices=["page", "bands"], default="page")
ap.add_argument("--bands", type=int, default=3)
ap.add_argument("--batch", type=int, default=32)
ap.add_argument("--limit", type=int, default=0)
ap.add_argument("--gpu-util", type=float, default=0.6)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

sys.path.insert(0, os.path.dirname(hf_hub_download(REPO, "dry_logits_processor.py", revision=REV)))
from dry_logits_processor import DRYLogitsProcessor  # noqa: E402

llm = LLM(model=REPO, revision=REV, logits_processors=[DRYLogitsProcessor], gpu_memory_utilization=a.gpu_util,
          max_model_len=8192, limit_mm_per_prompt={"image": 1})
sp = SamplingParams(temperature=0, max_tokens=4096,
                    extra_args={"dry_multiplier": 0.8, "dry_base": 1.75, "dry_allowed_length": 12})
tok = llm.get_tokenizer()
prompt = tok.apply_chat_template([{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}],
                                 add_generation_prompt=True, tokenize=False)


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "sourcelibrary-eval"}), timeout=120) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def bands(im, n):  # identical to yig_page.py
    g = np.asarray(im.convert("L"), dtype=np.uint8)
    ink = np.convolve((g < 128).sum(axis=1).astype(float), np.ones(9) / 9, mode="same")
    h = g.shape[0]
    cuts, win = [0], max(10, h // (4 * n))
    for k in range(1, n):
        c = h * k // n
        lo, hi = max(cuts[-1] + 20, c - win), min(h - 20, c + win)
        cuts.append(int(lo + np.argmin(ink[lo:hi])) if hi > lo else c)
    cuts.append(h)
    return [im.crop((0, cuts[i], im.width, cuts[i + 1])) for i in range(n)]


def load(r):
    try:
        im = fetch(r["src"])
        return r, (im.size, [im] if a.mode == "page" else bands(im, a.bands)), None
    except Exception as e:
        return r, None, e


rows = [json.loads(l) for l in open(a.manifest) if l.strip()]
rows = [r for r in rows if not os.path.exists(os.path.join(a.out, f"{r['id']}.txt"))]
if a.limit:
    rows = rows[: a.limit]
tl = open(os.path.join(a.out, "timings.jsonl"), "a")
pool = ThreadPoolExecutor(8)
done = 0
for i in range(0, len(rows), a.batch):
    t0 = time.time()
    got = list(pool.map(load, rows[i: i + a.batch]))
    reqs, owners = [], []
    for r, val, err in got:
        if err is not None:
            open(os.path.join(a.out, f"{r['id']}.err"), "w").write(repr(err) + "\n")
            continue
        for p in val[1]:
            reqs.append({"prompt": prompt, "multi_modal_data": {"image": p}})
            owners.append(r["id"])
    outs = llm.generate(reqs, sp, use_tqdm=False) if reqs else []
    texts, toks = {}, {}
    for oid, o in zip(owners, outs):
        texts.setdefault(oid, []).append(o.outputs[0].text.strip())
        toks[oid] = toks.get(oid, 0) + len(o.outputs[0].token_ids)
    secs = (time.time() - t0) / max(1, len(texts))
    for r, val, err in got:
        if r["id"] not in texts:
            continue
        dst = os.path.join(a.out, f"{r['id']}.txt")
        with open(dst + ".tmp", "w") as f:
            f.write("\n".join(t for t in texts[r["id"]] if t) + "\n")
        os.replace(dst + ".tmp", dst)
        tl.write(json.dumps({"id": r["id"], "mode": a.mode, "secs": round(secs, 2), "tokens": toks[r["id"]], "w": val[0][0], "h": val[0][1]}) + "\n")
    tl.flush()
    done += len(texts)
    print(f"{time.strftime('%H:%M:%S')} {done}/{len(rows)}", flush=True)
print(f"done {done} pages mode={a.mode}", flush=True)
del llm
