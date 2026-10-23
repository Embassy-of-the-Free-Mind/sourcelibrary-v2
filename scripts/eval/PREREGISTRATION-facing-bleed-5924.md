# Preregistration — removing facing-page bleed from Latin print OCR (#5924)

PRIOR ART: `scripts/eval/PREREGISTRATION-longs-prompt-5924.md` (the 99 references, the scorer, the L0/L0b live-prompt
reads, all reused unchanged); `scripts/eval/latin-repair-census-5924/detectors.mjs` (PR #7173: `marginStrip`, the
text-only bleed detector, reused as the fragment test); `scripts/lib/gutter-detect.mjs` (the transitions-per-column
text profile, reimplemented for the outer edges because its search window is the central 30–70%). None removes the
strip, and none measures what removal does to CER.

Committed on `job-spotcheck-improve-1022` on 2026-10-22, **before any fix was scored against a reference**. The by-eye
labels of which reference images show a facing strip, and which reads carry its text, are made first and blind to
any fix's output.

**Question.** On #7171's blind read, text from the facing page's edge strip (p8: the next page's line-starts read as a
second column and looped; p30: 27 side-notes on a page that has none) was a bigger problem than long s. Does a cheap
fix remove it without harming clean pages? Two fixes:

- **(a) text-only, $0.** On a stored read, delete (i) the census margin-strip fragments when `marginStripFires`, (ii)
  a `<column-break/>` tail on a page whose image the edge detector says is one leaf plus a strip, and (iii) `<margin>`
  notes whose letters match the neighbour page's stored OCR (≥ 60% of 4-grams) — the facing leaf's own side-notes.
  Applied to the stored L0 reads of all 99 references. No model call.
- **(b) crop to the leaf, then re-read.** An outer-edge detector (text block, a non-text gap, a narrow text strip ≤ 20%
  of the width at the image edge) crops the strip off; only pages where it fires are re-read with the live prompt
  (`longs-prompt-arm.mjs --arm L0`, flash-lite, temperature 0, metered through `gemini-script-client.mjs`). Cap $1.

**Ground truth (made first).** An Opus reader opens each of the 99 reference images and the L0 read, and labels:
strip visible (side, approx. width, text in it), and strip text in the read (yes / no, where). `S` = pages whose L0
read carries strip text. `C` = all other pages.

**Scorer.** `latin-bakeoff-5924/score.mjs`, deciding CER (view N, order-tolerant), unchanged. Noise floor per page =
|CER(L0) − CER(L0b)|.

**The bar, per fix (all four must hold to call it "works"):**
1. **Fixes:** on `S`, ≥ 2/3 of pages improve by ≥ 0.01 CER, and the median ΔCER on `S` < 0.
2. **No harm:** on `C`, no page worsens by > 0.01 CER (for (b), > max(0.01, that page's noise floor)).
3. **Firing precision:** the fix fires on ≤ 3 pages of `C` (for (a): changes the text at all; for (b): crops).
4. **By eye, 10 pages** (all of `S` it touched, then pages of `C` it touched, then random, up to 10): image vs fixed
   text, judged fixed / unchanged / harmed. **Harmed = 0.**

Report the 99-page median CER before/after as context only; it is not the bar (bleed is on a few pages, so the median
will not move). If `S` has fewer than 3 pages, the 99 references cannot decide the fix: say so, and decide on the
36-page spot check and census pages by eye only.

**Not done here.** No fix is applied to `pages`; applying one rewrites `ocr.data` and triggers gap-fill retranslation
(a separate decision). No prompt change.
