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

## Experiments to Run

### Experiment A: Large Batch Size (1,000 pages)
- Submit a single OCR batch with 1,000 pages across multiple books
- Compare: throughput, completion time, error rate vs 250-page batches
- Watch for File API upload size limits

### Experiment B: Implicit Cache Detection
- Check recent batch job results for `cachedContentTokenCount` in usage metadata
- If present, we're already getting implicit caching for free

### Experiment C: Batch Translation with 5-Page Context Windows
- Group 5 consecutive pages into a single request (OCR text only, no images)
- Each request includes translation of pages N-4 through N with full context
- Compare translation quality vs realtime translate-worker
- This doesn't need context caching — just larger individual requests

## Sources
- [Gemini Batch API docs](https://ai.google.dev/gemini-api/docs/batch-api)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Context caching docs](https://ai.google.dev/gemini-api/docs/caching)
- [Forum: Context caching + batch requests](https://discuss.ai.google.dev/t/context-caching-batch-api-requests/105642)
- [Forum: Is context caching with batch not supported?](https://discuss.ai.google.dev/t/is-context-caching-with-batch-api-not-supported/90541)
- [Forum: How to send cached content to batch?](https://discuss.ai.google.dev/t/how-do-i-send-cached-content-to-a-batch-job/71942)
- [Google blog: Scale with Batch Mode](https://developers.googleblog.com/en/scale-your-ai-workloads-batch-mode-gemini-api/)
