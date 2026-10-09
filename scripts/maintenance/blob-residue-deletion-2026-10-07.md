# Vercel Blob residue deletion — summary (2026-10-07)

PRIOR ART: none — searched `git grep -i "blob residue"`; the gate (`verify-blob-residue-in-r2.mjs`) and #3645 carry the method, not a record of what was deleted.

Snapshot, not doctrine. Issue #3645 (finding 3), approved by Derek 2026-10-06 ("remove the blob"). Tools in this directory: `repoint-blob-url-pages.mjs` and `delete-verified-blob-residue.mjs` (#6045).

## Store `sourcelibrary-v2-blob` (Vercel `/v1/storage/stores`)

| | GB | objects |
|---|---|---|
| before (2026-10-06) | 2,882.85 | 5,432,915 |
| after (2026-10-07) | 538.06 | 1,194,343 |

## Deleted: 4,237,181 objects / 2,346.9 GB

Each was re-checked at delete time: Blob ETag (= content MD5) equal to the R2 single-part ETag, and Content-Length equal on both sides.

| prefix | deleted | not deleted: still referenced | not deleted: refused |
|---|---|---|---|
| archived/ | 1,502,489 | 103 | 236 size-differs (R2 re-archived larger after the listing) |
| uploads/ | 182,879 | 1,280 | 0 |
| cropped/ | 401,788 | 105 | 0 |
| gallery/ | 155,190 | 88 | 40 md5-differs |
| thumbnails/ | 1,994,168 | 1,610 | 0 |
| books/ | 1,647 | 2 | 0 |
| blog/ | 20 | 0 | 0 |

**Ledger.** One line per object: `blob_key  r2_key  md5  bytes  time`. It lives on the Hetzner box at `/mnt/HC_Volume_105839809/cold-tier-5989/blob-residue-ledger-2026-10.tsv.gz`, 129 MB, sha256 `8b90c829d4b5e6cb54d10b957b28c101eb093d33f42255fce73699f944455a9c`. It is too large for this public repo. The ledger file holds 1,000 duplicate lines from a test run, so the unique count above is the authoritative one.

## Repointed before deleting
- 79 page docs still stored a Blob URL: 57 `archived_photo`, plus 22 split pages with `cropped_photo` and thumb fields. All were repointed to R2, and 17 objects were copied with the ETag verified.
- An exact rescan afterwards found 0 such pages.

## Kept, pending a decision (#3645)

**49,443 keys referenced by a Mongo doc.** These are in `collections` (528 refs), `gallery_images`, `deleted_books` (43,645), `duplicate_pages`, and changelogs. Nothing was written to those collections; the keys were excluded from deletion instead.

**1,192,267 objects that are Blob-only by key, or size-mismatched.** Their Blob MD5s were matched against every R2 ETag (69.4M objects):
- 587,957 (~282 GB) exist in R2 byte-identical under another key.
- **604,310 (253.6 GB) exist nowhere in R2.** The largest groups:
  - deleted books' pages: 157,520 / 166 GB
  - R2 holds a different object: 128,582 / 33.6 GB, of which 1,422 have the R2 copy *smaller*
  - pages past `pages_count`: 18,497 / 24.8 GB
  - `uploads/` of live books: 10,812 / 12.4 GB
  - `gallery/`: ~123K / ~11.5 GB

## What the run taught
- **Gates.** The R2-key gate cannot see a page doc that still holds a Blob URL. Only a doc-side scan can, and it found 79.
- **Accept-Encoding.** Node `fetch` sends `Accept-Encoding: br`. The Blob CDN then brotli-encodes `application/octet-stream` objects, so the response has no Content-Length and a weak ETag. HEAD with `identity`.
- **Rate limit.** `del()` is limited per store to about 4–5K objects/min, whatever the chunk size. Run one runner.
- **Public image host.** `images.sourcelibrary.org` re-encodes on GET, so prove stored bytes by the S3 ETag, never by the CDN body.
- **R2 changes underneath you.** It was re-archived during the run: 236 objects grew after the listing. A per-object re-check at delete time is what caught it.
