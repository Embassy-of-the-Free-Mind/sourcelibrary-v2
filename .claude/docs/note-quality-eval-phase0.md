# Note-quality eval — Phase 0 (mechanical pass)

_Run date: 2026-07-22. Issue: #3308. Script: `scripts/analysis/note-quality-phase0.mjs`.
Pure Mongo reads + string matching — no model calls, no writes to any database._

## Why

`<note>` content is served to readers (gold highlight), kept in quotable text (`get_quote`), and
baked into embeddings — but its correctness had never been measured. This is Phase 0 of the #3308
plan: a corpus-scale, $0, purely mechanical pass that (1) checks whether `original: "X"` notes
quote text that's actually on the page, (2) measures how often notes reference adjacent pages (a
quote-integrity hazard per CLAUDE.md's Quote & snippet integrity section), (3) checks structural
compliance (nesting/unbalanced tags/multi-paragraph) against the #3298 baseline, and (4) builds a
class distribution for the Phase 1 stratified sampling frame.

## Inclusion criteria & population

- **Universe:** the `pages` collection (~19.1M documents in production `bookstore`). There is no
  text index on `translation.data`, so a full COLLSCAN with a `$regex` filter is not viable in a
  single session (confirmed by timing: 100K pages via `$sample` + `$match` + light projection took
  ~94s; a full COLLSCAN at 19.1M documents would run for hours).
- **Sampling:** **250,000 pages** drawn via MongoDB's `$sample` aggregation stage — a pseudo-random
  storage-engine walk, not a COLLSCAN, so it stays fast at this collection size. This is the
  issue's allowed Phase-0 fallback ("run a large random-but-deterministic subset and clearly label
  it") — not deterministic by a hash predicate (evaluating a hash still requires a full scan), but
  every sampled `page_id` is persisted in `notes.jsonl`, so the exact population of THIS run is
  fully reproducible/auditable even though a re-run draws a fresh random sample.
- **Filter:** of the 250,000 sampled pages, **107,784 (43.1%)** contain at least one `<note>` span
  in `translation.data`.
- **Unit of analysis:** every `<note>...</note>` span on every kept page — **459,514 notes total**,
  across **9,403 distinct books**.
- **Strata:** `translation.model` × `translation.prompt_version` × `books.language` × century
  (derived from `books.year`, joined on `pages.book_id = books.id` — NOT `books._id`, which is a
  *different* ObjectId; confirmed by direct lookup before writing the sweep). Missing values bucket
  as `"unknown"`.
- **Runtime:** 1,583.8s (26.4 min) end to end, matching the issue's ~30 min estimate.
- **Verification:** every count in this report was cross-checked by re-deriving it directly from
  the raw `notes.jsonl` (independent of `aggregates.json`) — all totals matched exactly.

## Original-phrase fidelity — method

For notes matching `original: "X"` (and variants — `original symbol:`, `original text:`, markdown
`*X*`/`**X**`, `<term>X</term>`, and bare unwrapped tokens), the extracted phrase X is normalized
and checked against the SAME page's `ocr.data`, also normalized:

- **Normalization:** lowercase; long-s `ſ→s`; ligatures (æ/œ/ﬁ/ﬂ/ﬀ/ﬃ/ﬄ/ĳ); strip diacritics
  (NFD, strip combining marks); strip punctuation; collapse whitespace. **Beyond the base spec**,
  this pass also folds classical u/v and i/j (`"Judicio"`/`"Iudicio"`, `"vt"`/`"ut"` — early modern
  printers used these interchangeably) since it's applied identically to both sides of the
  comparison and can only reduce false MISS verdicts, never inflate false matches. This addition
  was necessary: an 8K-page dry run without it measured 27.9% "miss" on the strict quoted-only
  class; with it, ~13-15%. This matches the issue's own 2026-07-22 preliminary comment, which found
  u/v-i/j folding essential to get real fabrication signal out of a 17-20% "not found" residue.
- **Match rule:** exact substring after normalization = `match`; else sliding-window best
  similarity (bigram-Dice over windows of `len(X) ± 20%`) — similarity ≥ 0.85 = `fuzzy_match`,
  else `miss` (candidate fabrication).
