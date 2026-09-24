#!/usr/bin/env python3
# PRIOR ART: scripts/eval/gemma4-ollama-sweep.py — drives a local open-weight model over pages, but
# through Ollama's chat API for OCR/summary, not a completion-template MT model; /root/tibetan-reocr
# (Hetzner) drives Yigdzin OCR on Scaleway, not translation. Nothing in the repo calls a
# self-hosted translation model.
"""
mitra-translate.py — the MITRA-MT arm of the Tibetan translation A/B (#4742).

Runs ON the GPU box against a local vLLM serving buddhist-nlp/gemma-2-mitra-it (9B, bf16). The
model's own card fixes the format:  "Please translate into <target>: <input> 🔽 Translation::",
line breaks replaced by 🔽, '#' as the stop token. It was trained on sentence pairs, so a page
is re-segmented at the shad (།) and sent in chunks of up to --chunk-chars characters; within a
chunk the sentences are joined by 🔽 and the output's 🔽 become line breaks again.

Input: one Yigdzin read per page (`mtab-yig-<book>_<page>.txt`). Output: <out>/<id>.json with
every chunk's source, output, token counts and latency, plus the joined page translation.

  python3 mitra-translate.py --yig /root/mtab/yig --out /root/mtab/out --ids id1,id2 [--chunk-chars 500] [--joiner space]
"""
import argparse
import glob
import json
import os
import re
import time
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--yig", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--ids", default="")
ap.add_argument("--chunk-chars", type=int, default=500)
ap.add_argument("--joiner", choices=["arrow", "space"], default="arrow")
ap.add_argument("--url", default="http://localhost:8000/v1/completions")
ap.add_argument("--force", action="store_true")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

TAG = re.compile(r"<[^>]+>")


def page_text(raw):
    # physical manuscript lines → one string; a line ends at a tsheg or shad, so no separator
    raw = TAG.sub(" ", raw)
    lines = [l.strip() for l in raw.split("\n")]
    text = "".join(lines)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def sentences(text):
    # keep every shad run with its sentence; leftover tail (no closing shad) is its own sentence
    parts = re.findall(r"[^།]+།+\s*|[^།]+$", text)
    return [p.strip() for p in parts if p.strip()]


def chunks(sents, limit):
    out, cur = [], []
    n = 0
    for s in sents:
        if cur and n + len(s) > limit:
            out.append(cur)
            cur, n = [], 0
        cur.append(s)
        n += len(s)
    if cur:
        out.append(cur)
    return out


def complete(prompt):
    body = json.dumps({"model": "mitra-it", "prompt": prompt, "max_tokens": 1024, "temperature": 0, "stop": ["#"]}).encode()
    req = urllib.request.Request(args.url, data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        j = json.load(r)
    ms = int((time.time() - t0) * 1000)
    ch = j["choices"][0]
    return ch["text"], ch.get("finish_reason"), j.get("usage", {}), ms


ids = [i for i in args.ids.split(",") if i] or None
files = sorted(glob.glob(f"{args.yig}/mtab-yig-*.txt"))
for f in files:
    pid = os.path.basename(f)[len("mtab-yig-"):-4]
    if ids and pid not in ids:
        continue
    outf = f"{args.out}/{pid}.json"
    if os.path.exists(outf) and not args.force:
        print("skip", pid)
        continue
    text = page_text(open(f, encoding="utf8").read())
    sents = sentences(text)
    groups = chunks(sents, args.chunk_chars)
    rec = {"id": pid, "src_chars": len(text), "sentences": len(sents), "chunks": [], "joiner": args.joiner, "chunk_chars": args.chunk_chars}
    t0 = time.time()
    for g in groups:
        src = ("🔽" if args.joiner == "arrow" else " ").join(g)
        prompt = f"Please translate into English: {src} 🔽 Translation::"
        out, fin, usage, ms = complete(prompt)
        rec["chunks"].append({"src": src, "out": out, "finish": fin, "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"), "ms": ms})
    rec["ms_total"] = int((time.time() - t0) * 1000)
    rec["text"] = "\n".join(c["out"].replace("🔽", "\n").strip() for c in rec["chunks"])
    rec["prompt_tokens"] = sum(c["prompt_tokens"] or 0 for c in rec["chunks"])
    rec["completion_tokens"] = sum(c["completion_tokens"] or 0 for c in rec["chunks"])
    json.dump(rec, open(outf, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(pid, f"{len(text)} chars, {len(sents)} sents, {len(groups)} chunks, {rec['completion_tokens']} out tok, {rec['ms_total']} ms")
