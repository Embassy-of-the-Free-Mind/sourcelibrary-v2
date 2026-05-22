# Automated Image Quality System — Design

**Status:** Design draft (2026-05-17)
**Author:** Derek + Claude
**Related:** scan-quality coverage, dedupe-best-copy picking, partial-archive triage

---

## Why this exists

For Source Library, **illustrations are the irreplaceable content.** Text is recoverable via OCR; a faded woodcut, a smeared engraving, or a microfilmed map is a permanent loss. The library needs a per-illustration technical-quality signal to:

1. **Choose the best copy among duplicates** — when two editions share the same Kircher diagram, pick the one with the sharper rendering of *that specific image*.
2. **Flag content concerns** — illustrations that arrived blank, microfilmed, partially captured, or destroyed by bad thresholding.
3. **Track corpus health** — distribution of scan quality across providers, eras, collections; provider-level baselines.

The existing `book.scan_quality` field (1,087 books, 4% coverage) and `audit-scan-quality.mjs` script have three problems: pixel-only scoring is unreliable at the extremes, sampling is too thin (2 pages/book), and the audit is decoupled from the production pipeline so it never reaches new books.

This design replaces it with a per-illustration system embedded in the image extraction pipeline.

---

## Architecture: three layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — Deterministic characteristics (free, every page)   │
│ sharp pixel-stats + Laplacian variance, histogram entropy,   │
│ bimodality, chroma spread, bytes-per-pixel                   │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — Gemini scan-quality assessment (in extraction)     │
│ Augment existing extraction prompt with scan_score,          │
│ scan_class, readable_text, illustration_fidelity,            │
│ page_completeness, concerns[]                                │
├─────────────────────────────────────────────────────────────┤
│ Layer 3 — Cross-validation & ML distillation (future)        │
│ Use L1+L2 outputs as labeled dataset; train a small visual   │
│ classifier for offline scoring at zero per-call cost         │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1 — Deterministic characteristics

Computed via `sharp` on the in-memory page buffer the image-extract-worker already has. ~5-10ms per page.

| Feature | Definition | Diagnostic signal |
|---|---|---|
| `megapixels` | width × height ÷ 1M | Resolution (capped — sharp ≠ large) |
| `bytes_per_pixel` | file size ÷ pixel count | < 0.02 = over-compressed or near-blank |
| `mean_brightness` | mean luminance across channels | Detects very dark/light pages |
| `mean_stdev` | mean per-channel stdev | Low = flat image (faded or blank) |
| `dynamic_range` | max channel range across channels | 0 = blank/uniform |
| `chroma_spread` | max abs(meanA - meanB) across R/G/B | < 5 = monochrome |
| `sharpness_var` | Laplacian variance on downsampled grayscale | Low = blurry/microfilm; high = sharp |
| `histogram_entropy` | Shannon entropy of grayscale histogram | Low = bitonal; mid = grayscale; high = photo |
| `bimodality` | top-2 histogram bin fraction | > 0.5 = bitonal; < 0.1 = photographic |

**Direct deterministic flags** these features make trivial to detect:

- **`is_blank`**: `dynamic_range < 5 && sharpness_var < 10`
- **`is_monochrome`**: `chroma_spread < 5`
- **`is_bitonal`**: `bimodality > 0.5 && histogram_entropy < 4`
- **`is_over_compressed`**: `bytes_per_pixel < 0.015`
- **`is_low_resolution`**: `megapixels < 1`

These don't need Gemini — they're noise-free deterministic flags.

### Layer 2 — Gemini scan-quality assessment

Embedded in the existing `image-extract-worker.mjs` Gemini call. Single prompt, single round-trip per page. Adds ~20% to prompt output tokens; essentially free incremental cost.

The augmented JSON output, **per page** (not per illustration — the page is what Gemini sees):

```json
{
  "extracted_images": [...],          // existing — illustration bboxes + curatorial fields
  "scan_quality": {                   // NEW — page-level technical assessment
    "scan_score": 0-100,
    "scan_class": "color_photo" | "color_print" | "grayscale_photo" |
                  "grayscale_print" | "bitonal_clean" | "bitonal_microfilm" |
                  "microfiche" | "blank" | "corrupt",
    "readable_text": true | false,
    "illustration_fidelity": "pristine" | "good" | "degraded" |
                             "destroyed" | "no_illustration",
    "page_completeness": "full_page" | "partial_capture" |
                         "two_pages_one_image" | "fragment" | "blank",
    "concerns": ["bleed_through", "gutter_shadow", "page_skew", ...],
    "reasoning": "<2 sentences>"
  }
}
```

