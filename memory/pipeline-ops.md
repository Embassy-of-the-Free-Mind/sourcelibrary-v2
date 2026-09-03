# Pipeline Operations

Operational reference for pipeline monitoring, debugging, and processing. For full architecture details, see `.claude/docs/pipeline-architecture.md`.

## Where Everything Runs

> **Reality check (2026-08-08, second pass):** the LINE IS RUNNING. The
> unified scheduler was on the crontab the whole pause (an earlier note here
> said "not scheduled at all" — that came from grepping the crontab for the
> word "orchestrator", which the scheduler line doesn't contain; the grep was
> the lying instrument). With `paused: false` + `daily_budget_usd` set
> (2026-08-08 relight), the scheduler spawns orchestrator, translate-worker,
> enrich workers and archivers every 2 min; spend-guard gates Phases 2/4 and
> the worker's health gate refuses looped translations (relight canary: flash
> looped on 42% of the loop-prone manuscript cohort's fresh pages; dial
> contained spend to <$3). Also live: `collect-batch-results.mjs` every 30
> min (#3717), the nightly stage-coverage snapshot (04:15, /platform/admin/line).
> Shared translation logic now lives in `scripts/lib/translate-core.mjs` (the
> "one door": model routing, DB prompts, revision-before-overwrite, counter
> sync — issue #3725); any new translation writer must import it.

| Component | Where | How |
|-----------|-------|-----|
| Pipeline orchestrator | **Hetzner** (`pipeline-orchestrator.mjs`) | All phases, every 2 min |
| Full-book OCR | **Hetzner → Gemini Batch API** | Direct submission, 50% cost discount |
| Translation | **Hetzner** (`translate-worker.mjs`) | Direct Gemini calls, 40 concurrent books |
| Batch result collection | **Hetzner** (`batch-collector.mjs`) | Polls Gemini API every 10 min |
| Archiving | **Hetzner** (`archive-ocr.mjs`, `archive-bulk.mjs`) | Downloads → Cloudflare R2 |
| Preview OCR (25 pages) | **Lambda** via SQS | Fast preview path, still active |
| Image extraction | **Lambda** via SQS | Still active (Phase 8) |
| Metadata enrichment | **Hetzner** (orchestrator Phase 3.5) | HTTP fetch to Vercel `/api/books/[id]/verify-metadata` |
| Summary + Index | **Hetzner** (`enrich-worker.mjs`) | Direct Gemini calls, every 5 min, 30 books/run |
| Chapter extraction | **Hetzner** (`enrich-worker.mjs`) | Direct Gemini calls, runs after summary+index |
| Lightweight crons | **Vercel** | social-post, health-check, daily-report, warm |
| Finalize tail (cover-select + complete) | **Hetzner** crontab (`*/15 * * * *`) | `pipeline-orchestrator.mjs --phase 9` runs Phase 8.9 (cover) + 9 (finalize), decoupled from the main loop so the tail doesn't starve behind OCR/translation. flock `/tmp/sl-finalize.lock`, log `/var/log/sourcelibrary/finalize.log`. See `lesson_finalize_tail_starvation`. |
| e-rara / Harvard / Gallica archiving | **Local Mac** via launchd | Source hosts block Hetzner IPs (`archive-{erara,harvard,gallica}.mjs`, every 30 min, plists `org.sourcelibrary.archive-*`) |
| Archiving watchdog | **Hetzner** crontab (`45 */6 * * *`, every 6h) | Self-heals books stuck in `archiving`: parks IA-lending/dead-URL books → `needs_attention`, escalates stale-unreachable. `scripts/maintenance/archiving-watchdog.mjs --apply` (conservative; add `--rearchive` manually to push recoverable books to R2). Logs `/var/log/sourcelibrary/archiving-watchdog.log`, audit in `watchdog_runs`. |

**Lambda translation is deprecated for the main pipeline.** The SQS FIFO translation queue is only used for preview translation and manual job submission. The Hetzner `translate-worker.mjs` handles all production translation.

## Model Routing

| Task | BPH books | All others |
|------|-----------|------------|
| OCR (batch) | `gemini-3-flash-preview` | `gemini-3.1-flash-lite` |
| Translation | `gemini-3-flash-preview` | `gemini-3.1-flash-lite` |
| Transliteration | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` |
| Summary/Index/Chapters | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` |

## The Budget Dial (#3737)

Spend is a **number**, not a switch. `system_config.processing_control.daily_budget_usd`
is the ceiling for paid dispatch; `scripts/lib/spend-guard.mjs` gates orchestrator
Phase 2 (OCR submit) and Phase 4 (translation dispatch) against today's measured
`gemini_usage` spend (UTC day, ObjectId-range — the `timestamp` field is a string on
old rows). **Default-closed:** unset/null/0 means NO paid dispatch even when
`paused: false` — flipping the old pause flag can no longer reopen unbounded spending.
In-flight work always finishes; `--phase N --book=ID` operator runs bypass the dial
exactly as they bypass the pause. Enrichment (Phases 6–7) isn't gated directly but its
spend counts toward the measured total, and its volume is downstream of gated phases.
`cost_usd` is a computed estimate and some rows lack it → the guard can UNDERCOUNT;
treat the ceiling as a brake, not accounting. The guard logs `spend $X / $Y` every cycle.

**Change the dial ONLY via `scripts/maintenance/set-dial.mjs`** (`--budget N --by "why"`,
`--pause/--resume`, `--history`) — it snapshots the prior state to
`system_config_revisions` (everything versions; raw one-liner \$sets on
`processing_control` are how scopes got clobbered). `unpause-scope.mjs` writes are
versioned the same way. Repair scripts that overwrite R2 images preserve the prior
object under `versions/<key>.<ts>` via `scripts/lib/r2-version.mjs`.

**To turn the line on (Derek):**
1. Set the dial: `db.system_config.updateOne({_id:'processing_control'}, {$set:{daily_budget_usd: 5}})` — start at $5/day.
2. Unpause: `{$set:{paused:false}}` (same doc).
3. Re-add the scheduler line to the live Hetzner crontab — it already exists in `scripts/workers/crontab.production` line 20 (`*/2 * * * * … scheduler.mjs`); the live crontab lost it during the pause era.
4. Watch `/var/log/sourcelibrary/scheduler.log` + `pipeline.log` for the `[spend-guard]` lines; first candidates processed should be `loop_quarantine_hold` books once those are re-enrolled.
5. Failure at step 4 = no `[spend-guard]` line at all → the box hasn't pulled main yet (auto-pull ~5 min) or the crontab line didn't take (`crontab -l | grep scheduler`).

## Priority Ordering (#3756)

One field decides who gets processed first: **`books.processing_priority`** (number;
absent = 0; **higher first**). It is the LEADING sort key in every paid candidate
query — orchestrator Phase 2 (OCR submit, both passes), Phase 4 (translation
dispatch, fresh + gap-fill), and translate-worker self-dispatch (fresh + partial) —
with each query's previous ordering (BPH boost, first-translation flag, speed tier)
kept as the tiebreak. The archive crons already honored the same field
(`image-storage-architecture.md`), so one number now moves a book up the whole line.

Feeder sources and their conventional weights (writers stamp the field; also record
why in `processing_priority_breakdown`):

| Source | Weight |
|--------|--------|
| Sponsorship (paid, promised to a donor) | 200 |
| Reader request (feedback translation-requests) | 100 |
| Fresh imports (existing import-script default) | 80 |
| Curated collection membership | 50 |

Legacy note: Phase 2's aggregations also honor an older `pipeline_priority` (≥1 = manual
boost) inside their computed `_priority` — it now acts as a tiebreak below
`processing_priority`. Prefer `processing_priority` for anything new.

## Emergency Controls

- **Stop all:** Set `system_config._id: 'processing_control'` → `paused: true`
- **Resume:** `POST /api/admin/emergency-stop?resume=true`
- **Selective pause:** `paused_phases: ['ocr','translation','images']`
- **Adaptive limits:** `GET/PATCH /api/admin/adaptive-limits`
- **`paused: true` doesn't stop Lambda workers or Hetzner translate-worker.** Must CANCEL jobs in MongoDB for actual load reduction.
- **The pipeline is currently paused on purpose** (Gemini spend, since 2026-06-08). Archiving still runs, so books pile at `archive_complete` and it *looks* like an outage — check the flag before diagnosing a stall.
- **To process ONE book while paused, do NOT selectively unpause** — run a one-off batch job instead (`POST /api/books/[id]/batch-ocr-async` then `.../batch-translate-async`, or the `/batch-translate` skill). Selective-unpause has a known bug: it raises module-level phase limits but not the phase-local split/dedup limits (and Phase 1.97 isn't scope-aware), so hidden/scoped books strand at `archive_complete`. The pause flag is also shared prod state other sessions depend on. **Full collaborator runbook: `.claude/docs/translating-a-book.md`.**
- **Per-book cost (measured `gemini_usage`, 1,752 books, OCR+translation, 2026-06-30):** median **$0.58**, mean **$0.94**, p75 ~$1, but large folios run several $ up to **~$29** (1,188p). A book is "well under a dollar typically," NOT "cents." Translation output tokens dominate. Pricing: `src/lib/gemini-logger.ts` `MODEL_PRICING`.

## Concurrency Limits

- MongoDB Atlas saturates at ~40 concurrent Lambda jobs (global backpressure limit)
- Per-phase maximums: OCR 200/cycle (hardcoded default), translation 30 (in-flight cap 40 books), images 50
- Translate-worker runs 40 concurrent books, 8000 pages/run cap
- Tested higher (2026-03-26): `global_active_max` 50, `translate_lambda_max` 50 — Atlas stayed healthy. Adaptive system will auto-dial back if needed (ensure `locked: false`).

## Critical Rules

- **Batch-API translation: banned for bulk, sanctioned for one-off books — know why.** Sequential translation (translate-worker, Lambda FIFO) feeds each page's finished translation into the next page's prompt; that chain is what keeps cross-page sentences and terminology coherent, and the Batch API cannot provide it. The per-book route `batch-translate-async` (the `translating-a-book.md` path) IS Batch-API translation: each page is translated independently, with no previous-page context — a deliberate cost/coherence tradeoff acceptable for a single requested book, wrong for bulk reprocessing. (The Feb 18 incident — 17K wrong translations — was a separate bug: batch results matched by array index instead of `metadata.key`; that part is fixed.) So: bulk → sequential worker; one-off → batch route; never claim the two produce equivalent quality.
- **Translation prompt source of truth is the DB `prompts` collection** (type: 'translation', is_default: true). Both workers read it once per run and cache. Never hardcode prompts in worker files. To update the prompt, update the DB — no code deploy needed.
- **Any Hetzner worker that writes to `pages` must also update the parent book's cached counters** (`pages_ocr`, `pages_translated`, `pages_archived`). Vercel API routes do this via shared helpers, but standalone Hetzner scripts bypass them. See #497.
- Any script overwriting `ocr.data` or `translation.data` MUST call `createRevision(pageId, field, jobId?)` first
- **Never patch Hetzner directly without committing to git.** Local-only patches cause drift that's invisible to other devs and future sessions. Apply fixes in git first, then `git pull` on Hetzner.
- **Health grading uses DB latency only** (findMs, countMs), not job count. Job count stopped correlating with DB load when translation moved to Hetzner. See lesson 2026-03-30.
- Summary/Index/Chapters generation: enrich-worker uses `gemini-3.1-flash-lite` for ALL phases (per CLAUDE.md, verified in `scripts/workers/enrich-worker.mjs` — the GA name, no `-preview` suffix; the preview name 404s since its retirement).
- Stale Vercel connection pools after DB recovery → redeploy to reset

## Lessons Learned

- **Lambda timeout on large books (2026-03-13):** Books with >500 pages can exceed Lambda 15min timeout. Split into chunks of 400 pages max.
- **Batch API key visibility (2026-03-15):** Jobs are ONLY visible to the creating API key. Multi-key support in collectors.
- **Gemini File API quota (2026-03-20):** 20GB quota filled by uncleaned JSONL files. KEY_2 File API permanently broken; use TIER3. Auto-cleanup now in orchestrator + collector.
- **RECITATION fix (2026-03-20):** Batch OCR was failing on books with copyrighted content markers. Fix merged, Phase 2 re-enabled.
- **Verify AWS state, not just git (2026-03-22):** Cloud resource names may differ from codebase. Always verify against AWS before asserting.
- **Zombie jobs block orchestrator (2026-03-26):** Jobs stuck in `processing` status with no active worker prevent new dispatch. The orchestrator counts books at `translate_submitted` as in-flight — if these exceed the cap (40), no new translations are dispatched. Fix: cancel zombie jobs in `jobs` collection AND reset stuck books from `translate_submitted` → `metadata_enriched`. Check both.
- **Batch API PENDING queue saturation (2026-03-26):** 450 Gemini batch jobs stuck at `BATCH_STATE_PENDING` across all API keys, blocking the entire batch OCR pipeline. Root cause: batch job quota (100 concurrent per key) exhausted by stale jobs that never transitioned to RUNNING. Fix: cancel stale batches via Gemini API (`POST /v1beta/{name}:cancel`), mark MongoDB `batch_jobs` as failed, and reset books from `ocr_submitted` → `archive_complete`. Monitor: `GET /v1beta/batches?key=KEY` should show <20 active batches per key.
- **Adaptive limits locked = no auto-scaling (2026-03-26):** The `adaptive_limits.locked: true` flag prevents the orchestrator from auto-scaling even when health is "healthy". Check `locked` status when investigating slow throughput.
- **Translation model routing bug (2026-03-27, PR #482):** Was hardcoding flash model for all jobs instead of calling `getTranslateModelForBook()`. 97% of translations used 3x expensive model. Fixed — BPH gets flash, others get lite.
- **Hetzner workers don't sync book counters (2026-03-27, #497):** `translate-worker.mjs` was translating 169K pages over 3 days without updating `book.pages_translated`. Root cause: Vercel API routes use shared helpers that auto-sync counters, but Hetzner scripts bypass them. Fix: patched translate-worker to sync on job completion. Broader fix needed: audit all Hetzner workers, add counter sync to each.
- **RECITATION in translate-worker (2026-03-28):** Philo's "Lucubrationes Omnes" stuck at 683/688 pages — 5 pages hitting RECITATION every cron cycle. Root cause: translate-worker was missing `BLOCK_NONE` safety settings and public domain copyright note that the OCR pipeline already had. Fix: added both. **Rule: any new Gemini call in any worker must include BLOCK_NONE safety settings + copyright note for pre-1930 works.**
- **OCR guard blocked split-checked portrait books (2026-03-30, PR #541):** 7,283 books stuck at `archive_complete` for 10+ days. The per-page crop guard in `submitOcrDirectly()` rejected ALL books where pages lacked `crop`/`cropped_photo` — even portrait books that Phase 1.25 correctly identified as not needing splitting. Fix: guard now checks `!book.pipeline_auto?.split_checked` before rejecting. **Rule: `split_checked: true` means the book passed split detection — trust it.**
- **Health check job count threshold was stale (2026-03-30, PR #542):** `activeJobs > 100` triggered "degraded" health grade even with DB latency at 15ms. This halved OCR submission limits. Root cause: threshold was set when translation ran through Lambda; after moving to Hetzner, ~100 translation jobs stay in "processing" for hours without DB pressure. Fix: removed `activeJobs` from grading — health now based solely on actual DB latency (`findMs`, `countMs`). **Rule: grade health on what you measure (latency), not proxies (job count).**
- **Hetzner/git drift from local patches (2026-03-30, PR #541/#542):** Translation prompt v10 ran on Hetzner for weeks without being in git. Three fixes applied by sed on Hetzner before being committed. Fix: synced all patches, moved translation prompt source of truth to DB `prompts` collection (read once per run, cached). **Rule: never patch Hetzner directly without committing to git. Translation prompt lives in DB, not code.**
- **Hetzner auto-pull silently breaks on stale stashes (2026-05-31, #2245):** The deploy cron (`infrastructure/hetzner-crontab`, the every-5-min `git stash -q; git pull -q origin main; git stash pop -q; crontab ...` line) stash/pops to preserve intentional box-local patches. But stale stashes accumulate — the box had 10 from Feb–Apr (old WIP on `pipeline-orchestrator.mjs`, `sync-worker.mjs`, `archive-ocr.mjs`). The unconditional `git stash pop` re-applies them every cycle; they conflict, leave an unmerged tree, and that conflict blocks the *next* cycle's `git stash` — with the error swallowed by `2>/dev/null`. Net effect: deploys silently stop applying AND months-old code can get re-injected into live workers (it was conflicting inside `sync-worker.mjs`). **Detection:** `ssh hetzner 'cd /root/sourcelibrary && git stash list && git status -sb'` — any stash older than a current change, or an unmerged/non-clean tree, means the auto-pull is wedged. **Recovery:** verify no stash holds a wanted change, reset conflicted files to `origin/main`, `git stash clear`, then run the cron's pull command twice to confirm clean (`unmerged=0`, `stashes=0`, `## main...origin/main`). One intentional local patch is expected to remain in the working tree: `pipeline-orchestrator.mjs` disables Phase 3.7 transliteration via `if (false && ...)`. **Rule: the stash/pop deploy dance is fragile — don't leave WIP stashed on the box (commit to git or discard); consider making the cron clear stale stashes / fail loudly instead of `2>/dev/null`.**
- **`preview_ocr_queued_at` filter blocked split detection (2026-03-30, PR #542):** 9,090 books had preview OCR queued (Phase 1.5) but couldn't be split-checked (Phase 1.25) because the split detection query excluded them. These are independent operations. Fix: removed the filter. **Rule: split detection and preview OCR are independent — don't gate one on the other.**
- **Batch image-extraction never materialized gallery crops (2026-06-04, #2430):** `batch-collector.mjs` writes `gallery_images` rows with bbox+metadata but NO `extracted_url`/`thumbnail_url` — by design, expecting `scripts/workers/generate-thumbnails.mjs` to crop+upload later. That worker was never cronned, so once the batch path became the production extraction route (~May) 30K rows piled up (21% of gallery, 25K at q≥0.5) — invisible to the public gallery, embeddings, and collection covers, which all filter on `extracted_url`. Fix: nightly Hetzner cron 03:30 (`generate-thumbnails.mjs --limit=8000 --concurrency=6 --min-quality=0.5`, log `/var/log/sourcelibrary/generate-thumbnails.log`) + one-off backlog run. **Canary:** `db.gallery_images.countDocuments({extracted_url:null, thumbnail_url:null, gallery_quality:{$gte:0.5}})` climbing into the thousands = the cron is dead. The inline SQS path crops at write time — converging the two paths is the open follow-up in #2430.
- **Mass "Gemini 404: job no longer exists on any key" = Vercel/Hetzner key-set drift, not lost jobs (2026-06-05):** 348 OCR batch jobs (June 4–5) were falsely marked `failed` by `batch-collector.mjs` while the jobs had SUCCEEDED on Gemini with results intact. Batch jobs are visible only to their creating key (see 2026-03-15 lesson); jobs submitted via the Vercel routes (`/api/books/[id]/batch-ocr-async`) use Vercel's env keys, the Hetzner collector polls with Hetzner's — the two `.env.production.local` files had drifted to a single shared key (`_3`). Orchestrator-submitted jobs were unaffected (same box submits + collects), which made the Vercel route look flaky. **Tell:** `status:'failed'` + `error:'Gemini 404: job no longer exists on any key'` + `recovery_checked_at` ~1 min after `created_at`, clustered on API-route submissions. **Fix:** mirrored Vercel's unique keys to Hetzner as `GEMINI_API_KEY_5/6/7`, reset the false-failed jobs to `pending`; collector then recovered 163 jobs / 3,157 pages at zero cost (truly-expired jobs re-404 harmlessly and get resubmitted by the orchestrator). **Rule: any process that collects batch results must hold a superset of every key used to submit; when rotating/adding a Gemini key on one host, mirror it to the other the same day.**
- **FAILED_PRECONDITION on file-based OCR submit = file not ACTIVE (2026-05-30, PR #2186):** `createBatchJobFromFile()` called `batches.create` right after `files.upload` without waiting for the File API file to reach `ACTIVE`. Gemini rejects a batch referencing a still-`PROCESSING` file with `400 FAILED_PRECONDITION`. Large file-based JSONLs (big books) process slower → failed while small inline-path books succeeded; surfaced as ~24k `ocr/failed` batch_jobs + books stuck at `archive_complete`. **File API quota was NOT the cause (0 files across all keys) — don't assume quota when you see FAILED_PRECONDITION.** Fix: poll `files.get(name)` until `state==='ACTIVE'` (~60s) before `batches.create`. After deploy, reset affected books `failed → archive_complete`.
- **Bulk OCR belongs in the orchestrator, NOT the Vercel route (2026-06-26):** For any backlog OCR, enroll books (`pipeline_auto.status='queued'`; orchestrator advances already-archived ones to `archive_complete` and archives the rest, then OCRs) — the orchestrator submits to Gemini *directly* from Hetzner. The route `POST /api/books/[id]/batch-ocr-async` downloads ALL page images synchronously before creating batches, so it **edge-timeouts on books >~300pp** (Cloudflare 524 / Vercel 500 / Next `__next_error__`); only small books (<~150pp, or a small `limit:`) submit cleanly. **Rule: don't drive bulk OCR by looping the route from a laptop — enroll and let the pipeline do it.**
- **Route batch-OCR: client abort loses the batch; 524 does not; batch_jobs is ground truth (2026-06-26):** A client-side `AbortController` on `batch-ocr-async` cancels the Vercel function → no batch created. A Cloudflare **524** (origin keeps running) DOES create the batch server-side. The route does **not** dedupe against pending `batch_jobs`, so re-calling a book that already has pending jobs **double-submits and double-charges**. **Rule: never abort early; treat 524/500 as "verify via `batch_jobs`," and use `batch_jobs` (created in last N h, per `book_id`) as the dedup/coverage source of truth before resubmitting.**
- **A chunk of `language:'english'` books are IA lending-locked = copyright (2026-06-26):** IA Controlled-Digital-Lending scans have the `*0000xxxx` "inlibrary" identifier; their page images 403 and they're copyright-restricted — `batch-ocr-async` returns `400 "Failed to prepare any images"` and `archive-bulk` skips them as broken-source. **They cannot/should-not be archived or OCR'd — detect (identifier `…0000<libcode>` or 403 on the image URL) and drop / re-source from an open copy.** Two more gotchas from the same sweep: (a) the route OCRs from `pages.photo`/`photo_original` (for archived books these point to `images.sourcelibrary.org` R2; "has external `photo`" ≠ "archived to R2"); (b) `pages_count − pages_ocr` **overcounts** the real OCR gap — blank/plate pages count toward `pages_count` but are intentionally never OCR'd, so filter to books <~85% OCR'd to find genuine gaps.

## Batch OCR can report success and save almost nothing (2026-08-24, UNRESOLVED)

A Gemini batch returns `JOB_STATE_SUCCEEDED` while most of its pages never
save. Measured on one import: Lister 1894 lost **80%** of 250 submitted pages,
twice; Cooke 1877 52%; Massee 1892 10%; the German/Latin/Polish books in the
same batch lost ~0-3%. The identical pages then went through the realtime
Lambda path (`/api/jobs/queue-books`) without trouble, so it is not the pages
and not the scans.

**Checked and refuted** (do not re-spend on these): the RECITATION filter (no
page carries `ocr.recitation_count`); image byte size (Zopf succeeds at a
1,329KB median while Lister fails at 917KB); pixel dimensions; JPEG encoding
(progressive vs baseline correlates loosely but de Bary is progressive and
barely failed); inline payload size (the largest payload had the lowest
failure rate).

**Why it stayed undiagnosable:** `batch-collector.mjs` discarded the responses
that would say. It now tallies failures by reason into `batch_jobs.fail_reasons`
(transport error / RECITATION / missing metadata key / no-text + finishReason).
**Next occurrence: read that field first.**

Two things still wrong and unfixed: the pipeline reports success on a job that
saved almost nothing, and these jobs log **no cost at all** even though every
response is billed — so the spend is invisible too. A batch saving under some
threshold should mark the book for retry and fall back to the realtime path,
which is what had to be done by hand five times.
