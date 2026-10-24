#!/usr/bin/env python3
# parity.py — does the vLLM read match the HF read it replaces? Median syllable identity over shared pages (#6871 row 4).
# PRIOR ART: scripts/eval/tibetan-proofread/score.mjs (syllables + NW identity, ported from kanjur_align.py); this is
# the same tokeniser with difflib matching, so it runs on the GPU box with no node checkout. Exit 0 = parity, 3 = not.
import difflib, glob, os, re, statistics, sys
PUNCT = re.compile(r"[༁-༊།-༗༚-༟༺-༽྾-࿏\s]+")
syl = lambda t: [s for s in PUNCT.sub("་", t).split("་") if s]
a_dir, b_dir, bar = sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.95
ids = [os.path.basename(f)[:-4] for f in glob.glob(f"{a_dir}/*.txt") if os.path.exists(f"{b_dir}/{os.path.basename(f)}")]
scores = []
for i in ids:
    a, b = syl(open(f"{a_dir}/{i}.txt").read()), syl(open(f"{b_dir}/{i}.txt").read())
    if len(a) < 20 and len(b) < 20:
        continue  # blank leaf on both sides
    scores.append(difflib.SequenceMatcher(None, a, b, autojunk=False).ratio())
med = statistics.median(scores) if scores else 0
print(f"parity {a_dir} vs {b_dir}: pages {len(scores)} median {med:.3f} min {min(scores, default=0):.3f} bar {bar}")
sys.exit(0 if scores and med >= bar else 3)
