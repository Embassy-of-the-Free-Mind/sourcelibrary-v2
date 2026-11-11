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
    trigger: 'cron on gex45, one line a pool: cli-ocr-lane.mjs latin-first (#7263: Latin re-read, then the German/French correction, then the rest of Latin). cron on main every 2 h: cli-ocr-lane.mjs run (:10, #7089) and cli-ocr-lane.mjs correct (:50, stops at the agy quota floor, #7558); one-off claude-job runs with their own page lists (book list recorded per job until R6)',
    budget: 'quota-share', quota: { meter: 'agy', share: 0.4 }, respectsHold: false, pause: null,
    stamps: [{ field: 'ocr', call_site: 'scripts/batch/cli-ocr.mjs', engine: 'gemini' }],
    routes: { hold: 'ocr-flash-cli-7075' },
    reason: 'Runs named page lists, often of books held FOR it (the hold is the router\'s queue). A locked model is never called (agy-cli.mjs → model-limits.mjs agyBlocked): the run sleeps to the quoted reset, it never falls to the API. No pause check: a person or a job is the switch.', gap: true },
  { name: 'agy-flash-translate', serves: 'translate', files: ['scripts/batch/cli-translate.mjs', 'scripts/batch/cli-translate-lane.mjs', 'scripts/batch/siku-translate-lane.mjs', 'scripts/batch/reader-request-lane.mjs', 'scripts/lib/agy-cli.mjs'],
    selects: 'books the translation router holds for it (CLI_TRANSLATE_HOLD, `channel: "cli"` rows naming gemini-3.8-flash+agy-cli), the held Siku Quanshu cohort (paddle-zh-5600-ocr-only / gpu-backlog-5660, kept held, siku-translate-lane.mjs, #5600; a book with an open reader request goes first, #7690), books a reader asked for (open translation-request feedback rows passing translation-request-eligibility.mjs; reader-request-lane.mjs OCRs their missing pages first and emails the reader, #7599), and page lists by hand',
    trigger: 'cron on gex45 hourly: cli-translate-lane.mjs finish (#8482: idle visible books closest to done first) and cli-translate-lane.mjs stale (#7263: re-translation after the Latin re-read, yields to finish). cron on main every 2 h: cli-translate-lane.mjs (#7075) and siku-translate-lane.mjs (#5600, its own per-pool weekly floor from agy /quota); reader-request-lane.mjs every 2 h on the second agy pool (#7599); one-off claude-job runs (book list recorded per job until R6)',
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
    selects: 'priority < 90, visible, not English (auto-enrolled or approved runs)', trigger: 'none since 2026-11-08: both cron lines retired (#8283; #8279 routes every translation to agy). By hand only',
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
  { name: 'agy-flash-enrich', serves: 'enrich', files: ['scripts/workers/lib/enrich-agy-lane.mjs', 'scripts/lib/agy-cli.mjs'],
    selects: 'the batch lane\'s gap (live translated books past the realtime statuses with no summary / index / chapters), reads then translated pages; each book claimed in enrich_batch_books before its call so the API batch lane skips it, and handed back to it on failure (#7628)',
    trigger: 'cron on main every 2 h: enrich-worker.mjs --agy (#7628), Gemini 3.8 Flash low, one conversation per book; stops at its daily request cap (about a quarter of one agy pool\'s week, Derek 2026-10-28), at the pool\'s quota floor (cli-ocr-lane.mjs quotaFloor) and at the first quota reply',
    budget: 'quota-share', quota: { meter: 'agy', share: 0.4 }, respectsHold: 'marker', pause: 'enrich',
    reason: 'Its model calls are the subscription CLI only. The writes it shares with the API lanes (finishEnrichBook) still upsert the book and page embeddings through the embedding API, as every enrich lane does: that is the embedding step, not a fallback for the enrichment call.' },

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
  { file: 'scripts/eval/quality-dashboard/build.mjs', reason: 'report: reads book and page counts, writes only its dashboard file and ops_reports' },
  { file: 'scripts/eval/quality-dashboard/trends.mjs', reason: 'report: reads book and page counts, writes only its own daily trend rows; no book or page writes' },
  { file: 'scripts/maintenance/rebuild-human-read-count-5048.mjs', reason: 'metadata: recomputes books.human_read_count from analytics_events, no step work (#5048); daily cron' },
  { file: 'scripts/maintenance/router-board-push.mjs', reason: 'report: reads the router table and repo crontabs, writes only ops_reports router-board:latest for /admin/router (#7913); the write libs come in through the lane constants router-binding.mjs imports from cli-ocr-lane.mjs' },
  { file: 'scripts/eval/lane-judge-sampler.mjs', reason: 'measurement: reads pages/books/page_revisions, writes only lane_judge_verdicts, lane_judge_runs and ops_reports (#7611); the write libs come in through the lane constants it imports from cli-ocr-lane.mjs' },
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
  { file: 'scripts/maintenance/rehost-walled-covers.mjs', reason: 'display: cover URLs moved from walled hosts to the R2 copy of the same page (#5448)' },
  { file: 'scripts/maintenance/seam-repair-6742/lean.mjs', reason: 'repair: minimal edge edits to served page translations at broken page joins, through writePageTranslation with a revision per page and an undo (#6742); no step work, skips held books; nightly cron, stops at the account\'s 60% weekly' },
  { file: 'scripts/maintenance/cover-frame-backfill.mjs', reason: 'display: books.thumbnail_frame (card crop), no step work (#6010); weekly cron' },
  { file: 'scripts/maintenance/backfill-cover-cards.mjs', reason: 'display: books.image_card, the 500px AVIF cover written to R2 beside the scan, no step work (#4342, #6920); daily cron' },
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
  { match: '/root/tengyur-cli-6361/watchdog.sh', reason: 'tends the #6361 Tengyur CLI driver; removes itself at DONE-STAGE2' },
  { match: '/usr/local/bin/climits', reason: 'reads Claude subscription limits, no step work' },
  { match: '/root/agy-quota/meter.py', reason: 'meter for the agy quota (#6331, #6375): passive, makes no model calls' },
  { match: '/root/bin/box.sh', reason: 'job plumbing: pushes limits across the box mesh' },
  { match: '/root/bin/sync-concepts.sh', reason: 'not book or page work: syncs the concept knowledge bases' },
  { match: '/root/restic-transcripts.sh', reason: 'box backup of session transcripts, no step work' },
  { match: '/root/moltbook-', reason: 'not Source Library (moltbook)' },
  { match: '/root/restic-backup.sh', reason: 'box backup, no step work' },
  { match: '/root/bin/claude-job.sh', reason: 'job plumbing: starts or resumes headless jobs (a copy of scripts/workers/claude-job.sh); the work each job does is the lane it runs' },
  { match: '/root/bin/claude-rc.sh', reason: 'job plumbing: remote-control session at boot' },
  { match: '/root/bin/agy-wal-checkpoint.py', reason: 'disk: a copy of scripts/workers/agy-wal-checkpoint.py (#6223)' },
  { match: '/root/disk-alarm.sh', reason: 'disk: fallback copy of scripts/workers/disk-alarm.sh' },
  { match: '/root/bin/atlas-egress-meter.sh', reason: 'cost alarm: hand-placed copy of scripts/workers/atlas-egress-meter.sh, the cron fallback until the checkout has it; counts bytes from Atlas, no step work (#5189)' },
  { match: '/root/bin/disk-steward.sh', reason: 'disk: hand-placed copy of scripts/workers/disk-steward.sh, the cron fallback until the checkout has cold-r2.mjs (#6223)' },
  { match: '/data/vector-search/app/', reason: 'page-vector service on l7a (#6821): reads page_translations from Supabase, writes its own index; a deployed copy of scripts/workers/vector-search' },
  { match: '/root/bin/ocr-filler.sh', reason: 'queues ONE chunk of the first gated OCR route in scripts/gpu/ocr-filler-routes.tsv on the gex45 GPU queue when it is empty (#6871; replaced the SigLIP2 requeue 2026-10-28); an installed copy of scripts/gpu/ocr-filler.sh. Writes no page text itself: each route\'s own lane applies its reads (first route: paddle-zh-lane.mjs, #7546)' },
];

