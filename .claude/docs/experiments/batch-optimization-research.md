# Batch API Optimization Research (2026-04-12)

## Key Findings from Google Docs + Developer Forums

### 1. Rate Limits Are Dynamic, Not Fixed
Google's official docs say the Batch API has **"no predefined quota limits"** — it uses a shared
resource pool allocated dynamically based on availability and demand. Our empirical ~700
batch-creation limit per project isn't a hard cap — it shifts based on overall platform load.

**Implication:** Adding GCP projects helps but the limit is unpredictable. Better strategy:
submit fewer, larger batches.

### 2. Recommended Batch Size: 1,000–5,000 Requests Per Job
Google explicitly recommends batching 1,000–5,000 requests per job for optimal throughput.
Our current OCR batch size is 250. There's no hard cap — hundreds of thousands of requests
per job are possible.

**Implication:** We could 4-20x our batch size, which would proportionally reduce the number
of batch creation API calls and dodge the creation rate limit entirely.

**Blocker:** File size. 250 pages of base64 images = ~250-500MB JSONL. At 1,000 pages that's
1-2GB. The File API upload limit is 2GB. Need to test if this works in practice.

### 3. Context Caching + Batch: Officially Supported, Practically Broken
The docs claim: "Context caching is enabled for batch requests." But the developer forums
tell a different story:
- Multiple threads report errors when including `cachedContent` in batch JSONL
- Some users get "default irrelevant answers" when the cache ref is included
- No confirmed working examples of explicit caching with batch on AI Studio (non-Vertex)

**Implication:** Batch translation with cached context is NOT viable right now. Our current
approach (realtime translation via translate-worker with cross-page context) remains correct.

### 4. Implicit Caching Exists (Gemini 2.5+)
Gemini 2.5 and newer have **implicit caching** — if you send the same prompt prefix
repeatedly, Google may cache it automatically. No API changes needed. This means our batch
OCR jobs (which all share the same system prompt) might already benefit from implicit caching
without us doing anything.

**Implication:** Check `gemini_usage` for cached token counts on recent batch jobs.

## Experiment Results

### Experiment B: Implicit Cache Detection (2026-04-12) — CONFIRMED
Ran `scripts/experiments/check-implicit-caching.mjs` against all 3 keys.

**Key1 results:** Implicit caching IS active. 339 tokens cached out of 1,554 prompt tokens
per request (~22%). The `cachedContentTokenCount` field is present. Also includes
`cacheTokensDetails` and `promptTokensDetails` breakdowns.

**Key2 results:** No caching detected. All responses show `cached=NONE`. Key2 is newer
(added 2026-04-11) and may not have enough repeated prompts to trigger implicit caching,
or the model version/prompt structure differs.

**Takeaway:** We're already getting free implicit caching on ~22% of our OCR prompt tokens.
No code change needed. Larger batches with identical prompts may increase the cache hit rate.

### Experiment A: Large Batch Size — COMPLETED (2026-04-13)

Two parallel experiments on Paracelsus *Opera* (BPH, large images):

| | Full-res (680 pages) | Resized 1500px (1000 pages) |
|---|---|---|
| JSONL size | 1,864 MB | **467 MB** |
| Upload time | 14s | **7s** |
| Total submit time | 158s | **97s** |
| Gemini processing time | **2.2 hours** | 4.3 hours |
| Avg image size | 2,145 KB | **358 KB (83% smaller)** |
| OCR quality | Excellent | **Identical** |
| Failures | 0/680 | 0/1000 |
| Implicit caching | None (Key3 too new) | None (Key3 too new) |

**Key findings:**
1. **1500px resize produces identical OCR quality.** Both transcribed early modern German
   (Paracelsus) accurately — same handling of "vnnd", "Nymph", "Siderifchen" etc.
2. **File API hard limit is 2GB** (2,147,483,648 bytes). Full-res 750 pages = 2,068 MB
   (over limit). With resize, 1,000 pages = 467 MB (way under).
3. **With resize, 4,000+ pages per batch is feasible** (staying under 2GB).
4. **Resized batch took 2x longer to process** (4.3h vs 2.2h) despite smaller file.
   Likely queue depth, not systematic — Gemini processes requests, not bytes.
5. **Prompt tokens nearly identical** (1,124 vs 1,136). Gemini internally resizes anyway,
   so we're only saving upload bandwidth and JSONL size, not token cost.

**Action taken:** Added `sharp` resize (1500px, quality 80) to orchestrator's OCR download
path. Raised `OCR_FILE_BATCH_SIZE` from 500 to 1000. Image extraction paths unchanged
(need full resolution for bbox accuracy).

