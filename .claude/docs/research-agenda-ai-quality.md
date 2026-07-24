# Source Library Research Agenda — AI Quality (v1)

_Finalized 2026-07-24. What we're trying to find out about the quality of our AI-generated text,
for whom, and what each line of work delivers. How-to-measure details live in
`ocr-translation-eval-landscape.md` (the field survey); this doc is the plan that survey serves.
Status lines point at the issues/PRs where work already exists — check them before starting._

## Why this research exists

Source Library promises that a reader can **read and quote a historical source** they couldn't
otherwise access. Every AI layer — OCR, translation, notes, summaries, search, the librarian —
either keeps that promise or quietly breaks it. We can't proofread 75K books, so every quality
claim we make rests on indirect signals (models agreeing with each other, embedding similarity,
AI judges). The whole program boils down to one question:

> **Can we tell how accurate our AI text is without checking it by hand — and can we tell when
> our own measurements are fooling us?**

Anyone can publish an accuracy percentage. What we're positioned to show — with a corpus spanning
many eras and scripts, some of it famous enough to be in training data — is **when the standard
measurements can be trusted and when they can't**. That's the contribution.

## The four layers, one metric each

Each AI layer is one step further from the physical page. With each step, "correct" gets fuzzier,
making things up gets easier, and catching it gets harder. Each layer gets one headline number
tied to a concrete promise:

| Layer | Promise to the reader | The number we report |
|---|---|---|
| OCR | The words shown are the words on the page | **Quote integrity** — if you quote us, what are the odds the quote is exactly right? |
| Translation | The English says what the original says — nothing added | **Nothing-invented rate** — errors split into "inherited from bad OCR" vs "the translator made it up" |
| Notes & summaries | Claims about the page are actually supported by the page | **Claim-support rate** — what fraction of stated facts check out? |
| Librarian & search | Answers cite real sources, correctly | **Citation validity** — links work, quotes are verbatim, claims trace to a real page |

These four numbers are the scorecard. Public face: `/research`.

---

## Program A — OCR: trusting text nobody proofread

**For:** every reader of every page, and every layer built on top of the OCR.

