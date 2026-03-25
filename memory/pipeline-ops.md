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
- Never set `global_active_max` >25 or `translate_lambda_max` >15 — limits are per-cycle, not total concurrent

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
