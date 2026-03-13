# Post-Mortem: Overnight OCR Processing — Feb 20, 2026

## Summary

Overnight realtime OCR processing successfully OCR'd ~109,000 pages but hit Gemini rate limits around 05:00 UTC, causing throughput to collapse from ~28k pages/hour to ~600 pages/hour. The site degraded to 5-10s response times, likely from a combination of heavy MongoDB writes and Vercel cold starts. Separately, the launch set was expanded from 1,234 to 2,222 visible books by a concurrent session.

## Timeline (all times CET = UTC+1)

| Time | Event |
|------|-------|
| 02:33 | OCR loop started (batch_size=8000, concurrency=50) |
| 02:47 | Restarted with concurrency=100, limit=10000 |
| 02:51 | `unhide-best-partners.mjs` run — expanded visible books from 1,234 → 2,222 |
| 02:00-03:00 | Peak: 22,557 pages/hour, 153 errors |
| 03:00-04:00 | Strong: 28,161 pages/hour, 449 errors |
| 04:00-05:00 | Good: 24,693 pages/hour, 450 errors |
| 05:00-06:00 | Declining: 22,327 pages/hour, 451 errors |
| 06:00-07:00 | Rate limited: 10,227 pages/hour, 349 errors |
| 07:00-08:00 | Severely limited: 530 pages/hour, 282 errors (KEY_2 exhausted) |
| 08:00-08:38 | Crawling: 666 pages/hour, 267 errors |
| 08:38 | Process killed (exit code 143) |
| ~08:45 | New process started (limit=2000, concurrency=60) |
| 09:00 | Investigation begins — all processes stopped |

## Damage Assessment

### What went well
- **109k pages OCR'd** — the most ever processed in a single session
- Total OCR went from 133k → 355k (167% increase overnight)
- No data corruption — all pages saved correctly to the right books
- Job tracking worked (jobs collection has records with progress)

### What went wrong
1. **Rate limiting cascade (KEY_2)**: 613 rate limit waits logged. Concurrency=100 across 3 keys was too aggressive. KEY_2 quota exhausted first, causing all requests routed to it to back up with 30s waits.

2. **Error rate**: 2,401 total errors out of ~111k attempts (2.2%). Most were rate limits, not data failures.

3. **Site degradation**: Response times went from <1s → 5-10s. Still slow after killing local processes, suggesting it's not just connection pressure.

4. **Uncoordinated concurrent sessions**: Two Claude sessions ran simultaneously — one doing OCR, another expanding the launch set and starting translations. No coordination mechanism.

5. **Token cost tracking**: Cost showing $0.00 — the `cost` field on `gemini_usage` records from the realtime-ocr script may not be populated.

## Root Causes

### 1. Concurrency too high
The script was restarted at concurrency=100 (from 50). With 3 API keys, that's ~33 concurrent requests per key. Gemini's per-key rate limit is lower than this for sustained throughput. KEY_2 hit its daily quota around 05:00 UTC.

### 2. No backoff strategy
When a key hits rate limits, the script waits 30s then retries on the SAME key. It should:
- Rotate to the next key immediately
- Implement exponential backoff per key
- Reduce concurrency dynamically when rate limits are detected

### 3. No coordination between sessions
Two dev sessions running against the same DB and API keys with no locking or awareness of each other.

## Current State

| Metric | Before (Feb 19 EOD) | After (Feb 20 9:00 AM) |
|--------|---------------------|----------------------|
| Visible books | 1,234 | 2,222 |
| Total pages (visible) | 478,019 | 697,780 |
| Pages OCR'd | 133,580 (28%) | 355,445 (51%) |
| Pages translated | ~149k | 170,467 (24%) |
| Pipeline: archive_complete | 797 | 1,086 |
| Pipeline: ocr_complete | 3 | 144 |
| Pipeline: complete | 391 | 501 |

### Running processes
All stopped as of 09:00 CET.

### Site health
5-10s response times across all pages. MongoDB queries themselves are <1.5s — the slowness is in Vercel SSR (cold starts + heavier aggregation with 2,222 books).

## Action Items

### Immediate
- [ ] Investigate site slowness (likely needs Vercel redeploy or homepage query optimization)
- [ ] Decide on target: keep 2,222 visible or revert to 1,234?
- [ ] Fix cost tracking in realtime-ocr script

### Before next OCR run
- [ ] Add per-key rate limit detection with automatic key rotation
- [ ] Add dynamic concurrency reduction on rate limit detection
- [ ] Cap concurrency at 30-40 max (proven sustainable rate)
- [ ] Add coordination file/flag to prevent concurrent runs

### Longer term
- [ ] Homepage query optimization for 2,222+ books
- [ ] Consider Redis/edge caching for homepage data
- [ ] Gemini quota monitoring dashboard

## Lessons Learned

1. **Concurrency=100 is too aggressive for 3 Gemini keys.** Sweet spot was 30-50 (achieved ~28k pages/hour).
2. **Rate limit cascades are nonlinear.** Once one key exhausts, the remaining keys get overloaded, causing a cascading slowdown rather than a 33% reduction.
3. **Multiple concurrent sessions need a coordination mechanism.** A simple lockfile or "who's running" check in the DB would prevent this.
4. **The 01:00-05:00 UTC window is the sweet spot** for bulk Gemini processing — rate limits are generous during off-peak hours.
