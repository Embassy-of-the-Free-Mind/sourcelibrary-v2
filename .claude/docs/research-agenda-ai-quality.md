# Source Library Research Agenda — AI Quality (v1)

_Finalized 2026-07-24. This is the purpose-driven map of our quality research: what we are trying to
find out, for whom, and what each program delivers. Methods live in
`ocr-translation-eval-landscape.md` (the field survey); this doc is the agenda that survey serves.
Status lines reference the issues/PRs where work already exists — check them before starting anything._

## Why we do quality research at all

Source Library's promise is that a reader can **read and verbatim-quote a historical primary
source** they could not otherwise access. Every AI layer we run — OCR, translation, notes,
summaries, search, the librarian — either keeps that promise or quietly breaks it. We will never
have human ground truth for 75K books, so every quality claim we make rests on proxies. The
research program exists to answer one meta-question:

> **Can we estimate the accuracy of AI-generated text at corpus scale without ground truth — and
> know when our estimates are lying to us?**

The unifying stance is **calibration, not scoring**. Anyone can publish an agreement percentage.
Our contribution — with a multi-era, multi-script, partly-canonical corpus and paired revision
data — is showing *when the standard proxies are trustworthy and when they are confounded*, and
tying thresholds to real reader uses.

## The ladder of interpretive distance

All programs sit on one ladder. Each rung is further from the page; the "right answer" gets less
well-defined, fabrication gets easier and harder to detect, and verification shifts from
*comparison against the page* to *grounding in retrievable evidence*.

| Rung | Layer | Reader promise | Headline metric |
|---|---|---|---|
| 1 | Transcription (OCR) | The words shown are the words on the page | **Quote Integrity Rate** — P(a served quote is verbatim-correct vs the page image), per script × era |
| 2 | Translation | The English says what the original says — nothing added | **Fidelity-without-invention rate** — translation errors split into OCR-inherited vs translation-native vs fabricated |
| 3 | Annotation (notes, summaries, keywords, image descriptions) | Claims about the page are supported by the page | **Claim-support rate** — fraction of factual claims verifiable against source or evidence |
| 4 | Synthesis (librarian, search, generated editorial) | Answers cite real, correct sources | **Citation validity rate** — links resolve, quotes are verbatim, claims trace to retrieved evidence |

One metric per rung, each tied to a promise. These four numbers are the scorecard the whole
program reports against (public face: `/research`).

---

## Program A — Transcription: trusting text we cannot proofread

**Who it serves:** every reader of every page; downstream, every layer built on the OCR.

### A1. Calibrating agreement as an accuracy proxy
- **Question:** When is model agreement (revision pairs, cross-model, re-runs) a measure of
  accuracy, and when a measure of shared blind spots or shared memory? Consistency ≠ accuracy —
  high agreement can be identically wrong (the Javanese 100%-MCR case).
- **Method:** stratified human/strong-judge gold anchors per script; regress agreement against
  gold CER; report *where the proxy tracks truth and where it decouples*. Inclusion criteria
  stated before analysis (the five disagreement populations from #3273: editorial notes,
  tokenization artifacts, image-only pages, commentary-as-transcription, degeneration).
