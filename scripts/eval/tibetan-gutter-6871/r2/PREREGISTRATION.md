# Preregistration, round 2 — Yigdzin page-mode WITH the #4523 write rule, on a fresh draw (#6871 row 4)

Written 2026-10-20, before any round-2 read. PRIOR ART: `../PREREGISTRATION.md` (round 1, same pages frame, same reader) and
`2026-10-20-tibetan-guttered-pages-yigdzin-page-mode-6871.md` (round 1's result: neither arm cleared "0 invented pages").
Round 1 scored every read. A lane does not serve every read: #4523's write rule withholds a page that `first-ocr-guard`
flags or that carries < 150 syllables. Applied **post hoc** to round 1, that rule withheld the one page with a loop and
invented line (111 syllables), and wrote 16 of 30 with none invented. A post-hoc rule decides nothing. This round fixes
the rule in advance and tests it on 30 pages nobody has seen.

## Pages
30 new pages from the 5,132, excluding round 1's 30: page-weighted, at most 2 per book (22 books), LCG seed 68712
(`r2/draw.json`). The structural references are in `r2/references-A/B.jsonl`: two blind Opus readers, body-line counts
agreeing within ±1 on **30/30**. 24 pecha leaves, 6 book pages, 1 blank.

## Arms (one gex45 queue task, `72-tib-gutter-r2`, files only)
- **V**: `yig_vllm.py --mode page`. vLLM 0.31 + `vllm_paddleocr_seqpos` (sequential), greedy, the repo's DRY processor
  0.8/1.75/12. This is the lane candidate: hours, not a week, for 5,132 pages.
- **H**: `yig_page.py --mode page`. HF, as round 1. The parity reference.

## The write rule (fixed now; what a lane would serve)
On each read:
1. strip whole lines that are only the blank-band marker (`empty page`, `ཤོག་སྟོང་།`);
2. run `firstOcrVerdict(text, image)` (`scripts/lib/first-ocr-guard.mjs`): any flag → withheld;
3. fewer than 150 Tibetan syllables → withheld.

The rest is **written**.

## Scoring
An Opus checker sees each V read with the image tiles. It does not know the arm, and does not know whether the page
would be written. Line verdicts are the round-1 labels. **Invented** here means a line carrying ≥ 3 Tibetan syllables
that are not on the page, or a loop line. A punctuation-only insertion, such as a head mark `༄༅།`, is recorded but is
not invention.

## Rule (fixed now)
V **PASSES** only if, over its WRITTEN pages:
1. **0** written pages with an invented line;
2. line recall ≥ **0.95** (reference body lines minus dropped, over reference body lines);
3. ≥ **90 %** of written pages clean: no dropped body line, no loop, ≤ 1 `wrong` line;
4. ok + minor ≥ **0.90** of read lines;
5. **parity**: median syllable SequenceMatcher ratio V vs H ≥ **0.95** over pages with text (`parity.py`).

Reported, not deciding: coverage, the written share of text pages.

- **PASS** → queue the 5,132-page read with V to FILES. Applying it (the #4523 apply path, revisions first) is a
  DECISION for Derek, posted on #6871.
- **V fails only parity** → H is scored the same way; if H passes, the full read runs on HF, slowly (resumable).
- **Anything else** → the pages stay empty and row 4 closes.

n = 30 rules out a high invented rate, not a low one.
