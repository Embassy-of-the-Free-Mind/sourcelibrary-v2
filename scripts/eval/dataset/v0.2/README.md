# Source Library OCR-Eval Dataset v0.2

Reference-scored OCR observations on historical printed and manuscript pages, with a
**memorization control**: every reference passage is labeled canonical (texts frontier
models have plausibly memorized) or non-canonical (editor prefaces, biographical front
matter, mid-text passages of rarely digitized works). The canonical-vs-non-canonical
score gap on matched pages estimates the **memorization subsidy** — how much better a
vision-language model scores on text it can recite than on text it can only read.

Produced by [Source Library](https://sourcelibrary.org) (Embassy of the Free Mind).
Build tooling and provenance: `scripts/eval/` in the
[sourcelibrary-v2](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2) repo
(issues #3212, #3235; PRs #3253–#3265). Exported 2026-07-19 by `export-eval-dataset.mjs`.

## What changed since v0.1

- **40 pages, up from 23.** Twelve new non-canonical pages inside editions already in
  the set (Hero's *Pneumatica*, Simplicius' *In Physica*, Philo's *De opificio mundi*,
  Eznik's *Ełc ałandoc'*, Movses Xorenac'i's *Patmut'iwn Hayoc'*) plus five German
  pages page-aligned against DTA TEI (Hegel ×2, Herder, Humboldt, Boltzmann). The set
  is now 12 canonical / 28 non-canonical.
- **921 scored runs, up from 339**, including two new experiment arms (below) and
  full Mistral-OCR coverage of the non-canonical rows.
- **Two manipulated arms**, tagged on the `model` field so every arm is a within-page,
  within-model contrast against the untagged baseline:
  - `@w2000` / `@w1000` / `@w600` — the same page re-rendered at that pixel width.
  - `@annotated` — the production Source Library OCR prompt (v15, annotation contract)
    instead of the bare transcription prompt.

## Files

- **`pages.jsonl`** — 40 pinned pages. Book metadata (title, author, year, language,
  Internet Archive identifier where applicable, Source Library URLs), visually audited
  `page_class` covariates (`source_class`, `layout`, `density`, `type_size`,
  `canonical_text`, `memorization_risk`), and **measured image resolution**
  (`image.width/height/bytes/megapixels`, from the exact image URL the models OCR'd —
  40/40 pages measured, 0.64–17.4 MP).
- **`references.jsonl`** — 40 reference passages with provenance (`source`,
  `source_url`), license status, and the passage text **where the source license
  permits redistribution** (20 of 40: First1KGreek CC-BY-SA, Wikisource CC BY-SA,
  Living Poets CC-BY/PD, Clementine Vulgate PD, Sefaria PD versions). For the rest
  (TITUS, ctext.org, the DTA German passages, and other transcriptions whose license
  we could not confirm — all marked `UNKNOWN`) the row carries
  `reference_sha256` over the exact UTF-8 string plus retrieval instructions — the
  passage boundaries are documented in the repo's `scripts/eval/reference-works/` files.
- **`runs.jsonl`** — 921 scored observations: one row per (page × model × run) across
  `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`,
  `claude-sonnet-5`, `mistral-ocr-latest`, the two tagged arms, the production pipeline
  OCR, and interactive Claude transcriptions. Each row has the raw model output
  (produced by us, on public-domain scans), alignment verdict, guard value, and
  character accuracy, stamped with `scoring_version` (the git sha of the metric
  implementation). Raw text is the durable artifact — scores are re-derivable.
- **`checksums.txt`** — sha256 of each jsonl.

## Scoring method (summary)

The reference is matched as an **in-order subsequence** of the OCR output: extra OCR
material (commentary, critical apparatus, editorial annotations, a facing translation
column) is skipped free, and errors are counted only on the reference span. A
word-level subsequence guard (char-level for CJK) decides whether the passage is
genuinely present (`aligned`); character accuracy is then computed on normalized text
with edition-orthography folds (u/v, i/j, long-s, niqqud, polytonic marks, Armenian
ew-ligature). Consequence: scores measure accuracy **on the reference passage only**,
not page completeness.

Report `char_accuracy` (conditional, aligned runs only) and `char_accuracy_raw`
(unconditional, all runs) separately — they rank models differently, which is one of
the dataset's findings rather than an artifact.

## Known caveats (read before drawing conclusions)

1. **Canonical scores are memory-assisted upper bounds.** Two earlier canonical rows
   were deleted after page-scan audits proved models *recited* the passage from memory
   (letter-perfect canonical text not printed on the page). Text-only checks cannot
   distinguish reading from reciting; every page here was visually audited to confirm
   the passage is printed.
2. **Pool at your peril.** The pooled canonical-vs-non-canonical gap moves with page
   mix: it read +1.3 to +2.6pp at 23 pages and −2.0 to +1.2pp at 40 pages, because the
   pages added are cleaner than the canonical pages they pool against. Only the
   **same-book contrasts** are controlled comparisons, and just two books (the 1580
   Virgil and the 1566 Louvain Vulgate) currently print both classes.
3. **Reference-transcription conventions masquerade as OCR error.** The TITUS Armenian
   references silently expand nomina-sacra abbreviations the printings abbreviate; the
   Eznik reference follows 1959 critical orthography against an 1826 printing; the
   Dioscorides reference is a different edition (Wellmann 1907 vs the 1549 Ruel print)
   — its accuracy is a lower bound. Per-row `audit_note`/works-file notes document these.
4. **Model consensus is not independent on canonical text**: two models reciting the
   same memorized passage agree perfectly while both misreport the page. Calibrate any
   agreement→accuracy mapping on non-canonical rows only.
5. **Resolution is measured, and it is not the factor it looks like.** Image resolution
   spans 27× across pages, but the resolution arm shows accuracy differences in the
   600–2000px range are mediated by *truncation*, not legibility (caveat 6).
6. **Arm cells are thin.** The `@w*` arms are 6 pages × 2 models × 2 runs; `@annotated`
   is 40 pages × 2 models × 3 runs. Both arms cover flash and flash-lite only.
7. **n is small.** 40 pages, unbalanced cells. Treat interaction estimates as
   hypotheses, not findings.

## Headline observations (2026-07-19 rebuild)

- **Same-book contrast (1580 Virgil)**: canonical Aeneid beats non-canonical Vita for
  every model — flash-lite 5.4pp, sonnet-5 4.7pp, pipeline 3.1pp, mistral 1.3pp,
  flash 1.2pp, pro 1.0pp. The 1566 Vulgate contrast is flat, consistent with Jerome's
  prologues being partially memorized themselves.
- **Ranking inversion**: conditional accuracy ranks Gemini Pro first (99.2% canonical);
  unconditional accuracy puts flash-lite (98.0%, 0% truncation) and the production
  pipeline (98.9%) ahead of it (90.5%, 15% truncation).
- **Anomaly consistent with recitation**: claude-sonnet-5 scores 99.4% on the Iliad in
  a 1555 *manuscript* (1.66 MP) but 97.3% on non-canonical Greek in clean 19th-c
  *print* (6.5–8.4 MP).
- **Mistral-OCR fails categorically on canonical pages it cannot align to** (0/4
  aligned on canonical Armenian, 0/3 on canonical Greek) while reaching 99.6% on
  non-canonical Greek — a specialist system with no recitation channel behaves
  differently in kind, not degree.
- **Resolution**: flash-lite is flat within 0.6pp from 600px to native across the whole
  set; flash is non-monotonic, and the page-level swings track truncation flips (one
  Hebrew page improves 50.2% → 95.2% when downscaled to 600px as its truncation rate
  falls 100% → 0%).
- **Prompt contract**: the production annotated prompt costs ≈1pp of unconditional
  accuracy (flash −0.91pp, lite −1.24pp) with alignment unchanged. No reliable
  canonicity × prompt interaction.

## License

- Page images: reproductions of public-domain works, served from Source Library.
- Model outputs, scores, covariates, and this compilation: CC-BY-4.0
  (attribution: Source Library / Embassy of the Free Mind).
- Reference texts: per-row `license` field; rows with `text_included: false` must be
  retrieved from their sources under those sources' terms.

## Citation

Source Library OCR-Eval Dataset v0.2 (2026). Embassy of the Free Mind / Source
Library. https://sourcelibrary.org — repository: Embassy-of-the-Free-Mind/sourcelibrary-v2,
`scripts/eval/dataset/v0.2/`. (DOI pending.)