- **Excluded from the fabrication denominator, tracked separately:**
  - `miss_empty_ocr` — the page's OCR is empty or under 20 normalized characters. Negligible in
    practice: **19 of 122,816** strict quoted notes (0.02%).
  - `miss_script_mismatch` — the page's OCR is predominantly a non-Latin script (Devanagari,
    Tibetan, Han, Hiragana/Katakana, Hebrew, Arabic, Greek, Tamil, Bengali, and 13 other Indic/SE
    Asian/Caucasian scripts) while the quoted "original" phrase is predominantly Latin letters — a
    romanization. Character-level normalization can never bridge a script boundary, so a miss here
    is a transliteration-representation gap, not a fabrication signal. This is "cause 1" from the
    issue's own preliminary comment (Sanskrit/Chinese/Tibetan romanizations quoted against
    original-script OCR) and turned out to be the single largest source of false MISS:
    **18,272 of 122,816** strict quoted notes (14.9%).
- **Reported at two scopes:** `strict_quoted_only` (the literal `original: "X"` spec — a real
  quote mark after the prefix, 122,816 notes) and `all_wraps` (includes markdown/`<term>`/bare-token
  variants, 138,339 notes — about 11% of `original:` notes use a non-quote wrapper). The headline
  below is `strict_quoted_only`.

## Headline results

| Metric | Value |
|---|---|
| Pages sampled (via `$sample`) | 250,000 |
| Pages with `<note>` | 107,784 (43.1%) |
| Total notes | 459,514 |
| Distinct books | 9,403 |
| `original:` notes, strict quoted | 122,816 |
| — scoreable (excl. empty/short OCR + script mismatch) | 104,312 |
| — exact match | 88,113 (**84.5%** of scoreable) |
| — fuzzy match (≥0.85 similarity) | 3,469 (3.3%) |
| — **candidate fabrication (miss)** | 12,730 (**12.2%** of scoreable) |
| — excluded: empty/short OCR | 19 (0.02% of all strict-quoted) |
| — excluded: script mismatch (romanization vs non-Latin OCR) | 18,272 (14.9% of all strict-quoted) |
| `original:` notes, all wraps (incl. markdown/`<term>`/bare) | 138,339 scoreable-eligible; fabrication rate 13.4% |

**Headline: ~12.2% of `original: "X"` quoted-phrase notes are candidate fabrications** — X does not
appear, exactly or near-exactly, anywhere on the page's OCR text, after controlling for empty OCR
and script-boundary romanization. This is a mechanical upper-bound estimate (see Limitations); Phase
2's page-image judges will separate genuine fabrication from residual normalization gaps (OCR errors
on the comparison side, contraction expansion, inflected-stem variance) within this 12.2%.

## Fabrication rate by stratum

Strata with ≥200 scoreable notes (59 of 713 total strata; smaller strata are noisy and omitted from
this table but are all present in `aggregates.json`/`notes.jsonl` for anyone who wants them).

**Best (lowest candidate-fabrication rate):**

| Model | Prompt version | Language | Century | n (scoreable) | Fabrication rate |
|---|---|---|---|---|---|
| gemini-3-flash-preview | v2 | Irish/English | 20th | 855 | 0.9% |
| gemini-3-flash-preview | v5.1.2026-03b | Irish/English | 20th | 983 | 1.0% |
| gemini-3-flash-preview | v2 | Dutch | 16th | 250 | 2.0% |
| gemini-3.1-flash-lite-preview | v10 | Greek | 20th | 202 | 2.5% |
| gemini-3-flash-preview | v2 | German | 18th | 356 | 2.8% |
| gemini-3.1-flash-lite-preview | 11 | Tibetan | 17th | 676 | 3.0% |
| gemini-3.1-flash-lite-preview | v10 | Greek | 19th | 507 | 3.4% |
| gemini-3-flash-preview | v10 | German | 17th | 7,404 | 3.5% |

**Worst (highest candidate-fabrication rate):**

| Model | Prompt version | Language | Century | n (scoreable) | Fabrication rate |
|---|---|---|---|---|---|
| gemini-3.1-flash-lite-preview | v10 | Greek | 17th | 218 | 17.9% |
| gemini-3.1-flash-lite-preview | v10 | Greek | 16th | 1,282 | 18.6% |
| gemini-3-flash-preview | v10 | French | 18th | 1,013 | 20.0% |
| gemini-3-flash-preview | v10 | Latin | 16th | 6,311 | 23.0% |
| gemini-3-flash-preview | 11 | Greek | 20th | 1,269 | 27.7% |
| gemini-3-flash-preview | v10 | Dutch | 18th | 542 | 29.3% |
| gemini-3.1-flash-lite-preview | v10 | Hebrew | 19th | 494 | 32.4% |
| gemini-3-flash-preview | 11 | Sanskrit | 20th | 275 | 41.5% |

