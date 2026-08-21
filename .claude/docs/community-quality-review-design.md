# Community quality review — design

Status: **proposal, nothing built.** Written 2026-08-02 from a conversation with
Derek about volunteer management; decisions on credit, payment, Spanish and
abstention added 2026-08-04 (see "Decisions" at the end). Read
`.claude/docs/newsletter-queue.md` item 2 alongside it — the volunteer letter is
the recruiting instrument for this, and it should not go out until at least
Phase 0 below exists.

## The problem, and the leverage

We hold ~4.9M machine-translated pages and almost none have been read by a human.
Proofreading the corpus is not a plan; at one page a minute it is forty years of
continuous reading.

But we do not need to proofread the corpus to *know how good it is*. That
machinery already exists and is starving:

`scripts/eval/calibration-scorecard.mjs` fits accuracy against cross-pass
agreement (OLS + bootstrap CI over 2,000 resamples), refuses to fit a stratum
below `MIN_PAGES_FOR_FIT`, and refuses to extrapolate beyond the anchor range.
It is careful, honest work. Its entire corpus-wide claim rests on **32
non-canonical human-verified anchor pages**, and it says so.

Two consequences:

- A few hundred careful human judgments would statistically license claims about
  millions of pages. That is the whole argument for a review programme.
- **Tibetan and Chinese currently have zero non-canonical anchor pages**, so we
  can say nothing at all about them. That is not a soft number, it is an absence.

So the framing is not "help us proofread." It is **help us calibrate the
instrument that measures the library.** That is a real, fundable, academically
legible thing to ask for, and it is small enough to actually finish.

## The design tension

Two goals pull the sampling design in opposite directions, and conflating them
produces a programme that does neither.

|  | Measurement | Improvement |
|---|---|---|
| Who picks the page | We do | The reader does |
| Sample | Stratified random | Self-selected |
| Output | A statistic with a CI | Fixes, and discovered pathologies |
| Fails if | People choose their own texts | People are told what to read |

Self-selected review cannot produce a corpus statistic. It measures "how good is
our Latin on the books enthusiasts happen to like," which is not publishable and
not true. Equally, handing a Sanskritist a random page of Dutch is how you lose
a Sanskritist.

**So: two lanes, and they must never contaminate each other.**

## Lane 1 — the panel (measurement)

Small, assigned, stratified. This is the lane that produces numbers.

**Strata.** Language × era × scan quality class. Language matters most (the
agreement→accuracy relationship demonstrably differs by script — space-less
scripts have no usable fit at all). `books.scan_quality.dominant_scan_class`
gives the third axis where present.

**How many.** For a direct per-stratum estimate of the proportion of pages with
a material error, at 95% confidence:

- ±10%, assuming accuracy near 0.9 → **~35 pages**
- ±5%, same assumption → **~140 pages**
- ±5% worst case (p=0.5) → ~385 pages

Thirty-five pages per language is achievable. This is the number that makes the
whole thing tractable, and it should be said out loud early and often, because
everyone assumes it is thousands.

**A subtlety that will bite if ignored.** Purely random sampling is right for an
unbiased direct estimate but *wrong* for extending the scorecard's calibration.
The fit needs anchor points spread across the agreement range; a random draw
returns mostly typical-agreement pages, giving a precise line over a narrow
interval — and the scorecard will then correctly refuse to extrapolate, leaving
us no better off. So the panel needs two sub-samples:

- **random** within stratum → unbiased direct estimates
- **spread** across agreement deciles → calibration coverage

Keep them tagged and never pool them for a headline number without
post-stratification.

**Overlap.** ~20% of panel pages get a second independent reviewer. Without it
we cannot separate "the translation is wrong" from "these two reviewers
disagree," and every CI we publish is softer than it looks. Budget it from the
start; retrofitting inter-rater reliability is not possible.

**Excluded from the panel sample.** Pages whose printed page number disagrees
between passes (see the `page_revisions` section of CLAUDE.md — ~40% of revision
pairs are image-shift artefacts, not legibility). A reviewer handed one of those
reports "the text does not match the image," which is true, is worth knowing, and
is *not* a translation-quality datum. It routes to archival repair instead.

## Round 1 should be OCR adjudication, not translation review

Added 2026-08-04. The panel's first round should adjudicate **double-OCR pairs**
rather than judge translation faithfulness. It is better on every axis, and it
serves the memorization paper's binding constraint directly.

### Why this and not translation review

`.claude/docs/ocr-memorization-paper.md` lists its own blocker: *"the corpus
gives agreement and its factors, never accuracy. Only the anchor rows can supply
truth."* The calibration scorecard's spaced fit rests on **n=32** non-canonical
anchors (12 canonical, per-script: Greek 12, Armenian 8, German 5, Hebrew 2), and
the **spaceless fit is n=0** — Chinese, Tibetan and Japanese have no anchor points
at all.

