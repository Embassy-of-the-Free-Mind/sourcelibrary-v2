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
| `pages/{bookId}/{NNNN}-full.jpg` | 6.8% | Canonical `pagePaths(...).full`. Used by new pipeline writers — uploads (`src/lib/uploads/processing.ts`), split pages (`src/lib/page-split/split-processing.ts`), BPH split worker, and bulk-import scripts. |
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

## Full prefix inventory, classified by REPLACEABILITY (added 2026-08-18)

Everything above classifies paths by **convention and era** — which is what you need to serve a
page. It does not tell you the only thing that matters before deleting something: *could we get
this back?*

That gap is not cosmetic. Of the 41 top-level prefixes in the bucket, **this doc described 12**, and
the 29 it omitted included `archive/`, `masters/`, `page-masters/`, `manuscripts/`, `papyri/`,
`tablets/`, `source-pdfs/` and `imports/` — **every prefix whose name suggests it holds masters.**
The reason is structural and worth stating: a missing *display* variant is a broken image someone
reports within the hour, so serving paths get documented. A missing *master* breaks nothing visible,
so it never generates the pressure that produces documentation. The paths that fail silently are
exactly the ones that go unrecorded, and they are the ones you cannot re-create.

**The near-miss this prevents.** On 2026-08-18 `archive/` presented every signal of dead weight —
**zero** page documents referenced it across a 20,000-row sample, every object was written on a
single day (2026-04-27), and it sits beside the live `archived/` under a near-identical name. It is
**358,625 JPEG 2000 master scans from the BPH partner library**; 999 of 1,000 sampled folders are
live books, all `provider=bph`, and **none carries an `ia_identifier`**, so none can be re-fetched
from Internet Archive. Deleting it would have destroyed partner masters to save $71/year.

**Replaceability classes:**

- **M — master.** Irreplaceable, or replaceable only by re-acquiring from an institution. Never delete.
- **S — source.** Bulk imports/PDFs the corpus was built from. Delete only after proving the derived
  pages exist.
- **D — derived.** Recomputable from an M or S. Free to delete and regenerate.
- **E — editorial.** Hand-made site assets (hero images, brand, blog). Small; re-creating means a
  person redoing design work.
- **T — transient.** Test/prototype scratch.

| Prefix | Objects | Size | Class | Evidence |
|---|---|---|---|---|
| `archived/` | 12.4M+ | 9.9 TB+ | **M/D** | the 77% legacy page convention; holds originals *and* display variants at the same shape — **must be split before either is treated as deletable** |
| `uploads/` | 209,935 | 548 GB | **M** | raw user/import uploads, ObjectId filenames; last written 2026-06-02 |
| `archive/` | 358,625 | 396 GB | **M** | **verified** — BPH JP2 partner masters, no `ia_identifier` |
| `cropped/` | 400K+ | 188 GB+ | D | split-page crops, regenerable from the page master |
| `artwork/` | 194,662 | 145 GB | M/D | artwork wing; `-full` is master, `-thumb`/display derived |
| `gallery/` | 400K+ | 53 GB+ | D | extracted illustrations; regenerable from page masters |
| `books/` | 129,198 | 45 GB | **M** | kloss / IDP / CCAG / PDF imports — **single high-res file per page, NO variants**, so this IS the master |
| `page-masters/` | 2,914 | 5.9 GB | **M** | name and size (1.7 MB avg) — *inferred, not verified* |
| `enhanced/` | 7,973 | 6.5 GB | D | image-enhancement output — *inferred* |
| `deepzoom/` | 400K+ | 6.4 GB+ | D | tile pyramids, regenerable |
| `thumbnails/`, `book-thumbnails/` | 400K+ | 2.8 GB | D | oldest thumb conventions |
| `manuscripts/` | 2,414 | 1.3 GB | M? | *inferred — verify before touching* |
| `masters/` | 42 | 1.1 GB | **M** | 24 MB avg — *inferred* |
| `hero-mosaic/`, `hero/`, `heroes/`, `collection-*` | ~18.5K | 2 GB | E | editorial imagery |
| `podcasts/` | 36 | 0.3 GB | E/M | generated audio; expensive to re-create |
| `imports/`, `source-pdfs/`, `source-imports/` | 4 | 0.4 GB | **S** | bulk import archives |
| `papyri/`, `tablets/`, `bph-backups/` | 140 | ~0.2 GB | M? | *inferred — verify* |
| `blog/`, `brand/`, `assets/`, `email/` | ~50 | small | E | site assets, referenced from JSX |
| `prototype/`, `prototypes/`, `artwork-prototype/`, `exports/`, `_test/` | ~35 | tiny | T | scratch |

**Rows marked *inferred* were classified from prefix name, object size and write date only.** Do not
delete anything on the strength of an inferred row — verify the way `archive/` was verified: sample
the keys, resolve the book ids, and check whether the source is re-fetchable.

### Why not just rename the masters?

Tempting, and wrong at this scale. The canonical convention already encodes tier by **suffix**
(`-full` = master, bare = display, `-thumb`), so new writes are self-describing. Re-keying the
legacy 93% would mean ~54.6M copy+delete operations plus rewriting ~19.1M `pages` pointers — and a
mass re-key is precisely the operation that produced #3362, where a dropped `book_id` wrote every
book's pages to one shared key. Adding a seventh convention on top of six makes the reader's rewrite
chain worse before it makes it better.

Two cheaper mechanisms, with different jobs:

- **Object metadata** — additive, non-breaking, no key or DB change. `bake-provenance-mark.mjs`
  already proves it works at scale (it stamps `provenance: <version>` and uses it for idempotency).
  **Caveat that decides the design:** `ListObjectsV2` returns key, size, date and ETag — **not user
  metadata** — so a metadata-only scheme cannot be surveyed without a HEAD per object (54.6M requests).
  Good for labelling; useless for inventory.
- **A generated manifest** — the authoritative index, joining key → book → provider →
  replaceability → checksum. Surveyable and joinable. It must be **generated from the stores**, never
  hand-maintained, or it drifts into fiction.

**Enforcement for new writes belongs at the boundary that already exists.** `storagePut()` calls
`validateR2Key()` on every write; a known-prefix check there would stop a seventh convention being
born by accident — the same shape as the book-scoping guard, applied to tier.

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
- `scripts/migration/backfill-display-images.mjs` — split-aware display+thumb variant backfill (Hetzner cron; #1814, replaced the retired `resize-worker.mjs`)
- `scripts/maintenance/repoint-blob-to-r2-fast.mjs` — bulk pointer migration
- `scripts/maintenance/migrate-blob-stragglers.mjs` — file transfer for stragglers
- `scripts/migration/bulk-import-to-r2.mjs` — BPH bulk import
