/**
 * Which `page_revisions.source` labels are READINGS, and which are bulk
 * maintenance (#3473).
 *
 * `page_revisions` is a mixed record. Most consumers treat it as a double-OCR
 * corpus — two model passes over one page — but a maintenance sweep that
 * relocates existing text between page docs also writes a revision for every
 * page it touches. Those pairs hold two DIFFERENT pages' text, so they read as
 * catastrophic disagreement while nothing was re-read at all.
 *
 * Measured 2026-08-01 (`scripts/audit/ocr-revision-provenance.mjs`):
 *
 *   source                       ocr rows   translation rows   leaf-shifted (ocr)
 *   batch_api                     109,982              6,584                3.8%
 *   shift-repair-erara-2026-07     56,413             55,272               99.0%
 *   pipeline_preview               12,949                  —                0.8%
 *   ai                              8,622             68,988                  0%
 *
 * Matched by SHAPE rather than an exact deny-list, so a sweep run next year is
 * excluded by default instead of being silently averaged in. The allowlist is
 * the set of pipeline/human sources; anything else naming a repair, fix,
 * migration, backfill or cleanup is maintenance.
 *
 * An UNLABELLED source (null / '' / 'unknown') is deliberately NOT treated as
 * maintenance — absence of a label is not evidence of a sweep, and silently
 * dropping unlabelled rows would shrink the corpus for the wrong reason. It is
 * reported as its own stratum instead.
 *
 * Full enum and provenance: `.claude/docs/data-provenance.md`.
 */

export const READING_SOURCES = new Set([
  'batch_api',                 // Gemini Batch API OCR/translation
  'ai',                        // realtime model pass
  'pipeline_preview',          // orchestrator preview pass
  'realtime_api_sequential',   // sequential realtime path
  'manual',                    // human edit
  'contributor',               // community contribution
  'skip',                      // explicit skip marker
  'mineru',                    // MinerU extraction
]);

export const MAINTENANCE_RE = /repair|fix|shift|migrat|backfill|cleanup|sweep|maintenance/i;

/**
 * True when this revision was written by a bulk sweep, not by a reading.
 *
 * `system` is a JUDGMENT CALL, not a measurement: 193 translation rows and 1 ocr
 * row, with no script identified as the writer. Treated as maintenance because
 * an unattributed bulk label is more likely a sweep than a model pass, and at
 * ~194 of 300K+ rows the choice cannot move any published number either way.
 * Revisit if the count ever grows.
 */
export function isMaintenanceSource(source) {
  if (source == null || source === '') return false;  // unlabelled ≠ maintenance
  if (READING_SOURCES.has(source)) return false;
  return MAINTENANCE_RE.test(source) || source === 'system';
}

/**
 * Read the flag off a corpus row. Prefers the stored boolean, but falls back to
 * deriving it from `prior_source` — corpus JSONL written before 2026-08-01 has
 * no `is_maintenance` field, and trusting `row.is_maintenance` alone would make
 * the exclusion silently inert on exactly those files.
 */
export function rowIsMaintenance(row) {
  if (typeof row?.is_maintenance === 'boolean') return row.is_maintenance;
  return isMaintenanceSource(row?.prior_source);
}