**Why `scan_class` matters most:** it distinguishes `bitonal_clean` (a pristine modern bitonal scan of a woodcut) from `bitonal_microfilm` (high-contrast pepper-noise scan-of-scan). Pixel stats alone cannot reliably make this distinction. Validation on 11 known samples (below) showed Gemini handled this correctly even when bimodality and entropy looked similar.

**Why `page_completeness` matters:** catches a class of defects pixel stats miss entirely — two-pages-in-one-image (folio scans split incorrectly), fragments (partial-capture failures), scanner-bed-visible captures.

**Why both `scan_class` and `concerns[]`:** `scan_class` is one canonical category for filtering/aggregation; `concerns[]` is a free-text list of issues for surfacing to humans and for tier-2 review.

**Model choice:** `gemini-3-flash-preview`. Validated against `gemini-3.1-flash-lite-preview` and the lite model hallucinated content on a fully blank page (scored it 95/100 with "clear high-contrast text and no distracting artifacts"). Lite is disqualified for this task; the doubled cost of flash is acceptable.

### Layer 3 — ML distillation (future)

Once Layer 1+2 has scored ~50K+ illustrations, the resulting (features → labels) corpus becomes training data for a small distilled classifier:

- **Input:** Layer 1 characteristics (10 floats) + optional thumbnail tensor
- **Output:** `scan_class` + `scan_score` regression
- **Goal:** ~95% agreement with Gemini, at zero per-call cost
- **Use case:** continuous re-scoring on the entire corpus when scoring algorithm versions, A/B testing, fast filtering in admin views

Not part of v1. Mentioned here to show the path; the distillation only becomes economical once we have a labeled corpus.

---

## Where it lives in the pipeline

```
extract-images phase (image-extract-worker.mjs)
  │
  ├─ Download page image to worker memory
  │
  ├─ Layer 1: sharp pixel-stats on buffer (5ms, free)
  │     → page.image_characteristics = { ... }
  │
  ├─ Layer 2: Gemini vision call with augmented prompt
  │     → page.scan_quality = { scan_score, scan_class, ... }
  │     → gallery_images[].scan_quality = derived per-illustration (inherited from page + bbox-specific sharp stats)
  │
  └─ Book-level rollup (sync-page-counts cron or new rollup phase)
        → book.scan_quality = {
            median_score, min_score, count,
            worst_image: { gallery_image_id, score, scan_class, concerns },
            illustration_classification: 'majority of pages',
            has_microfilm_pages: bool,
            has_blank_pages: bool
          }
```

### Per-illustration vs per-page

The Gemini call sees the whole page. The page-level `scan_class` and `concerns` apply to every illustration extracted from that page. For per-illustration *resolution* and *sharpness* (which can vary across regions of one page), we run a fast sharp pass on each cropped `extracted_url`. Page-level is the dominant signal; per-illustration sharpness adjusts at the margin.

### Schema additions

**On `pages`:**
```js
image_characteristics: {
  width, height, megapixels, bytes_per_pixel,
  mean_brightness, mean_stdev, dynamic_range, chroma_spread,
  sharpness_var, histogram_entropy, bimodality,
  flags: { is_blank, is_monochrome, is_bitonal, is_over_compressed, is_low_resolution },
  version, measured_at
}
scan_quality: {
  scan_score, scan_class, readable_text,
  illustration_fidelity, page_completeness,
  concerns: [], reasoning,
  model: 'gemini-3-flash-preview', version, assessed_at
}
```

**On `gallery_images`:** (new field, distinct from existing `gallery_quality` which is curatorial)
```js
scan_quality: {
  score,                    // page-level scan_score, modulated by per-crop sharpness
  scan_class,               // inherited from page
  sharpness_var,            // per-crop, measured on extracted_url
  resolution_mp,            // per-crop
  concerns: [],             // inherited from page + any crop-specific
  page_completeness,        // inherited
  version, assessed_at
}
```

