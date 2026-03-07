# Thumbnails & Cover Selection

## Overview

Every book has a `thumbnail` field (URL) used as its cover image across the site — library cards, book detail pages, collection grids, OG images, and search results. The system has four layers of cover selection, from initial import through AI-driven upgrades.

## Book-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `thumbnail` | string | Current cover URL (http/https only — never relative paths) |
| `thumbnail_blob` | string | Pre-generated 150px JPEG on Vercel Blob (fast CDN fallback) |
| `thumbnail_source` | string | How the cover was selected: `auto`, `auto_upgrade`, `manual` |

**Critical rule:** `thumbnail` must always be a direct `http(s)` URL. Never store `/api/image?url=...` proxy wrapper URLs — they crash Next.js `<Image>` during SSR. The `/api/image` route is for client-side rendering only.

---

## Cover Selection Pipeline

### Stage 1: Import (automatic)

All 13 import routes set `thumbnail` to page 1's image URL at import time:
```
book.thumbnail = getThumbnailUrl(0)  // page index 0 = page 1
```

This is always the first page of the digitized book — often a blank endpaper, bookplate, ex libris stamp, or library cover page. Rarely the best choice, but always available.

**No `thumbnail_source` is set at import.** The field is `undefined` at this stage.

### Stage 2: Split Detection Fix (pipeline Phase 1)

**Function:** `fixStaleThumbnail()` in `post-import-pipeline` cron (line 103)
**Trigger:** Book transitions to `archive_complete` state
**Condition:** Only runs if `thumbnail` contains `/uploads/` (unsplit original URL)

After split detection, pages get `cropped_photo` URLs but the book thumbnail may still point to the old unsplit image. This function upgrades it.

**Priority order:**
1. Title-page (any page with `page_type: 'title-page'` and `cropped_photo`)
2. Frontispiece (any page with `page_type: 'frontispiece'` and `cropped_photo`)
3. First non-blank page with `cropped_photo`
4. Any page with `cropped_photo`

**Limitation:** At this pipeline stage, most books don't have `page_type` data yet (that comes from OCR). So priorities 1-2 usually miss, and it falls through to priority 3 — which is still page 1 most of the time.

**Skips:** Books with `thumbnail_source: 'manual'`.

### Stage 3: Post-OCR Upgrade (pipeline Phase 3)

**Function:** `upgradeThumbnailFromPageType()` in `post-import-pipeline` cron (line 157)
**Trigger:** Book transitions from `ocr_submitted` to `ocr_complete`
**Condition:** Current thumbnail is NOT already a frontispiece or title-page

This is the key upgrade step. After OCR, every page has a `page_type` classification from Gemini vision. The function uses this metadata to find the most visually appropriate cover.

**Priority order:**
1. **Frontispiece** — within first 50 pages (ornate illustration facing the title page)
2. **Title-page** — within first 30 pages (the actual title page of the book)
3. **Illustration** — within first 20 pages (decorative image near the start)

**Image URL fallback chain:** `cropped_photo` → `archived_photo` → `photo` → `photo_original`

Sets `thumbnail_source: 'auto'` on upgrade.

**Skips:** Books with `thumbnail_source: 'manual'`, or current thumbnail already on a frontispiece/title-page.

### Stage 4: Manual Override (admin UI)

**Component:** `CoverImagePicker` in `src/components/book/CoverImagePicker.tsx`
**Who:** Admin users on the book detail page

Click any page thumbnail to set it as the book's cover. Sets `thumbnail_source: 'manual'`, which prevents all automatic upgrades from overwriting it.

**URL priority for manual picks:** `thumbnail_blob` → `cropped_photo` → `archived_photo` → `photo`

---

## What Works Well

1. **Post-OCR upgrade (Stage 3) is effective.** For books with current OCR (v5+ prompt), `page_type` classification is reliable. Frontispieces and title pages are consistently identified. The priority order (frontispiece > title-page > illustration) matches what looks best as a cover.

2. **Manual override is respected everywhere.** `thumbnail_source: 'manual'` is checked by both automatic upgrade functions. Once an admin picks a cover, it sticks.

3. **Image URL fallback chain is robust.** `cropped_photo` → `archived_photo` → `photo` → `photo_original` handles all stages of the archiving pipeline gracefully.

4. **Split detection + cropping improves covers.** Books with two-page spreads get their pages cropped, so covers show a single clean page instead of a distorted spread.

---

## Known Challenges

### 1. Books with Old OCR Lack `page_type`