Notable pattern: **Greek appears at both ends** (2.5-3.4% on some model/century cells, 17.9-27.7%
on others) — worth a targeted look before concluding "Greek is bad," since Greek transliteration
conventions (breathing marks, iota subscript, polytonic vs monotonic) are exactly the kind of
diacritic-heavy orthography this pass's normalization may under- or over-fold inconsistently
depending on how the note phrase vs. the OCR rendered them. The worst single cell (Sanskrit, 41.5%,
n=275) sits suspiciously close to the script-mismatch failure mode this pass tries to exclude —
some Sanskrit source editions are themselves printed in IAST Latin-script transliteration, which
would NOT trip the `miss_script_mismatch` detector (that only fires when OCR is predominantly
non-Latin-script) even though the same "two different romanization conventions" problem applies.
**This cell should be sampled first for Phase 1/2**, not taken as a fabrication verdict.

## Adjacent-page reference rate

| Metric | Value |
|---|---|
| Notes with an adjacent-page reference (any family) | 1,497 / 459,514 (**0.33%**) |
| "previous page" | 1,006 |
| "continues from" | 574 |
| "next page" | 248 |
| "following page" | 110 |
| "see page" | 69 |
| "preceding page" | 28 |
| "continued on" | 19 |
| "prior page" | 1 |

Low in absolute rate, but every one of these 1,497 notes is a concrete quote-integrity risk per
CLAUDE.md's Quote & snippet integrity doctrine — a note whose content genuinely describes a
*different* page's content, rendered as if it belongs to this one. Worth a targeted Phase 1 sample
independent of the class-stratified sample.

## Structural compliance (vs. #3298 baseline: 0.4% nested / 0.8% unbalanced / 3.7% multi-paragraph)

**Overall** (107,743 pages considered — pages with at least one note where tag-balance was
evaluated):

| Check | Rate | vs. #3298 baseline |
|---|---|---|
| Nested `<note>` inside `<note>` | 0.35% | close (baseline 0.4%) |
| Unbalanced open/close `<note>` tags (page-level) | 0.43% | notably lower (baseline 0.8%) |
| Multi-paragraph notes (blank line inside a note) | 0.05% | much lower (baseline 3.7%) |

**By prompt_version** (top 6 by note volume; full table in `aggregates.json`):

| Prompt version | Notes | Pages | Nested | Multi-paragraph | Unbalanced (page) |
|---|---|---|---|---|---|
| v10 | 232,951 | 52,782 | 0.40% | 0.06% | 0.41% |
| 11 | 196,888 | 49,800 | 0.33% | 0.05% | 0.45% |
| v2 | 13,742 | 1,542 | 0.08% | 0.02% | 0.39% |
| v1 | 7,652 | 2,786 | 0.01% | 0.01% | 0.11% |
| v5.1.2026-03b | 3,829 | 293 | 0.00% | 0.05% | 1.37% |
| v5.2026-02 | 3,637 | 356 | 0.00% | 0.05% | 0.28% |

Current production prompt versions (`v10`, `11` — together 93.4% of all notes in this sample) are
structurally cleaner than the #3298 baseline across the board, especially multi-paragraph (0.05-0.06%
vs. 3.7%). Two plausible explanations, not distinguished by this mechanical pass: newer prompt
revisions write cleaner `<note>` output, or the #3298 baseline measured a different (possibly
older, possibly render-path-specific) population. Either way — **Gate C's premise holds**: whatever
structural cleanup is needed, current-generation prompts are not where it's needed most.

## Class distribution (Phase 1 sampling frame)

| Class | Count | Share |
|---|---|---|
| `interpolation-other` | 308,775 | 67.2% |
| `original-phrase` | 138,649 | 30.2% |
| `explanation` | 9,429 | 2.1% |
| `image-desc` | 2,661 | 0.6% |

