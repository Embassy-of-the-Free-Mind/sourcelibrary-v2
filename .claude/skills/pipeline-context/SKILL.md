---
name: pipeline-context
description: Load context for pipeline, cron, Lambda, OCR, and translation work. Use when starting any pipeline monitoring, debugging, or processing task.
---

# Pipeline Context

Read these files before proceeding with pipeline work:

1. `memory/pipeline-ops.md` — Emergency controls, worker architecture, operational details
2. `memory/lessons-learned.md` — Operational postmortems and patterns
3. `.claude/docs/pipeline.md` — Full processing pipeline (states, crons, prompts, costs)
4. `.claude/docs/worker-architecture.md` — Lambda worker details
5. `.claude/docs/page-lifecycle.md` — Page processing states

## Critical Rules

- ALWAYS use `gemini-3-flash-preview` for all AI tasks
- NEVER use Gemini Batch API for translation — use Lambda workers (SQS FIFO)
- Any script overwriting `ocr.data` or `translation.data` MUST call `createRevision()` first
- MongoDB Atlas saturates at ~40 concurrent Lambda jobs — global backpressure limit
- Emergency stop: `system_config._id: 'processing_control'`, set `paused: true`

## Audit Trail

All AI calls logged to `gemini_usage` collection via `logGeminiCall()` in `src/lib/gemini-logger.ts`.
- Book history timeline: `GET /api/books/[id]/history` (assembles from 6 collections)
- Dashboard: `GET /api/admin/processing-dashboard?provider=ia`
- Error classification: `src/lib/errors.ts` → `classifyError(error)`
- `cost_tracking` collection is DEPRECATED — use `gemini_usage` for all cost queries

## Also Relevant

- Batch processing (Gemini Batch API): `.claude/docs/batch-processing.md`
- Observability & audit trail: `.claude/docs/observability.md`
- First translation identification: `.claude/docs/first-translation-system.md`
