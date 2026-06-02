# Lessons Learned

Cross-cutting patterns and postmortems. Domain-specific lessons go in their respective files (`pipeline-ops.md`, `data-quality.md`, `ui-navigation.md`).

## General Patterns

- **Always verify cloud state, not just git (2026-03-22):** Lambda function names, IAM policies, and SQS queues may differ from what's in the codebase. Always check AWS console/CLI before asserting.
- **Supabase `ilike` needs trigram indexes (2026-03-25):** Queries on 1.6M rows silently timeout without `pg_trgm` GIN index. Indexed: `ustc_editions.author_1`. Needs indexing: `ustc_enrichments.english_title`, `ustc_enrichments.original_author`.
- **Prompt versioning (2026-03-14):** NEVER edit old prompt versions in DB. Create new version + move `is_default`. DB `prompts` collection is source of truth, not hardcoded `defaults.ts`. Issue #333.
- **Atlas query performance (2026-03-18):** Books collection aggregation queries take 30-80s on M40. Never compute inline in API routes. Use pre-computed snapshots in `system_config`.
- **Tenant scoping must include all follow-up queries (2026-04-17):** Adding `tenantId` at request entry is not enough. Any subsequent `findOne`, `updateOne`, `countDocuments`, `$lookup`, and helper-built query (e.g. `buildQuery`) must include `tenantId`, including fire-and-forget updates and analytics rollups.
- **Guard `after()` + honor non-stream mode in route tests (2026-04-21):** `after()` throws outside request scope (e.g., direct Vitest handler calls). Wrap it in a fallback path and keep `stream: false` JSON responses available for integration tests and non-SSE clients. See `src/app/api/embassy/chat/route.ts`.
- **Tenant admin auth must resolve role server-side (2026-04-21):** Server guards cannot rely on client `update()` token enrichment (`TenantSessionUpdater`). In `requireRole`/`withAuth`, resolve effective role from `memberships` using `x-tenant-id` + email before denying.
- **Avoid unbounded `distinct` on large tenant backfills (2026-04-27):** `pages.distinct('id', { book_id: { $in: [...] } })` can hit Mongo's 16MB distinct cap on large tenants (e.g., BPH). Always chunk by `book_id` and then chunk `page_id` for downstream `gallery_images` updates.
- **Never leave substantial edits unstaged in the shared main dir (2026-06-01):** ~10 parallel sessions share the main working dir. Any sibling's `git restore` / `git checkout --` / auto-stash-on-pull silently wipes another session's *unstaged* working-tree edits, and an unstaged discard leaves **no git trace** — unrecoverable. Lost a ~+102/−317 in-progress doc rewrite this way (#2332 Task 6). Rule: do edit work in a worktree (`EnterWorktree`) and commit early. Recovery checklist when working-tree work vanishes: `git stash list`, `git reflog`, `git fsck --no-reflogs | grep "dangling blob"` (then `git cat-file -p <blob>` to grep for distinctive content) — but if it was `git restore`, it's gone. Reinforces the Multi-Session Awareness CRITICAL section in CLAUDE.md.

## Incident History

- **Atlas outage from search index build (2026-03-10):** Building Atlas Search index on 1.84M pages collection caused full database outage. Post-mortem: #144.
- **Batch OCR RECITATION failures (2026-03-20):** Gemini Batch API refused books with copyrighted content markers. Fix: added content-type filtering in collector. 2,005 failed books reset.
- **Gemini File API quota exhaustion (2026-03-20):** 20GB quota filled by uncleaned JSONL files from batch jobs. KEY_2 permanently broken. Fix: auto-cleanup in orchestrator + collector, switched to TIER3 key.

## Meta

- **Don't retry dead services (global rule):** If an external service fails twice with same error, stop and pivot. Archive fallback chain: Internet Archive → Gallica → HathiTrust → Project Gutenberg.
- **Concurrency kills Atlas (global rule):** >40 concurrent Lambda jobs saturates Atlas. Monitor via adaptive limits dashboard.
