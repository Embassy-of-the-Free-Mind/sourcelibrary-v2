// PRIOR ART: scripts/lib/model-pricing.mjs `PAGE_RATE_USD` — the measured per-page rates (2026-09-04),
// one number per lane, the high end below; it has no low end, no Paddle lane, and no step mapping.
// scripts/audit/scope-progress.mjs `estimatePagesCost` — one rate per kind, no range. The claude.ai
// "Remaining Pipeline Work" artifact (account-bound, gone) — the shape this replaces.
//
// pipeline-unit-prices — the price per page of each pipeline step, as a LOW–HIGH range, every number
// with its source and date (#5480). /admin/pipeline multiplies these by the pages left in the
// pipeline-next daily snapshot; nothing else should carry a copy. model-pricing.mjs explains why a
// stale per-page constant is invisible: "NEVER print a rate without its measurement date" — so each
// entry here carries one, and the page prints it. Re-measure before quoting these for a spend decision.
//
// Pure data apart from the model-pricing import (no imports of its own): /admin/pipeline imports this.

import { PAGE_RATE_USD, PAGE_RATES_MEASURED_ON, BATCH_MULTIPLIER } from './model-pricing.mjs';

/**
 * step → { low, high, currency, unit, basis, sources: [{ value, what, where, measured }] }.
 * `low` is the cheapest lane that serves the step today, `high` the most expensive one.
 */
export const UNIT_PRICES = {
  archive: {
    low: 0, high: 0, currency: 'USD', unit: 'page',
    basis: 'unmetered: image fetch to R2, no model call (egress/storage are not metered per page)',
    sources: [{ value: 0, what: 'no model spend', where: 'scripts/lib/lanes.mjs (archive lanes: budget unmetered)', measured: null }],
  },
  ocr: {
    low: 0.00148, high: PAGE_RATE_USD.ocrBatch, currency: 'USD', unit: 'page',
    basis: 'Gemini lite, Batch API',
    sources: [
      { value: 0.00148, what: 'lite-batch image OCR, measured', where: 'scripts/eval/experiments/2026-09-12-can-flash-lite-text-only-cleanup-rescue-rejected-internet.md', measured: '2026-09-12' },
      { value: PAGE_RATE_USD.ocrBatch, what: 'OCR batch lite, gemini_usage cost ÷ pages', where: 'scripts/lib/model-pricing.mjs PAGE_RATE_USD.ocrBatch', measured: PAGE_RATES_MEASURED_ON },
    ],
  },
  ocr_zh_paddle: {
    low: 0.00073, high: 0.00089, currency: 'EUR', unit: 'page',
    basis: 'PaddleOCR-VL-1.6 on a leased Scaleway L4 (the #5547 proposal; not a running lane)',
    sources: [
      { value: 0.00073, what: 'compute only, 3,422-page pilot', where: 'scripts/eval/experiments/2026-10-01-chinese-ocr-cohort-5547.md (step 4)', measured: '2026-10-01' },
      { value: 0.00089, what: 'billed, incl. install and restarts', where: 'scripts/eval/experiments/2026-10-01-chinese-ocr-cohort-5547.md (step 4)', measured: '2026-10-01' },
    ],
  },
  translate: {
    low: 0.00061, high: PAGE_RATE_USD.translationRealtime, currency: 'USD', unit: 'page',
    basis: 'chained Batch lane (low) to the realtime lane (high)',
    sources: [
      { value: 0.00061, what: 'chained Batch lane, 154 books at once', where: 'scripts/eval/experiments/2026-09-30-chained-batch-lane-at-scale-154-books-at-once-4681.md', measured: '2026-09-30' },
      { value: PAGE_RATE_USD.translationRealtime, what: 'translation realtime lite, gemini_usage cost ÷ pages', where: 'scripts/lib/model-pricing.mjs PAGE_RATE_USD.translationRealtime', measured: PAGE_RATES_MEASURED_ON },
    ],
  },
  enrich: {
    low: PAGE_RATE_USD.enrichmentTail, high: PAGE_RATE_USD.enrichmentTail, currency: 'USD', unit: 'page',
    basis: 'summary + chapters + index, per page of the book',
    sources: [{ value: PAGE_RATE_USD.enrichmentTail, what: 'index/summary/chapters combined, ~negligible', where: 'scripts/lib/model-pricing.mjs PAGE_RATE_USD.enrichmentTail', measured: PAGE_RATES_MEASURED_ON }],
  },
  images: {
    low: PAGE_RATE_USD.imageExtraction * BATCH_MULTIPLIER, high: PAGE_RATE_USD.imageExtraction, currency: 'USD', unit: 'page',
    basis: 'extract_images flash; Phase 8 runs it on the Batch API (half price), the worker realtime',
    sources: [
      { value: PAGE_RATE_USD.imageExtraction * BATCH_MULTIPLIER, what: 'realtime rate × BATCH_MULTIPLIER (batch is half of every rate)', where: 'scripts/lib/model-pricing.mjs BATCH_MULTIPLIER', measured: PAGE_RATES_MEASURED_ON },
      { value: PAGE_RATE_USD.imageExtraction, what: 'extract_images flash realtime, gemini_usage cost ÷ pages', where: 'scripts/lib/model-pricing.mjs PAGE_RATE_USD.imageExtraction', measured: PAGE_RATES_MEASURED_ON },
    ],
  },
};

/**
 * Which pages of the snapshot each step's price applies to (pipeline-next-step-audit.mjs `remaining()`):
 * `ocr_pages` (whole − ocr), `translate_pages` (translatable − translated), `archive_pages`
 * (pages_count − archived), or `pages` (the whole book, for steps that read every page).
 */
export const STEP_PAGE_FIELD = { archive: 'archive_pages', ocr: 'ocr_pages', translate: 'translate_pages', enrich: 'pages', images: 'pages' };

/** Language test for the Chinese cohort priced at the Paddle rate (#5547): `Chinese`, `Classical Chinese`, … */
export const isChineseLanguage = (language) => /chinese/i.test(String(language ?? ''));
