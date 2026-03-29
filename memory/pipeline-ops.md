# Pipeline Operations

Operational reference for pipeline monitoring, debugging, and processing. For full architecture details, see `.claude/docs/pipeline-architecture.md`.

## Where Everything Runs (March 2026)

| Component | Where | How |
|-----------|-------|-----|
| Pipeline orchestrator | **Hetzner** (`pipeline-orchestrator.mjs`) | All phases, every 2 min |
| Full-book OCR | **Hetzner → Gemini Batch API** | Direct submission, 50% cost discount |
| Translation | **Hetzner** (`translate-worker.mjs`) | Direct Gemini calls, 20 concurrent books |
| Batch result collection | **Hetzner** (`batch-collector.mjs`) | Polls Gemini API every 10 min |
| Archiving | **Hetzner** (`archive-ocr.mjs`, `archive-bulk.mjs`) | Downloads → Cloudflare R2 |
| Preview OCR (25 pages) | **Lambda** via SQS | Fast preview path, still active |
| Image extraction | **Lambda** via SQS | Still active (Phase 8) |
| Metadata enrichment | **Hetzner** (orchestrator Phase 3.5) | HTTP fetch to Vercel `/api/books/[id]/verify-metadata` |
| Summary + Index | **Hetzner** (`enrich-worker.mjs`) | Direct Gemini calls, every 5 min, 30 books/run |
| Chapter extraction | **Hetzner** (`enrich-worker.mjs`) | Direct Gemini calls, runs after summary+index |
| Lightweight crons | **Vercel** | social-post, health-check, daily-report, warm |
| e-rara archiving | **Local Mac** via launchd | Hetzner IPs blocked by e-rara |

**Lambda translation is deprecated for the main pipeline.** The SQS FIFO translation queue is only used for preview translation and manual job submission. The Hetzner `translate-worker.mjs` handles all production translation.

## Model Routing

| Task | BPH books | All others |
|------|-----------|------------|
| OCR (batch) | `gemini-3-flash-preview` | `gemini-3.1-flash-lite-preview` |
| Translation | `gemini-3-flash-preview` | `gemini-3.1-flash-lite-preview` |
| Transliteration | `gemini-3.1-flash-lite-preview` | `gemini-3.1-flash-lite-preview` |
| Summary/Index | `gemini-3-flash-preview` | `gemini-3-flash-preview` |

## Emergency Controls

- **Stop all:** Set `system_config._id: 'processing_control'` → `paused: true`
- **Resume:** `POST /api/admin/emergency-stop?resume=true`
- **Selective pause:** `paused_phases: ['ocr','translation','images']`
- **Adaptive limits:** `GET/PATCH /api/admin/adaptive-limits`
- **`paused: true` doesn't stop Lambda workers or Hetzner translate-worker.** Must CANCEL jobs in MongoDB for actual load reduction.

## Concurrency Limits

- MongoDB Atlas saturates at ~40 concurrent Lambda jobs (global backpressure limit)
- Per-phase maximums: OCR 20, translation 30 (in-flight cap 40 books), images 50
- Translate-worker runs 20 concurrent books, 8000 pages/run cap
- Tested higher (2026-03-26): `global_active_max` 50, `translate_lambda_max` 50 — Atlas stayed healthy. Adaptive system will auto-dial back if needed (ensure `locked: false`).

## Critical Rules

- NEVER use Gemini Batch API for translation — lacks cross-page context. Use `translate-worker.mjs` (Hetzner) or Lambda FIFO (fallback).
- **Any Hetzner worker that writes to `pages` must also update the parent book's cached counters** (`pages_ocr`, `pages_translated`, `pages_archived`). Vercel API routes do this via shared helpers, but standalone Hetzner scripts bypass them. See #497.
- Any script overwriting `ocr.data` or `translation.data` MUST call `createRevision(pageId, field, jobId?)` first
- Summary/Index generation: ALWAYS use `gemini-3-flash-preview` (per CLAUDE.md)
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
