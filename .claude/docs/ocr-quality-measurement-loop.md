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


## The metric does NOT transfer to translation (measured 2026-08-02)

Pointing the corpus builder at `--field=translation` works mechanically and
yields 50,768 pairs. It does not yield a quality signal, and the number should
not be quoted as though it did.

| | median agreement | below 0.85 ("unstable") | carries a printed `<page-num>` |
|---|---|---|---|
| OCR, same-leaf | 0.996 | 9.3% | 60.9% of rows |
| OCR, rescued | 0.973 | 22.0% | — |
| Translation, same-leaf | 0.685 | 89.4% | **2.0% of rows** |
| Translation, rescued | 0.630 | 89.8% | — |

**A threshold calibrated on OCR flags nine tenths of translation pairs**, and a
signal that fires on 90% of a population discriminates nothing. The cause is not
data quality, it is structural: OCR has ONE correct output — the glyphs on the
page — so two passes agreeing is evidence. Translation has MANY correct outputs,
so two passes differing is the expected case.

Read three pairs at the median (0.55–0.72) to check that rather than assume it,
and all three were the same text rendered twice with different wording: Pliny
p353 "is like barley" / "similar to barley", "provided it is held" / "so that it
is held"; Amuli p760 "similar to matter pus" / "resembles pus". Paraphrase
variance, not error.

But not *only* that — `songwonnok-yi` p103 renders one office as "Military
officer and attendant" against "Official of Sacrificial Meats", and a career note
as "Passed exam" against "Successor". Those are real disagreements about meaning,
sitting at the same agreement score as pure synonym choice. **Word-level
Levenshtein cannot separate them**, which is exactly why the lexical metric fails
here rather than merely being noisy.

A translation-quality signal therefore needs a SEMANTIC comparison (embedding
cosine between the two renderings, flagging low-similarity pairs) rather than a
lexical one. The embedding infrastructure already exists — `page_translations` in
Supabase, see `.claude/docs/embeddings.md`. Not built; scoped here so the next
attempt does not start by re-running the lexical metric and re-discovering this.

**The `2.0%` column is also why translation was never measurable before.** The
printed page number is transcribed by the OCR pass; a translation does not carry
it. So `leaf_shift` is null on 98% of translation rows and the same-leaf filter
reduced 130,049 rows to **331** usable pairs. The `source` label is the only
mechanism filter that functions on this field at all.

## Re-reading the page: the one direct test, and what it cost to get right

`scripts/eval/reocr-pairing-check.mjs` (2026-08-03/04, $0.78 total). Every other
instrument answers "does this text describe this image?" indirectly. This one
reads the image again and compares. Two arms: SUSPECT (`archive_metadata.
archived_at > ocr.updated_at`) against CONTROL.

**The first run was void, and it looked like the best result of the week.** It
reported 86% of suspect pages mispaired against 16.6% of control — a clean 5×
separation that survived stratification by prompt and by model. Two errors, both
invisible in the aggregate:

- **Wrong metric for the material.** Word-level agreement on space-less scripts,
  which this repo has always documented as invalid. The tell was inside the run:
  61.1% of *control* space-less pages — never re-archived — also scored
  "mispaired".
- **Arms not comparable.** Suspect was 76% Tibetan, control 7%, because the
  May-2026 re-archiving campaign targeted the Tibetan collections. "Re-archived
  after OCR" was very nearly a proxy for "is a Tibetan manuscript".

Fixed by routing through `agreementPrimary` (characters on space-less scripts)
and frequency-matching the arms on language. Re-run:

| script class | suspect (median / mispaired) | control |
|---|---|---|
| spaced | 0.593 / 35.9% | 0.793 / 15.5% |
| space-less | 0.212 / 88.9% | 0.225 / **70.4%** |

**Two different answers.** On space-less scripts there is *no* signal — the arms
are indistinguishable and both are terrible, because a re-read of a Tibetan
manuscript diverges from the stored text whether or not anything changed. That
70.4% control figure is the honest statement of a measurement limit: this
question cannot be answered by re-reading on that material.

On spaced scripts a ~2.3× gap survives language matching, the corrected metric,
and within-prompt stratification (prompt 12: 87.1% against 15.0%). So
re-archiving after OCR does look associated with text that no longer matches its
scan — **modestly, not catastrophically**, and the honest headline is 2.3× rather
than the 5× the broken run produced.

**One confound remains, and it is structural.** "Re-archived after OCR" entails
*older* OCR, hence an older prompt, while the re-read uses the current one —
which is also why control sits at 15.5% rather than near zero. Stratifying by
stored prompt only partly controls it. Settling it means re-reading each page
with **its own** prompt version (the `prompts` collection stores them); until
that runs, treat the 2.3× as suggestive, not established.

## What the loop actually measured: instability by language

The point of the metric, finally pointed at the question it was built for. True
repeats only — same leaf, same model, same prompt, maintenance rows excluded —
from `revision-agreement-corpus-2026-08-02.jsonl`. Free, already computed.

| language | n | median | unstable (<0.85) | bad (<0.5) |
|---|---|---|---|---|
| English | 13,102 | 1.000 | 2.3% | 0.3% |
| German | 19,081 | 0.998 | 4.4% | 0.4% |
| French | 3,961 | 0.997 | 8.0% | 0.1% |
| Latin | 17,114 | 0.982 | 15.5% | 0.9% |
| Italian | 391 | 0.963 | 22.8% | 0.3% |
| Greek | 2,516 | 0.983 | 23.3% | **7.8%** |
| Arabic | 243 | 0.793 | **59.7%** | **12.3%** |
| Persian | 274 | 0.808 | **70.1%** | 5.1% |

**Arabic and Persian are an order of magnitude less stable than English or
German.** Greek looks fine by median and has the second-worst outright-failure
rate — a reminder to read more than one column.

**This corrects a framing error made one message earlier.** The re-OCR pairing
run (above) found 70.4% of *untouched* space-less control pages scoring as
"mispaired", and that was written off as "the instrument does not work on this
material". Wrong: for the PAIRING question a high baseline does destroy the
signal, but instability *is* the quality measurement, so the same number is a
finding rather than a failure. Two questions, one metric, opposite readings —
name which one you are asking before interpreting the number.

**And the corpus cannot answer it for Tibetan.** There are only **82 space-less
true-repeat pairs** in all 61,640: those pages are rarely read twice under one
model and prompt, and many are filtered as degenerate loops. So the paid re-OCR
run — 81 pages per arm, prompt drift and all — is the *better* Tibetan evidence,
not the discarded one. Where a free corpus is thin, a small paid probe is not a
second-best.

Caveats. These are **stability, not accuracy**: a model that is consistently
wrong scores perfectly (see the memorisation result). And Latin's 15.5% against
German's 4.4% may be **material rather than language** — Latin holdings skew
older and harder — which this cut cannot separate without matching on year and
scan quality.

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
| pairing check: "86% of re-archived pages mispaired" | 2.3x on spaced scripts, no signal on space-less | word metric on Tibetan + arms 76% vs 7% Tibetan |

Every one was a plausible aggregate over a broken instrument, and none would
have been caught by a green test. That is the argument for keeping the metric
free and re-runnable: cheap measurement is what makes it affordable to check
yourself before publishing a number.
