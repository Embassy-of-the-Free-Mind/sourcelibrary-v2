---
date: 2026-03-16
topic: Repository cleanup and organization
commits: af61b9e0, ff689eb7, d94eb559
---

# Repo Cleanup — March 16, 2026

## What was done

### Root directory (af61b9e0)
- Deleted **383 `_tmp-*.mjs` scripts** and 3 other scratch scripts (`_quick-test`, `_stats`, `_test-conn`)
- Deleted **11 media files** (comparison screenshots, homepage recordings)
- Deleted **8 stale markdown files**: QAreport, agentcurator, bookbiography, curatorreports, press-releases, CATALOG (103 books — now 5,355), IA_IMPORT_CANDIDATES, CLAUDE_CONTEXT (superseded by CLAUDE.md)
- Moved **5 fundraising docs** to `docs/fundraising/`
- Dropped **5 stale git stashes**
- Deleted **2 stale branches**: `fix/pipeline-adaptive-limits`, `rollback/stable-2h-ago`

### Scripts organization (af61b9e0)
All 33 loose tracked scripts in `scripts/` moved into subdirectories:
- 6 → `scripts/import/` (laurenziana, getty, kloss)
- 10 → `scripts/batch/` (queue-*, submit-*, find-next-translations)
- 6 → `scripts/maintenance/` (check-indexes, create-indexes, launch-check, overnight-report)
- 4 → `scripts/enrichment/` (shwep-*, backfill-ia-contributors, batch-enrich)
- 5 → `scripts/one-off/` (analyze-partners, scrape-kloss, test-*)
- Removed 2 tracked `_tmp-*` files and 1 duplicate `collect-batch-results.mjs`

### Handoffs
Archived 6 handoffs older than 5 days (March 7–10) to `.claude/handoffs/archive/`

### Page merge: /data + /fulldata (ff689eb7)
- `/data` is now the single collection stats page
- `?admin=true` query param reveals admin sections: pipeline status, enrichment coverage, OCR/translation tiers
- `/fulldata` now redirects to `/data?admin=true`
- Updated links in `/letter`, `/plan`, `robots.ts`

### Dead code removed
- `/beta/gate-preview` page (orphaned, no links)
- 5 unused lib files: `collection-relevance.ts`, `image-provenance.ts`, `verify-unscanned.ts`, `site-mode.server.ts`, `api-utils.ts`
- `AddToBookshelfButton` component (never imported)
- All confirmed already deleted in prior commits (cc983eab)

### Bug fix: analytics tabs restored (ff689eb7)
Commit cc983eab accidentally deleted 7 analytics components (6 tab components + SparkLine) that the `/analytics` page still imports via `next/dynamic`. Restored from parent commit. The analytics page was silently broken.

### New tools (d94eb559)
- **`scripts/maintenance/check-imports.mjs`** — scans 845 source files, verifies all import targets resolve. 320ms. Catches the "deleted file still imported" class of bugs.
- **`scripts/maintenance/smoke-test.mjs <url>`** — hits every page route against a Vercel preview, reports 500s, error boundaries, timeouts.
- **Pre-commit hook** installed (`.git/hooks/pre-commit`) — runs `check-imports.mjs` on every commit. Note: this is local only (`.git/hooks/` is not tracked). Other devs need to set it up manually.

## Impact
- Root directory: ~400 loose files → clean
- Net tracked lines removed: ~15,000
- Scripts directory: organized into 16 subdirectories, zero loose files
- One silently broken page (/analytics) fixed
