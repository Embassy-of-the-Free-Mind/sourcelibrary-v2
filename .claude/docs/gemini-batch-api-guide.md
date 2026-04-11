# Gemini Batch API: Lessons, Pitfalls, and Playbook

> Comprehensive guide distilled from 4+ months of production use (Dec 2025 – Apr 2026).
> 20+ incidents, ~50 commits, 3 major architecture rewrites.

---

## Architecture Overview

```
ORCHESTRATOR (Hetzner, every 5min)
│
├─ Health probe → adaptive limits
├─ OCR submission (250 pages/file batch, 20 pages/inline)
├─ Image extraction (150 pages/batch, cross-book pooling)
└─ Key rotation (round-robin across 2 GCP projects)
        │
        ▼
  Gemini Batch API (async, 50% cost savings)
  ├─ File API upload (resumable, text/plain MIME)
  └─ batchGenerateContent (inline or file-based)
        │
        ▼
COLLECTOR (Hetzner, every 10min)
├─ Poll all keys (jobs are key-scoped)
├─ Match results by metadata.key (NEVER positional)
├─ Write to MongoDB (throttled 25 ops/200ms)
├─ RECITATION recovery → flag for retry
├─ Stale job cancellation (>24h PENDING)
├─ Zombie reaper (>6h no update on non-batch jobs)
├─ Ghost parent cleanup
└─ File API cleanup (delete files >1h old)
```

**Key files:**
- `src/lib/gemini-batch.ts` — core Batch API client (608 lines)
- `scripts/workers/pipeline-orchestrator.mjs` — submission (~3000 lines)
- `scripts/workers/batch-collector.mjs` — collection (~1170 lines)
- `src/lib/types/batch-job.ts` — MongoDB schema
- `src/lib/types/ai-models.ts` — model routing

---

## The 8 Hard Lessons (Verified Against Code)

### 1. Files Are Key-Scoped — Upload + Create Must Use Same Key

**The bug:** File uploaded with Key A, batch created with Key B → Key B can't see the file → silent failure.

**Current code (orchestrator:1387-1393):** Upload and batch creation are paired in the same loop iteration, using the same key index. On 429, it re-uploads with the next key.

**Status: FIXED and VERIFIED.** The pattern is consistent across OCR (line 1387), per-book images (line 1649), and cross-book images (line 1874).

### 2. Batch Jobs Are Only Visible to the Creating Key

**The bug:** Collector polls with Key A, can't find a job created by Key B → job appears lost.

**Current code (collector):** Tries ALL available keys when polling status. `getAllApiKeys()` in `gemini-batch.ts:87-94` deduplicates via `new Set()`.

**Status: FIXED and VERIFIED.**

### 3. Result Matching Must Use metadata.key, Never Index Position