### A1. When does "the models agree" actually mean "it's right"?
Our main quality signal is agreement — between revisions, between models, between runs. But two
models can agree because the page is easy, or because they share a blind spot, or because they
both memorized the text. We check agreement against pages where we *know* the right answer, and
map where the signal tracks truth and where it breaks.
_Status: the 110K-pair revision corpus is built (#3235/#3273), the calibration work landed
(#3336), and it's published on `/research` (#3344)._

### A2. Is the model reading the page, or reciting it from memory?
Famous texts (Plato, the Aeneid, Genesis) are in the training data. A model can score perfectly
on a canonical page without reading the scan at all — which makes our best-looking scores the
least trustworthy ones. The clean experiment we haven't run: alter a word on a famous page and
see whether the model transcribes what's printed or what it remembers.
_Status: the problem is identified and partly measured (PR #3304); the alter-a-word probe is the
next new experiment._

### A3. How often does OCR fail catastrophically, and can we catch it cheaply?
Some pages aren't slightly wrong — they're not transcriptions at all: refusals, one phrase
repeated 8,000 times, the model's reasoning written out as if it were page text, thousands of
characters of `&nbsp;`. About 1.3% of revision pairs have one of these. We have cheap detectors;
the open work is tracking whether new model generations reduce these failures or just change
their shape.
_Status: taxonomy and detectors exist (#3273); tracking over time doesn't._

### A4. Are some scripts getting worse quality — and are we even measuring them fairly?
Word-based scoring punishes Chinese and Tibetan: one wrong glyph sinks a whole "word," so the
same quality reads as 37% by word and 73% by character. Separately, some traditions mostly exist
as microfilm. So: measure the real quality gap per script with fair (character-level) metrics,
then split the gap into "the model is worse at this script" vs "the scans are worse."
_Status: the metric problem is demonstrated (#3273); Tibetan failures known (#3244/#3252); the
systematic per-script breakdown hasn't been done._

### A5. If you quote us, what are the odds the quote is exactly right?
The headline. Take a random sample of quotes as the site actually serves them, check each against
the page image, publish the rate by script and era. Nobody in this field publishes that number.
_Status: not measured. Highest-leverage single study on this list — it's the promise itself._

---

## Program B — Translation: faithful, with nothing made up

**For:** readers who can't read the original — the people least able to catch errors, reading
6,000+ texts that have never been translated before. No prior translation exists to compare
against, which is exactly why this needs care.

### B1. When OCR is bad, what does the translator do with it?
Three possibilities, very different stakes: it quietly fixes the noise (good), it skips the hard
part (bad), or it fills the gap with fluent invention (worst — the reader can't tell). Measure
the split: of translation errors, how many were inherited from bad OCR, and how many did the
translator introduce? Track made-up passages separately from overall quality — an average score
hides them.
_Status: not yet studied; the trace-alignment tooling (#3125) is a ready instrument._

### B2. Can an AI judge grade our translations, and can we trust its grades?
With no reference translation, the validated approach is asking a strong model to grade the
translation against the original. Two rules from the field: the judge must be from a different
model family than the translator (models favor their own), and the judge itself must be checked
against a small set of expert-graded pages per language before we trust it.
_Status: not built. Note our eval tooling does NOT do this today — never claim it externally._

---

## Program C — Notes and summaries: claims about the page

**For:** readers who trust our notes as scholarly apparatus; search users, since search reads
this layer; scholars who might cite a generated claim.

The key shift: OCR has a right answer sitting on the page. A note is the AI *saying something
about* the page — and the failure mode isn't being slightly off, it's **making things up**,
which a reader has almost no way to detect.

### C1. How often do our notes and summaries make things up, and in what way?
We have one hard number: roughly **12% of "original phrase" notes contain a suspect fabrication**
(#3308). Extend that audit to every generated type — summaries, keywords, chapter titles, image
descriptions — and classify what kind of wrong: invented outright, real but from the wrong page,
a modern idea projected onto an old text, or a stated fact that's just false.
_Status: notes audit Phase 0 done, sample drawn, paid verification lane waiting on Derek._

### C2. Can we force notes to be checkable at the moment they're written?
A note that quotes the page can be string-checked automatically — that's how we caught the 12%.
The experiment: make the generator label every claim (quote / paraphrase / interpretation /
outside fact), auto-verify the checkable kinds, and either clearly mark or refuse to emit the
rest. Then measure whether the fabrication rate drops. If it works, this is a publishable design,
not just cleanup.
_Status: not started; the #3308 findings are the input._

### C3. Is search reading the corpus, or reading Gemini's habits?
Search runs on summaries, keywords, and embeddings — all AI-written. If the AI over-uses certain
themes, search is biased before anyone types a query, and our n-gram counts may partly count the
model's tics rather than the corpus. Test: compare retrieval using source text only vs source
text plus the generated layer, and compare topic frequencies between the two.
_Status: we know contamination happens (the editorial-prose-in-embeddings incident); the size of
the bias is unmeasured._

### C4. How accurate are our claims *about* the books?
First-translation badges, author identities, work groupings, dates, languages — all
AI-asserted, all citable by scholars, all with known past errors (editors credited as authors,
mistagged languages, badges set before verification). Measure the error rate per claim type
against outside evidence (VIAF, Wikidata, catalogs), and decide which claim types must be
verified *before* they're published rather than after.
_Status: first-translation claims already have a verification flow (ft-verify, #2932); the other
claim types have known error modes but no measured rates._

---

## Program D — The librarian: answers built from everything below

**For:** readers using the chat librarian and AI clients on the MCP surface. Also our
credibility: a made-up citation in a librarian answer looks identical, to the reader, to a real
one.

### D1. When the librarian combines five sources, how much truth survives?
The librarian composes answers from notes, summaries, and search results — each imperfect. Audit
real librarian transcripts: do the links resolve, are the quotes verbatim, does each claim trace
to something actually retrieved? Then test the design question: is it better to only let the
librarian assert what a tool call returned, or to check its answers afterward?
_Status: we know it invents book slugs and image URLs when unconstrained (#3114); the systematic
audit hasn't been done._

### D2. Can readers tell who's talking?
Every page has three voices: the historical author, the AI translator, and the AI annotator.
If readers can't tell them apart, they'll quote our commentary as if it were the source — the
same failure as the old wrapper leaks, but in the reader's head instead of the pipeline. Test
interface treatments for marking AI text and measure whether people still misattribute it. For a
site whose pitch is "read the original," this question is close to existential.
_Status: the pipeline side is fixed; the reader-facing side is untouched (`<note>` still blurs
AI vs source on quote/embed — #3298 fixed rendering only)._

---

## Program E — Spending wisely (cross-cutting)

**For:** sustainability. Quality measurement should decide where money goes, not just fill a
report.

- **E1. Predict quality before paying.** Can scan type, script, and date predict how well OCR
  will go — well enough to route each book to the cheap model, the strong model, or a human?
  _(We already showed the cheaper model beats a pricier one on this corpus, p=8.6e-4, PR #3304 —
  routing on that kind of evidence is the goal.)_
- **E2. When a new model comes out, which pages are worth re-doing?** Can comparing old vs new
  output identify the pages that improved — remembering that on a garbage prior, a *shorter,
  disagreeing* re-OCR is the fix, not the regression (#3273)?
- **E3. How good is good enough?** Search tolerates a lot of error; reading some; quotation
  almost none. Set the threshold per use, so every measurement ends in a decision instead of a
  number in a table.

---

## Priorities (2026-07-24)

1. **A5 — measure quote integrity.** The promise itself, unmeasured, and a publishable first.
2. **C1 — unblock the notes-fabrication audit** (Phase 2 of #3308, waiting on approval).
3. **A2 — run the alter-a-word probe** on famous pages; upgrades the published calibration work
   from "memorization is a concern" to "memorization is measured."
4. **E2 — the re-OCR decision rule**; directly gates real spend as new models land.
5. **B1 — OCR-error propagation into translation**; needed before any public claim about
   translation quality.

Everything else queues behind these. When a program produces a number fit for the public
scorecard, it goes on `/research`.

## Standing cautions (from hard-won lessons)

- Decide what counts as a valid comparison **before** running it, and report what each exclusion
  removes (#3273).
- Never let a model judge its own family's output; never trust a judge that can't read the script.
- Scores on famous texts are inflated by memorization; a perfect score is a red flag, not a win.
- Screen out degenerate pages (loops, padding, refusals) before computing any statistic.
- Use character-level metrics for Chinese/Tibetan/etc.; word-level ones lie.
- Our eval tooling does not do LLM-judge translation grading today; don't claim it in
  funder-facing material.
