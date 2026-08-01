# Measuring OCR quality, and measurably improving it

2026-08-01 (#3473). The point of this file is the loop, not any one fix: a
metric that can be computed for free, a named defect, an intervention, and a
re-measurement that can come back negative.

## The measurement

**Quality signal:** two passes of the same model, same prompt, over the same
leaf, disagreeing. 63,572 such pairs already exist in `page_revisions` at zero
marginal cost. Isolating them requires removing pairs that read *different*
leaves — 40% of the raw corpus, and **not re-reading** (#3473). Those rows say so
themselves: `page_revisions.source = 'shift-repair-erara-2026-07'` is 29.5% of
the collection and 99% leaf-shifted. It is the #3357 shift *repair* moving `ocr`
subdocuments between page docs — the image never changed and the text did, the
opposite of re-archiving. Filter on `source`; see below.

It measures **stability**, not accuracy, and the distinction is load-bearing:
two passes that both recite the same memorised canonical text agree perfectly.
Stability is necessary, not sufficient. Accuracy needs reference text, which
exists for 32 pages and spans only 92.3–100% — too narrow to fit anything
against (`calibration-scorecard`).

**Triage:** `scripts/eval/ocr-triage.mjs` ranks unstable pages into buckets that
say *why* each surfaced. Sharpest signal is the model's own `<unclear>` marks —
3.97 per unstable page against 0.02 per stable one.

## A worked example: the plate/text specification gap

**The defect.** The OCR prompt says both "Capture ALL text including margins and
annotations" (rule 6) and "Describe any illustrations… with `<image-desc>`"
(rule 7). It never says which governs text printed *inside* a figure — the label
letters on an engraving, the numerals on a diagram. Both readings are defensible,
so two passes decide differently and the transcription swings from a few hundred
words to zero.

Verified on the image: Schott, *Mechanica Hydraulico-Pneumatica* p513 — a
full-page engraving of a hydraulic organ, captioned "Iconismus XXXIX. pag: 408",
with labels V, X, Y, T, S, R, M, N, O, Q, L, P, H, A, F, Z and numerals 1–8
across the figure, no prose anywhere. One pass transcribed 231 words of caption
and labels; the other emitted an `<image-desc>` and stopped. Agreement 0.004.
**Neither pass is wrong** — nothing decides the question.

**The baseline, and the correction that matters more.**
`scripts/eval/plate-flip-rate.mjs` measures it: among same-leaf true repeats
where the page carries an `<image-desc>`, the share where one side produced ≥40
body words and the other exactly 0.

```
illustrated same-leaf pairs sampled : 893
both sides zero (pure plate, agreed) :  13
PLATE-FLIP RATE                      : 3/893 = 0.34%
```

**0.34%, not 30%.** An earlier claim that fixing this "addresses 30% of the
unstable population" was wrong, and wrong in the same way three other claims in
this work were: 30.4% is the share of *unstable pages that carry an
illustration* — a co-occurrence — while the flip itself is 0.34% of *illustrated
pages*. Reading a bucket's size as an effect size substitutes one denominator
for another. The number that sizes an intervention is the rate of the defect in
the population the intervention touches, and it has to be computed before the
work is scheduled, not after.

## The proposed intervention

Not applied. A prompt edit changes every future OCR call, and a 0.34% defect
does not justify shipping unmeasured — that is the decision the baseline exists
to inform.

Add to the OCR prompts (`src/lib/types/prompt.ts`; the clause is language-neutral
and belongs in all five prompt families, not just Latin):

> **Text printed inside an illustration.** Label letters, numerals, and keys
> placed on or within a figure are part of the figure, NOT body text. List them
> inside the `<image-desc>` and do not transcribe them into the body. A caption
> printed *beneath* a figure IS body text. A page whose only marks are a figure
> and its labels therefore has NO body text — return the `<image-desc>` alone.

It resolves the ambiguity in the direction that makes the *stable* answer also
the *correct* one: a plate has no body text, so both passes return zero.

## How the improvement would be shown

1. **Baseline** — 0.34% on 893 illustrated pairs, above. Free, re-runnable.
2. **Hold out** the flip pages plus a matched control of illustrated pages that
   did *not* flip. Without the control, any change in the rate could be the
   population rather than the prompt.
3. **Re-OCR both arms twice** under the new prompt, same model, same temperature
   (production is **0.1** — at 0 the model is a deterministic fixed point and
   repeats measure nothing, so a harness defaulting to 0 will show a spurious
   perfect result).
4. **Re-measure the same rate.** It moves or the change did nothing.
5. **Check the control did not get worse** — a clause that suppresses figure
   labels could suppress real captions. The failure mode of this fix is
   over-application, so the control arm is where it would show.

Cost is a few hundred pages of paid OCR. **Not run — it needs a spend decision,
and at 0.34% the honest recommendation is to bundle it with the next prompt
revision rather than fund a run of its own.**

## Check whether the fact is stored before building an instrument to infer it

The most expensive mistake in this work was not a wrong number. It was spending
an audit inferring something the database already recorded.

`page_revisions.source` labels the mechanism of every row, and the label is
near-perfectly diagnostic against the independent printed-number instrument
(`scripts/audit/ocr-revision-provenance.mjs`, free, ~2 min):

```
source                        share of 191,221    numbered pairs leaf-shifted
batch_api                              57.5%                 3.8%
shift-repair-erara-2026-07             29.5%                99.0%   (89.9% +1)
pipeline_preview                        6.8%                 0.8%
ai                                      4.5%                 0%
```

The whole ±1 population that #3473 characterised by sampling, page-number
arithmetic, per-book offset signatures and finally two scans opened by hand is
just the rows that say `shift-repair-erara-2026-07`. And because the label does
not depend on the page having printed a number, it reaches the stratum the
instrument cannot: **21.5% of pairs printing no number are shift-repair rows**,
about 13,000 of the ~60,500 that had been written off as unmeasurable.

**The near-miss worth recording.** Before finding `source`, this section argued
the opposite conclusion — that no clock could order these pairs, so mechanism
claims needed the image. That came from testing one field (`created_at`, a
*snapshot* clock: it records when the row was written, so the live
`ocr.updated_at` is older on 84.4% of pairs and 90% of pairs whose model
demonstrably changed) and generalising from it to the category. Two fields over
were `original_date` — present on 91.8% of rows, and on proven re-OCRs it
precedes the live `ocr.updated_at` **99.3%** of the time — and `job_id`, on 57%.
One field failing is not the category failing, and "I could not find it" is a
claim about the search, not about the data.

The corpus itself is unaffected: requiring equal printed numbers on both sides
already drops ~99% of shift-repair rows, leaving ~0.3% residual in the 63,572.
But `source` is categorical and complete where the page number is neither, so
future selection should filter on it and keep the page number as the independent
check *on* it rather than as the primary.


## Why the loop matters more than the fix

Five claims in this work were wrong and each was caught by the same move —
opening the artifact instead of reading the aggregate:

| claim | reality | how it failed |
|---|---|---|
| catchword chain at 1–3% | intact; the test kept envelope prose | naive tag-strip |
| 15 independent difficulty categories | one category; 95% name a hand | 15 regexes over one sentence |
| "passes disagree on column count", 8.4× | 588/600 are a tag on one side only | field name read as its contents |
| plate fix "addresses 30%" | 0.34% of illustrated pages | bucket size read as effect size |
| inverted timestamp proves a text move | 90% of proven re-OCRs invert too | signal never checked against a control cohort |
| "no clock can classify these rows" | `source` labels every row; `original_date` orders 99.3% | one field's failure generalised to the category |

Every one was a plausible aggregate over a broken instrument, and none would
have been caught by a green test. That is the argument for keeping the metric
free and re-runnable: cheap measurement is what makes it affordable to check
yourself before publishing a number.
