# Pipeline Operations Reference

> Last verified: 2026-03-27. Stats decay fast — re-check counts before citing them.

## Quick Status Check Commands

```bash
# Current velocity (pages/hour, costs)
set -a; source .env.production.local; set +a; node -e '
const { MongoClient } = require("mongodb");
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1 });
c.connect().then(async () => {
  const db = c.db("bookstore");
  const cutoff = new Date(Date.now() - 24*60*60*1000);
  const snaps = await db.collection("pipeline_snapshots").find({ timestamp: { $gte: cutoff } }).sort({ timestamp: 1 }).project({ timestamp: 1, pages: 1, funnel: 1 }).toArray();
  if (snaps.length >= 2) {
    const f = snaps[0], l = snaps[snaps.length-1];
    const h = (new Date(l.timestamp) - new Date(f.timestamp)) / 3600000;
    console.log("OCR/hr:", Math.round(Math.max(0,(l.pages?.ocr||0)-(f.pages?.ocr||0))/h));
    console.log("Translate/hr:", Math.round(Math.max(0,(l.pages?.translated||0)-(f.pages?.translated||0))/h));
    console.log("Complete books:", l.funnel?.complete);
  }
  c.close();
});'

# Batch job queue health
set -a; source .env.production.local; set +a; node -e '
const { MongoClient } = require("mongodb");
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1 });
c.connect().then(async () => {
  const db = c.db("bookstore");
  const parents = await db.collection("batch_jobs").countDocuments({ status: { $in: ["pending","processing"] }, child_job_ids: { $exists: true } });
  const leaves = await db.collection("batch_jobs").countDocuments({ status: { $in: ["pending","processing"] }, child_job_ids: { $exists: false } });
  console.log("Parent (umbrella) jobs:", parents, "| Leaf (Gemini) jobs:", leaves);
  c.close();
});'

# 3-day translation activity
set -a; source .env.production.local; set +a; node -e '
const { MongoClient } = require("mongodb");
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1 });
c.connect().then(async () => {
  const db = c.db("bookstore");
  const cut = new Date(Date.now() - 3*24*60*60*1000);
  const r = await db.collection("gemini_usage").aggregate([
    { $match: { type: "translation", timestamp: { $gte: cut } } },
    { $group: { _id: { model: "$model", endpoint: "$endpoint" }, pages: { $sum: 1 }, cost: { $sum: "$cost_usd" } } },
    { $sort: { pages: -1 } }
  ]).toArray();
  r.forEach(x => console.log(x._id.endpoint, "|", x._id.model, "|", x.pages, "pages | $" + (x.cost||0).toFixed(2)));
  c.close();
});'
```

## Architecture Overview

```
Hetzner (cax31, 46.224.122.120) — pipeline brain
├── pipeline-orchestrator.mjs    every 5 min   drives all 9 phases
├── translate-worker.mjs         every 5 min   inline translation (15 concurrent books)
├── batch-collector.mjs          every 10 min  collects Gemini Batch API results
├── sync-worker.mjs              every 2 hrs   syncs page counts + gallery images
└── pipeline-health-alert.mjs    daily         throughput + storage alerts

AWS Lambda (eu-central-1) — workers
├── ocr-processor (×10)          SQS-triggered  preview OCR (first 25 pages)
├── translation-processor (×15)  SQS-triggered  LEGACY but still active — see below
├── image-extraction (×10)       SQS-triggered  detect illustrations/diagrams
└── write-processor (×50)        internal       batch MongoDB writes

Vercel — web + lightweight crons
├── social-post (3h), social-reset (daily), health-check (hourly)
├── daily-pipeline-report (6am UTC), warm (5min)
└── 11 DISABLED legacy cron routes still in code (replaced by Hetzner workers)
```

### Two Translation Paths (Important!)

There are TWO active translation paths running simultaneously:

1. **Hetzner translate-worker** (`worker/hetzner-translate`) — the new path
   - Uses `getModelForBook()`: BPH → flash, others → lite
   - Prompt version: v6
   - Cost-efficient for non-BPH books

2. **Lambda translation-processor** (`worker/translation`) — the legacy path
   - Still receives jobs via SQS FIFO queue
   - As of PR #482 (2026-03-27), now uses `getModelForBook()` for fallback model
   - But jobs created BEFORE the fix still have `model: 'gemini-3-flash-preview'` hardcoded in `job.config`
   - Prompt version: v5.1.2026-03

**The orchestrator creates jobs** in the `jobs` collection. The translate-worker picks them up. But some jobs may also be dispatched to Lambda via SQS — the two paths coexist.

## Pipeline Phases

```
Import → queued → archiving → archive_complete → ocr_submitted → ocr_complete
→ metadata_enriched → [ft_verified] → translate_submitted → translate_complete
→ summary_indexed → chapters_complete → images_submitted → images_complete
→ cover_selected → complete
```

Side phases: split detection (1.25), preview OCR (1.5), preview translation (1.7), transliteration (3.7)

## Model Routing

| Task | BPH books | Other books |
|------|-----------|-------------|
| OCR (batch) | gemini-3-flash-preview | gemini-3.1-flash-lite-preview |
| Translation | gemini-3-flash-preview | gemini-3.1-flash-lite-preview |
| Summary/Index | gemini-3-flash-preview (ALWAYS) | gemini-3-flash-preview (ALWAYS) |
| Transliteration | — | gemini-3.1-flash-lite-preview |