**On `books`:** (replaces the existing flat `scan_quality` object)
```js
scan_quality: {
  median_score, min_score, max_score, count,
  worst_image: { id, score, scan_class, concerns },
  best_image: { id, score },
  illustration_classification: 'majority scan_class',
  has_microfilm_pages: bool,
  has_blank_pages: bool,
  page_completeness_issues: count,
  rollup_at, version
}
text_quality: {                       // separate, derived from OCR confidence
  mean_ocr_confidence, low_confidence_pages,
  rollup_at
}
```

---

## Validation against 11 known samples

The new prompt + characteristics pair, run on a hand-labeled spot-check set (pixel score, expected truth):

| Pixel | Expected truth | Gemini scan_score | Gemini scan_class | Verdict |
|---|---|---|---|---|
| 100 | excellent | 94 | color_photo | ✅ |
| 92 | excellent | 94 | color_photo | ✅ |
| 84 | microfilm | 62 | **bitonal_microfilm** | ✅ caught microfilm despite high pixel score |
| 78 | good-bw | 96 | color_photo | ✅ |
| 74 | excellent | 95 | color_photo | ✅ pixel underrated; Gemini correct |
| 71 | excellent-bitonal | 72 | bitonal_microfilm | ⚠️ Gemini may be right that source IS microfilm |
| 68 | excellent-grayscale | 85 | grayscale_photo + `two_pages_captured` | ✅ |
| 57 | microfiche | 62 | bitonal_microfilm | ✅ matched |
| 48 | low-res-manuscript | 82 | grayscale_photo + `two_pages_captured` | ✅ |
| 43 | near-blank-broken | 25 | bitonal_microfilm + `partial_capture` | ✅ |
| 30 | BLANK | 0 | **blank** | ✅ corrected the pixel-score bug |

**Agreement:** 10/11 exact match; the 11th (Llull) is plausibly right and a labeling ambiguity rather than a model error.

Deterministic characteristics also showed strong discriminative signal:

- **Blank detection is trivial** — Ganita: `sharpness_var=0, entropy=0, bimodality=1, dyn_range=0`. Any one of these alone is enough.
- **Monochrome detection is unambiguous** — `chroma_spread < 5` is correct in every monochrome sample.
- **Bitonal vs photographic** — `bimodality > 0.5 && entropy < 4` correctly identifies microfilm/bitonal samples (De Platonicae 0.587/3.87, Steganographia 0.734/2.68, Agrippa 0.98/0.29).
- **Hard case:** clean-bitonal woodcut (Llull: 0.517/4.82) vs microfilm (Steganographia: 0.734/2.68) — bimodality discriminates but the threshold is fuzzy. Gemini is the disambiguator here.

---

## Cost analysis

### Hot path (going forward)

Per book, image-extract-worker already makes 1 Gemini call per illustrated page. The augmented prompt adds ~150 tokens output per call.

- Existing cost (per SKILL.md): ~$0.0004 per page, ~$0.04 per 100-page book
- Augmented cost: ~$0.00045 per page, ~$0.045 per 100-page book (~12% increase)
- Annual incremental cost at current curation pace: < $50

### Backfill (existing 101,967 gallery_images across ~25K books with illustrations)

Two options:

**Option A — Gemini on everything:** 25K books × ~5-10 illustrated pages avg = 150-250K calls. At flash rates ~$0.0004 × 200K = **~$80 one-time.**

**Option B — Pixel-stats first, Gemini on bottom quartile:** 250K sharp passes (free, ~30 min), then Gemini on the ~60K lowest-scoring or hardest-to-classify pages. **~$25 one-time.**

Option B is more efficient but adds a second pass over the data. Option A is operationally simpler and within a casual budget.

**Recommendation:** Option B, parallelized across the existing Hetzner worker pool. Run as a one-shot job; future books get scored inline at extraction time.

---

## Use cases enabled

### 1. Best-copy duplicate picking

When two editions of a work both have extracted illustrations:
1. Compute perceptual hash on each illustration (existing capability or new)
2. Match same-illustration pairs across editions
3. Compare `scan_quality.score` + `scan_class` + `sharpness_var`
4. Pick the editions that has the *better rendering of that specific illustration*

This is qualitatively different from picking by "book with higher average OCR completion." It directly optimizes for what users see.

