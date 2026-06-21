# Multi-leaf / spread scan splitting — strategy & tooling

*Status: design reference. Written 2026-06-21 after the Tibetan OCR-quality audit + EAP backfill.*

## Why this exists
A scanned image often contains **more than one page/leaf**. If we OCR the composite as-is, the model garbles it — on the Tibetan corpus, the cheap model **looped** (transcribed one leaf and repeated it across the others) and produced fluent-but-fabricated output ([[lesson_tibetan_lite_ocr_fails]]). Correct OCR requires **splitting the composite into single leaves first**. There are **two distinct geometries** in our corpus, and they need different splitters. Conflating them produces gutter-junk crops.

## The two geometries

### A. Horizontal 2-page spread (BPH, Western books)
- One image = a left page + a right page, side by side, with a **vertical gutter** in the middle.
- One split, vertical axis → 2 pages.
- Aspect ratio: landscape, typically ~1.1–1.6.
- **Existing tooling handles this** (see below).

### B. Vertical N-leaf pecha composite (Bhutanese/Tibetan manuscripts) ← the new/under-served case
- One image = **2–3 loose pecha leaves stacked vertically** on a board/dark ground, separated by **horizontal gaps**. Pecha leaves are individually wide-and-short; photographed several to a plate.
- N−1 splits, **horizontal axis** → 2–3 leaves. Each leaf is then itself a wide single folio (do NOT split a single pecha leaf — it's one page).
- Aspect ratio of the *composite*: landscape ~1.1–2 (the 128 EAP backfill books are 100% in this range, native 4752×3168). A *single* pecha folio is ~4:1+.
- Tagged in data as `books.split_geometry: 'pecha-vertical-multileaf'`.
- **No production tooling yet** — this is the gap.

> Aspect ratio alone does NOT distinguish A from B (both are landscape). The distinguisher is **gap orientation**: a vertical gutter (A) vs. horizontal inter-leaf gaps (B). Detect by projecting brightness onto each axis and finding the low-density band(s).

## Tooling

| Tool | Geometry | What it does |
|---|---|---|
| `scripts/ar-gate-remaining.mjs` | both | Sets `needs_splitting` by first-image aspect ratio (≥1.1 = candidate). |
| `scripts/batch/submit-spread-ocr.mjs` + `SPREAD-OCR-README.md` | **A** | Gemini Batch call returns `<split-position>N</split-position>` (0–1000) + left OCR + `<page-break/>` + right OCR. **One vertical split only** — does not handle N-leaf vertical stacks. |
| `scripts/split-book-v2.mjs`, `batch-split-bph.mjs` | A | Apply the split, materialize 2 page records. |
| flash bbox (`gemini-3-flash-preview`) — see `_tmp_bbox_test2.mjs` | **B** | Vision LLM returns one box per leaf; robust on count/region incl. tape-bridged gaps. **The chosen detector** (see Recommended approach). |
| `_tmp_tibet_split_test.mjs` + PIL splitter (audit prototype) | **B** | Row-brightness gap detection → crops N leaves. Use as the deterministic **snap** step on flash's boxes; brittle as a standalone detector (merged leaves on tape-bridged p14). **Prototype, not productionized.** |
| spread redesign | both | Issue #2454 (305 translated-as-spreads sweep pending behind it). |

## Recommended approach for geometry B (the Bhutan pecha) — CHOSEN

**LLM bounding-box for detection + deterministic gap-snap for precision + strong-model OCR per leaf.** Each step does the job it's cheapest-and-best at. Validated empirically 2026-06-21.

**Pipeline:**
1. **Detect leaves with a vision LLM bounding box.** Prompt `gemini-3-flash-preview` for one box per distinct physical leaf, top-to-bottom (`{"box_2d":[ymin,xmin,ymax,xmax]}`, 0–1000). Returns leaf count + coarse regions.
2. **Snap each boundary deterministically.** Within each LLM-identified boundary zone, snap the cut to the local row-brightness minimum (the true inter-leaf gap) so crops are pixel-clean and never slice through text. LLM boxes are robust on *count/region* but touch/overlap by a few px — they are NOT pixel-precise.
3. **Validate.** N non-overlapping boxes, plausible/consistent heights, covering the content. LLM-vs-snap disagreement or an implausible box → flag for review (don't blind-crop).
4. **Crop each leaf → strong-model OCR.** Pre-splitting also *fixes wrong-script OCR for free* (isolated leaves read correctly even by the cheap model); only residual hard leaves escalate to pro (split → lite → detect failures → pro; cost model in [[lesson_tibetan_lite_ocr_fails]]).

**Why LLM-led, not deterministic-only:** pure row-brightness gap detection is brittle where a measuring tape or shadow **bridges the gap** — it merged two leaves on the audit's p14 and needed a fixed-leaf-height hack. The LLM handles that case natively.

**Bbox model — use `gemini-3-flash-preview` (flash), NOT pro or lite.** Benchmark on 4 hard composites (p7/p9/p14/p18, each 3 leaves incl. the tape-bridged p14):
- **flash: 3/3/3/3 ✓**, bands essentially identical to pro (p14: flash [48-352][346-665][668-963] vs pro [48-351][347-667][667-967]). ~5× cheaper than pro ($0.50/$3 vs $2.50/$15 per M tok).
- pro: 3/3/3/3 ✓ (baseline) — correct but unnecessarily expensive for boxes.
- lite: gets the leaf *count* right (3/3/3/3) but coordinate output is inconsistent/unreliable — don't use for the cut.
- Cost at scale: ~1 flash call per composite (~$0.002/page) → a few hundred $ for the whole Bhutan corpus, trivial vs the OCR.

**Rejected alternative — split-during-OCR (extend `submit-spread-ocr.mjs` to N-way):** one Gemini call returns multiple split positions + per-band OCR. Tempting (one call) but couples splitting to OCR, trusts the model on both at once, and you can't validate the split before paying for OCR. Keep bbox and OCR **separate** so a bad split is caught before it costs an OCR pass.

## Bbox / coordinate invariant (don't re-break it)
After splitting, all bbox-consuming writers must resolve their source via `getPageSource()` / `getPageImageUrl()` — bbox is normalized to the **half/leaf**, not the full composite ([[lesson_gallery_crop_bbox_coordinate_space]], PRs #2516/#2517). Getting this wrong = gutter-spanning junk crops + misaligned magnifier.

## State / what to do
- **128 EAP backfill books**: imported hidden, archived at native res, now flagged `needs_splitting:true` + `split_geometry:'pecha-vertical-multileaf'`, `split_completed:false`. Awaiting the geometry-B splitter. Pipeline is PAUSED [[project_processing_deliberately_paused]], so nothing auto-splits yet (good — prevents a wrong-geometry split).
- **Whole Bhutan corpus** (~1,470 books) is the same geometry and rides the same redesign — this is the OCR-redo ([[lesson_tibetan_lite_ocr_fails]], the split→strong-model pipeline; ~$10K, awaiting go).
- **Don't** route geometry-B books through `submit-spread-ocr.mjs` (geometry A) — it will split a 3-leaf vertical stack into 2 horizontal halves. The `split_geometry` tag exists to prevent this.

## Open questions for the redesign (#2454)
1. Productionize the geometry-B splitter `split-pecha.mjs` (flash bbox → deterministic snap → validate → crop; the CHOSEN approach above) — promote the audit prototype.
2. Per-leaf page-record materialization for N-way (existing `split-book-v2` assumes 2).
3. Gap-detection robustness (measuring tapes, shadows, variable leaf counts 1–3).
4. Re-run the 305 translated-as-spreads sweep behind this redesign (verify before reset, per [[project_spread_pipeline_state]]).