## Batch Job Structure

Batch jobs use a **parent/child** pattern:
- **Parent jobs** have `child_job_ids[]` array, `total_pages`, NO `job_name` — these are umbrella trackers
- **Child/leaf jobs** have `job_name` (Gemini batch operation ID like `batches/abc123`), `page_count`
- Parent stays "pending" until ALL children complete — **this is normal, not stuck**
- When checking queue health, count **leaf jobs only** (where `child_job_ids` doesn't exist)

## Adaptive Health System

The orchestrator probes MongoDB at the start of each run:
- **Healthy**: find <300ms, count <500ms → full limits
- **Degraded**: find 300-1000ms → halves all limits
- **Critical**: find >1000ms → slams to minimums

**Known issue**: `system_config.adaptive_limits.locked = true` was set after an Atlas saturation incident and may still be locked. When locked, the system can't auto-recover from degraded state.

## Cost Structure

| Model | Input $/1M tokens | Output $/1M tokens |
|-------|-------------------|-------------------|
| gemini-3-flash-preview | $0.50 | $3.00 |
| gemini-3.1-flash-lite-preview | $0.25 | $1.50 |
| Batch API (either model) | 50% discount | 50% discount |

Typical daily spend at full velocity: ~$200-250/day ($180 translation, $25 OCR, $5 transliteration, misc).

## Gemini API Keys

11 keys total with rotation. Keys are in `.env.production.local`:
- `GEMINI_API_KEY` — fallback
- `GEMINI_API_KEY_2` through `GEMINI_API_KEY_10` — rotation pool
- `GEMINI_API_KEY_TIER3` — primary for realtime calls

**Critical**: Batch jobs are only visible to the API key that created them. If you see "entity not found" errors during batch collection, it's a key mismatch.

## Emergency Controls

- **Stop all:** Set `system_config._id: 'processing_control'` → `paused: true`
- **Resume:** `POST /api/admin/emergency-stop?resume=true`
- **Selective pause:** `paused_phases: ['ocr','translation','images']`
- **Adaptive limits:** `GET/PATCH /api/admin/adaptive-limits`
- **`paused: true` doesn't stop Lambda workers.** Must CANCEL jobs in MongoDB for actual load reduction.

## Concurrency Limits

- MongoDB Atlas saturates at ~40 concurrent Lambda jobs
- Per-phase: OCR 20, translation 30 (MAX_INFLIGHT_TRANSLATIONS), images 50
- Conservative safe: `global_active_max` 25, `translate_lambda_max` 15
- Higher tested (2026-03-26): `global_active_max` 50 — Atlas stayed healthy

## Translation Prioritization

Phase 4 dispatch sort order:
1. Latin books first (`_latinFirst: 0`)
2. First translations (`is_first_translation: true`)
3. Visible books before hidden

## Visibility & R2 Archiving

- `hidden: true` + `hidden_reason: 'unarchived'` = images not on R2 yet
- Per-page: `archived_photo` = R2 URL, `photo` = original source URL
- `image_source.provider` stays as original (e.g. "e-rara"), NOT changed to "r2"
- Don't check `provider === 'r2'` — check `pages_archived > 0` or `archived_photo` existence
- Auto-unhide: pipeline-orchestrator unhides books when archiving completes
- `hide-unarchived-books.mjs` bulk-hid unarchived books

## Common Issues & Debugging

### "Why are batch jobs stuck?"
They're probably not stuck — parent jobs stay pending until children complete. Check leaf job count and recent collection rates in `cron_runs` (cron: `batch-collector-worker`).

### "Why is translation using the expensive model?"
Check `gemini_usage` grouped by model + endpoint. After PR #482, new jobs should use lite for non-BPH. But existing in-flight jobs still have the old model in `job.config`.

### "Why are books hidden?"
Most likely `hidden_reason: 'unarchived'` — images not yet on R2. See data-quality.md for details.

### "What's the real book count?"
34K total, but ~21K are hidden (unarchived). The working set is ~13K visible books. Always use visible books as the denominator for meaningful stats.

## Lessons Learned

- **Zombie jobs block orchestrator (2026-03-26):** Jobs stuck in `processing` with no active Lambda prevent new dispatch. Cancel zombie jobs AND reset books from `translate_submitted` → `ocr_complete`.
- **Batch API PENDING saturation (2026-03-26):** 450 batch jobs stuck at PENDING across all keys. Fix: cancel stale batches via Gemini API, mark MongoDB jobs as failed, reset books.
- **Adaptive limits locked (2026-03-26):** `locked: true` prevents auto-scaling even when healthy. Check before investigating slow throughput.
- **Lambda timeout on large books (2026-03-13):** Books >500 pages can exceed 15min Lambda timeout. Split into 400-page chunks.
- **Translation model routing bug (2026-03-27, PR #482):** Orchestrator was hardcoding flash model for all translation jobs instead of calling `getTranslateModelForBook()`. 97% of translations used 3x expensive model. Fixed.
- **e-rara archiving runs locally (not Hetzner):** Hetzner IPs are blocked by e-rara. Archive-erara runs on Mac via launchd.
- **NEVER use Batch API for translation:** Realtime only — batch lacks cross-page context continuity.
- **Stale Vercel pools after DB recovery:** Redeploy to reset connection pools.
