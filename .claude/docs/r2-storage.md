# R2 Storage Organization

**Bucket:** `sourcelibrary` (Cloudflare R2, WEUR region)
**Public URL:** `https://images.sourcelibrary.org`
**DNS:** Cloudflare (custom domain, SSL)

## TL;DR

The library has accumulated **six URL conventions** across different eras and import scripts. The canonical convention is `pages/{bookId}/{NNNN}` with three variants — but only ~7% of pages live there today. The other 93% are scattered across legacy paths that are still actively read. Reader code (`src/lib/utils.ts:91-124`) papers over much of it via URL rewrites, but the rewrites are aspirational: when the canonical file doesn't actually exist on R2 the rewrite produces a 404.

**Current coverage** (measured 2026-05-28 via `/admin/r2-coverage`):
- 94.0% of pages have an R2 URL stored in `archived_photo` (record-level coverage).
- 80.3% have the display `.jpg` variant actually serving content on R2 (file-level).
- 80.3% have the `-thumb.jpg` variant.
- 79.7% have full-res (counting both `/pages/-full.jpg` AND `/archived/<N>.jpg`).

**The ~20% gap** is the user-visible broken-icon problem — most of it concentrated in mdz (162K pages), harvard (108K), and gallica (32K).

## Active path conventions, by frequency

Sampled from a 100K-page snapshot of `pages.archived_photo`:

| Pattern | Share | Where it comes from |
|---|---|---|
| `archived/{bookId}/{N}.jpg` | 77.4% | Pre-`pagePaths()` archiver. Unpadded `N`, no `-full` suffix. The dominant pattern in the corpus. Still actively read; reader code at `src/lib/utils.ts:101` rewrites it to `pages/{bookId}/{NNNN}.jpg` for display. |
| `pages/{bookId}/{NNNN}-full.jpg` | 6.8% | Canonical `pagePaths(...).full`. Used by new pipeline writers — uploads (`src/lib/uploads/processing.ts`), split pages (`src/lib/page-split/split-processing.ts`), the resize worker (`scripts/workers/resize-worker.mjs`), BPH split worker, and bulk-import scripts. |
| `books/{bookId}/pages/{NNNN}.jpg` | 1.8% | Used by **kloss, IDP, CCAG, and PDF imports**. Writers: `scripts/import/import-kloss-collection.mjs`, `scripts/import/import-idp-batch.mjs`, `scripts/import/ccag-vii-pdf-direct.mjs`, `src/app/api/import/pdf/route.ts`. Single high-res file per page — NO display or thumb variants generated. |
| `cropped/{bookId}/{objectId}.jpg` | (subset of "other", ~11%) | Split-page crops with ObjectId filenames. |
| `uploads/{bookId}/{objectId}.jpg` | (subset of "other") | Raw user uploads with ObjectId filenames. |
| `thumbnails/{bookId}/{N}.jpg` | <0.1% | Oldest pattern. Reader rewrites to `pages/.../-thumb.jpg`. |
| `pages/{bookId}/sp{NNNN}.jpg`, `spdm{N}-{NNNN}.jpg` etc. | (BPH-specific) | BPH split-page outputs use prefixes like `sp0001.jpg`, `spdm61-0001.jpg`. Same `pages/` prefix, different filename shape. |

### Other prefixes

```
gallery/{bookId}/{imageId}.jpg          Extracted illustration, display size
gallery/{bookId}/{imageId}-full.jpg     Extracted illustration, full-res
gallery/{bookId}/{imageId}-thumb.jpg    Extracted illustration, 300px thumbnail
covers/{bookId}.jpg                     Book cover image
artwork/{slug}.jpg, -thumb, -full       Visual art wing — follows pagePaths-style variants
video/hero-bg.webm, .mp4, hero-poster.jpg   Homepage hero
assets/...                              Partner logos
book-thumbnails/{bookId}.jpg            Old book cover path (legacy)
_test/...                               Test files, safe to delete
```

## Reader behavior — rewrites are aspirational

`src/lib/utils.ts:91-124` rewrites legacy paths to canonical form at read time:
- `thumbnails/{bookId}/{num}.jpg` → `pages/{bookId}/{NNNN}.jpg` (or `-thumb.jpg`)
- `archived/{bookId}/{num}.jpg` → `pages/{bookId}/{NNNN}.jpg` (or `-thumb.jpg`)
- `pages/{bookId}/{NNNN}-full.jpg` ↔ `pages/{bookId}/{NNNN}.jpg` ↔ `-thumb.jpg`

**The rewrite assumes the target file exists.** For unmigrated books the rewrite produces a URL that 404s. That's the root cause of broken-icon reports for legacy books — the page record has `archived_photo: ".../archived/<id>/1.jpg"` (which exists), the reader rewrites that to `.../pages/<id>/0001-thumb.jpg` (which doesn't), and the user sees a broken icon. Component-level fallbacks catch some cases (BookCard swaps to a working URL), but not all.

