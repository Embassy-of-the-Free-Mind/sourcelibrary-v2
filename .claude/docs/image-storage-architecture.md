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

### Time-bucketing throughput

Both workers stamp `book.archive_completed_at` (a `Date`) when the book reaches `archive_status: 'archive_complete'`. Use that for throughput queries instead of scanning the `pages` collection (the page-level approach reliably times out on Atlas):

```js
// Books fully archived in the past 7 days
db.books.countDocuments({ archive_completed_at: { $gte: new Date(Date.now() - 7*864e5) } })

// Per-day bucket
db.books.aggregate([
  { $match: { archive_completed_at: { $gte: new Date(Date.now() - 7*864e5) } } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$archive_completed_at' } },
              books: { $sum: 1 }, pages: { $sum: '$pages_count' } } },
  { $sort: { _id: 1 } },
])
```

Note: this field was added 2026-05-16, so books archived before that date won't have it — fall back to `updated_at` as a coarse proxy for older entries.

## Worker Health Monitoring

`archive-bulk` and `archive-ocr` are running on a 10-min and 30-min cadence respectively, but they can silently degrade — a small bug in URL construction or a missing User-Agent can cause every fetch to fail with no visible error to the operator. They also keep running and looking healthy in `ps` while archiving nothing.

**Each run writes a summary to `cron_runs`** with `actions.archived`, `actions.failed`, and per-domain stats. Check it routinely:

```js
// Average pages archived per run, past 24h
db.cron_runs.aggregate([
  { $match: { cron: { $in: ['archive-bulk', 'archive-ocr'] },
              timestamp: { $gte: new Date(Date.now() - 864e5) } } },
  { $group: { _id: '$cron', runs: { $sum: 1 },
              avgArchived: { $avg: '$actions.archived' },
              avgFailed:   { $avg: '$actions.failed' } } },
])
```

**Red flags:**
- `archive-ocr` averaging <50 pages archived per run over a day → almost certainly a per-domain breakage; check `/var/log/sourcelibrary/archive-ocr.log` for the HTTP status pattern by domain (`Per-domain: …`)
- `archive-bulk` averaging 0 archived but high `Done in N s` → JP2 download chain (`opj_decompress`, `unzip`) is broken, look at the per-book `[ERROR]` lines
- Both workers reporting 0 candidates → the book query filter no longer matches new imports (we hit this when provider value changed from `ia` to `internet_archive`)

**Per-domain failure modes** (lessons learned, mostly the hard way):

| Source | Hostname | Gotcha | Reference |
|--------|----------|--------|-----------|
| Internet Archive | `archive.org` | Some items are `access-restricted-item: true` (borrow-only) — every page returns 403. The import route now records this in `catalog_metadata.access_restricted`; honour it. | PR #1794 |
| MDZ (BSB) | `digitale-sammlungen.de` | URL pattern drift — old `bsbXXXXX/image_{N}` paths 404 after MDZ migrations. Worker hits the circuit breaker after 5 consecutive 404s. | _open_ |
| NDL Japan | `dl.ndl.go.jp` | IIIF tile requests with the wrong `region` segment get HTTP 500 (not 400). Worker also tripping circuit breaker. | _open_ |
| e-rara | `e-rara.ch` | (1) Blocks Hetzner IP entirely — needs the dedicated `archive-erara.mjs` on a Mac. (2) Rejects bare-`fetch` with no User-Agent (403). | PR #1800 |
| Vatican | `digi.vatlib.it` | robots.txt requires 10s crawl-delay — rate limit set to 0.1/s. Archiving a Vatican manuscript takes hours, not minutes. | — |
| Qatar Digital Library | `iiif.qdl.qa` | Blocks all automated access regardless of headers. Use manual PDF download + `/api/import/pdf` route. | curator skill |
| Gallica | `gallica.bnf.fr` | 429 above 2 req/s — was getting throttled at 4/s. | — |

When adding a new provider to the curator's import targets, run a sanity-check archive of one book end-to-end before bulk-importing N hundred — that catches most per-provider gotchas at the cost of one round-trip.

## See Also

- [R2 Storage](./r2-storage.md) — the bucket layout, URL patterns, the CDN in front of it
- [Curator Reference](./curator-reference.md) — adding a new source to the import surface
- Hetzner crontab — `ssh root@46.224.122.120 crontab -l` for the live scheduler entries (the unified scheduler at `scripts/workers/scheduler.mjs` orchestrates most archive timing)
