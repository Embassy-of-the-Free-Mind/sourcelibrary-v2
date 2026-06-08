# Spread-split remediation + detector rebuild (2026-06-06 → 09)

Multi-day session. Started "why does /collections/baltic-paganism show 1 book", became a full rebuild of spread splitting + remediation of 331 books OCR'd/translated as un-split spreads.

## Outcome — 331 confirmed-spread books

| Outcome | Count |
|---|---|
| **Split correctly** (text books, fixed detector) | **258** |
| Plate/map → kept whole (`needs_splitting:false`) | 6 |
| Mixed (text+plate) → flagged `split_review_needed` | 3 |
| Low-signal → parked (`needs_attention`) | 63 |
| Unprocessed/no-image | 1 |

258 split books are at `archive_complete`, OCR-less → re-OCR/re-translate as single pages via the unpaused pipeline. **0 known bad cuts remain** (the dark-valley defect was found, fixed, and the 12 affected books restored+re-split).

## What shipped (all merged to main)

- **#2454 Layout Resolution** spec (split-before-OCR phase design) — comment on the issue.
- **#2464** Phase 1.3: split spreads at detection time, before OCR (`split-book.mjs --gutter-only`).
- **#2472** the detector: OCR `page_type` pre-filter (Step 2.5: plate/mixed/text routing), pixel ink-valley + Gemini-preview cross-check, **book-median consensus** (outliers/abstains snap to median), **Gemini on a ~8-page sample not every page** (~95% cost cut), archive-in-place, 3% overlap, archive fields, tenantId, unique R2 paths.
- **#2495** the fix: **demote dark-valley to a non-confident hint** — it false-positived on dark manuscript features (mis-cut Figurae/Annvae ~50px off). Now those pages snap to the median.
- Earlier same session: #2446 (Gemini key-drift lesson), #2448 (median AR gate), #2456 (spread-integrity guards), #2462 (OCR generation guard + `reset-book-ocr.mjs`), #2463 (ops guards).

## Prevention issues filed (the "what should the pipeline have had" answers)

- **#2481** closed-loop: reconcile OCR `page_type` → `needs_splitting` (we computed the classification and ignored it).
- **#2482** standing alarm: `needs_splitting:true && pages_ocr>0` (OCR'd-before-split inconsistent state).
- **#2483** QA: detect "translated as a two-page spread".
- **#2492** detect double-page illustrations inside text books (bisection blind spot — the one unsolved edge).

## Key technical findings (read before touching the splitter)

- **OCR `page_type` is the free, decisive map-vs-spread classifier.** A book with >60% `map`/`illustration` pages (or `<image-desc>` + tiny body text) is a plate book → keep whole. Only 6/331. Forward gap: NEW books have no OCR at split time, so forward map-catching relies on Phase 1.25's image-only Gemini classification (imperfect) — #2481 is the backstop.
- **Gemini gutter localization: prompt > model.** The old "usually 400-600" hint anchored both models to center. With a no-center-hint prompt, `gemini-3-flash-preview` localizes offset gutters to ~3/1000. `flash-lite` is inconsistent. Used on a ~8-page SAMPLE per book (binding is book-stable), not per page.
- **Pixel detector:** ink-valley (narrow bright gutters, ±2px smoothing + relative-min, central 35-65% window) is reliable. **Dark-valley (binding shadow) is NOT** — demoted to a hint; it mistakes dark figures/shadows for the binding. Photographed codices (Euclid) are covered by the Gemini-anchored median instead.
- **Book-median consensus:** a single bad page snaps to the book median, not parks the whole book. Park only when too few confident gutters (<25% of landscape) or scattered.
- **Archive-in-place:** old spreads kept at negative `page_number` + `page_type:'archived-spread'` (read path filters them, PR #1441). To re-split an already-split book: restore (un-archive negatives → positive, `page_number = abs-1`, delete sp-halves), then `--gutter-only`. Page-record image fallback is guarded to `split_completed!==true`.

## The 63 parks — clean recovery path

Low-contrast manuscripts (codices, Sanskrit, Arabic, palimpsests) where pixel rarely fires. After dark-valley demotion they fall below the 25% confidence threshold → park. Recovery: **expand the Gemini sample** for confirmed text books where pixel rarely fires (Gemini localizes these well) so the median anchors and they clear the threshold. Or a tuning UI (#F idea). NOT yet done — left for review.

## Lessons (the meta)

We re-derived from pixels what the OCR already knew (page_type). Should have: (1) censused the set from existing data first; (2) read all split history up front (#1491 22-lesson checklist, the Phase 1.25 classification prompt); (3) separated classification (book-level, OCR) from localization (page-level, pixel+vision); (4) set up the visual audit first and looked at a stratified sample of the REAL set; (5) climbed the cost ladder: existing data → heuristic → cheap model → expensive model → human. Derek's two questions ("which model?", "can't I use the OCR?") were the course-corrections.

## Tools left in place

- `scripts/split-book.mjs --gutter-only` — canonical splitter (merged).
- `scripts/lib/gutter-detect.mjs` — pixel detector (merged).
- `scripts/maintenance/split-audit-visual.mjs` — visual gutter-line audit (merged); `--ids-file`, `--samples`, renders self-contained HTML.

## Next session

1. Decide on the 63 parks (expanded-Gemini pass vs tuning UI vs leave).
2. Build #2481 (closed-loop) to make forward map-handling airtight.
3. Verify the 258 split books re-OCR'd + re-translated cleanly (spot-check a few in the reader).
4. Re-run `split-audit-visual.mjs` stratified, weighted toward manuscripts, as a final QA before declaring the 258 done.

## CLAUDE.md check
No new CLAUDE.md invariant needed — the splitter doctrine lives in #2454 + memory `project_spread_pipeline_state`. Phase 3.1 (legacy marker-path split) retires once in-flight books drain.
