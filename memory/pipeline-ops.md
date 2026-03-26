# Pipeline Operations

Operational reference for pipeline monitoring, debugging, and processing. For full architecture details, see `.claude/docs/pipeline-architecture.md`.

## Emergency Controls

- **Stop all:** Set `system_config._id: 'processing_control'` → `paused: true`
- **Resume:** `POST /api/admin/emergency-stop?resume=true`
- **Selective pause:** `paused_phases: ['ocr','translation','images']`
- **Adaptive limits:** `GET/PATCH /api/admin/adaptive-limits`
- **`paused: true` doesn't stop Lambda workers.** Must CANCEL jobs in MongoDB for actual load reduction.

## Concurrency Limits

- MongoDB Atlas saturates at ~40 concurrent Lambda jobs (global backpressure limit)
- Per-phase maximums: OCR 20, translation 30, images 50
- Conservative safe limits: `global_active_max` 25, `translate_lambda_max` 15 (per-cycle, not total concurrent)
- Tested higher (2026-03-26): `global_active_max` 50, `translate_lambda_max` 50 — Atlas stayed healthy with 5 consecutive healthy readings. Adaptive system will auto-dial back if needed (ensure `locked: false`).

## Key Infrastructure

- **Hetzner** (`root@46.224.122.120`) runs the actual pipeline orchestrator, not Vercel
- **Vercel** only runs 4 lightweight crons (social, health, daily report)
- **Lambda workers** (eu-central-1): OCR + translation via SQS FIFO
- **e-rara archiving** runs locally on Mac via launchd (Hetzner IPs blocked)

## Critical Rules

- NEVER use Gemini Batch API for translation — use Lambda workers (SQS FIFO). Batch API lacks cross-page context.
- Any script overwriting `ocr.data` or `translation.data` MUST call `createRevision(pageId, field, jobId?)` first
- Default model for all AI tasks: `gemini-3-flash-preview`
- Stale Vercel connection pools after DB recovery → redeploy to reset

## Lessons Learned

- **Lambda timeout on large books (2026-03-13):** Books with >500 pages can exceed Lambda 15min timeout. Split into chunks of 400 pages max.
- **Batch API key visibility (2026-03-15):** Jobs are ONLY visible to the creating API key. Multi-key support in collectors.
- **Gemini File API quota (2026-03-20):** 20GB quota filled by uncleaned JSONL files. KEY_2 File API permanently broken; use TIER3. Auto-cleanup now in orchestrator + collector.
- **RECITATION fix (2026-03-20):** Batch OCR was failing on books with copyrighted content markers. Fix merged, Phase 2 re-enabled.
- **Verify AWS state, not just git (2026-03-22):** Cloud resource names may differ from codebase. Always verify against AWS before asserting.
- **Zombie jobs block orchestrator (2026-03-26):** Jobs stuck in `processing` status with no active Lambda worker prevent new dispatch. The orchestrator counts books at `translate_submitted` as in-flight — if these exceed the cap (30), no new translations are dispatched. Fix: cancel zombie jobs in `jobs` collection AND reset stuck books from `translate_submitted` → `ocr_complete`. Check both.
- **Batch API PENDING queue saturation (2026-03-26):** 450 Gemini batch jobs stuck at `BATCH_STATE_PENDING` across all API keys, blocking the entire batch OCR pipeline. Root cause: batch job quota (100 concurrent per key) exhausted by stale jobs that never transitioned to RUNNING. Fix: cancel stale batches via Gemini API (`POST /v1beta/{name}:cancel`), mark MongoDB `batch_jobs` as failed, and reset books from `ocr_submitted` → `archive_complete`. The batch collector's 6h stale detection wasn't catching these because they were returning 100 errors per run (likely 404s from cross-key visibility). Monitor: `GET /v1beta/batches?key=KEY` should show <20 active batches per key.
- **Adaptive limits locked = no auto-scaling (2026-03-26):** The `adaptive_limits.locked: true` flag prevents the orchestrator from auto-scaling even when health is "healthy". This was set defensively after an Atlas saturation incident but was never unlocked. Check `locked` status when investigating slow throughput.