- **Status:** revision-agreement corpus built (109,953 pairs, #3235/#3273); calibration scorecard
  landed (#3336); published on `/research` (#3344).

### A2. Memorization vs perception (the canonicity confound)
- **Question:** When a model "OCRs" a canonical text, is it reading the scan or reciting training
  data? Canonical scores are memory-assisted upper bounds ([[project_noncanon_eval_rows]]); a
  *perfect* score on a canonical page is a hallucination flag (Gemini RECITATION lesson).
- **Method:** non-canonical holdouts as the unsubsidized baseline; perturbation probes (does the
  model transcribe a deliberately altered canonical page as printed, or as remembered?); quantify
  the memorization subsidy per tradition. Marginalia (57% agreement) vs body text (87%) is the
  within-page version of the same decomposition.
- **Status:** confound identified and measured on the 9-model campaign (dataset v0.3, PR #3304);
  perturbation probes not yet run — the novel experiment.

### A3. Catastrophic failure taxonomy
- **Question:** What are the base rates, per model generation, of failures that are wrong *in
  kind* — refusals, repetition loops, reasoning-as-transcription, entity padding, descriptions
  instead of text? Do cheap detectors (type/token ratio < 0.15, `&[a-z]+;` runs, length anomalies)
  catch them reliably?
- **Method:** extend the #3273 degenerate-output census into a maintained taxonomy + detector
  suite; track prevalence across model generations (do new models reduce them or reshape them?).
- **Status:** ~1.3% of revision pairs have a degenerate side; detectors exist read-time
  (`stripLeadingAiPreamble`, degeneracy screens) — the *longitudinal tracking* is the open work.

### A4. Script equity — and metric equity
- **Question:** What is the true per-script quality gap once metrics stop punishing space-less
  scripts (Chinese: 36.7% word-agreement vs 72.7% character-agreement for the same text)? Where is
  the gap in the model vs in the scan supply (microfilm-heavy traditions, Tibetan lite failures)?
- **Method:** character-level, script-aware metrics everywhere (CER > WER); per-script gold
  anchors; decompose gap into model capability vs scan quality using `scan_quality` classes.
- **Status:** metric problem demonstrated (#3273); Tibetan lite untrustworthiness known
  (#3244/#3252); systematic per-script decomposition not yet done.

### A5. Quote integrity (the headline)
- **Question:** What is P(a randomly served quote is verbatim-correct against the page image),
  per script and era — and is it above the threshold where citation is responsible?
- **Method:** stratified sample of served quotes → judge/human check against page images →
  published rate with confidence intervals. Nobody in the field publishes this number.
- **Status:** not yet measured. Highest-leverage single study on this list — it is *the* promise.

---

## Program B — Translation: fidelity without invention

**Who it serves:** readers who cannot read the original — the people least able to catch errors,
reading 6,000+ texts that have never been translated before (no reference exists, by definition).

### B1. Error propagation: absorbed, amplified, or invented
- **Question:** What fraction of translation errors are OCR-inherited vs translation-native? Does
  the translator silently repair OCR noise (good), gloss lacunae with fluent invention
  (catastrophic for us), or omit hard passages?
- **Method:** paired studies on pages with known OCR quality; alignment + embedding checks for
  omission/fabrication; catastrophic failures tracked *separately* from scalar quality (terminology
  rarity predicts them — a single score hides hallucinated terms).
- **Status:** not yet studied systematically; trace-alignment machinery (84%/67%, #3125) is a
  reusable instrument.

### B2. Reference-free judging, calibrated
- **Question:** Does GEMBA-style reference-free LLM-judging track expert raters on *our* corpus
  (classical/low-resource registers where learned metrics like COMET are known not to transfer)?
- **Method:** cross-family judge (Opus judging Gemini — never self-judge); calibrate against a
  small expert-rated set per language (target Cohen's κ ≥ 0.6); MITRA-zh-eval / Mitrasaṃgraha are
  the validated precedents. Build only at the scale translation eval actually needs.
- **Status:** not built (qa-eval does NOT do GEMBA — never claim it externally); landscape doc has
  the full method survey.

---

## Program C — Annotation: claims about the page

**Who it serves:** readers who trust our notes and summaries as scholarly apparatus; search users
whose queries are answered by this layer; scholars who might cite generated claims.

The epistemic shift: OCR has a right answer on the page; an annotation is an *authored claim
about* the page. The failure mode shifts from inaccuracy to **fabrication**, and readers are far
less able to detect it.

### C1. Fabrication rates and taxonomy per annotation type
- **Question:** What is the fabrication rate for each generated type (notes, glosses, page
  summaries, keywords, chapter titles, book summaries, image descriptions), and what shape does it
  take — invented content, misattributed content (real but from an adjacent page), anachronistic
  framing, or over-confident interpretation of a genuine ambiguity?
- **Method:** typed claim extraction → per-type verification (string match for quotations,
  alignment for paraphrase, entity lookup for external facts) → per-type base rates.
- **Status:** anchor finding exists — **12.2% candidate fabrication in original-phrase notes**
  (#3308, Phase 0 done; paid verification lane awaits approval). Extend the same design to the
  other types.

### C2. Verifiability as a generation constraint
- **Question:** Can every factual claim in a generated annotation be *typed* at generation time
  (quotation / paraphrase / interpretation / external fact), each type carrying its own
  verification path — and should claims that cannot be grounded be structurally marked as
  interpretation, or not generated at all?
- **Method:** prompt-contract + output-schema experiments; measure fabrication rate with vs
  without the constraint. This is a publishable design idea, not just hygiene.
- **Status:** not started; #3308's fabrication typology is the input.

### C3. Discovery bias from the generated layer
- **Question:** How much does search read Gemini's habits rather than the corpus? Summaries,
  keywords, and embeddings are what retrieval actually consumes; baked-in editorial prose already
  contaminated the embedding vectors once. Are n-grams counting the corpus or the model?
- **Method:** retrieval experiments contrasting source-text-only vs annotation-inclusive indexes;
  topic-frequency comparison between generated keywords and source text.
- **Status:** contamination mechanism known and read-path guarded (#2232 lineage); the *bias
  measurement* is unstudied.

### C4. Bibliographic claim accuracy
- **Question:** For each AI-generated claim *about the corpus* — first-translation badges, author
  identity, work clustering, language/date assignment — what is the error rate under independent
  verification, and which claim types must require verification *before* publication?
- **Method:** the ft-verify pattern (independent agents + evidence capture in
  `first_translation_attempts`) generalized to other claim types; external anchors (VIAF,
  Wikidata, catalogs).
- **Status:** FT verification flow exists (#2932, ft-verify skill); author/work layers have
  known error modes (editor-as-author, language mistags) but no measured rates.

---

## Program D — Synthesis: answers built from the layers below

**Who it serves:** readers using the librarian, AI clients on the MCP surface, and anyone
downstream of generated editorial prose. Also: our institutional credibility — a fabricated
citation in a synthesized answer is indistinguishable, to the reader, from a fabricated source.

### D1. Compositional fidelity of the librarian
- **Question:** If notes are ~88% clean and summaries are X% clean, what is the fidelity of an
  answer synthesized from five of them? Does grounding-at-generation (assert only what a tool call
  returned) beat verification-after?
- **Method:** citation-validity audits of librarian transcripts (links resolve, quotes verbatim,
  claims trace to retrieved evidence); A/B the two grounding designs. Known failure to build on:
  the librarian invents slugs and image URLs when unconstrained (#3114).
- **Status:** link-integrity lesson exists; systematic citation-validity rate not measured.

### D2. Voice separation and reader trust (the HCI question)
- **Question:** The site has three voices — the historical author, the AI translator, the AI
  annotator. Can readers tell which they are hearing, and does marking machine annotation
  calibrate trust without destroying reading flow? For a library whose pitch is "read the
  original," voice confusion is close to existential.
- **Method:** interface experiments + reader studies; measure misattribution (do readers quote AI
  notes as source text?). The wrapper-leak incidents (#2232, #2420) are what happens when the
  voices blur *in the pipeline*; this program is about the *reader-facing* boundary.
- **Status:** pipeline hygiene done; the reader-side question untouched. (`<note>` still conflates
  AI vs source on quote/embed — #3298 fixed rendering only.)

---

## Cross-cutting program — the economics of quality

**Who it serves:** the mission's sustainability. Quality measurement should be an economic
instrument, not a report card: the marginal dollar goes where it changes the outcome.

- **E1. Predictive routing:** can scan class, script, date, typeface, layout predict quality well
  enough to route work ex ante — cheap model / strong model / human review? (Status: 3.1-lite vs
  3.5-lite result exists, p=8.6e-4, PR #3304; routing model not built.)
- **E2. Re-processing pays?:** when a new model generation arrives, which pages improve enough to
  justify re-OCR — and can old-vs-new revision agreement *identify* them, given that a shorter
  disagreeing re-OCR of a degenerate prior is a fix, not a regression? (Status: the direction-
  inversion trap is documented (#3273); the longitudinal decision rule is the open work.)
- **E3. Threshold-setting:** per use (search / reading / quotation), what accuracy suffices? Ties
  every program's metric to a go/no-go decision instead of a number in a table.

---

## Priorities (as of 2026-07-24)

1. **A5 Quote Integrity** — the promise itself, unmeasured, and a publishable first.
2. **C1 note fabrication Phase 2** — sample drawn, blocked only on approval (#3308).
3. **A2 perturbation probes** — the novel experiment on the memorization confound; upgrades the
   already-published calibration work from "confound noted" to "confound measured."
4. **E2 re-processing decision rule** — directly gates real spend as new models land.
5. **B1 error propagation** — the biggest unstudied surface; needed before any translation-quality
   public claim.

Everything else queues behind these. When a program produces a number fit for the public
scorecard, it goes on `/research` next to the OCR calibration work — the scorecard *is* the
program's public face.

## Standing cautions (carried from hard-won lessons)

- State inclusion criteria **before** any disagreement analysis; count what each excluded class
  removes (#3273).
- Never self-judge (judge ≠ generator family); never trust a judge that can't read the script.
- Canonical-text scores are upper bounds, subsidized by memory; perfect scores are suspect.
- Screen for degenerate output before computing any metric over page text.
- Word-level metrics lie about space-less scripts; use character-level.
- qa-eval does not do GEMBA; don't claim it in funder-facing material.
