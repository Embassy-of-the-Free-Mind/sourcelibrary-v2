# R2 storage reclamation (issue #3005)

Measurement + execution tooling for the four reclamation passes on the
`sourcelibrary` R2 bucket (16.5 TB, ~46.7M objects). **All measurement is
read-only** — it LISTs the bucket (Size + ETag come back on every
`ListObjectsV2` Content, so we never HEAD per object) and writes NDJSON
manifests + a JSON summary to `scripts/output/r2-reclaim/`. Deletion is a
separate, sign-off-gated step and is **not** implemented here.

```
set -a; source .env.production.local; set +a
node scripts/maintenance/r2-reclaim/measure-pages-archived.mjs   # Pass 1 + Pass 2
node scripts/maintenance/r2-reclaim/measure-jp2-orphans.mjs      # Pass 3
node scripts/maintenance/r2-reclaim/measure-stale-crops.mjs      # Pass 4
node scripts/maintenance/r2-reclaim/enrich-full-dup-pointers.mjs # Pass 2 decision enrichment
node scripts/maintenance/r2-reclaim/regen-display-bloat.mjs --dry-run  # Pass 1 execution
```

## The identity join is the whole game — read this first

R2 folders are keyed by the book's **string `id`** (`books.id`, ==
`pages.book_id`), **not** the Mongo `_id`. Page `_id` and `id` are themselves
stored as strings and differ from each other; crop filenames are the page's
**`id`**. Any existence check that wraps the folder id in `new ObjectId(...)`
and matches `_id` silently finds nothing and flags live books/pages as orphans.

This bug was baked into the original sampling probes behind #3005's estimates,
which is why they were wildly high:

| Pass | #3005 sampled estimate | Measured (full crawl, correct join) |
|---|---|---|
| 3 — `archive/` JP2 orphans | ~150–190 GB | **0 GB** — all 2,142 dirs are live books |
| 4 — `cropped/` stale | ~20% of files | **~3.4%** (a first buggy run showed a false 75%) |
| 2 — `pages/-full` vs `archived/` dup | ~0.5–1 TB | far smaller — ~58K pairs; see summary for bytes |
| 1 — display never downsized | ~1–1.5 TB | the real prize — 2.8M+ candidates, ~TB reclaim |

`lib.mjs :: loadLiveBookIds()` is the shared, correct join (string ids from
`books` ∪ `deleted_books` ∪ `failed_imports`). Never re-introduce an
ObjectId-keyed existence check against these R2 folder ids.

## Passes

- **Pass 1 — display bloat** (`measure-pages-archived.mjs`). A
  `pages/{id}/{NNNN}.jpg` display whose size is ≥90% of its master (`-full` if
  present, else `archived/{id}/{N}.jpg`) was never downsized. Manifest =
  **regeneration** candidates (not deletes). Executed by
  `regen-display-bloat.mjs`, which force-overwrites the bloated display with a
  true 1200px variant via the shared `generateDisplayVariants()`, resolving the
  source with `getPageSource()` and **skipping old-era split pages**
  (`cropped_photo` set) — the #1814 footgun. The master is untouched, so the
  pass is reversible.
- **Pass 2 — full-res duplicates** (same crawl). `pages/{id}/{NNNN}-full.jpg`
  and `archived/{id}/{N}.jpg` with equal ETag (or size within 2%) are
  byte-identical. Which copy is redundant is **per-page** — it depends on which
  key the reader's pointer resolves through (`getPageSource`). Run
  `enrich-full-dup-pointers.mjs` to attach that decision before any delete.
- **Pass 3 — JP2 orphans** (`measure-jp2-orphans.mjs`). `archive/{id}/` dirs
  whose id is in no live-book collection. Measured empty.
- **Pass 4 — stale crops** (`measure-stale-crops.mjs`). `cropped/{id}/{oid}.jpg`
  whose page `id` (the filename) is absent from `pages`. Delete manifest is the
  absent-from-`pages` set only; "page alive but unreferenced" is reported
  separately for a second decision.

## Efficiency notes

- Pass 1/2 does a streaming **merge-join** of `pages/` and `archived/` by bookId
  (both prefixes share id-space and lexicographic order), sharded into 4096
  three-hex-char bookId prefixes through a concurrency pool (`SHARD_CONCURRENCY`,
  default 24) — the ObjectId cluster (`6xx-`) balances across 256 sub-buckets.
  Constant memory (one book at a time). `ONLY_SHARDS=6a0,6a1` restricts for
  smoke tests.
- `pages/` + `archived/` hold ~11M+ / ~9M objects; the remaining ~26M bucket
  objects live in other prefixes (gallery/, thumbnails/, covers/, uploads/, …)
  outside these four passes.

## Ground rules (from the issue)

Every delete pass: dry-run with counts/bytes → explicit sign-off (the
`sourcelibrary` no-batch-delete rule) → delete with a manifest logged for audit.
Re-run `scripts/storage-stats.mjs` before/after to measure actual reclaim.
