#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-preprocessing/syriac-run.sh (rounds 1-3: arm images + one Kraken call per (arm, page) on
# published-GT folios) and gutter.py (the lane's gutter cut, ported). Those read EXTERNAL GT pages whole; this reads
# LIBRARY pages through the lane's own path (gutter found on the original, right part first) with the arm applied by
# scripts/workers/syriac-kraken-preprocess.py — the code that ships — so the transfer check tests the lane step itself.
"""#5277 transfer check: does the #5250 per-stratum preprocessing transfer to LIBRARY Syriac manuscript captures?

There is NO reference transcription for any library Syriac page, so this cannot measure accuracy on them. It measures:
  1. classifier: the class of every GT page (must split 60/60) and of a cohort sample (~5 pages per manuscript book);
  2. reads: each drawn library page read by Kraken Sophro Mhiro under arms base (downscale only), flatten, sauvola,
     beside the lane's own production read (full resolution, no arm) that is already on disk;
  3. proxies per read: Syriac letters, non-empty lines, and LEXICON HIT RATE = share of Syriac word tokens (N2, points
     stripped) found in a lexicon built from published GT transcriptions. The proxy is validated against real CER on
     the round-3 GT reads (lexicon from the DISJOINT round-1 pages) before it is used: `validate`.

usage (Hetzner, one CPU worker beside the production lane, nice 10):
  syriac-lib-r4.py cohort  <W>            # sample + classify; writes <W>/cohort.jsonl, <W>/gt-classes.jsonl
  syriac-lib-r4.py read    <W> [arms..]   # <W>/lib/draw.jsonl pages -> <W>/lib/out/<arm>/<bid>-<pn>.txt (resumable)
  syriac-lib-r4.py validate <W>           # proxy vs CER on round 3 -> <W>/proxy-validation.json
  syriac-lib-r4.py score   <W>            # paired proxies on library pages -> <W>/lib-scores.json
  syriac-lib-r4.py report  <W> <eye.json> # paired tables: library (letters vs the lane's read) + GT (CER, auto routing)
"""
import collections
import glob
import json
import os
import random
import subprocess
import sys
import time
import urllib.request
import importlib.util

import cv2

REPO = os.environ.get("REPO", "/root/sourcelibrary")
LANE_DIR = os.environ.get("LANE_DIR", "/root/syriac-kraken")
K = os.environ.get("K", "/root/bench2-kraken/venv/bin/kraken")
MODEL = os.environ.get("MODEL", "/root/ocr-bench/syriac-retest/models/sophro-mhiro.mlmodel")
GT_DIRS = {"r1": os.environ.get("GT1", "/root/ocr-bench/syriac-retest"), "r3": os.environ.get("GT3", "/root/ocr-bench/syriac-r3")}
GT_IMG = [os.environ.get("GTIMG1", "/root/ocr-bench/images/syriac-gt"), os.environ.get("GTIMG3", "/root/ocr-bench/images/syriac-r3")]
R3_OUT = os.environ.get("R3_OUT", "/root/pp5250r3/syriac/out")
UA = "sourcelibrary-syriac-preproc-5277/1 (derek@sourcelibrary.org)"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PP = _load("syr_pp", f"{REPO}/scripts/workers/syriac-kraken-preprocess.py")
GUT = _load("syr_gut", f"{REPO}/scripts/eval/ocr-preprocessing/gutter.py")
_src = open(f"{REPO}/scripts/eval/benchmark/syriac-retest/score-syriac-retest.py").read()
NS = {}
exec(_src[:_src.index("def engines_of")], NS)
n2, line_cer = NS["n2"], NS["line_cer"]


def fetch(url, dest):
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=90).read()
            if len(data) > 2000:
                open(dest, "wb").write(data)
                return True
        except Exception:
            time.sleep(5 * (attempt + 1))
    return False


