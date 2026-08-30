# Artwork provenance backfill — issue #3838 delivered end-to-end

**Sessions 2026-08-09 → 2026-08-10.** Structured `source_ids` coverage went from
627 docs (2.5%) to **24,010 / 24,819 (96.7%)**, with the 591 pointer-less residue
marked `source_unrecoverable: true` (99.1% accounted for). All PRs merged, all
writes verified in Mongo, UI change verified in prod HTML.

## What shipped (all merged)

- **#3849** `backfill-commons-source-ids.mjs` — item 1: 11,239 true-Commons docs
  got `source_ids.commons` (canonical post-redirect File: title) + full
  `commons_sha1` coverage. Batched 50 titles/request → zero 429s.
- **#3856** `backfill-provider-source-ids.mjs` — Met objectIDs (289) +
  Rijksmuseum object numbers (1,868) extracted from the museums' own URLs
  hiding in `commons_url`/`source_url`.
- **#3864** — item 4 bulk: the "10,188 no-signal" docs were 93% recoverable via
  `commons_page_title`/`commons_full_url`; 9,457 written, canonical
  `commons_url` added where missing.
- **#3868** — Rijksmuseum fetcher (keyless Linked Art chain: objectNumber
  search → object → VisualItem → DigitalObject → iiif.micr.io) and NGA fetcher
  (opendata `published_images.csv` via `--nga-images-csv`) wired into
  `artwork-image-integrity.mjs` (`--rijks-sample`, default 100); NGA matcher
  (`backfill-nga-source-ids.mjs`, 390/590 strict matches); identifier lanes
  (94 Met Egyptian-art + 47 Rijksmuseum KOG from `image_source.identifier`);
  591 marked `source_unrecoverable` (detector shows `unrecoverable-marked`).
- **#3873** — UI: artwork page Source button + Digital Source row fall back
  `commons_url` → `source_url` → museum-record URL from `source_ids`.
  Verified live on an NGA page and a URL-less Rijksmuseum page.

## Key findings (recorded on the issue)

- **commons_sha1 ≠ the file the doc points at, for 440 docs**: the image-upgrade
  path (`image_upgrade_source: "Commons alternate"`) re-points `commons_title`
  without refreshing `commons_sha1`/`commons_url`. 362/367 "sha1 divergences"
  were this, not wrong images. Never use sha1 equality inside that set without
  first checking title/url agreement (affects dedup #3037 + item-5 sweep).
- **2 new confirmed wrong-image records** (smoke test): `69dfe0046a68cb6a2e358396`
  (cleveland, dist 24), `2c2840822ab4a93692ad6529` (met, dist 17) → repair queue
  (`repair-artwork-images.mjs`).
- **Met API 403s after ~60 rapid requests** at the audit's concurrency 4/250ms —
  the Met section needs its own throttle before an exhaustive sweep is
  trustworthy.
- NGA ambiguities (195) are two-impression pairs — disambiguate by dHash against
  each candidate's IIIF image (report:
  `scripts/output/nga-source-ids-backfill-2026-08-10.json`).

## Open follow-ups (all listed on #3838, which stays OPEN)

1. Met-section throttle, then the full item-5 corpus sweep
   (`--nga-images-csv` needs the opendata CSVs; copies were in the scratchpad,
   re-download from github.com/NationalGalleryOfArt/opendata).
2. The 2 repair-queue mismatches above.
3. dHash-disambiguation of the 195 NGA pairs; dHash-verify-then-refresh of the
   440 stale-sha1 docs (never refresh unverified).
4. Manual click-check of one NGA link (nga.gov blocks curl; pattern is Wikidata
   P4683's formatter): https://www.nga.gov/collection/art-object-page.11.html —
   if 404, swap the pattern in `museumRecordLink` (ArtworkInfo.tsx).

## Reports (local, untracked, in `scripts/output/`)

`commons-source-ids-backfill-2026-08-{09,10}.json`, `sha1-divergent-triage`,
`sha1-history-check`, `provider-source-ids-backfill-2026-08-{09,10}.json`,
`nga-source-ids-backfill-2026-08-10.json`, `artwork-image-integrity-2026-08-10.json`.
