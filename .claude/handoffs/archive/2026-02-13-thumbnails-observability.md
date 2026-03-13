# Handoff: Thumbnail Generation & Observability — 2026-02-13

## What Was Done

### 1. Observability Plan (Complete)
All 6 items from `.claude/plans/swift-floating-pancake.md` are done:

1. **Audit logger** — `src/lib/audit-logger.ts` created. Non-blocking `logAuditEvent()` with typed actions.
2. **13 routes instrumented** — imports, CRUD, editions, DOI, page edits all log to `audit_log`.
3. **cost_tracking fully deprecated** — 5 routes migrated to `logGeminiCall()`. Zero references remain (`grep -r "cost_tracking" src/app/` → 0).
4. **Analytics/usage reader migrated** — reads from `gemini_usage` instead of `cost_tracking`.
5. **Search query logging** — 3 search routes log to `analytics_events`.
6. **Annotation moderation gap documented** — TODO at `src/app/api/annotations/route.ts:135`, gap listed in `.claude/docs/observability.md`.

All audit events auto-surface in Book History timeline.

### 2. Thumbnail Pre-Generation System

**Architecture:**
- Per-book API: `POST /api/books/[id]/generate-thumbnails` — 150px JPEG, Vercel Blob storage
- `PageThumbnail` component uses `thumbnail_blob` when available, falls back to `/api/image`
- Fast standalone script: `scripts/generate-thumbnails-fast.ts` — connects directly to MongoDB + Vercel Blob

**Current state: TWO WORKERS RUNNING**
- **Local Mac** — concurrency 20, ~5 pages/sec
- **Hetzner (46.224.122.120)** — concurrency 20, ~34 pages/sec
- Combined: ~38 pages/sec, zero failures
- Running from `archived_photo` pages only (Vercel Blob sources). Pages with only remote URLs (IA, Gallica) may 403.
- ~860K total pages need thumbnails. At 38/sec = ~6.3 hours.

**To check progress:**
```bash
# Local
tail -20 /private/tmp/claude-501/-Users-dereklomas-sourcelibrary/tasks/b3fd1ef.output

# Hetzner
ssh root@46.224.122.120 "tail -20 /root/thumbnails/thumbnails.log"

# MongoDB count
db.pages.countDocuments({ thumbnail_blob: { $exists: false }, archived_photo: { $exists: true } })
```

**To restart if stopped:**
```bash
# Local — needs secrets from keychain
secret-lover get MONGODB_URI  # and BLOB_READ_WRITE_TOKEN
# Use /tmp/run-thumbnails.sh wrapper (has env vars baked in)

# Hetzner — run.sh has env vars baked in
ssh root@46.224.122.120 "cd /root/thumbnails && nohup bash run.sh > thumbnails.log 2>&1 &"
```

**Known issues:**
- Pages marked `thumbnail_blob: "failed:..."` had permanent errors (usually HTTP 403 from source). These can be retried later after archiving images.
- Vercel Blob rate limits at ~50 concurrent uploads. Keep combined concurrency ≤40.
- Vercel cron was REMOVED from `vercel.json` — all processing via standalone script now.

### 3. Book Page Payload Optimization
- MongoDB projections exclude heavy fields: chapters, reading_sections, pipeline, split_check, index.sectionSummaries, ocr.data, translation.data, detected_images sub-fields, split_detection
- `BookPagesSection` batch filter uses `ocr.updated_at` instead of `ocr.data`

### 4. SEO Improvements
- Schema.org JSON-LD for gallery, encyclopedia, gallery images
- ContentPageLayout component for about/processing/research/developers
- OpenGraph image montage for gallery
- Standards page: `sourcelibrary.org/about/standards`

## Commits Pushed
```
e0aedb0 Add book provenance history timeline and comprehensive system documentation
1461cf1 Improve SEO with structured data, OpenGraph images, and content page layouts
5b2536b Add thumbnail pre-generation system and optimize book page payloads
34d8c6e Fill observability gaps: audit logging, cost tracking migration, search logging
ff7699d Add session handoff notes and OCR needs check script
fa4da1d Remove thumbnail cron — running locally via fast script instead
```

## What's Left
- [ ] Wait for thumbnail generation to complete (~6 hours)
- [ ] After archived pages done, run with `--include-remote` for remaining pages (may need image archiving first)
- [ ] Consider MongoDB index on `thumbnail_blob` for faster queries
- [ ] Clean up `failed:` thumbnail entries after fixing source URLs