/**
 * CRON ROWS (#8283): one row per page-work cron LINE on every box, so an old line cannot linger unseen. LANES says
 * what a code path may do; this says which scheduled line runs it, why (issue), on which route, who answers for it,
 * and when someone must look again. Seeded from the lane-audit-8283 inventory (2026-11-08,
 * https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/8283#issuecomment-6726714864).
 *
 * pipeline-now-push.mjs judges every live line of each box against these rows hourly (judgeCronLine below) and
 * /admin/pipeline/now shows the red ones at the top; a weekly ntfy names them. Red is one of:
 *   UNREGISTERED   a live line of a page-work stage (JUDGED_STAGES) that no row matches;
 *   RETIRED BUT LIVE  a live line matching a `retired` row;
 *   PAST REVIEW    today is after the row's `review_by`;
 *   IDLE 7 DAYS    the row names the page stamp it writes (`writes`: pages.ocr.lane / translation.lane, else
 *                  .source) and the corpus wrote 0 pages under it in 7 days. Lane-level: rows sharing a stamp
 *                  are idle together. `paused` rows are not judged idle;
 *   MATCHES A RETIRED PATTERN  RETIRED_PATTERNS, unless the row lists the pattern id in `allow` with a reason.
 *
 * match:     { script?: basename of the executed script, mode?: its subcommand, has?: substrings of the raw line }.
 *            Every key given must hold. First matching row wins, so the narrower row comes first.
 * status:    'current' | 'paused' (stopped for cause, stays stopped: a STOP file or a #PAUSED tag) | 'retired'.
 * route:     agy | GPU>agy | Opus | GPU>Opus (routing.md), or what else it is (none, Kraken, IA djvu, paid API).
 * owner:     who answers for the line. Derek, unless a named job does.
 * open:      an unanswered policy question (the audit's UNKNOWN rows); such rows get a short review_by.
 * Adding a cron line that does page work: add its row here in the same PR. Retiring one: set `retired`, keep the row.
 */
