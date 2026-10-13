// PRIOR ART: the lane table in .claude/docs/pipeline-next-step.md ("The lane table", a hand survey of
// 2026-10-01) — prose, so nothing could test it; scripts/workers/scheduler.mjs WORKERS (what the scheduler
// launches, not what each lane selects or respects); scripts/audit/spend-perimeter.mjs (which call sites
// spend, not which books they may touch). None says, per lane, which step it serves and whether it
// respects a hold, a pause and a budget.
//
// lanes — the registry of every code path that does pipeline work on `books` / `pages` (#5480, step 4 of
// #5469). One descriptor per lane; /admin/pipeline renders it beside the daily step counts, and
// tests/unit/lanes-registry.test.ts fails when:
//   - a script named in scripts/workers/crontab.production, the scheduler's WORKERS, or vercel.json's
//     crons writes `books` or `pages` (directly or through a local import) and is neither a lane here nor
//     listed in EXEMPT with a reason;
//   - a lane declares a pause key or a marker hold check its files do not contain;
//   - a lane declares `respectsHold: false`, `pause: null` or `budget: 'none'` without a `reason`.
//
// WHY ONE FILE, not `export const LANE` in each worker: the design asked for the latter, but most workers
// run main() on import (so a registry that imports them would start them), and Next.js refuses unknown
// exports from a route.ts. The descriptor lives here; each lane names its files, and the test reads them.
//
// OBSERVE ONLY. Nothing here changes which books any lane selects (#5480). A `reason` records why a lane
// skips a check TODAY; `gap: true` marks a reason that is a known gap rather than a justification, so
// the page shows it as one. Pure data, no imports: /admin/pipeline imports this file.

/** Steps a lane can serve (pipeline-next-step.mjs STEPS, minus `done`/`blocked`), plus `any` for collectors. */
export const LANE_STEPS = ['archive', 'ocr', 'translate', 'enrich', 'images', 'any'];

/**
 * Pause keys that actually stop something, and the source test that proves it. `paused` is the global
 * switch (processing_control.paused; the scheduler also refuses to launch anything while it is set, and
 * selective-unpause scopes it). The step keys are the vocabulary of scripts/lib/pause.mjs (#5492): one
 * word per step, which every lane of that step asks through `isPaused(control, '<key>')`, a named brake
 * that does (verified by scripts/audit/spend-perimeter.mjs), or — in the orchestrator — `shouldRun(N)`
 * for a phase that pause.mjs PHASE_PAUSE_KEY maps to the key. Legacy `paused_phases` entries
 * ('translation', 'enrichment', 1.5, 2, 4, 6, 7, 8) are aliases of these keys in pause.mjs, so an old
 * entry still stops what it stopped. Pure data here: the admin page imports this file.
 */
export const PAUSE_KEYS = {
  paused: { test: /shouldBypassPause\(|control\?*\.paused\b/, doc: 'processing_control.paused (global)' },
  archive: { test: /isPaused\([^)]*'archive'\)|shouldRun\(1\)/, doc: "paused_phases: ['archive'] — archivers + orchestrator Phase 1" },
  ocr: { test: /isPaused\([^)]*'ocr'\)|shouldRun\((?:1\.25|1\.45|1\.5|1\.6|2|3\.7)\)/, doc: "paused_phases: ['ocr'] — every OCR submit (orchestrator 1.25/1.45/1.5/1.6/2/3.7)" },
  translate: { test: /isPaused\([^)]*'translate'\)|translateSubmitBrake\(|translatePausedMidRun\(|shouldRun\(4\)/, doc: "paused_phases: ['translate'] — realtime worker, chained + seam batch lanes, orchestrator Phase 4" },
  enrich: { test: /isPaused\([^)]*'enrich'\)|enrichPauseMode\(|shouldRun\((?:6|7)\)/, doc: "paused_phases: ['enrich'] — enrich-worker (realtime skips; --batch collects, submits nothing), orchestrator 6/7" },
  images: { test: /isPaused\([^)]*'images'\)|shouldRun\(8\)/, doc: "paused_phases: ['images'] — image-extract-worker + orchestrator Phase 8 dispatch" },
};

/**
 * Pause NAMES the docs once told an operator to set and that no live lane reads — only the archived
 * Vercel routes did. Setting one pauses nothing (pause.mjs reports it as an unknown entry). The registry
 * test fails if a lane ever claims one. ('ocr' and 'images' were on this list until #5492 made them keys.)
 */
