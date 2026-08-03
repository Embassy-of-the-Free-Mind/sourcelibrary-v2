# Community quality review — design

Status: **proposal, nothing built.** Written 2026-08-02 from a conversation with
Derek about volunteer management. Read `.claude/docs/newsletter-queue.md` item 2
alongside it — the volunteer letter is the recruiting instrument for this, and it
should not go out until at least Phase 0 below exists.

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
`reviewer_user_id`, `lane`, `assignment_id` (null for stream), `verdict`,
`notes`, `spans`, `language`, `text_version`, `created_at`. Reviews never
directly mutate public text; they are evidence, and a human applies fixes.

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

## Open questions for Derek

1. **Credit.** Named on a public methods/statistics page? Acknowledged in a
   paper? For academics this is the actual compensation and it should be decided
   before recruiting, not after.
2. **Payment.** Is the panel paid? It is a defined piece of work and paying for
   it is defensible. Needs an explicit yes before anything spends.
3. **Who answers.** Every lane creates replies. The programme dies the first
   month nobody responds, exactly as the standing offers have gone unanswered.
4. **Spanish.** Five of the nine existing volunteers wrote in Spanish and one
   said they do not read English. Does the review UI need Spanish, or only the
   letter?

## Risks

- **Reviewer disagreement misread as corpus error.** Mitigated only by overlap.
- **A statistic outliving its validity.** Stamp every published figure with its
  sample date and n; re-derive rather than quote.
- **Recruiting into silence.** The failure mode already visible in the standing
  offers. Phase 0 exists to prevent it.
- **The panel eating the stream.** If assigned work becomes the visible thing,
  self-directed reading stops, and that is where the interesting defects come
  from. Keep the stream prominent.
