# PREREG: which route restores the 丨 ditto marks? (#5274, job zh-ditto-restore-5274)

Committed after the draw and the images, before any arm read a page. 2026-11-03.

PRIOR ART: `scripts/audit/headword-mark-drop.mjs` (the page census), `scripts/eval/paddle-correct-6561/` (Paddle zh
correction vs Kanripo, its scorer's bar folding), `scripts/batch/ocr-convergence/correct.mjs` (the #7568 Opus correction
prompt, reused), `scripts/eval/flash-reread-5924/fc-prompt.mjs` (its one-page agy form, reused), `C-TASK.md` there (the
judge's verdict words, reused).

## Found before the arms ran
- `results/frame.json`: 62,892 body pages (≥ 300 Han outside `<header>`/`<page-num>`), 20,265 with no 丨, 756 books,
  all pipeline `paddle-zh-2026-10`.
- **The stored image is about a third of the Archive's file.** R2 `archived_photo` is ~660 px wide, the Archive's file
  ~2,000 px. The lane ran with no resize of its own (`serving.max_side: 0`), so "full resolution" in the brief means the
  Archive's file, not the stored one. Keep-丨 pages have the same stored size, so size alone is not the whole cause.
- **Kanripo's WYG branch keeps the marks** (KR3k0059, KR3k0056, KR3k0060) and is the same witness: 29 of the 30 zero
  pages and all 5 keep pages have an own leaf (dice ≥ 0.6) with 12–60 marks. That is a reference for the marks
  independent of every model here.

## Draw
`draw.mjs`, seed 5274: 30 zero-丨 pages, one per book, + 5 keep pages (≥ 5 丨, other books). PR #8006's sample and the
brief's own example page excluded.

## Arms
- P0: stored Paddle text.
- P1-r2: Paddle again on the stored image, production settings (repeat noise).
- P1-ia: Paddle on the Archive's file, no resize. The brief's P1.
- P1-ia-nolayout: the same with the layout stage off (#5600 saw the mark read as 一 with layout on).
- P1-up3: stored image upscaled 3x (could the fix run without re-fetching from the Archive?).
- P2-r2 / P2-ia: Opus correction of the Paddle text with the stored / Archive image: live OCR prompt +
  `correctInstruction(1)` + one ditto instruction. One page per call.
- P3-ia: agy `gemini-3.8-flash-low` correction, the one-page form of the same prompt + the same ditto instruction, one try,
  on the third pool (97% weekly left on 2026-11-03), Archive image.

## Measures
Truth for marks, in order: the Kanripo leaf where one exists; the Opus counter (image only, no text) on every page, which is
checked against Kanripo and against 5 pages counted by eye.
- **Count recall / precision**: min(n_arm, n_truth) / n_truth and / n_arm, per page and pooled. All bar forms folded to 丨.
- **Placed runs**: a run of marks in the leaf is placed if the arm has a run of the same length with the same character
  on its left or right. Recall = leaf runs placed; precision = arm runs that match a leaf run. This catches a right count
  in the wrong place.
- **Body CER** vs the leaf (`bodyCer`, Han only, margins removed), and **CER with marks removed from both sides**, so that
  restoring marks does not hide new misreads.
- **Bar 一 count**: marks rendered as 一 (extra 一 vs the leaf, reported).
- **Blind judge**: Opus, image + two texts X/Y in seeded order, P0 against the best arm, `C-TASK.md` verdicts
  (misleading / flawed / sound) and preference. 5 swap controls (another page's text): must be called misleading.
- **Price per 1,000 pages**: GPU minutes (flat box; opportunity cost only), or subscription share from tokens.

## Usable page and route rule
A page is **usable** in an arm if count recall ≥ 0.9, count precision ≥ 0.9, placed-run recall ≥ 0.8, and marks-removed CER
no worse than P0 + 0.5 pt. On the page without a leaf only the counts apply, against the counter.
**Route**: the cheapest arm per 1,000 usable pages among those with ≥ 24/30 usable and no keep page damaged (count recall on a
keep page may not fall by more than 0.1 vs P0), and whose judge misleading count is at most half of P0's on the same pages.
If no arm meets it, no route is recommended and the numbers are reported.