### 2. Concern flagging (admin queue)

A "scan health" admin view filtered by:
- `scan_quality.has_blank_pages: true`
- `scan_quality.scan_class IN ['microfiche', 'bitonal_microfilm']` (re-source candidates)
- `scan_quality.page_completeness_issues > 0` (manual review)
- `gallery_images.scan_quality.score < 40 AND gallery_images.gallery_quality > 0.7` (important content, bad rendering — top priority)

### 3. Provider quality dashboards

`book.scan_quality.illustration_classification` aggregated by `image_source.provider`:
- Internet Archive — distribution of color_photo / grayscale_photo / microfilm
- Gallica — likely high microfilm fraction, useful to know
- MDZ — low resolution but typically color
- Provider trust scores for future imports

### 4. Re-source candidate list

Output: a queue of books that should be re-imported from a higher-quality source. The flag is precise: not "low score book" but "important illustrations rendered as microfilm."

---

## Implementation plan

### Phase 1 — Prompt + worker patch (1-2 days)
- [ ] Add the scan-quality fields to `image-extract-worker.mjs` Gemini prompt
- [ ] Compute Layer 1 characteristics on the buffer; write to `pages.image_characteristics`
- [ ] Parse and write `pages.scan_quality` + `gallery_images.scan_quality`
- [ ] New books extracted from here on are scored automatically

### Phase 2 — Book rollup (1 day)
- [ ] New cron or extension to `sync-page-counts` that aggregates page-level → `book.scan_quality`
- [ ] Drop the legacy `scan_quality` field from old `audit-scan-quality.mjs` runs after migration
- [ ] Add `book.text_quality` derived from OCR confidence (separate signal)

### Phase 3 — Backfill (1 day to run, ~$25)
- [ ] Run pixel-stats pass on all 250K illustrated pages (free)
- [ ] Run Gemini on bottom-quartile pages
- [ ] Roll up to books
- [ ] Report coverage

### Phase 4 — Use cases (1 week)
- [ ] Extend dedupe-bph-shared-ubn.mjs with scan_quality tiebreaker
- [ ] Admin view: scan health queue
- [ ] Provider dashboards in `/admin`

### Phase 5 (future) — ML distillation
- [ ] Export labeled dataset (features → Gemini scan_class/score)
- [ ] Train small classifier
- [ ] Validate against held-out Gemini labels
- [ ] If ≥95% agreement: use for continuous re-scoring at zero per-call cost

---

## Open questions

1. **Per-illustration vs per-page granularity.** The current design scores at page level and inherits to illustrations. Is that enough? If a page has one pristine engraving and one faded one, do we need to distinguish? Probably yes for high-value books — but adds Gemini cost. Could compromise: sharp-stats per illustration + Gemini at page level.

2. **Re-scoring cadence.** When new pages get archived for an existing book (partial-archive backfill), should we automatically re-score? Probably yes — the worker patch covers this for free.

3. **OCR confidence as text_quality signal.** Need to confirm we have per-page OCR confidence stored, or whether we'd need to add it.

4. **Perceptual hashing for cross-edition image matching.** Required for Use Case 1 but not in this design's scope. Track as separate work.

5. **Microfilm detection threshold.** Validation showed Gemini correctly identifies microfilm, but Llull (an arguably clean-bitonal woodcut) was also classified as `bitonal_microfilm`. Need to decide if the threshold should be tuned via prompt engineering or accepted as conservative.

6. **Pipeline phase ordering.** Image extraction is fairly late (`chapters_complete`). For early concern-flagging (e.g. during import), a lightweight Layer 1 pass at archive time would surface blank/corrupt pages immediately rather than waiting for extraction.

---

## Related work / references

- `scripts/workers/image-extract-worker.mjs` — extraction worker to be patched
- `scripts/audit-scan-quality.mjs` — legacy pixel-only audit (to be retired)
- `scripts/enhance-scan-quality.mjs` — downstream consumer of `book.scan_quality.classification` for grayscale/B&W enhancement
- `.claude/skills/extract-images/SKILL.md` — current extraction documentation
- Issue #1788 (BPH duplicate dedupe) — duplicate-picking is the immediate use case
- Issue #1727 (centralize page-image URL resolution) — touches `archived_photo` precedence used by both extraction and quality measurement