export const JUDGED_STAGES = ['ocr', 'translate', 'enrich', 'embed', 'orchestrator'];
export const BOX_ALIASES = { hetzner: 'main' };

const QUARTER = '2027-02-01';
const SOON = '2026-11-22';
export const CRON_ROWS = [
  // ── main ───────────────────────────────────────────────────────────────────────────────────────────
  { id: 'main-chained-tick', box: 'main', match: { script: 'translate-batch-worker.mjs', has: ['--tick'] }, issue: 8279, route: 'paid API (flash-lite Batch)', owner: 'Derek', review_by: QUARTER, status: 'retired', note: 'retired 2026-11-08 (#8283, PR #8452): 46 runs dial-closed every tick, 0 written' },
  { id: 'main-chained-enrol', box: 'main', match: { script: 'translate-batch-worker.mjs', has: ['--enrol-auto'] }, issue: 8279, route: 'paid API (flash-lite Batch)', owner: 'Derek', review_by: QUARTER, status: 'retired', note: 'retired 2026-11-08 (#8283, PR #8452): enrolment paused by NO-GO since 10-10' },
  { id: 'main-preview-stubs', box: 'main', match: { has: ['/root/preview-stubs-4719/driver.mjs'] }, issue: 4719, route: 'paid API (chained lane)', owner: 'Derek', review_by: QUARTER, status: 'retired', note: 'retired 2026-11-08 (#8283, PR #8452)' },
  { id: 'main-routing-drift', box: 'main', match: { script: 'routing-drift.mjs' }, issue: 8331, route: 'none', owner: 'Derek', review_by: QUARTER, status: 'retired', note: 'retired 2026-11-08: script deleted by #8331' },
  { id: 'main-leaf-break-4523', box: 'main', match: { has: ['/root/leaf-break/fullrun-4523-watchdog.sh'] }, issue: 4523, route: 'Yigdzin (specialist)', owner: 'Derek', review_by: QUARTER, status: 'retired', note: 'retired 2026-11-08: DONE-4523' },
  { id: 'main-cli-translate-opus', box: 'main', match: { script: 'cli-translate-lane.mjs', has: ['--engine=claude-opus-5-5'] }, lane: 'claude-opus-translate', writes: 'claude-opus-translate', issue: 7075, route: 'Opus', owner: 'Derek', review_by: SOON, status: 'current', open: 'Claude quota goes to Opus QA, not translation writes: keep only the router cells bound to Opus? (#8283 decision 3)' },
  { id: 'main-reader-request', box: 'main', match: { script: 'reader-request-lane.mjs' }, lane: 'agy-flash-translate', writes: 'agy-flash-translate', issue: 7599, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-siku-translate', box: 'main', match: { script: 'siku-translate-lane.mjs' }, lane: 'agy-flash-translate', issue: 5600, route: 'agy', owner: 'Derek', review_by: '2026-12-08', status: 'paused', note: 'STOP file since the 2026-10-30 spot check (invented / wrong-leaf); stays stopped' },
  { id: 'main-cli-ocr-run', box: 'main', match: { script: 'cli-ocr-lane.mjs', mode: 'run' }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 7089, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-cli-ocr-correct', box: 'main', match: { script: 'cli-ocr-lane.mjs', mode: 'correct' }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 7558, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'retired', note: 'retired 2026-10-28 (#7263, PR #7594): the correction lane runs on gex45' },
  { id: 'main-ia-ocr-nightly', box: 'main', match: { script: 'ia-ocr-nightly.mjs' }, writes: 'ia_djvu', issue: 8283, route: 'IA djvu (agreement-gated)', owner: 'Derek', review_by: SOON, status: 'current', open: 'Archive text is not one of the four routes: name it in routing.md, or retire? (#8283 decision 5)' },
  { id: 'main-pre-ocr-dupe', box: 'main', match: { script: 'pre-ocr-dupe-screen-nightly.sh' }, issue: 8283, route: 'none (holds duplicate printings)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-syriac-kraken', box: 'main', match: { script: 'syriac-kraken-relaunch.sh' }, lane: 'kraken-syriac', writes: 'kraken-syriac', issue: 4883, route: 'Kraken (named exception)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-paddle-fleet', box: 'main', match: { has: ['/root/paddle-zh-5600/fleet-cron.sh'] }, lane: 'paddle-zh', issue: 5600, route: 'GPU', owner: 'Derek', review_by: SOON, status: 'current', note: 'fleet-state done: a self-guarded no-op. Retire with the paddle-zh `cron` entry above at the next fleet run.' },
  { id: 'main-runpod-watchdog', box: 'main', match: { has: ['runpod-pod-watchdog.mjs'] }, lane: 'paddle-zh', issue: 5600, route: 'GPU (watchdog)', owner: 'Derek', review_by: SOON, status: 'current', note: 'goes with main-paddle-fleet' },
  { id: 'main-tengyur-6361', box: 'main', match: { has: ['/root/tengyur-cli-6361/watchdog.sh'] }, issue: 6361, route: 'agy', owner: 'Derek', review_by: SOON, status: 'paused', open: 'STOP by hand since 10-10: finish or retire? (#8283)' },
  { id: 'main-enrich-batch', box: 'main', match: { script: 'enrich-worker.mjs', has: ['--batch'] }, lane: 'enrich-worker-batch', issue: 2141, route: 'paid API (flash-lite Batch, --max-usd)', owner: 'Derek', review_by: QUARTER, status: 'current', allow: { 'paid-flash-lite': 'paid flash-lite within a dial is allowed (Derek, #8279); scoped to an open envelope' } },
  { id: 'main-enrich-agy', box: 'main', match: { script: 'enrich-worker.mjs', has: ['--agy'] }, lane: 'agy-flash-enrich', issue: 7628, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-enrich-metadata', box: 'main', match: { has: ['backfill-printed-page-4291.mjs'] }, issue: 4291, route: 'none (printed page numbers)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-hires-gallery', box: 'main', match: { script: 'backfill-hires-gallery.mjs' }, issue: 8283, route: 'none (display fields)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-author-geo', box: 'main', match: { script: 'backfill-thesaurus-author-locations.mjs' }, issue: 8283, route: 'none (metadata)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-place-geo', box: 'main', match: { script: 'geocode-publication-places.mjs' }, issue: 8283, route: 'none (metadata)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-enrichment-snapshot', box: 'main', match: { script: 'enrichment-snapshot.mjs' }, issue: 8283, route: 'none (read-only snapshot)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-embed-gemini', box: 'main', match: { script: 'embed-gemini.mjs' }, issue: 8283, route: 'paid API (Gemini embeddings)', owner: 'Derek', review_by: SOON, status: 'current', open: 'paid embeddings: inside the doctrine? name them in spend-controls.md (#8283 decision 5)' },
  { id: 'main-embed-site', box: 'main', match: { script: 'embed-site-pages.mjs' }, issue: 8283, route: 'embeddings (site pages)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-embed-images', box: 'main', match: { script: 'image-embeddings-cron.mjs' }, issue: 8283, route: 'embeddings (images)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-scheduler', box: 'main', match: { script: 'scheduler.mjs' }, issue: 8283, route: 'router (orchestrator, translate-worker, enrich-worker: dial closed)', owner: 'Derek', review_by: SOON, status: 'current', open: 'scheduler translate-worker / enrich-worker are idle API lanes: drop them from WORKERS? (#8283)' },
  { id: 'main-orchestrator-finalize', box: 'main', match: { script: 'pipeline-orchestrator.mjs' }, issue: 8283, route: 'none (Phase 9 finalize)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  // QA / flags on main (qc is judged only when a row or a pattern matches)
  { id: 'main-mark-stale', box: 'main', match: { script: 'mark-stale-translations.mjs' }, issue: 4927, route: 'none (staleness flags)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-leak-check', box: 'main', match: { script: 'new-translation-leaks.mjs' }, issue: 8414, route: 'none (neighbour-leak detector, sees page breaks)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'main-corpus-audit-draw', box: 'main', match: { script: 'monthly-draw.sh' }, issue: 5301, route: 'Opus (judge)', owner: 'Derek', review_by: SOON, status: 'current', open: 'one interior page per book: move to paired-fifths (#8405)?' },
  { id: 'main-convergent-audit', box: 'main', match: { script: 'convergent-audit-weekly.sh' }, issue: 6420, route: 'Opus (judge)', owner: 'Derek', review_by: SOON, status: 'current', open: 'one page per call: move to paired-fifths (#8405)?' },

  // ── gex45 ──────────────────────────────────────────────────────────────────────────────────────────
  { id: 'gex45-cli-translate', box: 'gex45', match: { script: 'cli-translate-lane.mjs', mode: 'run' }, lane: 'agy-flash-translate', writes: 'agy-flash-translate', issue: 7075, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'gex45-cli-translate-stale', box: 'gex45', match: { script: 'cli-translate-lane.mjs', mode: 'stale' }, lane: 'agy-flash-translate', writes: 'agy-flash-translate', issue: 7263, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'gex45-cli-translate-finish', box: 'gex45', match: { script: 'cli-translate-lane.mjs', mode: 'finish' }, lane: 'agy-flash-translate', writes: 'agy-flash-translate', issue: 8482, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current', note: 'finish books first (Derek 2026-11-10): idle visible books, >= 80% translated first' },
  { id: 'gex45-latin-first', box: 'gex45', match: { script: 'cli-ocr-lane.mjs', mode: 'latin-first' }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 7263, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current', note: 'one line a pool (default, james, milo)' },
  { id: 'gex45-first-reads', box: 'gex45', match: { script: 'cli-ocr-lane.mjs', mode: 'run', has: ['--cohort=visible-unread'] }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 7701, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'gex45-finish-first-reads', box: 'gex45', match: { script: 'cli-ocr-lane.mjs', mode: 'run', has: ['--cohort=finish'] }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 8482, route: 'agy', owner: 'Derek', review_by: QUARTER, status: 'current', note: 'unread pages of books >= 80% translated, German and French' },
  { id: 'gex45-armc-first-read', box: 'gex45', match: { script: 'cli-ocr-lane.mjs', mode: 'armc-plan', has: ['--frame=first-read'] }, lane: 'agy-flash-ocr', issue: 7701, route: 'GPU>agy', owner: 'Derek', review_by: '2026-12-08', status: 'paused', note: 'paused 2026-11-04 at 19% yield; stays paused' },
  { id: 'gex45-armc-campaign', box: 'gex45', match: { script: 'cli-ocr-lane.mjs', mode: 'armc-plan', has: ['--frame=campaign'] }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 8049, route: 'GPU>agy', owner: 'Derek', review_by: QUARTER, status: 'current', note: '62% of taken pages written (2026-11-08); not the first-read cause' },
  { id: 'gex45-armc-euro', box: 'gex45', match: { script: 'cli-ocr-lane.mjs', mode: 'armc-plan', has: ['--frame=euro'] }, lane: 'agy-flash-ocr', writes: 'agy-flash-ocr', issue: 6871, route: 'GPU>agy', owner: 'Derek', review_by: QUARTER, status: 'current', note: 'es19 / fr19: 82% written (2026-11-08)' },
  { id: 'gex45-gpu-queue', box: 'gex45', match: { has: ['/root/bin/gpu-queue.sh'] }, issue: 6871, route: 'GPU drafts (PERO / LightOn / Paddle)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'gex45-ocr-filler', box: 'gex45', match: { has: ['/root/bin/ocr-filler.sh'] }, issue: 6871, route: 'GPU drafts', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'gex45-withhold-stale', box: 'gex45', match: { script: 'withhold-stale-translations.mjs' }, issue: 4927, route: 'none (withholding)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  { id: 'gex45-page-integrity-draw', box: 'gex45', match: { script: 'page-integrity-draw.mjs' }, issue: 8040, route: 'Opus (judge)', owner: 'Derek', review_by: SOON, status: 'current', open: 'one served page per book: move to paired-fifths (#8405)?' },

  // ── l7a ────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'l7a-refused-pages', box: 'l7a', match: { script: 'refused-pages.mjs' }, lane: 'claude-opus-ocr', writes: 'claude-opus-ocr', issue: 7170, route: 'Opus (or Sonnet)', owner: 'Derek', review_by: SOON, status: 'current', open: 'Sonnet is off the four routes: Opus only? (#8283 decision 4)' },
  { id: 'l7a-lane-judge-nightly', box: 'l7a', match: { script: 'lane-judge-sampler.mjs', mode: 'nightly' }, issue: 7611, route: 'Opus (judge)', owner: 'Derek', review_by: SOON, status: 'current', open: 'one page per book: move to paired-fifths (#8405)?' },
  { id: 'l7a-lane-judge-weekly', box: 'l7a', match: { script: 'lane-judge-sampler.mjs', mode: 'weekly-pr' }, issue: 7611, route: 'none (weekly report)', owner: 'Derek', review_by: QUARTER, status: 'current' },
  // cloudlayer: no page-text lines in its snapshot (2026-11-08; its live crontab could not be read).
];

/**
 * Shapes doctrine has retired (#8283). A live line matching one is red unless its row `allow`s the id with a reason.
 */
export const RETIRED_PATTERNS = [
  { id: 'paid-flash-lite', test: /translate-batch-worker\.mjs[^#]*--chained|batch-(?:ocr|translate)-async|enrich-worker\.mjs[^#]*--batch/,
    why: 'paid flash-lite lane: everything on agy; paid flash-lite only within a dial (Derek, PR #8279)' },
  { id: 'single-page-qa', test: /lane-judge-sampler\.mjs[^#]*\bnightly\b|translation-corpus-audit\/monthly-draw|page-integrity-draw\.mjs|convergent-audit-weekly/,
    why: 'QA that never sees a page break: every QA or book check reads paired fifths (#8405, PR #8411)' },
];

/**
 * What SESSIONS READ (docs, skills, commands), as opposed to what RUNS (#8283). RETIRED_PATTERNS are cron-line
 * shapes; a doc rarely quotes one verbatim, so DOC_RETIRED_EXTRA adds the phrases a doc uses to teach the same
 * retired approach. A doc matching either list must carry a SUPERSEDED/RETIRED banner near its top.
 */
export const DOC_RETIRED_EXTRA = [
  { id: 'gemini-batch-default', test: /Gemini Batch API|batch-(?:ocr|translate)-async|gemini-3\.1-flash-lite-preview/i,
    why: 'the paid Gemini Batch API / flash-lite-preview is no longer a route: agy, GPU>agy, Opus, GPU>Opus (docs/routing.md)' },
];

export const BANNER_WINDOW_LINES = 15;
const BANNER_RE = /\b(SUPERSEDED|RETIRED)\b/;

/** Ids of the retired patterns a doc's text matches. */
export function retiredPatternsIn(text) {
  const t = String(text);
  return [...RETIRED_PATTERNS, ...DOC_RETIRED_EXTRA].filter((p) => p.test.test(t)).map((p) => p.id);
}

/** True when a SUPERSEDED/RETIRED banner sits in the first BANNER_WINDOW_LINES lines. */
export function hasRetiredBanner(text) {
  return String(text).split('\n').slice(0, BANNER_WINDOW_LINES).some((l) => BANNER_RE.test(l));
}

const basename = (p) => (p ? String(p).split('/').pop() : null);

/** The CRON_ROWS row a live line belongs to, or null. `line` carries { cmd, script, mode }; `box` may be an alias. */
export function cronRowFor(box, line) {
  const b = BOX_ALIASES[box] ?? box;
  return CRON_ROWS.find((r) => r.box === b
    && (!r.match.script || basename(line.script) === r.match.script)
    && (!r.match.mode || line.mode === r.match.mode)
    && (r.match.has ?? []).every((s) => String(line.cmd).includes(s))) ?? null;
}

/**
 * The red verdicts for one live cron line (#8283): [{ flag, why }], empty when the line is fine or switched off.
 * `laneTotals` is pages written per stamp over the last 7 days ({ 'agy-flash-ocr': 280474, … }), or null when
 * unknown (then IDLE is not judged). A disabled or one-shot line is never red.
 */
export function judgeCronLine(box, line, { now = new Date(), laneTotals = null } = {}) {
  if (line.disabled || line.one_shot) return [];
  const row = cronRowFor(box, line);
  const red = [];
  if (!row) {
    if (JUDGED_STAGES.includes(line.stage)) red.push({ flag: 'UNREGISTERED', why: 'no CRON_ROWS row in scripts/lib/lanes.mjs matches this line' });
  } else {
    if (row.status === 'retired') red.push({ flag: 'RETIRED BUT LIVE', why: row.note ?? `row ${row.id} is retired` });
    if (row.review_by && now.toISOString().slice(0, 10) > row.review_by) red.push({ flag: 'PAST REVIEW', why: `review_by ${row.review_by}${row.open ? `: ${row.open}` : ''}` });
    if (row.status === 'current' && row.writes && laneTotals && !(laneTotals[row.writes] > 0)) red.push({ flag: 'IDLE 7 DAYS', why: `0 pages stamped ${row.writes} in 7 days` });
  }
  for (const p of RETIRED_PATTERNS) {
    if (p.test.test(String(line.cmd)) && !row?.allow?.[p.id]) red.push({ flag: 'MATCHES A RETIRED PATTERN', why: `${p.id}: ${p.why}` });
  }
  return red;
}

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