**Impact:** ~66 books (as of Mar 2026) have OCR but no `page_type` field on any page.
**Cause:** OCR'd before prompt v4 (late Jan 2026), which didn't include `<page-type>` classification.
**Result:** Stage 3 upgrade can't find frontispiece/title-page pages. These books keep their page-1 cover.
**Fix:** Self-corrects when books are re-OCR'd with current prompts. All 7 OCR save paths extract and persist `page_type`.

### 2. Initial Cover is Always Page 1

**Impact:** Every newly imported book starts with page 1 as its cover — often a blank endpaper, bookplate, ex libris stamp, or library scanner page.
**Duration:** This persists until OCR completes (hours to days in the pipeline). Books displayed before OCR show the bad cover.
**Mitigation:** Could add a heuristic at import time (e.g., skip first few pages if they're very dark/light), but not yet implemented.

### 3. Stage 2 Rarely Helps

**Impact:** `fixStaleThumbnail()` only triggers for `/uploads/` URLs and runs before OCR, so `page_type` data isn't available. It mostly just picks the first non-blank page.
**Note:** This function was designed to fix a specific bug (stale unsplit URLs), not to be a general cover selector. It works for its intended purpose.

### 4. Ex Libris / Bookplate Pages

**Impact:** Some books have ex libris stamps, ownership inscriptions, or library bookplates on pages classified as `text` or unclassified. These aren't caught by the `page_type` priority system.
**Scale:** Minor — only ~36 books had genuinely bad covers with better alternatives available (fixed via `_tmp-check-covers.mjs`, Mar 2026).
**Future:** Could add `ex_libris` or `bookplate` as a page_type to the OCR prompt, then exclude those from cover selection.

### 5. Gallery Quality Not Used for Covers

**Impact:** Image extraction assigns gallery quality scores (0-1.0) to detected illustrations, but cover selection doesn't consider these scores.
**Opportunity:** A frontispiece with quality 0.3 (faded, damaged) might be a worse cover than a high-quality illustration on page 15. Currently not factored in.

### 6. No Cover Selection for Books Without Frontispiece/Title-Page

**Impact:** Some books genuinely don't have a frontispiece or decorative title page (e.g., manuscripts, modern reprints). Stage 3 falls through to "no upgrade" and keeps page 1.
**Mitigation:** Could fall back to the highest-quality illustration from image extraction, but this runs later in the pipeline.

---

## Collection Hero Images

Collections on the homepage use `featured_images` from the `collections` MongoDB collection.

### Format Inconsistency (Fixed Mar 2026)

Most collections store `featured_images` as arrays of objects:
```json
{ "page_id": "...", "book_id": "...", "image_url": "...", "extracted_url": "...", "_id": "..." }
```

SHWEP stored them as plain URL strings. Fixed in DB (converted to objects) and added defensive handling in `src/app/page.tsx` to support both formats:
```typescript
const hero = images.find(
  (img: unknown) => typeof img === 'string' || (img && typeof img === 'object' && ...)
);
```

### Hero Image Priority

For collection cards: `extracted_url` → `image_url` → `thumbnail_url` (for objects), or the string directly.

### Blurry Collection Thumbnails (Fixed Mar 2026)

Collection cards were using low-res `thumbnail_url` (200px) instead of `extracted_url` (full-res cropped illustration). Fixed priority order to prefer `extracted_url` first. Added `fetchPriority="high"` for above-fold featured collections.

---

## Key Code Locations

| What | Where |
|------|-------|
| Import thumbnail (page 1) | `src/app/api/import/*/route.ts` — `thumbnail: getThumbnailUrl(0)` |
| Stale unsplit fix | `src/app/api/cron/post-import-pipeline/route.ts:103` — `fixStaleThumbnail()` |
| Post-OCR upgrade | `src/app/api/cron/post-import-pipeline/route.ts:157` — `upgradeThumbnailFromPageType()` |
| Manual cover picker | `src/components/book/CoverImagePicker.tsx` |
| Collection hero images | `src/app/page.tsx` — `getFeaturedCollections()`, `getRemainingCollections()` |
| Page thumbnail display | `src/components/reader/PageThumbnail.tsx` |
| Book card display | `src/components/book/BookCard.tsx` |

## Ad-Hoc Fix Scripts

| Script | Purpose | Result |
|--------|---------|--------|
| `_tmp-check-covers.mjs` | Find books with bad covers (text/diagram pages when frontispiece exists) | Fixed 36 books (Mar 2026) |
| `_tmp-fix-thumbnails.mjs` | Fix specific thumbnail URL issues | Various |
| `_tmp-fix-broken-thumbs.mjs` | Fix broken/404 thumbnail URLs | Various |
| `_tmp-gallery-cover-upgrade.mjs` | Upgrade covers using gallery image quality scores | Various |
