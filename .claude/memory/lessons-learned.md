# Lessons Learned

Cross-cutting patterns and postmortems. Domain-specific lessons go in their respective files (`pipeline-ops.md`, `data-quality.md`, `ui-navigation.md`).

## General Patterns

- **Always verify cloud state, not just git (2026-03-22):** Lambda function names, IAM policies, and SQS queues may differ from what's in the codebase. Always check AWS console/CLI before asserting.
- **Supabase `ilike` needs trigram indexes (2026-03-25):** Queries on 1.6M rows silently timeout without `pg_trgm` GIN index. Indexed: `ustc_editions.author_1`. Needs indexing: `ustc_enrichments.english_title`, `ustc_enrichments.original_author`.
- **Prompt versioning (2026-03-14):** NEVER edit old prompt versions in DB. Create new version + move `is_default`. DB `prompts` collection is source of truth, not hardcoded `defaults.ts`. Issue #333.
- **Atlas query performance (2026-03-18):** Books collection aggregation queries take 30-80s on M40. Never compute inline in API routes. Use pre-computed snapshots in `system_config`.

## Incident History

- **Atlas outage from search index build (2026-03-10):** Building Atlas Search index on 1.84M pages collection caused full database outage. Post-mortem: #144.
- **Batch OCR RECITATION failures (2026-03-20):** Gemini Batch API refused books with copyrighted content markers. Fix: added content-type filtering in collector. 2,005 failed books reset.
- **Gemini File API quota exhaustion (2026-03-20):** 20GB quota filled by uncleaned JSONL files from batch jobs. KEY_2 permanently broken. Fix: auto-cleanup in orchestrator + collector, switched to TIER3 key.

## Meta

- **Don't retry dead services (global rule):** If an external service fails twice with same error, stop and pivot. Archive fallback chain: Internet Archive → Gallica → HathiTrust → Project Gutenberg.
- **Concurrency kills Atlas (global rule):** >40 concurrent Lambda jobs saturates Atlas. Monitor via adaptive limits dashboard.