**The bug (2026-03-24, PR #816):** Response order from Gemini is NOT guaranteed. Index-based matching wrote OCR text from Book A's page onto Book B's page. Cross-book contamination.

**Current code (collector:303-309):**
```javascript
const pageId = r.metadata?.key;
if (!pageId) {
  // NEVER fall back to index-based matching — response order is not guaranteed.
  console.warn(`  SKIP: response ${idx} missing metadata.key`);
  failCount++;
  continue;
}
```

**Status: FIXED and VERIFIED.** No fallback to index matching anywhere in the codebase.

### 4. Three Independent Rate Limits Per GCP Project

This is the subtlest lesson and the one that caused the most wasted debugging time.

| Endpoint | Limit | Symptom |
|----------|-------|---------|
| `generateContent` (realtime) | High | Rarely hit |
| File API upload (`/upload/v1beta/files`) | Separate quota | Upload fails with 429 |
| `batchGenerateContent` (batch creation) | ~700 creations, 12-24h reset | Creation fails with 429 |

**The trap:** Testing with `generateContent` shows "key is healthy" but batch operations are still 429'd. The limits are per-endpoint, per-project.

**Current mitigation:**
- 2 GCP projects (2 unique keys after dedup)
- Round-robin submission across projects
- When one project is 429'd on uploads and the other on batch creation... you wait

**Diagnosis tip:** The orchestrator logs "All keys quota exhausted" without distinguishing the endpoint. Check the lines above it: "Upload key N quota exhausted" vs "Batch create key N quota exhausted".

**Possible improvement:** The 700-creation limit argues for larger batches (fewer creations). OCR was raised from 75→250 pages/batch for exactly this reason. Image extraction is at 150. Could go higher if Gemini allows it.

### 5. File API Has a 20GB Per-Project Quota (Ghost Files)

**The bug (2026-04-08):** Old batch files aren't auto-deleted. They accumulate silently until the 20GB quota is full, then file uploads start failing with no clear error message.

**Current code (collector:1147-1170):** After each collector run, it lists all files on every key and deletes anything >1 hour old.

**Status: FIXED and VERIFIED.** But the cleanup is best-effort (catches errors silently). If the collector fails mid-run, ghost files survive.

**Critical note from memory:** The original fix was to put keys on separate GCP projects so one project's ghost files don't block the other. This is still the architecture.

### 6. RECITATION Blocks Are Not Transient — Mark and Move On

**The bug:** Gemini returns `finishReason: 'RECITATION'` for pages it considers too close to copyrighted training data. The pipeline kept retrying these pages infinitely.

**Current code (collector:285-320, 953-974):**
1. Count RECITATION responses per job
2. If ALL pages in a batch hit RECITATION: flag the book with `recitation_retry: true`, reset to `archive_complete`
3. Individual RECITATION pages: counted as failures, skipped in results

**The orchestrator (commit 9956ee4f):** Skips recitation-flagged books in OCR submission entirely.

**Status: FIXED and VERIFIED.** RECITATION is handled at both collector and orchestrator level.

### 7. PROHIBITED/Safety Blocks Need the Same Treatment as RECITATION

**The bug (2026-04-08):** Some pages trigger Gemini's safety filter (nudity in historical medical texts, etc.). These returned `PROHIBITED` errors. The translate-worker kept retrying them forever.

**Fix:** Mark PROHIBITED pages with `safety_reason` field, skip them in future runs.

**Status: FIXED in translate-worker.** The batch collector also handles these (safety-blocked pages are counted as failures).

### 8. Zombie Jobs: Created in MongoDB But Never Submitted to Gemini

**The bug (2026-04-10):** A job record gets created in `batch_jobs` (status: 'pending') but the Gemini API call fails silently (network error, 429, etc.). The job has no `gemini_job_name`. It sits in MongoDB forever, counting against active-job limits and blocking the pipeline.

**Current code (collector:1061-1070):**
```javascript
// Zombie Reaper: cancel stale processing jobs (>6h no update)
const zombieResult = await db.collection('jobs').updateMany(
  { ... stale >6h ... },
  { $set: { status: 'cancelled', cancel_reason: 'zombie reaper — stale >6h' } }
);
```

**Note:** The zombie reaper runs on the `jobs` collection (non-batch pipeline jobs), not `batch_jobs`. Batch jobs have the 24h stale-pending check (line 580-598) that catches the equivalent case for batch operations.

**Potential gap:** If a batch job record is created in MongoDB but the Gemini submission throws before returning a `job_name`, the 24h stale check would catch it — but only after 24 hours. Could be tightened.

---

## Verified Current Configuration

| Parameter | Value | Source |
|-----------|-------|--------|
| OCR file batch size | 250 pages | orchestrator:54 |
| OCR inline batch size | 20 pages | orchestrator:53 |
| Image extraction batch size | 150 pages | orchestrator:1516 |
| Image inline batch size | 20 pages | orchestrator:1517 |
| Stale PENDING threshold | 24 hours | collector:582 |
| Zombie reaper threshold | 6 hours | collector:1061 |
| File cleanup age | 1 hour | collector:1158 |
| Write throttle | 25 ops per 200ms | collector bulk writes |
| Unique API keys | 3 (deduped from 4 env vars) | orchestrator:998 |
| Hallucination guard | Skip >25KB output | collector |
| Default OCR model (non-BPH) | gemini-3.1-flash-lite-preview | ai-models.ts |
| Default OCR model (BPH) | gemini-3-flash-preview | ai-models.ts |
| Batch cost discount | 50% | collector cost tracking |

---

## Things That Work Well

1. **Cross-book image batching (PR #927):** Pools pages from multiple books into shared 150-page batches. Reduces batch creation count (helps with the 700-creation limit) and improves utilization.

2. **Round-robin key rotation:** Spreads load across both GCP projects. On 429, automatically tries the next key in the same operation.

3. **Adaptive health probes:** Pipeline self-throttles when Atlas is degraded. Prevents the write-amplification death spiral.

4. **metadata.key matching:** Simple, bulletproof. Every request includes a unique `key` field in metadata. Results matched by key, never by position.

5. **File-based submission for large batches:** Avoids the ~20MB inline body limit. Resumable upload protocol handles network interruptions.

6. **50% cost savings:** The whole point. At scale this is thousands of dollars saved monthly.

---

## Things That Still Bite

### 1. The "Both Projects Blocked" Deadlock
When Project A is 429'd on File uploads and Project B on batch creation (or vice versa), there's no working path. The pipeline just stops until one project's cooldown expires (12-24h).

**Status: MITIGATED (2026-04-11).** Third GCP project (`GEMINI_API_KEY_3`) added. All 3 projects would need to be blocked simultaneously, which is much less likely.

### 2. Batch Creation Limit (~700/project)
This is the single biggest throughput bottleneck. At 250 pages/batch and 700 creations/project/day, that's ~525K pages/day across 3 projects. Sounds like a lot, but burst imports can hit it.

**Mitigations already in place:**
- OCR batch size raised to 250 (from 75)
- Cross-book pooling for images
- Min-batch-size gate (won't submit tiny batches)
- 3 GCP projects for round-robin (added 2026-04-11)

### ~~3. OOM on Large Book JSONL Construction~~
**Status: FIXED (2026-04-11).** Books with 250+ large images (e.g. Patrologia Graeca, 500 pages) caused `Invalid string length` / heap OOM when building the JSONL string in memory. Fix: `buildJsonlFile()` streams JSONL lines to a temp file one at a time, freeing each image buffer after serialization. Upload uses `fs.createReadStream()` for streaming upload. Peak memory is now ~1 image + 1 JSON line, not 250 images + full JSONL string.

### 4. 24-Hour Stale Timeout Is Very Long
A batch job stuck in PENDING for 24 hours before the collector cancels it means that book is blocked for a full day. Flash Lite can be slow, but 24h is conservative.

**Trade-off:** Lower it to 12h and you risk cancelling jobs that would have completed. Gemini's SLA is "within 24 hours." The current 24h timeout matches the SLA exactly — which means in practice, some jobs are cancelled just as they'd complete.

**Possible improvement:** Check `stats.successCount` during polling. If it's been RUNNING with 0 progress for >6h, that's more meaningful than a flat 24h clock.

### 4. File Cleanup Is Best-Effort
The ghost file cleanup after each collector run catches errors silently. If the collector itself crashes, or if the File API list endpoint is paginated beyond 100 files, old files survive. The 20GB quota can still fill up.

**Possible improvement:** The cleanup fetches `pageSize=100`. If there are >100 files, it misses some. Should paginate with `nextPageToken`.

### 5. No Batch Translation (Intentional but Worth Revisiting)
Translation uses realtime Gemini calls via Hetzner's translate-worker because batch lacks cross-page context continuity. This is correct — translation quality depends on seeing previous pages.

**But:** Issue #217 proposes 5-pages-per-request batching which would preserve context within each request. Could capture most of the 50% savings while keeping quality.

### 6. RECITATION Recovery Could Be Smarter
Currently, books with 100% RECITATION get flagged and the orchestrator skips them entirely. But some books have only a few RECITATION pages mixed with successful ones.

**Current behavior:** Individual RECITATION pages are counted as failures but the book continues. Only 100%-RECITATION books get the recovery flag.

**This seems correct.** No change needed.

---

## Memory File Audit

Several memory entries reference files that **don't exist** as standalone `.md` files:

| Referenced in MEMORY.md | Exists? |
|------------------------|---------|
| `pipeline-batch-api.md` | NO |
| `lesson-batch-recovery-sweep.md` | NO |
| `lesson-batch-job-querying.md` | NO |
| `lesson-batch-creation-rate-limit.md` | NO |
| `lesson-batch-quota-optimization.md` | NO |
| `lesson-batch-key-scoped-files.md` | NO |
| `lesson-batch-collector-contamination.md` | NO |
| `lesson-gemini-file-storage-quota.md` | NO |
| `lesson-safety-blocked-pages.md` | NO |
| `lesson-blank-page-accounting.md` | NO |
| `lesson-gemini-batch-rate-limits.md` | YES |
| `lesson-zombie-batch-jobs.md` | Referenced but file missing |

The MEMORY.md index references these files as if they exist, but most were never created — the content lives only in MEMORY.md's inline descriptions. This is fine functionally (MEMORY.md is always loaded) but misleading if someone tries to read the linked files.

---

## Accuracy Check: Are Any Lessons Wrong?

### Verified Correct
- **Key scoping** — confirmed in code and Gemini docs
- **metadata.key matching** — confirmed, no index fallback exists
- **RECITATION handling** — confirmed at both collector and orchestrator level
- **File API 20GB quota** — confirmed, cleanup code exists
- **3 independent rate limits** — confirmed by incident reports and code comments
- **TIER3 === KEY_2** — confirmed by `new Set()` dedup producing 2 keys from 3 env vars

### Potentially Outdated
- **"~700 batch creations then 12-24h cooldown"** — This number comes from empirical observation on 2026-04-09. Google may have changed the limit since. No way to verify without hitting it again.
- **"Batch API with gemini-3-flash-preview triggers RECITATION on some historical texts"** (collector:954) — This may be model-version-specific. Newer model versions might handle historical texts better. Worth testing periodically.

### Minor Inaccuracy in MEMORY.md
- MEMORY.md says "zombie reaper" lesson file exists at `lesson-zombie-batch-jobs.md` — the file does NOT exist (confirmed by file read returning "File does not exist").

---

## Decision Framework: When to Use Batch vs. Realtime

| Factor | Use Batch | Use Realtime |
|--------|-----------|-------------|
| Cost sensitivity | Yes (50% savings) | No |
| Needs cross-page context | No | Yes (translation) |
| Pages > 20 per book | Yes (file-based) | Wasteful |
| Pages < 5 per book | No (min-batch gate) | Yes |
| Latency matters | No (hours) | Yes (seconds) |
| Content may trigger RECITATION | Batch + fallback to Lambda | Lambda directly |
| Atlas is degraded | Batch (async, no pressure) | Careful with throttling |

---

## Incident Timeline

| Date | Incident | Root Cause | Fix | PR/Commit |
|------|----------|------------|-----|-----------|
| 2026-03-19 | Batch OCR returning 0 pages for days | Collector broken (unknown specifics) | Major collector rewrite | #256 |
| 2026-03-24 | Cross-book contamination | Index-based result matching | Switch to metadata.key | #816 |
| 2026-03-24 | "Invalid string length" crash | OCR batch too large (150 pages) | Reduce to 75 | #815 |
| ~2026-03 | RECITATION infinite retry | No handling for finishReason: RECITATION | Mark and skip | Multiple commits |
| 2026-04-06 | Ghost parent jobs stuck in processing | Children collected but parent not updated | Ghost cleanup routine | #823 |
| 2026-04-08 | File API quota exhausted | Ghost files filling 20GB | Key separation + cleanup routine | #289 |
| 2026-04-08 | Safety-blocked pages retrying forever | No PROHIBITED handling | Mark safety_reason, skip | Translate-worker fix |
| 2026-04-08 | Files uploaded on wrong key | Upload and create on different keys | Pair upload+create in same loop | commit 054eed74 |
| 2026-04-09 | Both projects rate-limited simultaneously | Different endpoints blocked on different projects | Wait for reset (no code fix possible) | — |
| 2026-04-10 | Zombie jobs blocking pipeline | Jobs created in MongoDB without Gemini submission | Zombie reaper | #741 |
| 2026-04-10 | OCR batch size tuning | 700 creation limit hit too fast at 75 pages/batch | Raise to 250 | commit fa38d0cc |

---

## Recommendations for Reliability Improvements

**High impact, low effort:**
1. **Paginate file cleanup** — add `nextPageToken` loop to `cleanupStaleFiles()` so it handles >100 ghost files
2. **Tighten stale detection** — check `stats.successCount` during RUNNING state, not just flat 24h clock
3. **Create missing memory files** — 10 entries in MEMORY.md point to nonexistent files

**Medium impact, medium effort:**
4. **Add a third GCP project** — breaks the "both projects blocked" deadlock for $0 (free tier)
5. **Batch translation with 5-page context windows** — Issue #217, could save 50% on translation costs while preserving quality

**Low priority but worth tracking:**
6. **Monitor RECITATION rates by model version** — newer Gemini versions may handle historical texts better
7. **Structured logging for rate limits** — distinguish File API vs. batch creation 429s in a queryable format
