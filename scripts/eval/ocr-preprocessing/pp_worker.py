#!/usr/bin/env python3
# PRIOR ART: sl-mitra-1:/root/yig/yig_leaf_worker.py (the #4722 per-leaf re-read, 2026-09-25..28) — copied verbatim
# except the image source: instead of fetching + splitting, each job names its already-made arm image files
# (tibetan-prep.py), so the prompt, DRY config, batching, retry-on-repetition and min_tokens re-decode are production's
# and ONLY THE IMAGE varies between arms (#5250).
"""Yigdzin-v1 reads of the #5250 preprocessing arms. Job rows (manifest.jsonl): {stem, arm, files[]}; each file is
one request (a leaf, or the whole capture); texts are joined top to bottom as in production.
Writes <out>/txt/<arm>/<stem>.txt and <out>/pages.jsonl (one row per job). Resumable.
"""
import argparse, json, os, queue, sys, threading, time, io
from collections import Counter
from pathlib import Path

import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

UA = "SourceLibrary-reocr/0.1 (Tibetan corpus repair; contact: library@sourcelibrary.org)"
RPS_OWN_HOST = 5.0
ABORT_STREAK = 5
OCR_TARGET_W = 2400
WHITE_LEVEL = 250
BAND_PURITY = 0.98
MIN_BAND_PX = 200
PROMPT = "Extract all Tibetan text. Preserve line breaks."
MAX_TOKENS = 4096
DRY = {"dry_multiplier": 0.8, "dry_base": 1.75, "dry_allowed_length": 12}
TRUNC_MIN_TOKENS = 300
TRUNC_MARKS = ("།། །།", "༄༅། །", "༄༅།།", "༄༅༅། །", "།།")
TSHEG = "་"
Image.MAX_IMAGE_PIXELS = None


def _interior_bands(profile):
    runs, start = [], None
    for i, v in enumerate(profile):
        if v >= BAND_PURITY and start is None:
            start = i
        elif v < BAND_PURITY and start is not None:
            runs.append((start, i)); start = None
    if start is not None:
        runs.append((start, len(profile)))
    return [(a, b) for a, b in runs if a > 0 and b < len(profile) and b - a >= MIN_BAND_PX]


def is_guttered(gray):
    import numpy as np
    w = np.asarray(gray) >= WHITE_LEVEL
    return bool(_interior_bands(w.mean(axis=0)) and _interior_bands(w.mean(axis=1)))


def syllables(text):
    return [s for s in text.replace("\n", TSHEG).split(TSHEG) if s.strip()]


def repetition_score(text, n=8):
    syls = syllables(text)
    if len(syls) < n + 1:
        return 0.0
    sh = [tuple(syls[i:i + n]) for i in range(len(syls) - n + 1)]
    return 1.0 - len(set(sh)) / len(sh)


def hard_loop(text, n=20, k=3):
    syls = syllables(text)
    if len(syls) < n * k:
        return False
    c = Counter(tuple(syls[i:i + n]) for i in range(len(syls) - n + 1))
    return max(c.values()) >= k


def nlines(text):
    return sum(1 for l in text.split("\n") if l.strip())


def crops_for(info, H, mode):
    if mode == "whole" or info["path"] != "detected" or len(info["bands"]) < 2:
        return [(0, H)]
    b = info["bands"]  # already padded + clipped at gap midpoints by detect(), full-res px
    cuts = [0] + [int((b[i][1] + b[i + 1][0]) / 2) for i in range(len(b) - 1)] + [H]
    if mode == "partition":
        return [(cuts[i], cuts[i + 1]) for i in range(len(b))]
    return [(max(cuts[i], y0), min(cuts[i + 1], y1)) for i, (y0, y1) in enumerate(b)]


