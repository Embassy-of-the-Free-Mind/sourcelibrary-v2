# Image Storage Architecture

## Page Image Fields

Pages have two layers of image fields — **source-of-record** and **R2 copies**:

### Source-of-record (never overwritten by archiving)
| Field | Purpose |
|-------|---------|
| `photo` | Original source URL (IIIF, IA, Gallica, etc.) |
| `thumbnail` | Original thumbnail URL from source |
| `photo_original` | Original full-res URL from source |

These fields retain external URLs permanently, even after archiving. They document provenance.

**BPH split-page convention:** BPH split pages write R2 URLs directly into `photo` (e.g. `images.sourcelibrary.org/pages/{bookId}/...`) because the split pipeline creates new images — there is no external source URL. Audits that only check `archived_photo` will underreport BPH archive coverage by ~1,185 books, but the images are in R2.

### R2 copies (written by archive workers)
| Field | Purpose | R2 path pattern |
|-------|---------|-----------------|
| `archived_photo` | Full-res JPEG, capped 3000px max dim, q85 | `archived/{bookId}/{pageNumber}.jpg` |
| `display_photo` | 1200px display JPEG | `pages/{bookId}/{num}.jpg` |
| `thumbnail_blob` | 150px thumbnail | `pages/{bookId}/{num}-thumb.jpg` |

### Serving cascade (reading room)

`src/components/reader/BookOverview.tsx` picks the page URL in this order:

```
archived_photo  →  display_photo  →  photo_original  →  photo
```

Whenever an R2 copy exists, the reading room serves it. External URLs are the fallback. The implication: once `archived_photo` is set, the book serves from R2 even though `photo` still points to the external source — and that's the intended behavior, because `photo` is the source-of-record.

## Resolution & Quality

Constants in `archive-bulk.mjs`:
- `MAX_DIMENSION = 3000` — full-res JPEG is downscaled to 3000px on the longest edge (no upscaling, `withoutEnlargement: true`)
- `JPEG_QUALITY = 85` — sharp's libvips JPEG encoder
- PDF fallback (when no JP2 zip is available on IA): rendered at `pdftoppm -jpeg -r 200` (200 DPI) before the 3000px cap applies

Source-format strategy:
- **IA (`archive-bulk`):** prefer `_jp2.zip` (extract → `opj_decompress` → BMP → sharp → JPEG). Falls back to `Image Container PDF` if no JP2 zip exists.
- **Other providers (`archive-ocr`):** the URL is passed through `upgradeToFullRes()` before download. That helper bumps IIIF URLs to the full-res variant per provider (e.g. e-rara `full/1000,/` → `full/2000,/`; pct downsamples → `full/full`). See `archive-ocr.mjs` for the per-domain rules.

Display + thumbnail derivatives are generated from the same full-res buffer (single download, three uploads).

## Archive Workers

| Worker | File | Provider | In scheduler? | Runs where |
|--------|------|----------|---------------|------------|
| `archive-bulk.mjs` | `scripts/workers/` | Internet Archive only | Yes (Tier 4, 10 min) | Hetzner |
| `archive-ocr.mjs` | `scripts/workers/` | Everything except IA and e-rara | Yes (Tier 4, 30 min) | Hetzner |
| `archive-erara.mjs` | `scripts/workers/` | e-rara only | **No** | Mac (launchd) — e-rara blocks Hetzner IPs |
| `archive-gallica.mjs` | `scripts/workers/` | Gallica (BnF) | **No** | Manual |
| `archive-uva.mjs` | `scripts/workers/` | UvA/BPH IIIF | **No** | Manual |

### Book selection priority

All scheduled archive workers select unarchived books with this sort order:

```
0. is_first_translation = true       (top priority — protect uniqueness signal)
1. (everything else)
2. language ∈ ENGLISH_VARIANTS       (deprioritised — translations matter more)
                                        than additional English copies)
then: hidden = false first, then hidden books
```

This means hidden books still get archived, just behind visible ones. Inside each band the cron also honours `processing_priority` (desc) — see below.

### Operational lever: `processing_priority`

Setting `processing_priority` (0-100) on a book pushes it earlier inside its priority band. Two real uses:

- **Fresh imports:** `bncf-aldine-direct.mjs` stamps `processing_priority = 80` at insert so new books surface immediately to the archive crons instead of sitting behind the long-tail backlog.
- **Manual promotion:** a one-off `updateMany` on a topical batch (e.g. all Hernández volumes for entheogen research) bumps them to 95 to jump the queue.

To redrive a backlog, raising `processing_priority` is preferred over restarting workers.

## Two Import Paths (the "archive late" footgun)

The pipeline has two routes into the visible library, and they archive at very different times:

**Warehouse path** — `books_warehouse` → archive → `books`
- New book lands in `books_warehouse` with `pipeline_auto.status: 'queued'`
- Orchestrator moves it through `archiving` → `archive_complete`
- Only after `archive_complete` is the book promoted to `books`
- **Archive happens before the book is visible.** No "archive late" perception.

**Direct path** — `books` immediately, then cron archives
- Importer (e.g. `bncf-aldine-direct.mjs`, `al-badri-direct.mjs`, `ia-bundle-import.mjs`) inserts straight into `books` as `hidden: true, visible: false`
- Pages are written with external `photo` URLs only
- `archive-bulk`/`archive-ocr` cron discovers it on its next pass, sorted by the priority above
- Lag from import to `archived_photo` populated can be hours to days depending on backlog depth

Most batch imports use the direct path. If "archive happens late" matters for a given operation (e.g. you want to unhide right after import), either:
1. Route the import through `books_warehouse`, or
2. Set `processing_priority` high at import time (the new default — 80)

## Pipeline Phase Ordering

Per the orchestrator's status machine, the typical progression is:

```
import → ocr → translate → chapters → summary/index → quality_score → collections → archiving → archive_complete
```

But in practice the archive crons run independently of the orchestrator, so a book at `chapters_complete` is often already archived. The phase ordering describes the orchestrator's bookkeeping, not the wall-clock order — `archive_complete` is sometimes reached before `chapters_complete`.

## Unhide Criterion

A book is safe to unhide (`hidden: false, visible: true`) when:
1. `pages_archived ≥ pages_count` — every page exists in R2, so the reading room serves from R2 regardless of source URL health, AND
2. `pages_translated / pages_count ≥ 0.8` — enough translation density for the reading room to be useful

`status: 'draft'` is orthogonal — a book can be `draft` and still visible. The bulk-unhide query that matches this convention:

```js
db.collection('books').updateMany(
  {
    hidden: true,
    pages_count: { $gt: 5 },
    $expr: { $and: [
      { $gte: [ { $divide: ['$pages_translated', '$pages_count'] }, 0.8 ] },
      { $gte: [ '$pages_archived', '$pages_count' ] }
    ] }
  },
  { $set: { hidden: false, visible: true } }
);
```

A snapshot of pre-update state to `/root/unhide-snapshot-{timestamp}.json` is the standard precaution for any large unhide batch — single-command revert.

## Audit Implications

When auditing image storage:
- Don't count `photo` / `thumbnail` EXTERNAL URLs as "unarchived" — those are source-of-record
- Check `archived_photo` for actual R2 archiving status
- For BPH books, check if `photo` already points to `images.sourcelibrary.org` — if so, the image is in R2 regardless of `archived_photo` (the convention, not a gap)
- Subtract books that haven't reached the archiving pipeline phase yet — but remember the cron runs independently, so `pages_archived` is the only ground truth
