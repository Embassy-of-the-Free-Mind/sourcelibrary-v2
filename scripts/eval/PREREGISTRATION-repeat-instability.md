# Preregistration — does repeat-OCR instability track page difficulty?

Written before drawing the sample. #3473 / #3469.

## The claim under test

`page_revisions` contains **63,572 pairs where the same model, running the same
prompt, read the same leaf twice.** 10.8% of them disagree at <0.85 agreement,
and 93.2% of that tail carries none of the known junk flags (degenerate loops,
refusals, commentary-as-transcription, near-zero overlap). So it is not model
failure — it is instability on ordinary pages.

**H1: pages in the unstable tail are visibly harder to read than pages the same
book transcribed stably.**

If H1 holds, repeat instability is a usable page-quality signal and can drive
worst-first re-OCR queues, per-book quality flags, and reader-facing confidence
— none of which need an accuracy number.

If H1 fails, disagreement is measuring something other than legibility
(transcription-policy variance, layout ambiguity, annotation churn), and it
should not be sold as quality.

## Why this design, and not a calibration

The obvious study — score tail pages against reference text — cannot be run.
The 32-page anchor set exists *because* those passages have machine-readable
reference editions; early-modern Latin and German prose does not. The anchor set
also spans only 92.3–100% accuracy, so it cannot speak about hard pages at all.

This design therefore tests the **ordinal** claim, which is the deployable one,
and needs no ground truth.

## Sampling

- Population: eligible pairs, `leaf_shift === false` (same leaf — a shifted pair
  compares two different images and its disagreement is re-archiving, #3473),
  same model on both sides, same prompt on both sides.
  > **Amendment, 2026-08-01 (rationale only — the rule is unchanged).** The
  > parenthetical is wrong about the mechanism: the dominant ±1 slice is the
  > #3357 *repair* moving `ocr` subdocuments between page docs, so the text moved
  > and the image did not. `leaf_shift === false` still excludes exactly the same
  > pairs for the same reason (the two sides do not describe one leaf), so no
  > result changes. Recorded here rather than edited away, because a
  > preregistration that is quietly rewritten stops being one.
- Excluded: any pair flagged `prior_degenerate`, `current_degenerate`,
  `prior_refusal`, `current_refusal`, `prior_meta`, `current_meta`, or
  `near_zero_overlap`. Those are model failures, and including them would let
  the study confirm H1 for the wrong reason.
- **Matched WITHIN BOOK.** Each pair contributes one UNSTABLE page (<0.85) and
  one STABLE page (≥0.97) from the same book. This holds typeface, scan source,
  language, era, and digitisation pipeline constant by construction, so a
  difference cannot be "Latin is harder" or "1580 scans are worse".
- Both pages must carry ≥80 body words on both sides, so neither arm is a
  near-blank.

## Blinding

The sampler writes images to opaque filenames (`page-01-A`, `page-01-B`) with
arm assignment randomised per pair, and writes the key to a SEPARATE file. The
judge records a verdict for every pair before the key is opened. Committing the
verdicts to disk first is what makes this a test rather than an impression.

## Judgement

For each pair, looking only at the two images: **which page is harder to read?**
(A / B / indistinguishable), plus a reason from a fixed list — faint or uneven
ink, bleed-through, stain or damage, tight or worn type, complex layout
(columns/tables/marginalia), heavy abbreviation, non-Latin script, none
apparent.

## Prediction, stated now

- **Supports H1:** unstable page judged harder in **≥70%** of decided pairs.
- **Refutes H1:** **≤55%** — indistinguishable from the 50% coin flip.
- **Ambiguous:** in between; report as such and do not deploy the signal on it.

Sign test on decided pairs (ties dropped). n=12 pairs: 11/12 gives p≈0.006,
10/12 p≈0.019, 9/12 p≈0.073. A pilot this size can therefore establish a strong
effect but cannot rule out a weak one — if the result lands ambiguous, the
answer is a larger draw, not a softer reading of this one.

## Known limitations, recorded before seeing results

1. **The judge is an LLM reading the image.** It may find hard precisely what
   Gemini found hard, for shared reasons. That inflates agreement with H1
   without proving human-visible difficulty. A human pass on the same blinded
   manifest is the fix, and this design leaves the manifest ready for one.
2. **Blind to fabrication.** Two passes reciting the same memorized canonical
   text agree perfectly and never enter the tail. This signal finds unstable
   pages, not wrong ones — on canonical material those are different sets
   (see `/blog/reciting-not-reading`).
3. **"Stable" is not "correct."** The stable arm is only pages the model
   transcribed *consistently*; consistency is what is being validated, so the
   control arm cannot be assumed accurate.
4. Within-book matching costs generality: books with both arms present are
   partly digitised sources, and single-condition books are unrepresented.
