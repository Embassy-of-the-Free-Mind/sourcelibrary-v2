// PRIOR ART: the lane table in .claude/docs/pipeline-next-step.md ("The lane table", a hand survey of
// 2026-10-01) — prose, so nothing could test it; scripts/workers/scheduler.mjs WORKERS (what the scheduler
// launches, not what each lane selects or respects); scripts/audit/spend-perimeter.mjs (which call sites
// spend, not which books they may touch). None says, per lane, which step it serves and whether it
// respects a hold, a pause and a budget.
//
// lanes — the registry of every code path that does pipeline work on `books` / `pages` (#5480, step 4 of
// #5469). One descriptor per lane; /admin/pipeline renders it beside the daily step counts, and
// tests/unit/lanes-registry.test.ts fails when:
//   - a script named in any box's crontab snapshot (CRONTAB_SNAPSHOTS: main, gex45, l7a), the scheduler's
//     WORKERS, or vercel.json's crons writes `books` or `pages` (directly or through a local import) and is
//     neither a lane here nor listed in EXEMPT with a reason;
//   - a snapshot runs a program from OUTSIDE the repo that is neither a lane's `cron` line nor OFF_REPO_CRON;
//   - a `quota-share` lane has no meter gate in its files, or can reach a paid model client;
//   - a routing hold or cli engine the routers hand books to has no lane (#7301);
//   - a lane declares a pause key or a marker hold check its files do not contain;
//   - a lane declares `respectsHold: false`, `pause: null` or `budget: 'none'` without a `reason`.
//
// WHY ONE FILE, not `export const LANE` in each worker: the design asked for the latter, but most workers
// run main() on import (so a registry that imports them would start them), and Next.js refuses unknown
// exports from a route.ts. The descriptor lives here; each lane names its files, and the test reads them.
//
// SUBSCRIPTION AND GPU LANES (#7301, R9 of #5469): the agy and `claude -p` lanes, Paddle, the GEX45 queue's
// lanes, Kraken and NDL are registered with a budget, and their page writes are stamped `ocr.lane` /
// `translation.lane` from `stamps` (laneForWrite, called by write-provenance.mjs). The quota gate is
// lane-quota.mjs; each job's book list is lane-book-list.mjs until R6.
//
// OBSERVE ONLY. Nothing here changes which books any lane selects (#5480). A `reason` records why a lane
// skips a check TODAY; `gap: true` marks a reason that is a known gap rather than a justification, so
// the page shows it as one. Pure data and pure functions, no imports: /admin/pipeline imports this file.

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
 * The budget unit of a subscription lane (#7301 item 2): a share of the account's WEEKLY quota, read from the
 * meter the boxes already keep (climits for Claude, the agy meter for Gemini through the CLI), paced over the week
 * the way spare-lane.py paces (#6395). Not dollars: the subscription fee is sunk, and an hour of quota left at the
 * reset is lost. The gate is scripts/lib/lane-quota.mjs. A lane out of quota IDLES and its books wait; it never
 * falls through to the paid API (Derek, 2026-10-08). Idle quota near a reset is priced $0 (Derek, 2026-10-26).
 * The unit is Derek's decision D13 on #5469; this is its default, taken as the default by job lane-registry-7301.
 */
export const QUOTA_METERS = {
  climits: { doc: '/root/.claude-limits/latest.json — this box\'s Claude account, weekly + 5-hour percent (model-limits.mjs claudeUsage)' },
  agy: { doc: '/root/agy-quota/status.json — the agy meter: locked models and their reset; no weekly percent yet (#7263 "agy weekly cap from all boxes")' },
};

/**
 * respectsHold: 'marker' — the lane filters or refuses on `pipeline_auto.hold` (tested in source);
 *               'status' — the lane selects only statuses a held book cannot carry (a held book's status
 *                          is `held`; pipeline-hold.mjs "WHY A STATUS"), so it never sees one. A `reason`
 *                          names any path that bypasses the status selector;
 *               false    — no hold check; `reason` required.
 * pause:        the ONE key that stops this lane (PAUSE_KEYS), or null with a `reason`.
 * budget:       'dial' (spend-guard daily dial), 'dial (scoped)', 'envelope', 'committed' (spend already
 *               made: a collector), 'gpu-lease', 'owned-gpu' (a GPU box we rent by the month: $0 a page),
 *               'free-cpu', 'quota-share' (a subscription lane: `quota` below), 'unmetered' (no model
 *               spend), or 'none' (spends with no meter in front of it — `reason` required).
 * quota:        with budget 'quota-share': { meter: QUOTA_METERS key, share, paced? } — the share of the account's
 *               week this lane may bring the account to (0.7 = it idles at 70%); in the last 48 h before the reset
 *               the share is lifted to spare-lane.py's 90% (free quota). `paced: true` also holds it to an even
 *               burn of the week (off for every lane today; lane-quota.mjs says why).
 * stamps:       the page writes this lane makes, so the write helper can stamp `ocr.lane` / `translation.lane`
 *               (#7301 item 3): { field: 'ocr'|'translation', call_site, engine? } — `call_site` is the
 *               engine block's call_site (or, for a specialist writer, the file that builds the `$set`);
 *               `engine` ('gemini'|'anthropic') splits one writer between two lanes. laneForWrite() reads it.
 * routes:       which routing rows hand this lane its books: { hold } (the pipeline hold the router puts on a
 *               book for this lane: CLI_FLASH_OCR_HOLD, CLI_TRANSLATE_HOLD) and/or { engines } (the routing
 *               table engine ids it reads for). The registry test checks both against the routers.
 * cron:         lines of a committed crontab snapshot that run this lane from OUTSIDE the repo (a substring
 *               of the line). A lane that runs only from the box fails the coverage test without one.
 * runsFrom:     where the scheduled copy runs, when it is not the repo checkout, and why.
 */
export const LANES = [
  // ── archive ────────────────────────────────────────────────────────────────────────────────────
  { name: 'archive-bulk', serves: 'archive', files: ['scripts/workers/archive-bulk.mjs'],
    selects: 'IA books, not bulk_unsuitable, first translations first', trigger: 'scheduler, 10 min',
    budget: 'unmetered', respectsHold: false, pause: 'archive',
    reason: 'Fetches page images to R2 and spends no model money. A hold keeps a book out of the paid lanes; a held book still needs its images preserved (preservation-policy.md). Its selector admits a book blocked only BECAUSE it is held (ARCHIVE_NOT_BLOCKED, #5448).' },
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
  { name: 'kraken-syriac', serves: 'ocr',
    files: ['scripts/workers/syriac-kraken-lane.mjs', 'scripts/lib/syriac-kraken-lane.mjs', 'scripts/workers/syriac-kraken-relaunch.sh'],
    selects: 'Syriac books (routing row `syriac`)', trigger: 'cron on main, 30 min (relaunch while the lane has work)',
    budget: 'free-cpu', respectsHold: 'marker', pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/lib/syriac-kraken-lane.mjs' }],
    reason: 'Kraken on free CPU on main; the lane is stopped by its relaunch line, not the model pause (it spends no model money).' },
  { name: 'ndl-koten', serves: 'ocr',
    files: ['scripts/workers/ndl-koten-lane.mjs', 'scripts/lib/ndl-koten-lane.mjs'],
    selects: 'cursive Japanese before 1868 (routing row `japanese-cursive`)', trigger: 'manual, on a leased GPU (gpu-lease-watchdog)',
    budget: 'gpu-lease', respectsHold: 'marker', pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/lib/ndl-koten-lane.mjs' }],
    reason: 'Operator-run on a leased GPU; the lease (gpu-lease-watchdog --lease) is the switch, not the model pause.' },
  { name: 'mineru-ocr', serves: 'ocr', files: ['scripts/workers/mineru-ocr-worker.mjs'],
    selects: 'named books', trigger: 'manual',
    budget: 'gpu-lease', respectsHold: false, pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/workers/mineru-ocr-worker.mjs' }],
    reason: 'Operator-run on a leased GPU for named books; no hold or pause check.', gap: true },
  { name: 'paddle-zh', serves: 'ocr',
    files: ['scripts/lib/paddle-zh-lane.mjs', 'scripts/workers/paddle-zh-lane.mjs', 'scripts/gpu/paddle-zh-fleet.mjs', 'scripts/gpu/paddle-zh-gpu.sh', 'scripts/gpu/paddle-zh-runpod.sh'],
    selects: 'books HELD for it (paddle-zh-5600-ocr-only, paddle-zh-6388-*): Siku Quanshu manuscript volumes (routing rows `chinese-siku-manuscript`, `chinese-tables`)',
    trigger: 'cron on main, 10 min (fleet-cron.sh) + RunPod pod watchdog',
    budget: 'gpu-lease', respectsHold: false, pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/lib/paddle-zh-lane.mjs' }],
    cron: ['/root/paddle-zh-5600/fleet-cron.sh', '/root/paddle-zh-5600/code/scripts/maintenance/runpod-pod-watchdog.mjs'],
    runsFrom: '/root/paddle-zh-5600/code on main: a FIXED copy of this repo, not the checkout, because the lane must not change under a running fleet (scripts/gpu/paddle-zh-fleet.mjs header). The code is the repo\'s; only the copy is pinned. Moving the cron to the checkout is a fleet restart, left to the next fleet run.',
    reason: 'It selects books BY its own hold (the hold is its queue: a held book is out of every other lane), so a hold check would select nothing. RunPod/Scaleway spend is metered by the fleet (running € on every cycle line) and stopped by `touch /root/paddle-zh-5600/STOP`, not the model pause.' },
  { name: 'paddle-zh-guarded', serves: 'ocr', files: ['scripts/workers/paddle-zh-guarded-lane.mjs'],
    selects: 'the held Chinese table + mixed residue of gpu-backlog-5660 (#6871 row 3), from the GEX45 task\'s per-book reads',
    trigger: 'GEX45 GPU queue (/root/bin/gpu-queue.sh on gex45, #6871) reads; apply by hand',
    budget: 'owned-gpu', respectsHold: 'marker', pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/workers/paddle-zh-guarded-lane.mjs' }],
    cron: ['/root/bin/gpu-queue.sh run'],
    reason: 'The read runs on the GEX45 (rented by the month, $0 a page); the apply is by hand over a finished task. Its agy Flash half is gated by the agy meter (agyBlocked) in the task. gpu-queue.sh itself lives only on gex45 (/root/bin) and is not in this repo yet.', gap: true },
  { name: 'paddle-print', serves: 'ocr',
    files: ['scripts/lib/paddle-print-lane.mjs', 'scripts/workers/paddle-print-lane.mjs', 'scripts/gpu/paddle-print-gpu.sh'],
    selects: 'Chinese and Japanese print outside the Siku cohort, split leaves (#6101), books HELD paddle-print-6101',
    trigger: 'GEX45 GPU queue (/root/bin/gpu-queue.sh on gex45, #6871) reads; apply by hand',
    budget: 'owned-gpu', respectsHold: false, pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/lib/paddle-print-lane.mjs' }],
    cron: ['/root/bin/gpu-queue.sh run'],
    reason: 'It holds every book itself (paddle-print-6101) before its first write, and selects them by that hold. The GEX45 is rented by the month ($0 a page); the queue runs one task at a time under /root/gpu.lock.' },

  // ── subscription lanes (#7301): routed by the routing tables, budgeted in quota, never the paid API ──────────
  { name: 'agy-flash-ocr', serves: 'ocr', files: ['scripts/batch/cli-ocr.mjs', 'scripts/batch/cli-ocr-lane.mjs', 'scripts/lib/agy-cli.mjs'],
    selects: 'books the OCR router holds for it (CLI_FLASH_OCR_HOLD: the flash families of ocr-routing-table.json); Flash-Lite drafts of visible German/French books for `cli-ocr-lane.mjs correct` (#7558); and page lists by hand',
    trigger: 'cron on main every 2 h: cli-ocr-lane.mjs run (:10, #7089) and cli-ocr-lane.mjs correct (:50, stops at the agy quota floor, #7558); one-off claude-job runs with their own page lists (book list recorded per job until R6)',
    budget: 'quota-share', quota: { meter: 'agy', share: 0.4 }, respectsHold: false, pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/batch/cli-ocr.mjs', engine: 'gemini' }],
    routes: { hold: 'ocr-flash-cli-7075' },
    reason: 'Runs named page lists, often of books held FOR it (the hold is the router\'s queue). A locked model is never called (agy-cli.mjs → model-limits.mjs agyBlocked): the run sleeps to the quoted reset, it never falls to the API. No pause check: a person or a job is the switch.', gap: true },
  { name: 'agy-flash-translate', serves: 'translate', files: ['scripts/batch/cli-translate.mjs', 'scripts/batch/cli-translate-lane.mjs', 'scripts/batch/siku-translate-lane.mjs', 'scripts/batch/reader-request-lane.mjs', 'scripts/lib/agy-cli.mjs'],
    selects: 'books the translation router holds for it (CLI_TRANSLATE_HOLD, `channel: "cli"` rows naming gemini-3.8-flash+agy-cli), the held Siku Quanshu cohort (paddle-zh-5600-ocr-only / gpu-backlog-5660, kept held, siku-translate-lane.mjs, #5600), books a reader asked for (open translation-request feedback rows passing translation-request-eligibility.mjs; reader-request-lane.mjs OCRs their missing pages first and emails the reader, #7599), and page lists by hand',
    trigger: 'cron on main every 2 h: cli-translate-lane.mjs (#7075) and siku-translate-lane.mjs (#5600, its own per-pool weekly floor from agy /quota); reader-request-lane.mjs every 2 h on the second agy pool (#7599); one-off claude-job runs (book list recorded per job until R6)',
    budget: 'quota-share', quota: { meter: 'agy', share: 0.4 }, respectsHold: false, pause: null,
    stamps: [{ field: 'translation', call_site: 'scripts/batch/cli-translate.mjs', engine: 'gemini' }],
    routes: { hold: 'translate-cli-7075', engines: ['gemini-3.8-flash+agy-cli'] },
    reason: 'It drains the books held FOR it (the hold is its queue). A locked model is not called; a quota reply stops the run and the book waits. No pause check yet: the lane runs by hand.', gap: true },
  { name: 'claude-opus-translate', serves: 'translate', files: ['scripts/batch/claude-translate.mjs', 'scripts/batch/cli-translate.mjs', 'scripts/batch/cli-translate-lane.mjs', 'scripts/lib/lane-quota.mjs'],
    selects: 'books the translation router holds for it (CLI_TRANSLATE_HOLD, `channel: "cli"` rows naming claude-opus-5-5), refused pages\' English, and page lists by hand',
    trigger: 'one-off claude-job runs (book list recorded per job until R6); refused-pages.mjs on l7a every 3 h translates what it OCRs',
    budget: 'quota-share', quota: { meter: 'climits', share: 0.7, endOfWeek: { weekly: 95, hours: 24 } }, respectsHold: false, pause: null,
    stamps: [{ field: 'translation', call_site: 'scripts/batch/cli-translate.mjs', engine: 'anthropic' }],
    routes: { hold: 'translate-cli-7075', engines: ['claude-opus-5-5'] },
    reason: 'It drains the books held FOR it. claudeBlocked() refuses the call on a spent account; the runner\'s quota gate (lane-quota.mjs) idles it at its share, paced over the week. No pause check: the subscription spends no dial money.', gap: true },
  { name: 'claude-opus-ocr', serves: 'ocr', files: ['scripts/batch/claude-ocr.mjs', 'scripts/batch/claude-ocr-two-read.mjs', 'scripts/batch/cli-ocr.mjs', 'scripts/batch/refused-pages.mjs', 'scripts/lib/lane-quota.mjs'],
    selects: 'pages Gemini refused (routing row `refused-pages` fallback), manuscripts and Nahuatl/Mayan books (rows `manuscripts`, `nahuatl-mayan`), corrections of stored drafts, by list',
    trigger: 'cron on l7a every 3 h (refused-pages.mjs, #7170) + one-off claude-job runs (book list recorded per job until R6)',
    budget: 'quota-share', quota: { meter: 'climits', share: 0.7 }, respectsHold: false, pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/batch/cli-ocr.mjs', engine: 'anthropic' }, { field: 'ocr', call_site: 'scripts/batch/claude-ocr-two-read.mjs' }],
    routes: { engines: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
    reason: 'refused-pages reads held books on purpose (a page Gemini refused in a held book still needs text) and skips containment holds. claudeBlocked() refuses a call on a spent account; the quota gate idles the cron at its share. It calls no paid API.', gap: true },

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
  { file: 'scripts/maintenance/seam-repair-6742/lean.mjs', reason: 'repair: minimal edge edits to served page translations at broken page joins, through writePageTranslation with a revision per page and an undo (#6742); no step work, skips held books; nightly cron, stops at the account\'s 60% weekly' },
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
  { file: 'scripts/audit/english-served-divergence.mjs', reason: 'read-only audit of the English served on English-original leaves (#7100); writes nothing; imports isEnglishOriginal() from page-counts.mjs, whose module also exports writers' },
  { file: 'scripts/audit/routing-drift.mjs', reason: 'read-only audit of DECISIONS.md against the routers (#5871); opens no database; imports the translation router from translate-core.mjs, whose module also exports writers' },
  { file: 'scripts/maintenance/prewarm-browse.mjs', reason: 'read-only; imports read helpers from page-counts.mjs' },
  { file: 'scripts/workers/enrichment-snapshot.mjs', reason: 'read-only snapshot; imports read helpers from page-counts.mjs' },
  { file: 'scripts/workers/stage-coverage-snapshot.mjs', reason: 'read-only snapshot; imports read helpers from page-counts.mjs' },
  { file: 'src/app/api/cron/dashboard-snapshot/route.ts', reason: 'read-only snapshot; imports read helpers from src/lib/page-counts.ts' },
  { file: 'src/app/api/cron/social-post/route.ts', reason: 'posts a quote; imports src/lib/word-alignment.ts, whose writer it does not call' },
  { file: 'scripts/audit/librarian-citation-gauge.ts', reason: 'read-only gauge on l7a (#6946): judges Librarian page links, writes a JSONL line and a markdown row; imports page-text helpers whose modules also export writers' },
  { file: 'scripts/workers/librarian-citation-fixer.ts', reason: 'l7a, DRY-RUN (#6946): writes only librarian_citation_fixes proposals; imports page-text helpers whose modules also export writers' },
];

/**
 * The committed snapshots of every box's live crontab (#7301 item 4). The coverage test reads all of them, so a lane
 * that runs only from a box — a script outside the repo, or a repo script only one box schedules — fails CI.
 * Re-snapshot with `crontab -l` on the box and PR it (sync-crontab.sh reports main's drift daily).
 */
export const CRONTAB_SNAPSHOTS = [
  { box: 'main', file: 'scripts/workers/crontab.production' },
  { box: 'gex45', file: 'infrastructure/gex45-crontab' },
  { box: 'l7a', file: 'infrastructure/l7a-crontab' },
];

/**
 * Programs OUTSIDE this repo that a crontab snapshot runs and that are not lanes, each with why. A path here is
 * matched as a substring of the live line. Hand drivers of a lane go here until R6 (#5825) retires them; they
 * name the lane they drive. A new off-repo line that is neither here nor in a lane's `cron` fails the test.
 */
export const OFF_REPO_CRON = [
  { match: '/root/moltbook-', reason: 'not Source Library (moltbook)' },
  { match: '/root/restic-backup.sh', reason: 'box backup, no step work' },
  { match: '/root/bin/claude-job.sh', reason: 'job plumbing: starts or resumes headless jobs (a copy of scripts/workers/claude-job.sh); the work each job does is the lane it runs' },
  { match: '/root/bin/claude-rc.sh', reason: 'job plumbing: remote-control session at boot' },
  { match: '/root/bin/agy-wal-checkpoint.py', reason: 'disk: a copy of scripts/workers/agy-wal-checkpoint.py (#6223)' },
  { match: '/root/disk-alarm.sh', reason: 'disk: fallback copy of scripts/workers/disk-alarm.sh' },
  { match: '/data/vector-search/app/', reason: 'page-vector service on l7a (#6821): reads page_translations from Supabase, writes its own index; a deployed copy of scripts/workers/vector-search' },
  { match: '/root/translate300/driver.mjs', reason: 'hand driver (#5467) of translate-chained; retired by R6 (#5825)' },
  { match: '/root/translate-next/driver.mjs', reason: 'hand driver (#5467) of translate-chained; retired by R6 (#5825)' },
  { match: '/root/claude-jobs/chain-translate-next.sh', reason: 'starts the translate-next-5467 hand driver; retired with it by R6 (#5825)' },
  { match: '/root/leaf-break/fullrun-4523-watchdog.sh', reason: 'watchdog of the #4523 Tibetan re-OCR driver (Yigdzin, specialist); remove when DONE-4523 exists' },
  { match: '/root/tib-step2/tend.py', reason: 'tends the #5320 Tibetan step-2 job; remove when step 2 is done' },
  { match: '/root/tibetan-reocr/relaunch.sh', reason: 'NOT A REGISTERED LANE YET: relaunches the Tibetan Yigdzin re-OCR reads on main (#4523, routing row `tibetan`); its pages are written by hand through scripts/maintenance/apply-reocr-verdicts.mjs after adjudication. Remove when the re-OCR is done, or register it if it becomes standing' },
  { match: '/root/tibetan-eval/relaunch_reacquire.sh', reason: 'relaunches the British Library image re-acquisition (#4646): images, no model spend; remove when reacquire-done.txt is complete' },
  { match: '/root/bin/ocr-filler.sh', reason: 'queues ONE chunk of the first gated OCR route in scripts/gpu/ocr-filler-routes.tsv on the gex45 GPU queue when it is empty (#6871; replaced the SigLIP2 requeue 2026-10-28); an installed copy of scripts/gpu/ocr-filler.sh. Writes no page text itself: each route\'s own lane applies its reads (first route: paddle-zh-lane.mjs, #7546)' },
];

/**
 * The lane a page write belongs to, from the registry (#7301 item 3): the name of the lane whose `stamps` names
 * this field, this call_site and (when the stamp splits a writer) this engine family, else null. Called by
 * ocrProvenance / translationProvenance (write-provenance.mjs) for every writer that goes through them, and by the
 * specialist `$set` builders with their own call_site. null means the writer is not a registered stamped lane, and
 * no `lane` field is written.
 */
export function laneForWrite(field, engine) {
  if (!engine || typeof engine !== 'object' || !engine.call_site) return null;
  for (const l of LANES) {
    for (const s of l.stamps ?? []) {
      if (s.field === field && s.call_site === engine.call_site && (!s.engine || s.engine === (engine.name ?? 'gemini'))) return l.name;
    }
  }
  return null;
}

/** A lane by name, or undefined. */
export const laneByName = (name) => LANES.find((l) => l.name === name);

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
