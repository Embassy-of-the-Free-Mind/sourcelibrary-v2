# Pre-registration — translation prompt v15 vs v13: are the original-notes real?

_Written 2026-09-12, **before any paid run**. Issue #3825 (the prompt revision),
#3308 (the 12.2% fabrication census), #4695 (the page_terms verifier). Harness:
`scripts/eval/translation-prompt-ab.mjs`. The sample is already drawn and pinned
(`results/translation-prompt-v15-sample.json`); nothing has been translated. The
decision rule below is fixed now so that it cannot be picked after seeing the numbers._

PRIOR ART: `PREREGISTRATION-prompt-ablation.md` and
`PREREGISTRATION-per-language-ocr-suitability.md` (house format, numeric decision
rules, amendment log); `prompt-ab.mjs` (paired OCR-prompt A/B, whose k≥5
repeated-measures design this deliberately does NOT copy — see "Design"); and
`scripts/lib/page-terms-parse.mjs`, the verifier `build-page-terms.mjs` used to
produce the corpus-wide 91%, which is reused here rather than reimplemented.

## The decision this changes

One binary: **flip the default translation prompt from v13 to v15, or leave it.**
v15 (`scripts/maintenance/translation-prompt-v15-verbatim-original.mjs`) carries
all five #3825 items. Item 2 is the one with a measurable target: the phrase
inside `<note>original: "…"</note>` must be a character-for-character copy of the
OCR input on that page, or the note is omitted. Readers and search treat those
notes as citations; a fabricated one is a quotation that never existed.

## Hypotheses

- **H1 (primary).** Under v15 the verified-note rate — original-notes whose quoted
  phrase occurs in `ocr.data` of the same page, over original-notes emitted — is
  higher than under v13 by at least 3 percentage points, on the same pages.
- **H2 (co-primary, the gaming check).** v15 does not achieve H1 by falling
  silent: notes per page under v15 are not more than 20% below v13.
- **H3 (items 1, 3, 4).** Invented tags, housekeeping-tag leakage and standalone
  glossary blocks per page do not increase under v15 (they are expected to fall;
  a fall is welcome but not required for the flip).
- **H4 (regression).** v15 does not lose content: prose body length is not more
  than 10% below v13, inline `<term>` supply is not more than 20% below v13, and
  a blind judge does not find v15 losing material more often than v13 does.

The null on H1 is what the trace-alignment prompt taught: a well-intentioned
rewrite can move nothing, or regress. "v15 looks better" is not a result.

## Population and sample

Pages the production pipeline would translate (`translatablePageFilter()` from
`scripts/lib/translate-core.mjs`: page_number > 0, non-empty `ocr.data`, not a
skip page-type, not recitation/safety-blocked), with at least 200 OCR characters,
in books with `pages_ocr ≥ 5`.

**n = 320 pages from 320 books — one page per book, always.** Pages inside a book
share a scan, a hand and a translation chain; they are one observation. Eight
strata of 40, because fabrication is expected to be script-dependent:

| stratum | filter | mode |
|---|---|---|
| latin-print | language Latin, print providers | print |
| german-print | language German, print providers | print (Fraktur present) |
| greek-print | language Greek, print providers | print |
| hebrew | language Hebrew | mixed |
| arabic | language Arabic | mixed |
| cjk-print | language Chinese | print |
| bph-mss | `image_source.provider: bph` | manuscript |
| tibetan-mss | language Tibetan | manuscript (the #4523 lane) |

The print/manuscript axis is a **declared proxy**: `books` has no manuscript
field (checked 2026-09-12: `material` and `medium` are empty on every book with
OCR; `format` is null on 62,947 of 63,913). Provider and language stand in, and
the column is called `mode` so nobody reads it as a measured property.

Books were drawn with Mongo `$sample`, one random translatable page each, and the
draw is **pinned** in `results/translation-prompt-v15-sample.json` (OCR text
included, so the run and the scoring read the same input). Reproducibility is by
the pinned file, not by a seed. Actual draw: 320/320, 793,641 OCR characters.

## Design

- **Paired.** Both arms translate the same 320 pages through the same door
  (`buildTranslationPrompt` from `translate-core.mjs`, with the arm's prompt
  substituted), same model, same `thinkingBudget: 0`, same safety settings, no
  previous-page context in either arm.
- **Model.** Default: `gemini-3.1-flash-lite` for every page, both arms
  (estimate **$1.47**). Alternative `--route`: production's per-book routing,
  which puts six of the eight strata on `gemini-3-flash-preview` (estimate
  **$2.64**). The recommendation to Derek is `--route`: the flip ships on that
  routing, and a prompt effect measured on a model a stratum never uses is a
  weaker basis than one measured on the model it does.
- **k = 1 per (page, arm).** This is not in tension with `prompt-ab.mjs`'s
  repeated-measures rule. That harness needed k≥5 because its outcome was body
  length on ~10 pinned pathological pages, where within-page sampler variance
  swamped the arm effect. Here the outcome is a rate over 320 independent pages;
  precision comes from n, and 320 pages at k=1 buys more of it than 64 pages at
  k=5 for the same money. The cost is that nothing here speaks to per-page
  stability, and it is not asked to.
- **Unit of analysis is the page** throughout. Pooled rates carry a bootstrap CI
  that resamples pages (`bootstrapRatioCI`, cluster bootstrap), never notes.
  Paired deltas use `diffCI` and the exact sign test from `lib/paired-stats.mjs`.

## Outcomes, computed identically on both arms

| outcome | definition | role |
|---|---|---|
| verified-note rate | `parseTranslationTerms(text, ocr)` rows of kind `original` with `verified === true`, over all `original` rows; pooled across pages | **primary** |
| notes per page | `original` rows per page | **co-primary** (gaming check) |
| invented tags / page | tag tokens outside {meta, note, term, gloss, margin, insert, unclear, column-break, warning, summary, keywords} ∪ the housekeeping set | gate |
| housekeeping tags / page | tokens in {vocab, language, lang, page-type, page-num, sig, scan-quality, script, columns, header, image-desc, folio, abbrev, detected-images, catchword} | gate |
| glossary block | free-text "Vocabulary:/Key terms:/Glossary" heading, or ≥3 `<term>/<gloss>` pairs one per line with no prose between | gate |
| em-dashes / page | in prose body | gate |
| body chars / page | prose after removing apparatus, glossary blocks and original-note citations (the two things v15 removes by design); interpretive notes stay in | gate, floor 10% |
| inline terms / page | `<term>` tokens outside glossary blocks — what the learn route and reader chips get | gate, floor 20% |
| blind judgement | 30 pairs, arm labels stripped, left/right randomised: does either side LOSE something the other keeps? | secondary gate |

Every outcome has a positive control in
`tests/unit/translation-prompt-ab-metrics.test.ts` — a hand-built page on which it
must fire and a clean page on which it must not. A metric that cannot fire is
not a measurement.

## Decision rule (fixed; the harness applies it verbatim)

**Recommend the flip iff ALL of:**

1. The paired 95% bootstrap CI on Δ(per-page verified rate), over pages that emit
   at least one original-note in BOTH arms, excludes zero and is positive.
2. The pooled verified-note rate under v15 exceeds v13 by **≥ 3 percentage
   points**. (Why 3: with ~250 note-emitting pages the standard error on the
   paired difference is ~2 pp, so 3 is the smallest gain the design can
   distinguish from noise, and it is a third of the way from the corpus 91% to
   100% — a material cut in fabricated citations, not a rounding difference.)
3. Notes per page under v15 are **not more than 20% below** v13.
4. Body chars per page under v15 are **not more than 10% below** v13.
5. No gate fires. A gate fires on a change that is decisive (95% CI excludes
   zero) in the wrong direction and, where a floor is stated, beyond it.
6. The blind judge finds v15 the WORSE side in **no more than 1.5×** as many pairs
   as it finds v13 worse (ties excluded), over 30 pairs. (Not 1:1, because with
   30 pairs a 9-vs-7 split is noise; 2:1 or worse is not.)

**Otherwise: do not flip, report which criterion failed, and say what it would
take.** Partial credit is reported as "not established", never argued into a
flip. If criterion 1 or 2 passes but 3 fails, the headline is "v15 stops writing
notes", which is the failure mode this plan exists to catch.

Per-stratum rates are REPORTED, not gated: the flip is one default for the
whole corpus, and a stratum that regresses is a finding for the report and a
possible per-language prompt, not a veto in this rule.

## What this does not measure, on purpose

- Translation QUALITY in the ordinary sense. There is no reference and BLEU
  against one would be theatre. The blind judge asks only about loss.
- Whether notes that verify are USEFUL. A verbatim quote of the wrong phrase
  verifies. That is a different study.
- Per-page stability (see k=1 above).
- The v14 `<lacuna>` rule (#4584): not in either arm. If v14 is promoted first,
  v15 must be re-seeded with `--from 14 --version 16` and this study re-run.

## Cost

640 calls (320 pages × 2 arms), text-in text-out on existing OCR. From the
pinned sample's real character counts and `scripts/lib/model-pricing.mjs`:
**$1.47** all on lite, **$2.64** under production routing. Approval is per run,
explicit, and the harness refuses to start without `--approved-usd` ≥ estimate.

## Amendments

None yet. If the rule must change after the run, the change goes here with the
date and the reason, the original stays above, and the results are reported
under both — a preregistration that is quietly rewritten stops being one.