def prep(im):
    if im.width > OCR_TARGET_W:
        im = im.resize((OCR_TARGET_W, round(im.height * OCR_TARGET_W / im.width)), Image.LANCZOS)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--todo", required=True, help="jsonl rows with book, page")
    ap.add_argument("--out", required=True)
    ap.add_argument("--img-root", default="/root/pp5250/tibetan/img", help="where the arm images live on this box")
    ap.add_argument("--model", default="/root/yig/model")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=128, help="pages per engine batch")
    ap.add_argument("--prefetch", type=int, default=384)
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--max-num-seqs", type=int, default=128)
    ap.add_argument("--stop-file", default="", help="exit cleanly after the current batch if this file exists")
    args = ap.parse_args()

    out = Path(args.out); txtdir = out / "txt"; txtdir.mkdir(parents=True, exist_ok=True)
    for r in open(args.todo):
        (txtdir / json.loads(r)["arm"]).mkdir(exist_ok=True)
    log = open(out / "worker.jsonl", "a"); ledger = open(out / "pages.jsonl", "a")

    def logrow(**kw):
        kw["t"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        log.write(json.dumps(kw, ensure_ascii=False) + "\n"); log.flush()

    rows = []
    for line in open(args.todo):
        r = json.loads(line)
        stem = f"{r['arm']}/{r['stem']}"
        if (txtdir / f"{stem}.txt").exists():
            continue
        rows.append((stem, [args.img_root + f.split("/tibetan/img", 1)[1] for f in r["files"]]))
        if args.limit and len(rows) >= args.limit:
            break
    print(f"queued {len(rows)} jobs", flush=True)
    if not rows:
        logrow(status="final", done=0, note="nothing queued"); return

    q = queue.Queue(maxsize=args.prefetch)
    state = {"streak": 0, "abort": False, "skipped": 0}
    slock = threading.Lock(); idx = {"i": 0}; last = {"t": 0.0}

    def wait_rate():
        with slock:
            now = time.time(); t = max(now, last["t"] + 1.0 / RPS_OWN_HOST); last["t"] = t
        if t > now:
            time.sleep(t - now)

    def fetch_loop():
        while True:
            with slock:
                if idx["i"] >= len(rows):
                    return
                stem, files = rows[idx["i"]]; idx["i"] += 1
            try:
                leaves = []
                for f in files:
                    im = Image.open(f); im.load(); leaves.append(im.convert("RGB"))
            except Exception as e:
                logrow(id=stem, status=f"load-failed:{type(e).__name__}", err=str(e)[-200:])
                with slock:
                    state["skipped"] += 1
                continue
            geo = {"n_files": len(files), "px": [list(im.size) for im in leaves]}
            q.put((stem, leaves, geo))

    threads = [threading.Thread(target=fetch_loop, daemon=True) for _ in range(args.threads)]
    for t in threads:
        t.start()

    os.environ.setdefault("OCR_VLLM_IMAGE_TOKEN_POSITIONS", "sequential")
    sys.path.insert(0, str(Path(args.model)))
    from vllm import LLM, SamplingParams
    from dry_logits_processor import DRYLogitsProcessor
    assert DRYLogitsProcessor is not None
    llm = LLM(model=args.model, logits_processors=[DRYLogitsProcessor], dtype="bfloat16",
              max_model_len=8192, limit_mm_per_prompt={"image": 1},
              max_num_seqs=args.max_num_seqs, gpu_memory_utilization=0.90)

    def sp(temperature=0.0, n=1, min_tokens=0):
        return SamplingParams(temperature=temperature, n=n, max_tokens=MAX_TOKENS, min_tokens=min_tokens,
                              extra_args=dict(DRY))

    def conv(im):
        return [{"role": "user", "content": [{"type": "image_pil", "image_pil": im},
                                             {"type": "text", "text": PROMPT}]}]

    def looks_truncated(text):
        t = text.strip()
        # leaf-scale version of the September boundary-mark heuristic: a leaf carries 4-9 lines
        # (~120-350 syllables). Measured 2026-09-25 on the first 128 production pages: gold-on-black
        # leaves (69e76134...) come back as the bare opening mark "༄༅།" -- ONE syllable, ending on a
        # single shad that TRUNC_MARKS does not list -- on 33/128 pages. So any leaf under 40
        # syllables is re-decoded with min_tokens; the re-decode still has to be longer and loop-free.
        return len(syllables(t)) < 40

    n_done = n_retry = n_loop = n_trunc = 0
    t0 = time.time(); pending = []
    alive = lambda: any(t.is_alive() for t in threads)

    while True:
        try:
            pending.append(q.get(timeout=5)); got = True
        except queue.Empty:
            got = False
        more = alive() or not q.empty()
        if not pending:
            if not more:
                break
            continue
        if len(pending) < args.batch and more and got:
            continue
        batch, pending = pending[:args.batch], pending[args.batch:]
        reqs = [(bi, li) for bi, (_, leaves, _) in enumerate(batch) for li in range(len(leaves))]
        texts = {}; meta = {}
        tc = time.time()
        try:
            outs = llm.chat([conv(batch[bi][1][li]) for bi, li in reqs], [sp() for _ in reqs], use_tqdm=False)
        except Exception as e:
            for stem, _, _ in batch:
                logrow(id=stem, status=f"ocr-fail:{type(e).__name__}", err=str(e)[-200:])
            continue
        redo = []
        for (bi, li), o in zip(reqs, outs):
            text = o.outputs[0].text; fin = o.outputs[0].finish_reason
            texts[(bi, li)] = text; meta[(bi, li)] = {"fin": fin}
            if fin == "length" or hard_loop(text) or repetition_score(text) >= 0.10:
                redo.append(("retry", bi, li))
            elif looks_truncated(text):
                redo.append(("trunc", bi, li))
        if redo:
            params = [sp(0.4, 2) if k == "retry" else sp(min_tokens=TRUNC_MIN_TOKENS) for k, _, _ in redo]
            try:
                routs = llm.chat([conv(batch[bi][1][li]) for _, bi, li in redo], params, use_tqdm=False)
            except Exception as e:
                routs = [None] * len(redo)
                logrow(status="redo-batch-fail", err=str(e)[-200:])
            for (k, bi, li), o in zip(redo, routs):
                if o is None:
                    continue
                t0_ = texts[(bi, li)]
                if k == "retry":
                    best = min([t0_] + [c.text for c in o.outputs], key=repetition_score)
                    loop = hard_loop(best); n_retry += 1; n_loop += int(loop)
                    texts[(bi, li)] = best; meta[(bi, li)].update(retry=1, loop_left=loop)
                else:
                    new = o.outputs[0].text; n_trunc += 1
                    ok = (len(syllables(new)) > len(syllables(t0_)) and repetition_score(new) < 0.15
                          and not hard_loop(new))
                    if ok:
                        texts[(bi, li)] = new
                    meta[(bi, li)].update(trunc=1, trunc_ok=ok)
        for bi, (stem, leaves, geo) in enumerate(batch):
            parts = [texts[(bi, li)].strip("\n") for li in range(len(leaves))]
            full = "\n".join(p for p in parts if p.strip())
            (txtdir / f"{stem}.txt").write_text(full, encoding="utf-8")
            row = {"id": stem, **geo, "lines": nlines(full), "syl": len(syllables(full)),
                   "leaf": [{"lines": nlines(parts[li]), "syl": len(syllables(parts[li])), **meta[(bi, li)]}
                            for li in range(len(leaves))]}
            ledger.write(json.dumps(row) + "\n")
            if not full.strip():
                logrow(id=stem, status="textless")
            n_done += 1
        ledger.flush()
        el = time.time() - t0
        print(f"{n_done} done {n_done/el:.2f} p/s reqs={len(reqs)} redo={len(redo)} retry={n_retry} loops={n_loop} "
              f"trunc={n_trunc} skipped={state['skipped']} q={q.qsize()} chat={time.time()-tc:.0f}s", flush=True)
        if state["abort"] or (args.stop_file and os.path.exists(args.stop_file)):
            break

    el = time.time() - t0
    logrow(status="final", done=n_done, retried=n_retry, loops_left=n_loop, trunc=n_trunc,
           skipped=state["skipped"], aborted=state["abort"], seconds=round(el), pps=round(n_done / max(el, 1), 3))
    print(f"FINAL done={n_done} abort={state['abort']} {n_done/max(el,1):.2f} p/s", flush=True)
    sys.exit(2 if state["abort"] else 0)


if __name__ == "__main__":
    main()