def cohort(W):
    """Classify every GT page and a seeded sample of up to 5 pages per manuscript book of the lane plan."""
    with open(f"{W}/gt-classes.jsonl", "w") as f:
        for d in GT_IMG:
            for p in sorted(glob.glob(f"{d}/*.jpg")):
                k, feat = PP.classify(cv2.imread(p, cv2.IMREAD_COLOR))
                f.write(json.dumps({"file": os.path.basename(p), "set": os.path.basename(p).split("-")[0], "klass": k, **feat}) + "\n")
    random.seed("5277-cohort")
    plan = [json.loads(l) for l in open(f"{LANE_DIR}/plan.jsonl")]
    by = collections.defaultdict(list)
    for r in plan:
        if r["route"] == "manuscript":
            by[r["bid"]].append(r)
    os.makedirs(f"{W}/cohort-img", exist_ok=True)
    with open(f"{W}/cohort.jsonl", "w") as f:
        for bid, rows in sorted(by.items()):
            for r in random.sample(rows, min(5, len(rows))):
                dest = f"{W}/cohort-img/{bid}-{r['pn']}.jpg"
                if not os.path.exists(dest) and not fetch(r["src"], dest):
                    f.write(json.dumps({"bid": bid, "pn": r["pn"], "klass": None, "error": "fetch"}) + "\n")
                    continue
                k, feat = PP.classify(cv2.imread(dest, cv2.IMREAD_COLOR))
                f.write(json.dumps({"bid": bid, "pn": r["pn"], "pages_in_plan": len(rows), "klass": k, **feat}) + "\n")
                os.remove(dest)  # classification needs no copy kept
    print("cohort done")


def kraken(img, out):
    env = {**os.environ, "OMP_NUM_THREADS": "3", "MKL_NUM_THREADS": "3"}
    t0 = time.time()
    r = subprocess.run(["timeout", "1800", "nice", "-n", "10", K, "-i", img, out, "segment", "-bl", "-d", "horizontal-rl",
                        "ocr", "-m", MODEL, "--base-dir", "R"], capture_output=True, text=True, env=env)
    return r.returncode, round(time.time() - t0)


def read(W, arms):
    """Lane path: gutter found on the ORIGINAL; the arm image is cut at the same fraction; right part read first."""
    draw = [json.loads(l) for l in open(f"{W}/lib/draw.jsonl")]
    tim = open(f"{W}/lib/timings.jsonl", "a")
    for arm in arms:
        os.makedirs(f"{W}/lib/out/{arm}", exist_ok=True)
        os.makedirs(f"{W}/lib/tmp", exist_ok=True)
        for r in draw:
            stem = f"{r['bid']}-{r['pn']}"
            out = f"{W}/lib/out/{arm}/{stem}.txt"
            if os.path.exists(out) or not os.path.exists(r["img"]):
                continue
            orig = cv2.imread(r["img"], cv2.IMREAD_COLOR)
            gut = GUT.find_gutter(cv2.cvtColor(orig, cv2.COLOR_BGR2GRAY))
            if arm == "base":  # the production downscale alone: isolates the arm from the resize
                res, meta = PP._arms().apply("none", orig)
            else:
                res, meta = PP._arms().apply(arm, orig)
            k, feat = PP.classify(orig)
            parts = []
            if gut:
                cut = round(res.shape[1] * gut["x"])
                parts = [(res[:, cut:], "R"), (res[:, :cut], "L")]
            else:
                parts = [(res, "W")]
            texts, ok, secs = [], True, 0
            for im, tag in parts:
                ip, op = f"{W}/lib/tmp/{stem}.{tag}.jpg", f"{W}/lib/tmp/{stem}.{tag}.txt"
                cv2.imwrite(ip, im, [cv2.IMWRITE_JPEG_QUALITY, 95])
                rc, s = kraken(ip, op)
                secs += s
                ok = ok and rc == 0 and os.path.exists(op)
                texts.append(open(op, encoding="utf-8").read().rstrip() if os.path.exists(op) else "")
                for p in (ip, op):
                    if os.path.exists(p):
                        os.remove(p)
            if ok:
                open(out, "w", encoding="utf-8").write("\n\n".join(texts))
            tim.write(json.dumps({"arm": arm, "stem": stem, "ok": ok, "secs": secs, "gutter": gut, "klass": k, **feat}) + "\n")
            tim.flush()
            print(f"{arm} {stem} ok={ok} {secs}s", flush=True)


SYR = lambda ch: 0x0710 <= ord(ch) <= 0x072F or 0x074D <= ord(ch) <= 0x074F  # letters only (points are stripped by n2)


def tokens(text):
    return [t for t in n2(text or "").split() if any(SYR(c) for c in t)]


def letters(text):
    return sum(1 for c in (text or "") if SYR(c))


def nlines(text):
    return sum(1 for l in (text or "").split("\n") if l.strip())


