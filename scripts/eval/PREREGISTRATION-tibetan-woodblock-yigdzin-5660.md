# Preregistration — Yigdzin on Tibetan WOODBLOCK prints, 30-book canary (#5660, job gpu-backlog-5660)

Written 2026-10-06 before any page below was read.

## Why

Yigdzin (BDRC/tibetan-ocr @ 50506eb6, the #4523 adopted reader) has a referenced measurement on **manuscripts only**:
British Library Kangyur manuscripts vs the Derge e-text, median syllable identity 0.947 (100 books, 2026-10-01).
About 40K of the 51K Tibetan pages owed first OCR are in books classed `printed` (block prints). The job brief
says: a class with no referenced measurement gets a 30-book canary against the Derge e-text before it scales.

## Pages

30 Derge Kangyur print volumes from our library (`book_class.class = printed`, title "Derge Kangyur", 77 volumes),
one random text page per volume (page > 10, not blank/spread/illustration, not the last 5 pages), `makeRng(56604)`.
Draw: `/root/gpu-backlog-5660/bo/canary-wb/todo.jsonl`. Images: our archived JPEGs (R2), as the lane would read them.

## Arm and instrument

The yigdzin-527 recipe unchanged: `yig_leaf_worker.py --mode partition --batch 128`, vLLM 0.29.0 + seqpos plugin,
then `judge.py`'s v4 absolute rule (empty reference). Scored with `/root/tibetan-eval/kanjur_align.py score`
(Needleman-Wunsch syllable identity vs the Derge Kangyur e-text, OpenPecha P000001, `etext-index-full.pkl`),
plus `--control-shuffle` for the chance floor. `measure: accuracy`.

## Rule (fixed now)

PASS, and woodblock books join the lane, only if ALL hold:
1. instrument valid: median identity − shuffle-floor median ≥ 0.20;
2. median syllable identity ≥ **0.90** over pages the judge serves (the manuscript figure 0.947, less a margin for edition differences);
3. no fabricated page: no served page with a line of Devanagari or another non-Tibetan script, and none in the
   by-eye read of 10 of the 30 (page image opened, text read against it, labelled `read-from-image`) whose text is not on the leaf.

FAIL → woodblock books stay out of the lane; the result and the page list are posted on #5660.
