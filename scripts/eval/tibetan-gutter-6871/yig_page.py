#!/usr/bin/env python3
# yig_page.py — read whole pages (not pecha leaves) with BDRC Yigdzin 1 under HF transformers, to files (#6871 row 4).
#
# PRIOR ART: the #4523 `yig_leaf_worker.py` (never committed; lived on the leased L4 boxes) cuts an image into pecha
# leaves and REFUSES one whose gutter detector sees a bound-book opening — that refusal is the 5,132 pages this reads.
# The model card's own HF recipe (huggingface.co/BDRC/tibetan-ocr, rev 50506eb6) is followed as written: sequential
# M-RoPE (mm_token_type_ids zeroed), greedy, the repo's DRY guard at the card's production config (0.8 / 1.75 / 12).
#
#   python yig_page.py --manifest todo.jsonl --out DIR --mode page|bands [--limit N]
# manifest rows: {"id": <page id>, "src": <image url>}. Writes DIR/<id>.txt and DIR/timings.jsonl. Resumable.
# mode page  = the whole image, as the processor's own resize gives it.
# mode bands = the image cut into horizontal bands at the emptiest pixel rows (never through a text line), each band
#              read alone and the reads joined with newlines. More pixels per line for long or dense pages.
# No Mongo, no network beyond the image fetch and the model download.
import argparse, io, json, os, sys, time, urllib.request

import numpy as np
import torch
from PIL import Image
from huggingface_hub import hf_hub_download
from transformers import AutoModelForImageTextToText, AutoProcessor, LogitsProcessorList

REPO, REV = "BDRC/tibetan-ocr", "50506eb6d8ed8738df86b448f6f6cdc688de29ea"
PROMPT = "Extract all Tibetan text. Preserve line breaks."

ap = argparse.ArgumentParser()
ap.add_argument("--manifest", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--mode", choices=["page", "bands"], default="page")
ap.add_argument("--bands", type=int, default=3, help="target band count in bands mode")
ap.add_argument("--limit", type=int, default=0)
ap.add_argument("--max-new", type=int, default=4096)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

sys.path.insert(0, os.path.dirname(hf_hub_download(REPO, "dry_logits_processor.py", revision=REV)))
from dry_logits_processor import make_hf_dry_processor  # noqa: E402

proc = AutoProcessor.from_pretrained(REPO, revision=REV)
model = AutoModelForImageTextToText.from_pretrained(REPO, revision=REV, dtype=torch.bfloat16, device_map="cuda").eval()


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "sourcelibrary-eval"}), timeout=120) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def bands(im, n):
    """Cut at the n-1 emptiest rows nearest the even split points (ink = dark pixels per row)."""
    g = np.asarray(im.convert("L"), dtype=np.uint8)
    ink = (g < 128).sum(axis=1).astype(float)
    ink = np.convolve(ink, np.ones(9) / 9, mode="same")
    h = g.shape[0]
    cuts, win = [0], max(10, h // (4 * n))
    for k in range(1, n):
        c = h * k // n
        lo, hi = max(cuts[-1] + 20, c - win), min(h - 20, c + win)
        cuts.append(int(lo + np.argmin(ink[lo:hi])) if hi > lo else c)
    cuts.append(h)
    return [im.crop((0, cuts[i], im.width, cuts[i + 1])) for i in range(n)]


def read(im):
    msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
    prompt = proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
    x = proc(text=[prompt], images=[im], return_tensors="pt").to("cuda")
    x["mm_token_type_ids"] = torch.zeros_like(x["input_ids"])  # sequential regime (model card: required)
    n = x["input_ids"].shape[1]
    lp = LogitsProcessorList([make_hf_dry_processor(prompt_len=n, multiplier=0.8, base=1.75, allowed_length=12)])
    with torch.inference_mode():
        out = model.generate(**x, do_sample=False, max_new_tokens=a.max_new, logits_processor=lp)
    return proc.batch_decode(out[:, n:], skip_special_tokens=True)[0].strip(), int(out.shape[1] - n)


rows = [json.loads(l) for l in open(a.manifest) if l.strip()]
if a.limit:
    rows = rows[: a.limit]
tl = open(os.path.join(a.out, "timings.jsonl"), "a")
done = 0
for r in rows:
    dst = os.path.join(a.out, f"{r['id']}.txt")
    if os.path.exists(dst):
        continue
    t0 = time.time()
    try:
        im = fetch(r["src"])
        parts = [im] if a.mode == "page" else bands(im, a.bands)
        reads = [read(p) for p in parts]
        text, toks = "\n".join(t for t, _ in reads if t), sum(k for _, k in reads)
        with open(dst + ".tmp", "w") as f:
            f.write(text + "\n")
        os.replace(dst + ".tmp", dst)
        tl.write(json.dumps({"id": r["id"], "mode": a.mode, "secs": round(time.time() - t0, 2), "tokens": toks, "w": im.width, "h": im.height}) + "\n")
    except Exception as e:  # one bad page must not stop the run
        open(os.path.join(a.out, f"{r['id']}.err"), "w").write(repr(e) + "\n")
    tl.flush()
    done += 1
    if done % 50 == 0:
        print(f"{time.strftime('%H:%M:%S')} {done}/{len(rows)}", flush=True)
print(f"done {done} pages mode={a.mode}", flush=True)
del model
torch.cuda.empty_cache()
