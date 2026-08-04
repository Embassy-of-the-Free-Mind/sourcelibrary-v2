# OCR span-provenance, fabrication, and what the revision corpus actually is — 2026-07-30

_One session, started from a reader report. Shipped two fixes, published one blog post, and
ended by discovering that a corpus we build methodology on is not what it appears to be.
Written so the open threads can be picked up cold._

## What shipped (done, verified, merged)

1. **#3437 — the Notes toggle deleted transcribed text.** `<insert>` (map cartouche labels) was
   classified as AI commentary, so hiding commentary hid the page. 26 pages across 16 books in a
   3,000-page sample of at-risk types would have gone blank. Guard:
   `tests/unit/notes-toggle-page-marks.test.ts`. Deployed to prod.
2. **#3450 — editorial wrappers with ATTRIBUTES were not stripped.** `<image-desc size="…"
   type="…">` appears on **0.77% of page-fields**; the strip patterns matched only a bare `<tag>`,
   so the AI's plate description survived into quotable text while the generic tag-strip removed
   its *closing* tag. The #2232 misquote class, live, on every snippet and quote surface. Fixed in
   both twins. Guard: `tests/unit/editorial-wrapper-attributes.test.ts`. **Merged, NOT yet
   deployed to prod** — see "next actions".
3. **`/blog/reciting-not-reading`** — the fabrication negative result, published.

## The finding that needs finishing

**The `page_revisions` corpus is substantially a record of RE-ARCHIVING, not of double OCR.**

Spot-checking Latin revision pairs, three causes of disagreement appeared, none of them legibility:

| cause | example |
|---|---|
| **the image changed** | p525: old OCR reads `505 De affectibus`, new reads `469 Aegyptia. Latina. Arabica.` — different books entirely |
| truncation | p518, p124: old pass transcribed one column (156 words) vs new (661) |
| normalization convention | `nūc`→`nunc`, `q;`→`que`, `&`→`et` |

Comparing `<page-num>` on both sides of each pair, one book showed a **constant offset of 36 running
consecutively** (505→469, 504→468, 503→467 …). That is the #3368 leaf-offset signature: the scan
slid under its text.

**Why it matters beyond data integrity:** `calibration-scorecard.mjs` (#3336) fits agreement→accuracy
on 32 anchor pages and applies it to all 109,953 revision pairs to produce corpus-wide accuracy
bands. If a large share of those pairs are *image changes* rather than *re-readings*, those bands
measure something other than what they claim. The scorecard already carries a caveat that pairs are
"within-Gemini-family transitions, not independent readings" — this is a stronger version of that
caveat and it is not currently stated anywhere.

It also explains the puzzle that started the investigation: agreement predicts accuracy weakly
(63 points of agreement range → ~5 points of accuracy) because agreement is substantially measuring
image stability, not legibility.

### MEASURED 2026-07-30 — `scripts/audit/revision-image-shift.mjs` (issue #3473)

Randomized sample, n=3,339 pairs carrying a printed page number on both sides:

```
identical page number : 1997 (59.8%)
DIFFERENT             : 1342 (40.2%)   <- did not read the same leaf
```

Of 366 books with >=3 comparable pairs: **112 shift on >50% of pairs, 88 of those
SYSTEMATICALLY** (one offset explains >=80% of the book's shifts). The dominant
offset is almost always **exactly +1** — the #3368 / #3357 leaf-offset signature.

**CONFIRMED REPAIR, verified against the images.** Two pages of a systematically
shifted e-rara book (*Kabbala denudata*) checked against their scans: image `49.jpg`
shows printed **5** (current OCR `5` correct, revision `4` wrong); `55.jpg` shows
**11** (current `11` correct, revision `10` wrong). The live data is right.

**Mechanism.** #3357 is recorded as "323 text-shifted back": the sweep moved
existing `ocr` subdocuments between pages rather than re-transcribing, so page 49
inherited page 50's object, while `page_revisions` snapshotted the displaced text
in July. So the ±1 slice is ONE administrative event replicated across thousands
of pages, not thousands of independent re-readings.

> **CORRECTION, 2026-08-01 — the mechanism was a stored field the whole time.**
> `page_revisions.source` labels every row outright, and the label is
> near-perfectly diagnostic against the independent printed-number instrument:
>
> | source | share of 191,221 | numbered pairs leaf-shifted |
> |---|---|---|
> | `batch_api` | 57.5% | 3.8% |
> | `shift-repair-erara-2026-07` | **29.5%** | **99.0%** (89.9% of them +1) |
> | `pipeline_preview` | 6.8% | 0.8% |
> | `ai` | 4.5% | 0% |
>
> So the ±1 population is simply the rows that already say
> `shift-repair-erara-2026-07`. No inference, no images, no clock needed — and
> the label also covers the stratum the printed number cannot see: **21.5% of
> pairs printing no number are shift-repair rows**, roughly 13,000 of the ~60,500
> previously written off as unmeasurable.
>
> The original timestamp argument here was still unsound, but for a narrower
> reason than first published. `created_at` is a **snapshot** clock — it records
> when the row was written, so it is later than the live `ocr.updated_at` on
> 84.4% of pairs, including 90% of pairs whose model demonstrably changed.
> Inversion against it means nothing. What is *not* true is the sweeping version
> this file briefly carried ("no clock can order a pair", "`ocr.updated_at` is not
> maintained"): `page_revisions.original_date` exists on 91.8% of rows and orders
> correctly — on proven re-OCRs it precedes the live `ocr.updated_at` **99.3%** of
> the time. One field failing is not the category failing.
>
> Re-run: `node scripts/audit/ocr-revision-provenance.mjs` (free, ~2 min).

**Corollary for the corpus filter.** `source` is categorical and complete where
the printed page number is neither, so it is the better exclusion. The published
same-leaf figures are unaffected — requiring equal printed numbers on both sides
already drops ~99% of shift-repair rows, leaving ~0.3% residual — but any future
selection should filter on `source` and keep the page number as the independent
check on it, not as the primary.

**Do not quote 87.3%.** A first attempt sorted `_id` desc, landed inside one
affected book, and produced that number. Use `$sample`.

Still open:
- Confirm repair-vs-damage from archive history.
- Re-fit `calibration-scorecard.mjs` **excluding pairs whose page numbers disagree**,
  and compare the bands. That filter is cheap and available.
- #3469 mining must exclude shifted pairs first, or "hard pages" will mostly be
  re-archived ones.

## What was tried and FAILED — do not repeat

Four prompt interventions, all fabricating masked canonical text (Genesis 1:2 through an opaque box):

| attempt | result |
|---|---|
| production baseline | fabricated |
| + open "is anything hard to read?" | fabricated |
| + REQUIRED `<legibility>` field | fabricated, and reported `clean` on 4/5 masked pages |
| + inline marker with explicit anti-fabrication language | fabricated 6/6, marker unused |

**Why:** each asks the model to report a state it cannot observe — it has no signal separating
*I read this* from *I completed this*. A fifth wording is not the answer. See #3444 Tier 3.

**What DID work, and is not a prompt:** mask *geometry*. Diamond (text visible at both edges of
every line) → 4/4 marked the gap with spontaneous `[...]`. Rect and bowtie, same 50% coverage →
0/4. Not deployable (we can't reshape real damage) but it is a method contribution for membership
inference.

**Tier 1 prompt change has evidence:** regrouping annotations by provenance eliminated untagged AI
prose on the atlas pages — 9 spans across 6 production runs → **0**, and labels correctly attributed
6/6 vs 0/6. Two pages, one model: an existence proof, not a consistency result. #3469 exists to
make the consistency half possible.

## Methodology warnings earned the hard way

**Four instrument failures in one session, each producing plausible numbers:**

1. The "1 of 28 runs mentioned the mask" baseline — that experiment ran a prompt saying *"output
   only the raw text, no commentary."* We measured our own instructions and built three issues on it.
2. Probe regexes invented rather than taken from the source (`Albanique patres` for a masked region
   that didn't contain it).
3. `tenebrae?` failing to match the `æ` ligature — reported 0/12 where the truth was 8/12.
4. A long-s classifier firing on glyph *presence* rather than difference, reporting `eſt → hunc` as
   a long-s confusion.

**Rules that follow:**
- Verify every outcome regex against emitted text before trusting a count.
- Read the actual output before interpreting an aggregate. Every one of the above survived until
  someone looked at the text.
- Production OCR runs **temperature 0.1**; the eval harness defaults to **0**. At 0 the model is a
  deterministic fixed point — 10 repeats gave 1 distinct output. Repeats only inform at 0.1.
- Occlusion is **2%** of real quality warnings. Bleed-through 35%, stain 21%, ink 19%, fading 16%,
  foxing 14%. Any synthetic-occlusion result is a lower bound on the rarest condition.

## Next actions, in priority order

1. **Deploy prod.** #3450 merged but `sourcelibrary.org` needs a manual `npm run deploy:prod` from
   the main checkout on `main`. The quote-integrity fix is a live data-integrity issue and the blog
   post is not public until then.
2. **Finish the revision-corpus investigation** (above). Randomized rate, per-book offset
   signatures, corruption-vs-repair. File as its own issue; it affects a published methodology.
3. **#3469 — build the hard-page corpus.** Blocked on nothing. Note the sampling trap recorded in
   its comment: mining by disagreement is blind to the fabrication case, because two passes that
   both recite the same memorized verse agree perfectly.
4. **#3444 Tier 1** — ship the provenance regrouping once #3469 gives more than one error class.
5. **#3452** — batch OCR records $0.00 across 376,804 pages.

## Tools left behind

- `scripts/eval/cloze-probe.mjs` — shaped-mask probe (rect/diamond/ellipse/bowtie), temp defaults
  to production 0.1, records `recovery: byLabel|byPosition|null`.
- `scripts/eval/disagreement-typology.mjs` — Latin disagreement classifier. **Its headline output
  is misleading on its own** (98% "unrelated word") until you know that most of those pairs are
  different images. Aligns on folded forms, classifies on raw.
- `scripts/eval/prompt-ablation.mjs` + `PREREGISTRATION-prompt-ablation.md` — the 2×2 factorial,
  **never run to completion**. It was measuring how *consistently* an intervention works before any
  intervention had been shown to work at all. Fix that ordering before reviving it.
