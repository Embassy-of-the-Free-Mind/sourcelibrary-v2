# Pipeline Unblock & Enrichment Fix — 2026-03-28

## What happened

Translation throughput was 0 for 12+ hours. Root cause: 40 books stuck in `translate_submitted` with no `job` field — jobs had been cancelled by adaptive-limits but pipeline status was never rolled back. The translate worker found them every 2 minutes, couldn't process them, and skipped all work.

Additionally, 900+ books that finished translation were stuck in `failed` because the orchestrator's Phase 6 (summary+index) called `GET /api/books/[id]/index` without auth headers. Turned out the deeper issue was **Cloudflare blocking Hetzner's IP** — all Vercel route calls from Hetzner return 403 (JS challenge page).

## Fixes deployed (all on main, all on Hetzner)

### Code changes (committed to main)
1. **`translate-worker.mjs` — self-healing** (`9e3035ca`): When a book has `translate_submitted` but no `book.job`, the worker now auto-relinks orphan jobs or rolls back to `metadata_enriched`.

2. **`pipeline-orchestrator.mjs` — orphan prevention** (`b5d787dc`):
   - adaptive-limits CRITICAL handler now rolls back `pipeline_auto.status` when cancelling jobs (not just clears `book.job`)
   - New orphan detector runs every cycle: catches books in `*_submitted` state with no active job, rolls them back

3. **`pipeline-orchestrator.mjs` — auth header fix** (`39bef286`): Added `headers()` to the Phase 6 summary+index fetch call. (This alone didn't fix it — Cloudflare was the real blocker.)

4. **`pipeline-orchestrator.mjs` — multi-page batch positional fallback** (`eb4c0ba8`): Gemini outputs `<translation page="1">` through `page="5"` instead of actual page numbers (e.g. 491-495). Fixed by remapping translations positionally when count matches but page numbers don't. Without this fix, every multi-page batch was being translated twice (batch discarded, then individual fallback).

5. **`pipeline-health-alert.mjs` — new checks** (`f2de06a0`): Translation stall detector (alert if `translate_submitted > 0` but 0 pages translated in 2h) and orphan submitted detector.

6. **`infrastructure/hetzner-crontab`** (`2d63192e`): Health alert bumped from daily to every 4h.

### Hetzner config change (not in git)
- Added `NEXT_PUBLIC_URL=https://sourcelibrary-v2.vercel.app` to `.env.production.local` on Hetzner
- This bypasses Cloudflare for all Vercel route calls from the orchestrator
- **Fragile workaround** — proper fix is #513 (move enrichment inline to Hetzner)

### Data fixes (one-time, not in git)
- Reset 40 orphan `translate_submitted` books (28 → `archive_complete`, 12 → `metadata_enriched`)
- Cancelled 37 orphan jobs (31 translation, 6 OCR) blocking in-flight cap
- Archived 279 orphan batch jobs (never submitted to Gemini, no `job_name`)
- Reset 717 books failed on HTTP 403 → `translate_complete`
- Rolled back 837 low-OCR `metadata_enriched` books → `archive_complete`

## Current state (end of session)

```
metadata_enriched: 4,809  (draining into translation)
translate_submitted:  30  (active)
translate_complete:  880  (flowing into enrichment now)
summary_indexed:       7  (enrichment confirmed working!)
complete:          3,705  (will climb as enrichment processes 880 books)
failed:               44  (down from 914 — only real failures)

Translation: ~6K pages/hr
Enrichment: unblocked, processing ~15-30 books/orchestrator cycle
```

## Open items

### #513 — Move enrichment inline to Hetzner (HIGH PRIORITY)
The `NEXT_PUBLIC_URL` workaround bypasses Cloudflare but is fragile. The real fix: extract summary+index and chapter extraction logic from Vercel routes into shared modules, call Gemini directly from Hetzner. **Derek's instruction: don't simplify the 1300-line index route — faithfully extract and move it.**

Key files:
- `src/app/api/books/[id]/index/route.ts` (1300 lines — batch extraction, vocabulary, Wikipedia research, chapter-aware sectioning)
- `src/lib/chapter-extraction.ts` (chapter detection logic)
- Models: summary uses `gemini-3.1-flash-lite-preview`, chapters use `gemini-3-flash-preview`

### #500 — Blank-adjusted completeness metric
`fully_translated` strict counter (1,552) understates reality. Blank-adjusted: ~3,330+. Need to surface this in UI/API.

### #501 — Multi-page translation batching (merged by other dev)
Deployed and working. The positional fallback fix in this session was needed to make it actually effective (was double-translating everything before).

### Monitor
- Enrichment pipeline should process 880 `translate_complete` books over next 1-2 hours
- `complete` counter should climb from 3,705 toward 4,500+
- 42 books in `failed` with "OCR submit: Invalid string length" — corrupt/huge pages, low priority
- The `translate_complete` → `summary_indexed` → `chapters` → `complete` flow depends on the orchestrator reaching Phase 6/7 each cycle (runs sequentially through all phases)

## Key lessons

1. **Job cancellation must roll back pipeline status.** Cancelling a job without resetting `pipeline_auto.status` creates orphans that block the entire phase.
2. **Cloudflare blocks Hetzner.** Any Vercel route call from Hetzner gets a JS challenge. Use `sourcelibrary-v2.vercel.app` or move logic inline.
3. **The orchestrator runs phases sequentially.** If Phase 2 (OCR submission) takes 20 minutes downloading images, Phase 6 (enrichment) waits. The flock lock means only one run at a time. Phase-specific crons help but the main orchestrator still does too much in one pass.
4. **Multi-page batching: Gemini renumbers pages.** Always support positional fallback when parsing structured XML output from Gemini.