export const DEAD_PAUSE_NAMES = ['chapters', 'classification', 'transliteration'];

/** A hold check the test can see in source: the marker filter, or a read of the marker. */
export const HOLD_MARKER_TEST = /NOT_HELD|isHeld\(|holdViolation\(|pipeline_auto\.hold/;

const ORCH = 'scripts/workers/pipeline-orchestrator.mjs';
// `/api/translate` was in the design's list but translates a title or a short text and writes no book or
// page, so it is not a lane.
const API_ROUTES = [
  'src/app/api/process/route.ts',
  'src/app/api/process/batch/route.ts',
  'src/app/api/admin/bulk-reocr/route.ts',
  'src/app/api/admin/bulk-ocr-new/route.ts',
  'src/app/api/scan/start-ocr/route.ts',
  'src/app/api/books/[id]/batch-translate-async/route.ts',
];

/**
 * respectsHold: 'marker' — the lane filters or refuses on `pipeline_auto.hold` (tested in source);
 *               'status' — the lane selects only statuses a held book cannot carry (a held book's status
 *                          is `held`; pipeline-hold.mjs "WHY A STATUS"), so it never sees one. A `reason`
 *                          names any path that bypasses the status selector;
 *               false    — no hold check; `reason` required.
 * pause:        the ONE key that stops this lane (PAUSE_KEYS), or null with a `reason`.
 * budget:       'dial' (spend-guard daily dial), 'dial (scoped)', 'envelope', 'committed' (spend already
 *               made: a collector), 'gpu-lease', 'free-cpu', 'unmetered' (no model spend), or 'none'
 *               (spends with no meter in front of it — `reason` required).
 */
export const LANES = [
  // ── archive ────────────────────────────────────────────────────────────────────────────────────
  { name: 'archive-bulk', serves: 'archive', files: ['scripts/workers/archive-bulk.mjs'],
    selects: 'IA books, not bulk_unsuitable, first translations first', trigger: 'scheduler, 10 min',
    budget: 'unmetered', respectsHold: false, pause: 'archive',
    reason: 'Fetches page images to R2 and spends no model money. A hold keeps a book out of the paid lanes; a held book still needs its images preserved (preservation-policy.md). Adding NOT_HELD would change selection — not done in #5480.' },
  { name: 'archive-ocr', serves: 'archive', files: ['scripts/workers/archive-ocr.mjs'],
    selects: 'priority / IIIF / warehouse books', trigger: 'scheduler, 10 min',
    budget: 'unmetered', respectsHold: false, pause: 'archive',
    reason: 'Same as archive-bulk: image fetching only, no model spend; a held book still needs its images.' },
  { name: 'archive-hosts', serves: 'archive',
    files: ['scripts/workers/archive-iiif-local.mjs', 'scripts/workers/archive-erara.mjs', 'scripts/workers/archive-harvard.mjs', 'scripts/workers/archive-gallica.mjs'],
    selects: 'named hosts (`--any-status`)', trigger: 'manual / laptop launchd',
    budget: 'unmetered', respectsHold: false, pause: null,
    reason: 'Operator-run, per host, residential IP for hosts that 429 datacenters; image fetching only. No pause check because they run outside the scheduler by hand.' },
  { name: 'archive-acquired', serves: 'archive',
    files: ['scripts/catalog-coverage/archive-acquired-cron.sh', 'scripts/catalog-coverage/acquire-gap-batch.mjs'],
    selects: 'books just created by the acquisition queue', trigger: 'cron, hourly',
    budget: 'unmetered', respectsHold: false, pause: null,
    reason: 'Archives books the acquisition wave just created, which carry no hold yet; a wave that should not archive is stopped by its own queue (acquisition_queue), not the pipeline pause.', gap: true },
  { name: 'archiving-watchdog', serves: 'archive', files: ['scripts/maintenance/archiving-watchdog.mjs'],
    selects: 'status `archiving` past the stale bound', trigger: 'cron, 6 h',
    budget: 'unmetered', respectsHold: 'status', pause: null,
    reason: 'Bookkeeping: re-probes stalled archiving and writes verdicts; spends nothing, so a pause has nothing to stop. Step 3 (pipeline-recheck) absorbs it.' },

  // ── ocr ────────────────────────────────────────────────────────────────────────────────────────
  { name: 'orchestrator-preview-ocr', serves: 'ocr', files: [ORCH],
    selects: 'first 25 pages of newly archived books', trigger: 'scheduler, 5 min (Phase 1.5)',
    budget: 'dial', respectsHold: 'marker', pause: 'ocr' },
  { name: 'orchestrator-ocr', serves: 'ocr', files: [ORCH, 'scripts/workers/batch-collector.mjs'],
    selects: '`archive_complete`, priority then `_priority`', trigger: 'scheduler, 5 min (Phase 2) / collector 10 min',
    budget: 'dial', respectsHold: 'marker', pause: 'ocr' },
  { name: 'manual-ocr', serves: 'ocr',
    files: ['scripts/batch/bulk-reocr-local.mjs', 'scripts/batch/realtime-ocr.mjs', 'scripts/maintenance/reocr-launch-books.mjs', 'scripts/batch/bulk-reocr-opened-books.mjs'],
    selects: 'named book lists', trigger: 'manual',
    budget: 'dial', respectsHold: false, pause: null,
    reason: 'Operator-run re-OCR of named lists. Holds are ignored by design: a hold is often the very thing the re-OCR is waiting on (realtime-ocr does filter NOT_HELD; bulk-reocr-local reports [HELD] and runs). Priced at submit, so the dial sees it; no pause because the operator is the switch.' },
  { name: 'specialist-ocr', serves: 'ocr',
    files: ['scripts/workers/syriac-kraken-lane.mjs', 'scripts/lib/syriac-kraken-lane.mjs', 'scripts/workers/syriac-kraken-relaunch.sh', 'scripts/workers/ndl-koten-lane.mjs', 'scripts/lib/ndl-koten-lane.mjs'],
    selects: 'one script each (Syriac, kuzushiji)', trigger: 'manual / cron 30 min (relaunch)',
    budget: 'free-cpu', respectsHold: 'marker', pause: null,
    reason: 'Each runs one approved script on free CPU or a leased GPU (gpu-lease-watchdog); the lane is stopped by its own lease or relaunch line, not the model pause.' },
  { name: 'mineru-ocr', serves: 'ocr', files: ['scripts/workers/mineru-ocr-worker.mjs'],
    selects: 'named books', trigger: 'manual',
    budget: 'gpu-lease', respectsHold: false, pause: null,
    reason: 'Operator-run on a leased GPU for named books; no hold or pause check.', gap: true },

  // ── translate ──────────────────────────────────────────────────────────────────────────────────
  { name: 'translate-worker', serves: 'translate', files: ['scripts/workers/translate-worker.mjs'],
    selects: '`processing_priority` ≥ 90 (realtime)', trigger: 'scheduler, 2 min',
    budget: 'dial (scoped)', respectsHold: 'marker', pause: 'translate' },
  { name: 'translate-chained', serves: 'translate',
    files: ['scripts/workers/translate-batch-worker.mjs', 'scripts/lib/translate-batch-chained.mjs'],
    selects: 'priority < 90, visible, not English (auto-enrolled or approved runs)', trigger: 'cron, 5 min ticker + hourly enrol',
    budget: 'envelope', respectsHold: 'marker', pause: 'translate',
    reason: 'Every submit (each round, queued runs included) asks translateSubmitBrake; a paused run waits READY and resumes on the next tick. Submitted rounds keep being collected under a pause — they are paid (#5492).' },
  { name: 'orchestrator-translate', serves: 'translate', files: [ORCH],
    selects: 'Phase 4 fresh dispatch (`ocr_complete`) and gap-fill (`partialBooks`, finished books under 90% of ocr − blank)', trigger: 'scheduler, 5 min (Phase 4)',
    budget: 'dial', respectsHold: 'marker', pause: 'translate' },
  { name: 'manual-translate', serves: 'translate',
    files: ['scripts/batch/realtime-translate.mjs', 'scripts/batch/retranslate-stale.mjs', 'scripts/lib/translate-batch-seam.mjs'],
    selects: 'named books', trigger: 'manual',
    budget: 'dial', respectsHold: false, pause: null,
    reason: 'Operator-run for named books (realtime-translate filters NOT_HELD; retranslate-stale and the seam do not). The operator is the switch.', gap: true },
  { name: 'es-translate', serves: 'translate', files: ['scripts/workers/es-translate-worker.mjs'],
    selects: 'English translations → Spanish (pivot)', trigger: 'manual (not in crontab or the scheduler, 2026-10-02)',
    budget: 'none', respectsHold: false, pause: 'paused',
    reason: 'Spends Gemini (~$0.0007/page, its header) with no dial or envelope in front of it. Tolerable only while it is run by hand; it needs a budget before it is ever scheduled.', gap: true },

  // ── enrich ─────────────────────────────────────────────────────────────────────────────────────
  { name: 'enrich-worker', serves: 'enrich', files: ['scripts/workers/enrich-worker.mjs'],
    selects: '`translate_complete` → summary, chapters, quality, collections', trigger: 'scheduler, 5 min',
    budget: 'dial (scoped)', respectsHold: 'marker', pause: 'enrich' },
  { name: 'enrich-worker-batch', serves: 'enrich', files: ['scripts/workers/enrich-worker.mjs', 'scripts/workers/lib/enrich-batch-lane.mjs'],
    selects: 'live translated books past the realtime statuses with no summary / index / chapters (#2141), reads then translated pages', trigger: 'cron, 15 min collect + 6 h admit',
    budget: 'dial (scoped)', respectsHold: 'marker', pause: 'enrich' },

  // ── images ─────────────────────────────────────────────────────────────────────────────────────
  { name: 'orchestrator-images', serves: 'images', files: [ORCH],
    selects: '`chapters_complete` (Batch API, Phase 8)', trigger: 'scheduler, 5 min',
    budget: 'dial (scoped)', respectsHold: 'marker', pause: 'images' },
  { name: 'image-extract-worker', serves: 'images', files: ['scripts/workers/image-extract-worker.mjs'],
    selects: '`chapters_complete`, plus a catch-up over `complete` / statusless books; `--books-file` lists', trigger: 'scheduler',
    budget: 'dial (scoped)', respectsHold: 'status', pause: 'images',
    reason: 'Selects by status, so held books (status `held`) are never picked — except through `--books-file`, which runs whatever list it is given. That path has no NOT_HELD filter.', gap: true },

  // ── any (collectors, bookkeeping, admin clicks) ────────────────────────────────────────────────
  { name: 'batch-collector', serves: 'any', files: ['scripts/workers/batch-collector.mjs'],
    selects: 'open batch jobs (OCR, translation, images)', trigger: 'scheduler, 10 min',
    budget: 'committed', respectsHold: 'marker', pause: null,
    reason: 'Collects output already paid for and submits nothing, so no pause stops it (#5496 review N1): Gemini expires a batch at 48 h and Phase 8.5 would re-dispatch the book (#4839). Pauses stop submission, upstream.' },
  { name: 'collect-batch-results', serves: 'any', files: ['scripts/batch/collect-batch-results.mjs'],
    selects: 'open Gemini batch jobs', trigger: 'cron, 30 min',
    budget: 'committed', respectsHold: false, pause: null,
    reason: 'Collects output already paid for. Gemini expires a batch at 48 h, so a pause or a hold must never strand a paid batch (#5492); writing a held book\'s pre-hold result is the lesser harm.' },
  { name: 'orchestrator-bookkeeping', serves: 'any', files: [ORCH],
    selects: 'enrol (0), archive check (1), OCR collect (3), translate collect (5), finalize (9)', trigger: 'scheduler, 5 min',
    budget: 'unmetered', respectsHold: 'marker', pause: 'paused' },
  { name: 'admin-api', serves: 'any', files: [...API_ROUTES, 'src/lib/lane-guards.ts'],
    selects: 'the request (admin click)', trigger: 'admin click',
    budget: 'none', respectsHold: false, pause: null,
    reason: 'assertLaneGuards() records a held book or an active pause in audit_log (`lane_guard_observed`) on every call, in observe mode. Refusing would change which books an admin click acts on; that is a decision for Derek, not this registry.', gap: true },
];

/**
 * Scripts that a schedule runs and that write `books` or `pages`, but are not pipeline lanes: they write
 * metadata, display fields, counters or markers, and never advance a book's next step. Each says why.
 */
export const EXEMPT = [
  { file: 'scripts/maintenance/backfill-printed-page-4291.mjs', reason: 'metadata: pages.printed_page fitted per book, no step work (#4291); daily cron --ocr-since=26h' },
  { file: 'scripts/workers/sync-worker.mjs', reason: 'the stamp writer: counters, translation_state and pipeline_next (#5477); does no step work' },
  { file: 'scripts/workers/scheduler.mjs', reason: 'launcher; its stalled-image-job drain clears job bookkeeping, not steps' },
  { file: 'scripts/analysis/assign-work-slugs.mjs', reason: 'metadata: books.work_slug' },
  { file: 'scripts/analysis/mint-local-work-ids.mjs', reason: 'metadata: books.work_id' },
  { file: 'scripts/enrichment/backfill-author-locations.mjs', reason: 'metadata: author geocodes' },
  { file: 'scripts/enrichment/backfill-thesaurus-author-locations.mjs', reason: 'metadata: author geocodes' },
  { file: 'scripts/enrichment/geocode-origin-by-tradition.mjs', reason: 'metadata: origin geocodes' },
  { file: 'scripts/enrichment/geocode-publication-places.mjs', reason: 'metadata: publication-place geocodes' },
  { file: 'scripts/maintenance/audit-language-mismatch.mjs', reason: 'metadata: language review flags' },
  { file: 'scripts/maintenance/backfill-author-canonical-links.mjs', reason: 'metadata: author canonical links' },
  { file: 'scripts/maintenance/classify-text-role.mjs', reason: 'metadata: books.text_role' },
  { file: 'scripts/maintenance/fix-broken-image-thumb.mjs', reason: 'display: thumbnail URLs' },
  { file: 'scripts/maintenance/cover-frame-backfill.mjs', reason: 'display: books.thumbnail_frame (card crop), no step work (#6010); weekly cron' },
  { file: 'scripts/maintenance/mark-stale-translations.mjs', reason: 'marker: pages.translation_stale (#4927). Not a lane, but it is ACTUATION — the paid translate lanes read it' },
  { file: 'scripts/maintenance/withhold-stale-translations.mjs', reason: 'marker: withholds a stale page translation from readers' },
  { file: 'scripts/migration/backfill-display-images.mjs', reason: 'display: display image fields' },
  { file: 'scripts/workers/backfill-hires-gallery.mjs', reason: 'display: gallery hi-res fields' },
  { file: 'scripts/workers/generate-thumbnails.mjs', reason: 'display: page thumbnails' },
  { file: 'scripts/audit/pipeline-hold-drift.mjs', reason: 'read-only audit; imports hold/chained constants whose modules also export writers' },
  { file: 'scripts/workers/sync-books-catalog.mjs', reason: 'mirror: reads books, writes only the Supabase books_catalog mirror (#5288); imports catalogTranslationColumns() from page-counts.mjs, whose module also exports writers' },
  { file: 'scripts/maintenance/daily-digest.mjs', reason: 'read-only digest (#5441): reads usage stores, runs and logs, sends one message; imports RUNS_COLLECTION from translate-batch-seam.mjs, whose module also exports writers' },
  { file: 'scripts/audit/pipeline-next-step-audit.mjs', reason: 'read-only audit of books.pipeline_next (#5478); writes only its ops_reports row; imports nextStep() from pipeline-next-step.mjs, whose module also exports writers' },
  { file: 'scripts/audit/routing-drift.mjs', reason: 'read-only audit of DECISIONS.md against the routers (#5871); opens no database; imports the translation router from translate-core.mjs, whose module also exports writers' },
  { file: 'scripts/maintenance/prewarm-browse.mjs', reason: 'read-only; imports read helpers from page-counts.mjs' },
  { file: 'scripts/workers/enrichment-snapshot.mjs', reason: 'read-only snapshot; imports read helpers from page-counts.mjs' },
  { file: 'scripts/workers/stage-coverage-snapshot.mjs', reason: 'read-only snapshot; imports read helpers from page-counts.mjs' },
  { file: 'src/app/api/cron/dashboard-snapshot/route.ts', reason: 'read-only snapshot; imports read helpers from src/lib/page-counts.ts' },
  { file: 'src/app/api/cron/social-post/route.ts', reason: 'posts a quote; imports src/lib/word-alignment.ts, whose writer it does not call' },
];

/** Every file a lane or an exemption names, for the coverage test. */
export function registeredFiles() {
  const s = new Set(EXEMPT.map((e) => e.file));
  for (const l of LANES) for (const f of l.files) s.add(f);
  return s;
}

/** Lanes that serve a step, for the page: step → lane names. */
export function lanesByStep() {
  const out = Object.fromEntries(LANE_STEPS.map((s) => [s, []]));
  for (const l of LANES) out[l.serves].push(l.name);
  return out;
}