def lexicon(dirs):
    lex = collections.Counter()
    for d in dirs:
        for p in glob.glob(f"{d}/gt-text/*.txt"):
            lex.update(tokens(open(p, encoding="utf-8").read()))
    return lex


def hit_rate(text, lex, min_count=2):
    t = tokens(text)
    return round(sum(1 for x in t if lex[x] >= min_count) / len(t), 4) if t else None


def validate(W):
    """On round 3 (80 fresh GT pages), does a gain in lexicon hit rate (lexicon from round-1 pages only) track a
    gain in real CER? Reports sign agreement per (set, arm) and overall."""
    lex = lexicon([GT_DIRS["r1"]])
    man = json.load(open(f"{GT_DIRS['r3']}/gt-manifest.json"))
    rows = []
    for m in man:
        ref = open(f"{GT_DIRS['r3']}/gt-text/{m['slug']}.txt", encoding="utf-8").read()
        base_p = f"{R3_OUT}/none/{m['slug']}.txt"
        if not os.path.exists(base_p):
            continue
        base = open(base_p, encoding="utf-8").read()
        for arm in ("flatten", "sauvola", "unsharp", "denoise"):
            p = f"{R3_OUT}/{arm}/{m['slug']}.txt"
            if not os.path.exists(p):
                continue
            h = open(p, encoding="utf-8").read()
            rows.append({"slug": m["slug"], "set": m["set"], "arm": arm,
                         "d_cer": round(line_cer(base, ref, n2) - line_cer(h, ref, n2), 4),  # + = arm better
                         "d_hit": None if hit_rate(h, lex) is None or hit_rate(base, lex) is None else round(hit_rate(h, lex) - hit_rate(base, lex), 4),
                         "d_letters": letters(h) - letters(base)})
    out = {"lexicon_types": len(lex), "cells": {}}
    for key in sorted({(r["set"], r["arm"]) for r in rows}):
        rs = [r for r in rows if (r["set"], r["arm"]) == key and r["d_hit"] is not None and r["d_cer"] != 0]
        agree = sum(1 for r in rs if (r["d_hit"] > 0) == (r["d_cer"] > 0) and r["d_hit"] != 0)
        med = lambda v: sorted(v)[len(v) // 2] if v else None
        out["cells"]["/".join(key)] = {"n": len(rs), "sign_agree": agree, "median_d_cer": med([r["d_cer"] for r in rs]),
                                       "median_d_hit": med([r["d_hit"] for r in rs]),
                                       "d_hit_pos": sum(1 for r in rs if r["d_hit"] > 0), "d_hit_neg": sum(1 for r in rs if r["d_hit"] < 0)}
    allr = [r for r in rows if r["d_hit"] is not None and r["d_cer"] != 0 and r["d_hit"] != 0]
    out["overall_sign_agree"] = f"{sum(1 for r in allr if (r['d_hit'] > 0) == (r['d_cer'] > 0))}/{len(allr)}"
    out["rows"] = rows
    json.dump(out, open(f"{W}/proxy-validation.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, indent=1))


def score(W):
    lex = lexicon([GT_DIRS["r1"], GT_DIRS["r3"]])
    draw = [json.loads(l) for l in open(f"{W}/lib/draw.jsonl")]
    rows = []
    for r in draw:
        stem = f"{r['bid']}-{r['pn']}"
        lane_p = f"{LANE_DIR}/out/{r['bid']}/{r['pn']}.txt"
        texts = {"lane": open(lane_p, encoding="utf-8").read() if os.path.exists(lane_p) else None}
        for arm in ("base", "flatten", "sauvola"):
            p = f"{W}/lib/out/{arm}/{stem}.txt"
            texts[arm] = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        k, feat = PP.classify(cv2.imread(r["img"], cv2.IMREAD_COLOR))
        rows.append({"stem": stem, "bid": r["bid"], "pn": r["pn"], "klass": k, **feat,
                     **{f"{a}_{m}": (fn(t) if t is not None else None) for a, t in texts.items()
                        for m, fn in (("letters", letters), ("lines", nlines), ("hit", lambda x: hit_rate(x, lex)))}})
    json.dump({"lexicon_types": len(lex), "rows": rows}, open(f"{W}/lib-scores.json", "w"), indent=1)
    print(f"scored {len(rows)} pages -> {W}/lib-scores.json")


def report(W, eye_path):
    """Paired tables. LIBRARY: metric = relative change in Syriac letters read against the lane's production read
    (validated as a sign proxy for CER on round 3: `validate`); the floor is the p90 |change| of `base` (the arm's
    own downscale with no transform) against the lane, i.e. what reading a resized copy moves by itself.
    GT: real order-free line CER (N2) of the classifier-routed `auto` arm vs `none`, per stratum, on round 3."""
    P = _load("paired5250", f"{REPO}/scripts/eval/ocr-preprocessing/paired.py")
    eye = json.load(open(eye_path))["labels"]
    sc = json.load(open(f"{W}/lib-scores.json"))["rows"]
    rel = lambda a, l: None if a is None or l is None else (a - l) / max(l, 50)
    by = {arm: {} for arm in ("base", "flatten", "sauvola", "auto")}
    classes = {}
    for i, r in enumerate(sc):
        k = r["stem"]
        classes[k] = {"klass": r["klass"], "eye": eye[str(i)]}
        for arm in ("base", "flatten", "sauvola"):
            by[arm][k] = rel(r.get(f"{arm}_letters"), r.get("lane_letters"))
        pick = PP.ARM_FOR_CLASS[r["klass"]]
        by["auto"][k] = 0.0 if pick == "none" else by[pick][k]
    zero = {k: 0.0 for k in by["base"]}
    floor = P.noise_floor(zero, by["base"])
    lib = {"metric": "relative change in Syriac letters read vs the lane's production read (+ = more read)",
           "floor_from": "base (downscale only) vs lane", "noise_floor": floor, "cells": {},
           "classifier_vs_eye": collections.Counter(f"{c['klass']}|{c['eye']}" for c in classes.values())}
    for grp_name, pred in (("all", lambda c: True), ("eye=clean", lambda c: c["eye"] == "clean"),
                           ("eye=dark", lambda c: c["eye"] == "dark"), ("eye=bilevel", lambda c: c["eye"] == "bilevel"),
                           ("classifier=clean", lambda c: c["klass"] == "clean")):
        keys = [k for k, c in classes.items() if pred(c)]
        for arm in ("flatten", "sauvola", "auto"):
            c = P.paired({k: 0.0 for k in keys}, {k: by[arm][k] for k in keys}, higher_is_better=True, tie_eps=floor["p90_abs"] if floor else 1e-9)
            c["counts"] = P.counts(c, floor)
            lib["cells"][f"{grp_name}/{arm}"] = c
    gt = {"metric": "order-free line CER N2 (lower is better); gain = none - auto", "cells": {}}
    gcls = {json.loads(l)["file"][:-4]: json.loads(l)["klass"] for l in open(f"{W}/gt-classes.jsonl")}
    man = json.load(open(f"{GT_DIRS['r3']}/gt-manifest.json"))
    for st in sorted({m["set"] for m in man}):
        b, a = {}, {}
        for m in man:
            if m["set"] != st:
                continue
            arm = PP.ARM_FOR_CLASS[gcls.get(m["slug"], "unsure")]
            ref = open(f"{GT_DIRS['r3']}/gt-text/{m['slug']}.txt", encoding="utf-8").read()
            pn, pa = f"{R3_OUT}/none/{m['slug']}.txt", f"{R3_OUT}/{arm}/{m['slug']}.txt"
            if not os.path.exists(pn) or not os.path.exists(pa):
                continue
            b[m["slug"]] = line_cer(open(pn, encoding="utf-8").read(), ref, n2)
            a[m["slug"]] = line_cer(open(pa, encoding="utf-8").read(), ref, n2)
        c = P.paired(b, a, higher_is_better=False)
        c["arm_by_class"] = dict(collections.Counter(PP.ARM_FOR_CLASS[gcls.get(k, "unsure")] for k in b))
        c["none_median"] = round(sorted(b.values())[len(b) // 2], 4) if b else None
        c["auto_median"] = round(sorted(a.values())[len(a) // 2], 4) if a else None
        gt["cells"][st] = c
    out = {"library": lib, "gt_auto": gt}
    json.dump(out, open(f"{W}/report.json", "w"), indent=1, default=dict)
    print(json.dumps(out, indent=1, default=dict))


if __name__ == "__main__":
    cmd, W = sys.argv[1], sys.argv[2]
    {"cohort": lambda: cohort(W), "read": lambda: read(W, sys.argv[3:] or ["base", "flatten", "sauvola"]),
     "validate": lambda: validate(W), "score": lambda: score(W), "report": lambda: report(W, sys.argv[3])}[cmd]()