The `books/{bookId}/pages/...` and BPH `sp*` patterns are **not** rewritten — readers consume those URLs directly. Kloss/IDP/CCAG books therefore have no display or thumb variant available unless one is generated separately.

## Coverage truth — the variant-coverage dashboard

`/admin/r2-coverage` (powered by `scripts/workers/r2-coverage-snapshot.mjs`) measures both:
1. **Record-level** — `archived_photo` points at any R2 URL (94.0%).
2. **Variant-level** — HEAD-probes the canonical `pages/<id>/<NNNN>{.jpg,-thumb.jpg,-full.jpg}` AND the legacy `archived/<id>/<N>.jpg`, samples N pages per book. Tells you whether the file actually exists at the URL we'd expect for the display/thumb/full reader paths.

**Known blind spots:** the variant probe only checks `pages/` and `archived/` patterns. Books whose images live exclusively at `books/<id>/pages/...` (kloss/IDP/CCAG) or BPH-prefix paths (`sp*`) get flagged as missing variants even though they're readable. So **the dashboard's 80.3% display number is biased downward** — true reader-visible coverage is somewhat higher.

## Path Helpers — the canonical convention for NEW writes

All paths are generated by helpers in `src/lib/storage.ts`:

```typescript
import { pagePaths, galleryPaths, coverPath, r2Url } from '@/lib/storage';

pagePaths('abc123', 5)
// → { full: 'pages/abc123/0005-full.jpg',
//      display: 'pages/abc123/0005.jpg',
//      thumb: 'pages/abc123/0005-thumb.jpg' }

galleryPaths('abc123', 'img-001')
// → { full: 'gallery/abc123/img-001-full.jpg', ... }

coverPath('abc123')
// → 'covers/abc123.jpg'

r2Url('pages/abc123/0005.jpg')
// → 'https://images.sourcelibrary.org/pages/abc123/0005.jpg'
```

**Rule for new writers: use `pagePaths()`.** Don't add a seventh URL convention. If you're modifying `scripts/import/import-kloss-collection.mjs`, `scripts/import/import-idp-batch.mjs`, `scripts/import/ccag-vii-pdf-direct.mjs`, or `src/app/api/import/pdf/route.ts`, those are the four writers currently emitting `books/{bookId}/pages/...` — convert them to `pagePaths()` if you touch them.

## Path Helpers

All paths are generated by helpers in `src/lib/storage.ts`:

```typescript
import { pagePaths, galleryPaths, coverPath, r2Url } from '@/lib/storage';

pagePaths('abc123', 5)
// → { full: 'pages/abc123/0005-full.jpg',
//      display: 'pages/abc123/0005.jpg',
//      thumb: 'pages/abc123/0005-thumb.jpg' }

galleryPaths('abc123', 'img-001')
// → { full: 'gallery/abc123/img-001-full.jpg', ... }

coverPath('abc123')
// → 'covers/abc123.jpg'

r2Url('pages/abc123/0005.jpg')
// → 'https://images.sourcelibrary.org/pages/abc123/0005.jpg'
```

## Image Size Pipeline

1. **Import/archive** uploads full-res to `{0001}-full.jpg`
2. **Thumbnail** generated at import time → `{0001}-thumb.jpg`
3. **Resize worker** (Hetzner, every 30 min) generates display size → `{0001}.jpg`

## MongoDB Field Mapping

### New convention (pages with `photo` matching `images.sourcelibrary.org/pages/`)

Only 2 fields needed — other sizes derived from URL:
- `photo` → `pages/{bookId}/{0001}-full.jpg` (or display size when available)
- `thumbnail` → `pages/{bookId}/{0001}-thumb.jpg`

### Legacy (everything else)

App resolves via fallback chain: `cropped_photo → archived_photo → photo_original → photo`

## Cache Headers

- Page images: `Cache-Control: public, max-age=86400, s-maxage=86400` (24h)
- Static assets (video, logos): `Cache-Control: public, max-age=31536000, immutable` (1 year)

## Credentials

```
R2_ACCOUNT_ID        → .env.production.local + Vercel env
R2_ACCESS_KEY_ID     → .env.production.local + Vercel env
R2_SECRET_ACCESS_KEY → .env.production.local + Vercel env
R2_BUCKET_NAME       → sourcelibrary
R2_PUBLIC_URL        → https://images.sourcelibrary.org
```

## Key Files

- `src/lib/storage.ts` — storagePut(), path helpers, R2 client
- `scripts/workers/resize-worker.mjs` — display-size generation (Hetzner cron)
- `scripts/maintenance/repoint-blob-to-r2-fast.mjs` — bulk pointer migration
- `scripts/maintenance/migrate-blob-stragglers.mjs` — file transfer for stragglers
- `scripts/migration/bulk-import-to-r2.mjs` — BPH bulk import
