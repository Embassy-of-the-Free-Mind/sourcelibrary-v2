#!/usr/bin/env python3
# PRIOR ART: yig_leaf_worker.py (#4523/#4722, ops repo handoffs/data/2026-09-25-yig-leaf/; never committed here): the
# production per-leaf Yigdzin reader on vLLM. Its partition crops, 2400-px resize, prompt, DRY config, loop retry
# (temperature 0.4, n=2, least repetitive kept) and short-read re-decode (min_tokens 300, kept only if longer and
# loop-free) are copied unchanged. scripts/eval/... yig_page.py (#6871, gex45 /root/jobs/tib-gutter-6871/): the HF
# transformers recipe from the model card (sequential M-RoPE, the repo's DRY processor) used because vLLM deadlocked on
# gex45's card there. What is new: the cuts come from frames.jsonl (the ledger spans of frames.mjs) and each leaf crop
# is also SAVED at full resolution, for the audit and the contact sheet.
"""
yig_leaf_read.py — split each frame into its leaves and read every leaf alone with BDRC Yigdzin 1 (HF), to files.

  python yig_leaf_read.py --frames frames.jsonl --out DIR [--crops-only] [--leafsplit /path/to/leafsplit.py]

frames.jsonl rows (frames.mjs): {uid, src, src_alt, spans: [[y0, y1], ...] fractions of the height, or null}.
A null `spans` is cut by leafsplit.detect() (the ledgers' own detector) in partition mode; a frame it cannot split is
kept whole (one leaf) and logged. Writes DIR/crops/<uid>-L<i>.jpg (full resolution, q95), DIR/txt/<uid>-L<i>.txt and
one DIR/leaves.jsonl row per leaf. Resumable. No Mongo, no network beyond the image fetch and the model download.
"""
import argparse, io, json, os, sys, time, urllib.request
from collections import Counter

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
REPO, REV = "BDRC/tibetan-ocr", "50506eb6d8ed8738df86b448f6f6cdc688de29ea"
PROMPT = "Extract all Tibetan text. Preserve line breaks."
OCR_TARGET_W = 2400
MAX_TOKENS = 4096
DRY = dict(multiplier=0.8, base=1.75, allowed_length=12)
TRUNC_MIN_TOKENS = 300
TSHEG = "་"

ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--crops-only", action="store_true")
ap.add_argument("--leafsplit", default="")
a = ap.parse_args()
for d in ("crops", "txt"):
    os.makedirs(os.path.join(a.out, d), exist_ok=True)


def syllables(t):
    return [s for s in t.replace("\n", TSHEG).split(TSHEG) if s.strip()]


def repetition_score(t, n=8):
    s = syllables(t)
    if len(s) < n + 1:
        return 0.0
    sh = [tuple(s[i:i + n]) for i in range(len(s) - n + 1)]
    return 1.0 - len(set(sh)) / len(sh)


def hard_loop(t, n=20, k=3):
    s = syllables(t)
    if len(s) < n * k:
        return False
    return max(Counter(tuple(s[i:i + n]) for i in range(len(s) - n + 1)).values()) >= k


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "sourcelibrary-eval/5771"}), timeout=180) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def spans_px(fr, im):
    H = im.height
    if fr.get("spans"):
        return [(round(y0 * H), round(y1 * H)) for y0, y1 in fr["spans"]], fr["cut_source"]
    sys.path.insert(0, os.path.dirname(os.path.abspath(a.leafsplit)))
    from leafsplit import detect  # noqa: E402
    info = detect(im)
    b = info.get("bands") or []
    if info.get("path") != "detected" or len(b) < 2:
        return [(0, H)], f"leafsplit:{info.get('path')}:whole"
    cuts = [0] + [int((b[i][1] + b[i + 1][0]) / 2) for i in range(len(b) - 1)] + [H]   # partition, as the worker
    return [(cuts[i], cuts[i + 1]) for i in range(len(b))], "leafsplit:detected"