More importantly, the paper notes that *"two models reciting agree while both
misreport the page."* So **agreement is structurally blind to the fabrication
class**: two passes reproducing the same memorized text agree perfectly while
neither reads the page. No quantity of corpus data can detect that. A human
holding the image against both transcriptions is the only instrument that can —
which makes volunteers not a cheaper source of anchors but the *only* way to
measure the extreme form of the paper's central claim.

The task shape is also far better suited to a mixed-skill pool. "Which of these
two transcriptions matches the page?" is comparison rather than evaluation:
faster, shallower, and a large share of disagreements are **mechanical** —
truncation, repetition loops, `&nbsp;` padding, normalization conventions
(`nūc`→`nunc`) — diagnosable by someone who does not read Latin. That directly
relieves the abstention pressure described above.

### Eligibility — three filters, in this order

Measured on a random sample of 35 OCR revision pairs (2026-08-04; small, re-run
at scale before relying on the percentages, though `revision-image-shift.mjs`
already put the shift rate at 40.2% on n=3,339):

1. **Drop byte-identical pairs — 11% of the sample.** Identical text and
   identical length is a duplicate write, not a second pass. Including it
   manufactures perfect agreement out of nothing.
2. **Record and stratify on independence. 83% of pairs carry the SAME model AND
   the SAME `prompt_version` on both sides.** Those are re-runs of one
   configuration, not independent observers, and their agreement is inflated by
   a shared blind spot. Classify each pair `cross_family` /
   `same_family_diff_prompt` / `same_config` and never pool them. This is the
   same doctrine `scripts/analysis/ft-rater-reliability.mjs` already applies:
   independence is by *family*, because the same model resampled shares its
   blind spot.
3. **Split on the printed page number before sampling by agreement.** Where both
   sides carry a `<page-num>`, they disagree **50%** of the time — and the
   separation is nearly total:

   | | median agreement |
   |---|---|
   | printed page numbers agree | **0.956** |
   | printed page numbers differ | **0.204** |

   **72% of pairs below 0.5 agreement are printed-number disagreements**, i.e.
   the two texts describe different leaves. They are the #3357 repair artifact,
   not legibility.

### The trap this creates for the "spread across agreement deciles" sample

The design above asks for anchors spread across the agreement range, because a
random draw clusters at typical agreement and leaves the scorecard correctly
refusing to extrapolate. But **the low end of the agreement range is
overwhelmingly image-shift.** Draw the spread sample naively and roughly
three-quarters of the low-agreement anchors are pages where the two texts are of
different leaves — and the calibration curve's low end, which the paper already
flags as *soft*, would be fitted on that.

So: apply filter 3 **first**, then draw the spread sample from the surviving
population. `different_leaf` remains a label a reviewer can apply (it is the one
class humans catch instantly), and those rows route to archival repair and to
measuring the printed-page-number detector's own recall — which CLAUDE.md notes
is weak, since a *uniform* shift preserves the page-number sequence perfectly.

### The adjudication

Shown: the page image, transcription A and transcription B, no indication of
which is current.

```
which:  a_matches | b_matches | both_match | neither_matches
        | different_leaf | cannot_judge (+ passed_reason)
cause:  [multi] truncation | repetition_loop | entity_padding
        | normalization | misreading | commentary_as_transcription
        | illegible_scan
notes:  free text
```

- **`neither_matches` is the fabrication detector** and the reason this round
  exists. It is unreachable from agreement.
- **`cause` is confirmation, not authoring** — pre-fill the candidate class from
  `disagreement-typology.mjs` and let the reviewer accept or correct it. Per the
  gallery-volunteer doc: verification gets ~50× the throughput of blank-form
  annotation.

### What the labels produce, and what they are not

The adjudication yields, per page, whether each side is correct — so aggregated
within an agreement decile it gives **P(page correct | agreement)**. That is a
calibration curve in probability space, and it is a *different quantity* from
the scorecard's existing CER-based anchor fit. **Do not pool them.** The
probability curve is arguably the more useful one for a public claim (it answers
"what fraction of pages are right"), and it maps onto the panel's own
`material_error` framing; the CER fit stays the instrument for the paper.

Stratify by **canonicity** and one interaction becomes testable that nothing in
the pipeline can currently produce: the memorization hypothesis predicts
canonical pages show **high agreement *and* elevated `neither_matches`.** High
agreement with low accuracy is the recitation signature, and it is only visible
when a human holds the image against both sides.

## Lane 2 — the stream (improvement)

