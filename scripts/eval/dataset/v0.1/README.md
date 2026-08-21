# Source Library OCR-Eval Dataset v0.1

Reference-scored OCR observations on historical printed and manuscript pages, with a
**memorization control**: every reference passage is labeled canonical (texts frontier
models have plausibly memorized) or non-canonical (editor prefaces, biographical front
matter, mid-text passages of rarely digitized works). The canonical-vs-non-canonical
score gap on matched pages estimates the **memorization subsidy** — how much better a
vision-language model scores on text it can recite than on text it can only read.

Produced by [Source Library](https://sourcelibrary.org) (Embassy of the Free Mind).
Build tooling and provenance: `scripts/eval/` in the
[sourcelibrary-v2](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2) repo
(issues #3212, #3235; PR #3253). Exported 2026-07-19 by `export-eval-dataset.mjs`.

## Files

- **`pages.jsonl`** — 23 pinned pages. Book metadata (title, author, year, language,
  Internet Archive identifier where applicable, Source Library URLs), visually audited
  `page_class` covariates (`source_class`, `layout`, `density`, `type_size`,
  `canonical_text`, `memorization_risk`), and **measured image resolution**
  (`image.width/height/bytes/megapixels`, from the exact image URL the models OCR'd).
- **`references.jsonl`** — 23 reference passages with provenance (`source`,
  `source_url`), license status, and the passage text **where the source license
  permits redistribution** (13 of 23: First1KGreek CC-BY-SA, Wikisource CC BY-SA,
  Living Poets CC-BY/PD, Clementine Vulgate PD, Sefaria PD versions). For the rest
  (TITUS, ctext.org, unknown-license transcriptions) the row carries `reference_sha256`
  over the exact UTF-8 string plus retrieval instructions — the passage boundaries are
  documented in the repo's `scripts/eval/reference-works/` files.
- **`runs.jsonl`** — 339 scored observations: one row per (page × model × run) across
  `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`,
  `claude-sonnet-5`, `mistral-ocr-latest` (canonical rows only), the production
  pipeline OCR, and interactive Claude transcriptions. Each row has the raw model
  output (produced by us, on public-domain scans), alignment verdict, guard value, and
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

## Known caveats (read before drawing conclusions)

1. **Canonical scores are memory-assisted upper bounds.** Two earlier canonical rows
   were deleted after page-scan audits proved models *recited* the passage from memory
   (letter-perfect canonical text not printed on the page). Text-only checks cannot
   distinguish reading from reciting; every page here was visually audited to confirm
   the passage is printed.
2. **Resolution is a live confound, now measured.** Image resolution spans 0.64–17.4 MP
   (27×) across pages. E.g., the Hebrew non-canonical pages (0.64 and 4.9 MP) are much
   lower resolution than the Hebrew canonical pages (5.3–7.2 MP), so the raw Hebrew
   canonical/non-canonical gap conflates memorization with resolution. Same-book
   contrasts (the 1580 Virgil and 1566 Louvain Vulgate pairs) are the controlled
   comparisons.
3. **Reference-transcription conventions masquerade as OCR error.** The TITUS Armenian
   references silently expand nomina-sacra abbreviations the printings abbreviate; the
   Eznik reference follows 1959 critical orthography against an 1826 printing; the
   Dioscorides reference is a different edition (Wellmann 1907 vs the 1549 Ruel print)
   — its accuracy is a lower bound. Per-row `audit_note`/works-file notes document these.
4. **Model consensus is not independent on canonical text**: two models reciting the
   same memorized passage agree perfectly while both misreport the page. Calibrate any
   agreement→accuracy mapping on non-canonical rows only.
5. **n is small.** 23 pages, unbalanced cells (8/23 are print/dense/small; one
   manuscript). Treat interaction estimates as hypotheses, not findings.

## Headline observations (2026-07-19 sweep)

- Same-book contrast (1580 Virgil): canonical Aeneid beats non-canonical Vita for
  every model — up to 5.4pp (flash-lite) / 4.7pp (sonnet-5).
- Anomaly consistent with recitation: claude-sonnet-5 scores 99.4% on the Iliad in a
  1555 *manuscript* (1.66 MP) but 97.3% on non-canonical Greek in clean 19th-c
  *print* (6.5–8.4 MP).
- Pooled memorization subsidy among aligned runs: ~1–3pp (Pro-class), up to ~5pp
  (small models); pooled numbers carry the confounds in caveats 2–3.

## License

- Page images: reproductions of public-domain works, served from Source Library.
- Model outputs, scores, covariates, and this compilation: CC-BY-4.0
  (attribution: Source Library / Embassy of the Free Mind).
- Reference texts: per-row `license` field; rows with `text_included: false` must be
  retrieved from their sources under those sources' terms.

## Citation

Source Library OCR-Eval Dataset v0.1 (2026). Embassy of the Free Mind / Source
Library. https://sourcelibrary.org — repository: Embassy-of-the-Free-Mind/sourcelibrary-v2,
`scripts/eval/dataset/v0.1/`. (DOI pending.)