frames = [json.loads(l) for l in open(a.frames) if l.strip()]
leaves = []   # (uid, i, crop path)
for fr in frames:
    done = sorted(f for f in os.listdir(os.path.join(a.out, "crops")) if f.startswith(fr["uid"] + "-L"))
    meta_f = os.path.join(a.out, "crops", f"{fr['uid']}.json")
    if done and os.path.exists(meta_f):
        leaves += [(fr["uid"], i, os.path.join(a.out, "crops", f)) for i, f in enumerate(f for f in done if f.endswith(".jpg"))]
        continue
    im, used = None, None
    for u in (fr.get("src"), fr.get("src_alt")):
        if not u:
            continue
        try:
            im, used = fetch(u), u
            break
        except Exception as e:  # next source
            print(f"{fr['uid']} fetch failed {u}: {e!r}", flush=True)
    if im is None:
        print(f"{fr['uid']} NO IMAGE", flush=True)
        continue
    sp, how = spans_px(fr, im)
    paths = []
    for i, (y0, y1) in enumerate(sp):
        p = os.path.join(a.out, "crops", f"{fr['uid']}-L{i + 1}.jpg")
        im.crop((0, y0, im.width, y1)).save(p, quality=95)
        paths.append(p)
        leaves.append((fr["uid"], i, p))
    json.dump({"uid": fr["uid"], "src": used, "w": im.width, "h": im.height, "spans_px": sp, "cut": how}, open(meta_f, "w"))
    print(f"{fr['uid']} {im.width}x{im.height} {len(sp)} leaves ({how})", flush=True)
print(f"{len(leaves)} leaf crops from {len(frames)} frames", flush=True)
if a.crops_only:
    sys.exit(0)

import torch  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402
from transformers import AutoModelForImageTextToText, AutoProcessor, LogitsProcessorList  # noqa: E402

sys.path.insert(0, os.path.dirname(hf_hub_download(REPO, "dry_logits_processor.py", revision=REV)))
from dry_logits_processor import make_hf_dry_processor  # noqa: E402

proc = AutoProcessor.from_pretrained(REPO, revision=REV)
model = AutoModelForImageTextToText.from_pretrained(REPO, revision=REV, dtype=torch.bfloat16, device_map="cuda").eval()


def prep(im):
    if im.width > OCR_TARGET_W:
        im = im.resize((OCR_TARGET_W, round(im.height * OCR_TARGET_W / im.width)), Image.LANCZOS)
    return im


def gen(im, sample=False, n=1, min_new=0):
    msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
    prompt = proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
    x = proc(text=[prompt], images=[im], return_tensors="pt").to("cuda")
    x["mm_token_type_ids"] = torch.zeros_like(x["input_ids"])  # sequential regime (model card: required)
    L = x["input_ids"].shape[1]
    lp = LogitsProcessorList([make_hf_dry_processor(prompt_len=L, **DRY)])
    kw = dict(max_new_tokens=MAX_TOKENS, logits_processor=lp, min_new_tokens=min_new)
    kw.update(dict(do_sample=True, temperature=0.4, num_return_sequences=n) if sample else dict(do_sample=False))
    with torch.inference_mode():
        out = model.generate(**x, **kw)
    res = []
    for row in out:
        toks = row[L:]
        res.append((proc.decode(toks, skip_special_tokens=True).strip(), int((toks != (proc.tokenizer.pad_token_id if proc.tokenizer.pad_token_id is not None else -1)).sum())))
    return res


ledger = open(os.path.join(a.out, "leaves.jsonl"), "a")
for uid, i, p in leaves:
    dst = os.path.join(a.out, "txt", f"{uid}-L{i + 1}.txt")
    if os.path.exists(dst):
        continue
    t0 = time.time()
    try:
        im = prep(Image.open(p).convert("RGB"))
        text, toks = gen(im)[0]
        meta = {"fin": "length" if toks >= MAX_TOKENS else "stop"}
        if meta["fin"] == "length" or hard_loop(text) or repetition_score(text) >= 0.10:
            best = min([text] + [t for t, _ in gen(im, sample=True, n=2)], key=repetition_score)
            meta.update(retry=1, loop_left=hard_loop(best))
            text = best
        elif len(syllables(text)) < 40:
            new = gen(im, min_new=TRUNC_MIN_TOKENS)[0][0]
            ok = len(syllables(new)) > len(syllables(text)) and repetition_score(new) < 0.15 and not hard_loop(new)
            meta.update(trunc=1, trunc_ok=ok)
            if ok:
                text = new
        with open(dst + ".tmp", "w") as f:
            f.write(text + "\n")
        os.replace(dst + ".tmp", dst)
        ledger.write(json.dumps({"uid": uid, "leaf": i + 1, "secs": round(time.time() - t0, 1), "tokens": toks, "w": im.width, "h": im.height,
                                 "lines": sum(1 for l in text.split("\n") if l.strip()), "syl": len(syllables(text)), **meta}) + "\n")
        ledger.flush()
        print(f"{time.strftime('%H:%M:%S')} {uid}-L{i + 1} {time.time() - t0:.0f}s {len(syllables(text))} syl", flush=True)
    except Exception as e:  # one bad leaf must not stop the run
        open(dst.replace(".txt", ".err"), "w").write(repr(e) + "\n")
print("done", flush=True)
del model
torch.cuda.empty_cache()