**Earlier run (480 pages, no resize):**
Also tested with 480 pages from mixed books at full resolution. JSONL 707 MB, uploaded in
10s. Confirmed File API handles large files fine. Main issue was download failures from
expired source URLs (316/796 failed) — archiver must complete before OCR.

### Experiment C: Batch Translation with 5-Page Context Windows
- Group 5 consecutive pages into a single request (OCR text only, no images)
- Each request includes translation of pages N-4 through N with full context
- Compare translation quality vs realtime translate-worker
- This doesn't need context caching — just larger individual requests

## OCR Speed Optimization Plan

### The Goal
Process 19,846 warehouse books (6.3M pages) as fast as possible. Priority: 6,804 first
English translations. Current OCR rate: ~920 pages/hr ($0.45/day). Target: 10,000+ pages/hr.

### Current Bottlenecks (ranked by impact)

| # | Bottleneck | Current | Limit | Fix |
|---|-----------|---------|-------|-----|
| 1 | **Batch creation rate limit** | ~700 batches/project/day | 3 projects × 700 = 2,100/day | Increase batch size from 250→1,000 = 4x fewer creations |
| 2 | **Batch size** | 250 pages/batch | Google recommends 1,000-5,000 | Raise to 1,000. JSONL ~1.4 GB (under 2GB File API limit) |
| 3 | **Archiving must complete first** | Pages need `archived_photo` or valid `photo` URL | Source URLs expire | Run archiver ahead of OCR; use `archived_photo` (R2, permanent) |
| 4 | **Orchestrator runs every 5 min** | Submits `ocr_submit` limit (200) pages/run | 200 × 12/hr = 2,400 pages/hr | Raise to 500 or 1,000/run |
| 5 | **3 GCP projects** | Round-robin | Per-project quotas independent | Could add more projects (free tier) |
| 6 | **Queue starvation** | Pipeline only promotes `draft` → `archive_complete` gradually | Warehouse books not auto-promoted | Bulk promote warehouse books to `archive_complete` |

### Quick Wins (implement now)

1. **Raise batch size to 1,000** (pending Experiment A results)
   - Change `MAX_PAGES_PER_BATCH` from 250 to 1,000
   - 4x fewer batch creation API calls = 4x throughput ceiling
   - Already verified: File API accepts 707 MB, should handle ~1.4 GB

2. **Raise `ocr_submit` limit** from 200 to 500-1,000 pages/run
   - Orchestrator submits more pages per 5-min cycle
   - With 1,000-page batches: 1 batch/run = 1,000 pages every 5 min = 12,000/hr

3. **Prioritize archived pages** for OCR
   - Use `archived_photo` (R2) instead of `photo` (source URL) in batch JSONL
   - Permanent URLs, no download failures
   - Need to check if orchestrator already does this

4. **Bulk promote warehouse first-translation books**
   - Query: `books_warehouse` where `is_first_translation: true` or language not English
   - Promote to `books` with status `draft` → archiver picks them up

### Theoretical Maximum

With 3 GCP projects, 1,000-page batches:
- Batch creation: 3 × 700/day = 2,100 batches/day
- Pages: 2,100 × 1,000 = **2.1M pages/day** (~87,500/hr)
- At $0.02/1K pages = ~$42/day
- 6.3M warehouse pages = **3 days** at full speed

This is the ceiling. Actual speed depends on Gemini's dynamic capacity allocation.

### Cost Model

| Batch size | Batches/day (3 keys) | Pages/day | Cost/day | Days for 6.3M |
|-----------|---------------------|-----------|----------|---------------|
| 250 (current) | 2,100 | 525K | ~$10 | 12 days |
| 1,000 | 2,100 | 2.1M | ~$42 | 3 days |
| 5,000 | 2,100 | 10.5M | ~$210 | 0.6 days |

Batch API is 50% off vs realtime. Cost = ~$0.02 per 1K input tokens (flash-lite).

## Sources
- [Gemini Batch API docs](https://ai.google.dev/gemini-api/docs/batch-api)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Context caching docs](https://ai.google.dev/gemini-api/docs/caching)
- [Forum: Context caching + batch requests](https://discuss.ai.google.dev/t/context-caching-batch-api-requests/105642)
- [Forum: Is context caching with batch not supported?](https://discuss.ai.google.dev/t/is-context-caching-with-batch-api-not-supported/90541)
- [Forum: How to send cached content to batch?](https://discuss.ai.google.dev/t/how-do-i-send-cached-content-to-a-batch-job/71942)
- [Google blog: Scale with Batch Mode](https://developers.googleblog.com/en/scale-your-ai-workloads-batch-mode-gemini-api/)
