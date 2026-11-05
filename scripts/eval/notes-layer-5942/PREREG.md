# PREREG — notes as their own layer, tried two ways (#5942, Part B)

Written 2026-10-24, before any Part B translation was made. Changes after this point are listed at the end with
the reason, never edited in place.

## Question

Can a translator return the translation and its notes as **two things** (plain text + anchored annotations)
without losing fidelity, with anchors that land, and with notes no worse than today's inline ones?

## Pages

40 pages: 10 each from books whose `language` is Latin, German, Greek, Chinese (Chinese includes
"Classical Chinese"). Seed 5942, one page per book. Frame, per book: `visible: true`, `pages_count > 0`, not held
(`pipeline_auto.hold` absent and `pipeline_auto.status != 'held'`), no page of the book carries
`translation_withheld` (containment), `reocr_candidate` not set. Page: OCR from a model (`ocr.source` not
`ia_djvu`), 600–3,500 characters of OCR, no `<warning>` in the OCR, `page_type` not a description-only type, and
the page before it has a stored translation (the production seed). Books sorted by id, shuffled with
mulberry32(5942) per language; the first 10 that have such a page give one, chosen by the same stream.
"Good OCR" means only these filters; it is not a by-eye judgement.

## Arms (same OCR input, same book line, same scoped page-break devices; Opus via sealed `claude -p`)

- **T** — today's production translation prompt (Standard Translation v13, `51651014…`), built by
  translate-core `buildTranslationPrompt` exactly as `cli-translate.mjs read` builds it, the stored previous page
  as seed, + agy-cli `TRANSLATE_SUFFIX` (the #6728 Opus arm, unchanged).
- **S** — the T prompt word for word (same instructions on what to annotate), plus one appended OUTPUT FORMAT
  block that overrides only the *form*: return JSON `{ "text", "annotations": [{ "type", "exact", "prefix",
  "suffix", "body" }] }`, `text` with no markup at all; page marks (margin, insert, unclear, printed gloss) keep
  their words in `text` and are annotations spanning them; page-level blocks (summary, keywords, meta) are
  annotations with `exact: ""`. Seed: the previous page through #6728 `plainSeed` (what an S pipeline would hold).
- **P** — #6728's PLAIN prompt (`prompts.mjs PLAIN_EDITS` on v13), `plainSeed` seed. Fidelity baseline only.

## Measures (all fixed now)

(a) **Fidelity**, blind. The body each judge sees: T and P through `splitAnnotations(...).text`
  (scripts/lib/annotation-layer.mjs, Part A's parser — notes, definitions, summary out; marks' words kept);
  S: its `text` through the same function (so any stray tag is treated alike). Candidates A/B/C in a seeded order
  per page, plus on 8 pages (2 per language) a 4th candidate: one arm's body with one planted meaning error
  (`pro-translate-6545/plant.mjs`, negation/number/name/clause) — the judge's control.
  Judge prompt: #6545's `JUDGE-PROMPT-PRO.md` rubric with the reference removed (the source is the only
  authority). Judges: Opus (all 40) and agy `gemini-3.8-flash-low` (a seeded 20, quota permitting). Never Argon.
  Report per arm: mean fidelity [95% CI, 2,000 bootstrap draws by page], S−T and P−T paired, pages with an
  omission / a reversal / an invention.
  **Rule:** S is "not worse than T" if S−T ≥ −0.15 with a lower bound > −0.30 under the Opus judge, and S has
  no more reversal pages than T + 2. The Gemini half is a second opinion, reported, not a gate.
(b) **S form**: valid JSON rate (after stripping a code fence); annotations whose `exact` is not in `text`
  (exact occurrence) / resolved by `resolveAnchor` (offset given by the first occurrence) / ambiguous; markup left
  in `text` (any tag of the vocabulary, any `<…>`); page-level annotations present (summary, keywords).
(c) **T form**: unclosed / stray tags per page (`splitAnnotations` malformed), and markup Part A's split cannot
  account for.
(d) **Note usefulness**: Opus, with the page image (Read tool on one local file, `--restricted`), every note of
  T (parsed) and S (annotations; commentary only: note, definition, original, image) on the page, pooled and
  shuffled, arm hidden, each shown with the phrase it attaches to and the translated sentence around it:
  `right` (true and about these words) / `wrong` (misreads the source or states a false fact) / `invented`
  (a quotation, source word, citation or fact with no basis on the page or in the record) / and a separate flag
  `misattached` (true, but about other words). Report per arm: notes per page, rate of each verdict.
(e) **Cost**: `claude -p` usage tokens per page per arm (input incl. cache, output); share of the weekly meter
  (`claude-job.sh where`) over the translation runs.
(6) **Robustness of S anchors**: on the S outputs, (i) a scripted edit set per page, seeded: insert a sentence
  at the start; delete one sentence; swap two adjacent words in one sentence; change the case and punctuation of one
  word; and (ii) an Opus correction pass of the English against the source on 20 pages (a real rewrite). Then
  `resolveAnchor` each anchored annotation in the edited text and classify against the word-diff truth (Part A's
  `truthOf`): survived (offset / quote / fuzzy) / orphaned, words gone / orphaned, words still there / misplaced.
  Every "misplaced" or "resolved where the diff lost the words" case is read by eye. **Rule:** misplaced must be
  ≤ 1% of anchors and 0 after the by-eye read for the recommendation to be "adopt".

## Recommendation rule

- **adopt S for new translations** if (a) passes, (b) valid JSON ≥ 95% and ≥ 90% of anchored annotations
  resolve in their own text, (d) S's wrong+invented rate is not above T's by more than 5 points, and (6) passes;
- **keep T** if (a) fails;
- **needs work** otherwise, naming which condition failed.

## Stop lines

Claude weekly meter ≥ 85% (run-arm.mjs stops). No paid Gemini, no Argon, no API key. Nothing is written to
pages, books or page_revisions.

## Changes after registration

No rule, arm, page or measure changed. Three facts of the run:
- 7 planted controls, not 8: `plant.mjs` found no plant site on gr-2.
- `resolveAnchor`'s zero-width (point) anchors were fixed during Part A (a by-eye read found them landing before
  a full stop); the fix landed before any Part B robustness scoring.
- The note reader (d) was given the page image and OCR but not the book line or previous page the translator saw;
  "invented" verdicts that rest on those are reported apart in the write-up.