Classification is a rough regex heuristic (per the issue: "Rough is fine") meant only to build the
Phase 1 stratified sampling frame, not as a quality claim. The `original-phrase` share (30.2%) is
lower than the issue's initial small-sample estimate (~39%) and the `interpolation-other` share
(67.2%) correspondingly higher — plausibly because `interpolation-other` is the classifier's
catch-all and swallows some genuine explanation/image-desc notes that don't match the narrow regex
heuristics (e.g., an image description that doesn't start with one of the listed keywords, or an
explanation that doesn't use one of the listed copula phrases). Phase 1's human/LLM-assisted
sampling should treat this split as approximate, not final.

## What this means for Gates A/B/C (#3308)

- **Gate A** (original-phrase fabrication < ~2% → mark as verified-source): **not met at 12.2%
  overall.** This class cannot be blanket-marked as verified-source today. However, the by-stratum
  spread (0.9% to 41.5%) means a *stratum-conditional* Gate A is plausible — several
  model/prompt/language/century cells (Irish/English, Dutch 16th c., German under `v2`) already
  clear a 2% bar. Phase 1/2 should prioritize confirming whether the low-fabrication strata's
  "miss" residue is genuinely near-zero fabrication or an artifact of small samples before writing
  any stratum-conditional provenance rule.
- **Gate B** (explanation/image classes show material error rates → add reader labeling): Phase 0
  cannot measure factual/visual accuracy — that requires the Phase 2 page-image judges. What Phase 0
  *does* show: these classes are a meaningful share of notes (2.1% + 0.6% = 2.7%, but likely
  undercounted per the class-distribution caveat above), so Gate B's premise ("material volume worth
  labeling if wrong") is not obviously false on volume grounds. Needs Phase 2 data to decide.
- **Gate C** (prompt v-next changes prioritized by which failure modes are still being written vs.
  frozen legacy): structural compliance data above supports this — `v10`/`11` (current production,
  93.4% of notes) are already cleaner than the #3298 baseline on all three structural checks, so a
  structural prompt fix is lower priority than a **fabrication-focused** prompt fix, since the
  12.2%/13.4% fabrication rates show no comparable improvement trend across prompt versions in this
  data (the by-stratum table mixes `v10`/`11` across both the best and worst rows — prompt version
  alone does not predict fabrication rate; language does, more strongly).

## Known limitations of this mechanical pass

- This is a **heuristic first pass**, not a verdict. The "miss" bucket still mixes genuine
  candidate fabrications with residual normalization gaps this pass doesn't handle (contraction
  expansion — e.g. `tempestaté` vs `tempestatem`; inflected-stem tolerance; OCR errors on the
  comparison side itself; and, per the Sanskrit finding above, romanization-vs-romanization
  mismatches that the script-mismatch detector cannot catch because it only fires when OCR is
  predominantly *non*-Latin-script). Phase 2's page-image judges resolve these definitively.
- Classification (`original-phrase` / `image-desc` / `explanation` / `interpolation-other`) is
  regex-heuristic, deliberately rough per the issue ("Rough is fine") — it's a sampling frame for
  Phase 1, not a quality claim. See the class-distribution caveat above.
- The sliding-window fuzzy match caps OCR scan length at 4,000 normalized characters per page (perf
  guard); pathologically long pages are truncated for the fuzzy-fallback pass only (the exact
  substring check always runs against the full text, uncapped).
- Sample is a fresh random draw each run (via `$sample`), not the same page set across reruns.
  Reproducibility is at the level of "every note in `notes.jsonl` carries its `page_id`, so this
  run's exact population and every verdict is auditable" — not "rerunning reproduces this exact
  table." A second independent run would be expected to land close to these numbers (population is
  large — 100K+ scoreable notes) but not identically.
- Only `<note>` spans were counted (per the issue's Phase 0 scope). The sibling annotation family
  (`<margin>`, `<gloss>`, `<insert>`, `<unclear>`, `<image-desc>` as a standalone tag rather than a
  note-class heuristic) handled by `normalize-annotation-spans.ts` was out of scope for this pass.

## Outputs

- Script: `scripts/analysis/note-quality-phase0.mjs`
- Per-note JSONL (459,514 rows, ~174 MB, not committed — regenerate by re-running the script):
  `/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/84edbaac-64b7-4a41-9a1e-8b42eb820a0c/scratchpad/note-quality-phase0/notes.jsonl`
- Aggregates snapshot (not committed): same directory, `aggregates.json`
- Run log (not committed): same directory, `progress.log` / `run.out`
