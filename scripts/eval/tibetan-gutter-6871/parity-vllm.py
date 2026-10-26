#!/usr/bin/env python3
# parity-vllm.py — does the vLLM 0.29 Yigdzin read match the HF read it would replace? (#6871, job yig-vllm-6871)
# PRIOR ART: parity.py (this directory): median SYLLABLE identity, exit 0/3. The bar posted on #6871 for this job is
# CHARACTER similarity >= 0.95 on each set plus "no line vLLM adds that HF lacks", so this keeps parity.py's tokeniser
# for a second column and adds the character ratio and an added-line finder; parity.py stays as it was for 72/73.
#
#   python3 parity-vllm.py HF_DIR VLLM_DIR [--out per-item.jsonl] [--bar 0.95]
# Compares every <id>.txt present in both dirs. Whitespace is dropped for the character ratio (line breaks are
# layout, not text). An "added line" = a vLLM line of >= 10 characters whose best match against any HF line (or two
# adjacent HF lines joined, for a split line) is below 0.5. "Dropped" is the same test the other way.
import argparse, difflib, glob, json, os, re, statistics, sys

PUNCT = re.compile(r"[༁-༊།-༗༚-༟༺-༽྾-࿏\s]+")
syl = lambda t: [s for s in PUNCT.sub("་", t).split("་") if s]
squash = lambda t: re.sub(r"\s+", "", t)
lines = lambda t: [l.strip() for l in t.splitlines() if len(l.strip()) >= 10]


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def unmatched(src, dst):
    pool = lines(dst)
    pool += [pool[i] + pool[i + 1] for i in range(len(pool) - 1)]
    return [l for l in lines(src) if max((ratio(l, p) for p in pool), default=0) < 0.5]


ap = argparse.ArgumentParser()
ap.add_argument("hf"); ap.add_argument("vl")
ap.add_argument("--out", default="")
ap.add_argument("--bar", type=float, default=0.95)
a = ap.parse_args()
ids = sorted(os.path.basename(f)[:-4] for f in glob.glob(f"{a.hf}/*.txt") if os.path.exists(f"{a.vl}/{os.path.basename(f)}"))
rows = []
for i in ids:
    h, v = open(f"{a.hf}/{i}.txt").read(), open(f"{a.vl}/{i}.txt").read()
    sh, sv = syl(h), syl(v)
    if len(sh) < 20 and len(sv) < 20:
        rows.append({"id": i, "blank_both": True}); continue
    rows.append({"id": i, "char": round(ratio(squash(h), squash(v)), 4), "syl": round(ratio(sh, sv), 4),
                 "hf_chars": len(squash(h)), "vl_chars": len(squash(v)), "hf_lines": len(lines(h)), "vl_lines": len(lines(v)),
                 "added": unmatched(v, h), "dropped": unmatched(h, v)})
sc = [r for r in rows if not r.get("blank_both")]
med = statistics.median(r["char"] for r in sc) if sc else 0
summ = {"hf": a.hf, "vllm": a.vl, "compared": len(rows), "blank_both": len(rows) - len(sc), "scored": len(sc),
        "median_char": round(med, 4), "median_syl": round(statistics.median(r["syl"] for r in sc), 4) if sc else 0,
        "min_char": min((r["char"] for r in sc), default=0), "ge_095": sum(r["char"] >= 0.95 for r in sc),
        "items_with_added": sum(bool(r["added"]) for r in sc), "added_lines": sum(len(r["added"]) for r in sc),
        "items_with_dropped": sum(bool(r["dropped"]) for r in sc), "dropped_lines": sum(len(r["dropped"]) for r in sc),
        "bar": a.bar, "median_pass": bool(sc) and med >= a.bar}
if a.out:
    with open(a.out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(json.dumps(summ))
sys.exit(0 if summ["median_pass"] else 3)