Endless queue, self-selected, no quota, read whatever you like. This is the lane
that found the leaf offset (#3368) and the fabricated encyclopedia citations
(#3361) — pathologies no sampling design would have caught, because they were
found by people reading closely for their own reasons.

**Intake already exists and needs nothing built.** The feedback widget is on
every reader page and every blog post and records which page the note came from.
A volunteer proofreading a blog post uses the same button as everyone else. Do
not build a second reporting path.

**Never quote the stream as a quality statistic.** It is a biased sample by
construction. Saying so publicly is itself a credibility win, and it is the kind
of thing academics notice.

## On the "three reports a week" idea

Recommend against. A quota converts a gift into an obligation and is the standard
way volunteer programmes die: someone misses week two, feels they have failed,
and leaves rather than doing one review in week three.

Put the commitment where it is genuinely a job — the panel, which is a defined
piece of work with a named output. Leave the stream at zero pressure. Someone who
sends one good report a year is net positive and should never see a streak
counter telling them otherwise.

If a retention mechanic is wanted, make it a *readout* rather than a demand:

> You have reviewed 40 pages and found 6 errors. Your work moved the Spanish
> estimate from ±9% to ±4%.

True, specific, and it credits the person with the thing they actually did.

## Matching

`/welcome` already collects `aboutYou`, `preferredLanguage` and
`helpDescription`, and `/admin/introductions` already displays them. The match is
essentially language × period. Do not build more than that.

Note what we cannot do: **we cannot verify that someone reads Latin.** Overlap
and agreement-with-other-reviewers is the only real check, which is another
reason the 20% double-review is load-bearing rather than nice-to-have.

## What a review actually is

One page, one verdict, plus optional detail. Structured enough to aggregate,
open enough to be worth a person's time.

```
verdict: faithful | minor_issues | material_error | image_mismatch | not_assessable
notes:   free text (optional)
spans:   [{ quote, comment }]  (optional)
```

A review row may instead carry **no verdict at all** — see the abstention
section below. `passed_reason` and `verdict` are mutually exclusive, and any
rate or agreement statistic must filter to rows that actually carry a verdict.
(The `volunteer_ratings` table learned this the same way: `rating` is nullable
so a note can arrive without one, and every statistic filters
`rating IS NOT NULL`.)

- **material_error** must be defined concretely or the scale drifts between
  reviewers: changes the sense, omits content that is present, or adds content
  that is not.
- **image_mismatch** exists so the archival defect above does not pollute the
  translation statistic.
- **not_assessable** exists so blank pages and illegible scans do not force a
  judgment. Its absence is a classic way to manufacture noise.

**A review is bound to the text it judged.** Store the reviewed text's
`updated_at` (or a hash) on the review row. A later re-OCR silently invalidates
the verdict otherwise, and we would be quoting a human judgment of text that no
longer exists — the same paired-artifact failure as #3362 and #3368, in a new
place.

Proposed storage: a `page_reviews` collection — `page_id`, `book_id`,
`reviewer_user_id`, `lane`, `assignment_id` (null for stream), `verdict`
(nullable), `passed_reason` (nullable), `notes`, `spans`, `language`,
`text_version`, `created_at`. Exactly one of `verdict` / `passed_reason` is set.
Reviews never directly mutate public text; they are evidence, and a human
applies fixes.

## What we can and cannot say publicly

Worth writing down now, because the number will outlive the context that
produced it.

**Can say:** "Across a stratified sample of N pages reviewed by human readers,
X% were faithful, ±Y at 95% confidence, for Latin printed 1500–1700." With the
strata and n visible.

**Cannot say:** any single corpus-wide accuracy figure without naming the strata
it was fitted on; anything at all about Tibetan or Chinese until anchors exist;
anything derived from the stream.

Precedent for the tone is already in the repo — the scorecard reports
`UNUSABLE, no fit attempted, never extrapolate` rather than a plausible number.
Keep that. A number that looks authoritative and is wrong is worse than no
number.

## Build order

**Phase 0 — no code.** Reply to the nine people who already offered. Ask the
three who named "reviewing translations" for five pages each, by email, with
direct links. This measures demand, produces the first new anchors, and costs a
day. **Do not build before this.** If three self-selected enthusiasts will not do
five pages each, no amount of tooling changes that.

**Phase 1.** `page_reviews` collection and a minimal review form on the reader
page for signed-in volunteers. The stream becomes real; the panel is still run by
hand from a spreadsheet.

**Phase 2.** Assignment records, strata sampling, and scorecard integration —
`calibration-scorecard.mjs` reads human verdicts as anchors alongside the
existing 32.

**Phase 3.** A public statistics page, and per-reviewer readouts.

## Abstention — the reviewer must be able to say "not me"

Decided 2026-08-04. A reviewer handed a page in a language they do not read needs
a way out, and **it must not be the `not_assessable` verdict.**

Those are different objects:

- `not_assessable` is a property of the **page** — blank, illegible, image
  mismatch.
- "I don't read Greek" is a property of the **reviewer–page pairing**.

Conflating them corrupts the corpus statistic in the direction that flatters
nobody: a Latinist reaching for `not_assessable` on a Greek page records that
*the page* cannot be judged, which is false, and deflates the measured quality of
a stratum for reasons that have nothing to do with the corpus. Same denominator
error as the `reading_history` "62% came back" figure, in a new place.

So: a **pass** action, stored as an assignment outcome rather than a verdict,
which returns the page to the pool for someone else. Capture the reason —
`not_my_language` / `not_my_period` / `cannot_read_scan` / `no_time`. The third
is a page property wearing a reviewer's clothes and routes to repair; capture
time is the only chance to tell them apart.

### The incentive this creates, given credit-without-payment

**Volume-based credit + no payment + an easy pass button = an incentive to
guess.** If someone is named for reviewing N pages and a pass does not count
toward N, the rational move for a person who wants the credit is to judge pages
they cannot read — fabricating anchors into the one dataset whose entire value is
that it is ground truth.

Therefore: **credit attaches to completing a round, not to page count, and an
abstention counts as participation.** This is not a nicety; it is what stops the
compensation model from corrupting the measurement.

### Abstention is data, and belongs in the paper

- **Report coverage per stratum as a first-class number.** A stratum with 40%
  abstention has a narrower effective reviewer population than its `n` suggests.
- **Characterise the missingness, do not merely count it** (Rubin's
  MCAR/MAR/MNAR). If reviewers abstain more on hard or degraded pages, the
  retained sample is systematically easier and "% faithful" is optimistically
  biased. This is cheaply testable: compare the machine cross-pass agreement
  distribution of abstained vs completed pages. That agreement number already
  exists for every page, so the instrument that detects the bias is free.
- **The abstention pattern is the paper's own thesis replicated on the human
  side.** If Latin draws twenty reviewers and Tibetan draws none, that is the
  same ground-truth scarcity the memorization paper documents for machine
  benchmarks. Report it as a finding, exactly as the scorecard reports the
  zero-spaceless-anchor gap rather than laundering it.

### Prior work to cite rather than re-derive

- **Chow (1970)**, classification with a reject option — abstention buys accuracy
  on retained decisions at the cost of coverage. Always report both.
- **Rubin (1976)**, missing-data mechanisms — why the question is *which*
  missingness, not *how much*.
- **Dawid & Skene (1979)** — EM estimation of true labels *and* per-annotator
  error rates from multiple noisy raters. The canonical answer to "we cannot
  verify that someone reads Latin": infer competence from agreement instead of
  trusting the declaration.
- **MACE (Hovy et al. 2013)** — models annotators answering without looking.
  This is what catches 40 pages in 90 seconds.
- **Krippendorff's α, not Cohen's κ.** With abstention the coverage matrix is
  ragged by construction, and α is the coefficient that tolerates missing data
  and any number of raters. Not a stylistic preference.
- **Artstein & Poesio (2008)** — standard IAA reference, including why raw
  agreement flatters when one category dominates. Most pages will be fine, so
  raw agreement will look excellent and mean little.

In-repo precedent to copy rather than reinvent:
`scripts/analysis/ft-rater-reliability.mjs` already separates **reliability**
(chance-corrected agreement, by rater *family*, because the same model resampled
shares its blind spot) from **validity** (accuracy against checkable gold), and
warns that high agreement under shared bias is the trap. Same structure applies
here.

## Decisions (2026-08-04)

1. **Credit — YES.** Contributors named on a public methods/statistics page and
   acknowledged in the paper. Authorship is reserved for design and analysis
   contributions; state that boundary in the recruiting letter rather than
   negotiating it afterwards. Credit is per completed round, per the incentive
   argument above.
2. **Payment — NO.** The panel is unpaid. This makes the credit design
   load-bearing rather than decorative, and it is why abstention must count as
   participation.
3. **Spanish — YES, and in the review UI, not only the letter.** 43 of 163
   volunteers named Spanish and one said they do not read English. Honest caveat
   to carry: reviewing a Spanish→English translation requires *both* languages,
   so a Spanish UI serves Spanish-source review specifically — it does not make
   Spanish speakers available for the whole corpus.
4. **Who answers replies — STILL OPEN.** This is the one that kills programmes.
   Every lane generates replies, and the standing offers already died of silence
   once (132 signups, 0 ratings, all `contacted: false`). Assign a person before
   the letter goes out.

## Risks

- **Reviewer disagreement misread as corpus error.** Mitigated only by overlap.
- **A statistic outliving its validity.** Stamp every published figure with its
  sample date and n; re-derive rather than quote.
- **Recruiting into silence.** The failure mode already visible in the standing
  offers. Phase 0 exists to prevent it.
- **The panel eating the stream.** If assigned work becomes the visible thing,
  self-directed reading stops, and that is where the interesting defects come
  from. Keep the stream prominent.
