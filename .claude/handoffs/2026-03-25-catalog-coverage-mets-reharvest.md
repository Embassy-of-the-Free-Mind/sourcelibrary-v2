# Handoff: Catalog Coverage — METS Re-harvest & Backfills

**Date:** 2026-03-25
**Branch:** `feat/catalog-coverage-backfill-viewer-urls`
**PR:** https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/367

## What Was Done This Session

### 1. Backfills on import_candidates (1.08M records)
- **scan_quality**: 100% coverage. Source mapping: bsb/erara/sbb/hab/heidelberg/slub/goettingen/vatican='high', gallica/biblissima='medium', ia_microfilm='low'
- **author_surname**: 83.2% (901K/1.08M). Remaining 17% have no author or author="Unknown"
- Script: `scripts/catalog-coverage/_tmp-backfill-import-candidates.mjs` (temp, don't commit)

### 2. Full catalog_coverage Rebuild
- 1,565,796 USTC editions matched against 920K import_candidates
- Scan coverage: 329,036 (21.0%, up from 17.3%)
- Translation coverage: 110,501 (7.1%)
- In Source Library: 2,401
- 1,034,658 distinct works

### 3. Spot-Check Findings & Fixes
- **Ficino**: 66/136 editions have scans. Early incunabula correctly unscanned. Later editions match e-rara.
- **Erasmus**: 5,914 editions, 4,527 scanned (76%). Correct.
- **Luther**: Correctly matched to BSB/e-rara. 95 Theses present.
- **BSB manifest URLs**: Verified resolving (200 OK, application/json).
- **76K scanned editions had no manifest URL**: Root cause was Goettingen (39K), SLUB (35K), HAB (2.4K).

### 4. Goettingen IIIF Manifest Backfill
- Pattern: `https://manifests.sub.uni-goettingen.de/iiif/presentation/{ID}/manifest` — verified working
- Backfilled 40,296 manifest URLs on import_candidates
- Patched 22,221 into catalog_coverage (title + author/decade matching)
- Remaining ~17K Goettingen in catalog_coverage still need manifests (title mismatch between USTC and OAI)

### 5. SLUB/HAB Viewer URL Patches
- SLUB: 16,486 viewer URLs added to catalog_coverage (bot-check blocks automated access but works in browsers)
- HAB: 1,107 viewer URLs added (old PPN-based URLs are broken; slug-based from METS work)

### 6. Dashboard & API Updates (in PR)
- `viewer_url` field added as fallback when `iiif_manifest_url` is null
- Dashboard shows gold links for viewer-only, rust for IIIF
- API returns `viewer_url` in search results
- Build script carries `viewer_url` through from import_candidates

### 7. OAI Harvester Rewritten for METS (major)
Rewrote `scripts/catalog-coverage/harvest-oai-libraries.mjs` from oai_dc to METS/MODS.

METS gives dramatically richer metadata:
- Structured titles + subtitles
- Multiple authors with roles (aut, edt, prt) and life dates
- Publisher, place, edition as separate fields
- Working viewer URLs from `dv:links` (fixes HAB!)
- IIIF manifests from `dv:iiif` or constructed from IDs
- PPN, URN, shelfmark, VD16/VD17 identifiers
- Physical description, subjects, classification
- File groups (image quality tiers: DEFAULT, MAX, MIN, THUMBS)
- OPAC reference links
- Uses `$set` instead of `$setOnInsert` so re-runs enrich existing records

### 8. METS Re-harvests (partially complete)

| Library | Status | Records | Updated | New | Manifests |
|---------|--------|---------|---------|-----|-----------|
| HAB | DONE | 1,087 | 981 | 106 | 0 (viewer URLs fixed) |
| Heidelberg | DONE | 3,715 | 3,714 | 1 | 3,715 (100%) |
| Goettingen | RUNNING | ~56 of ~40K | 56 | 0 | 56 (100%) |
| SBB | NOT STARTED | — | — | — | — |
| SLUB | NOT STARTED | — | — | — | — |

**Note on METS record counts**: METS endpoints return fewer records than oai_dc for some libraries. HAB: 1,087 via METS vs 4,792 via oai_dc. Heidelberg: 3,715 vs 16,301. The existing oai_dc records are NOT deleted — METS just enriches the ones it can find. For comprehensive coverage, keep the oai_dc records and layer METS enrichment on top.

## Still Running
- **Goettingen METS re-harvest**: Page ~350 / 86,622 total. 1 record per page (METS is large). Will take many hours. Running as background task. If it dies, re-run:
  ```bash
  set -a; source .env.production.local; set +a
  node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=goettingen
  ```
  It's idempotent — `$set` upserts, so re-running is safe.

## Next Steps

### Immediate
1. Wait for Goettingen METS harvest to complete
2. Run SBB METS re-harvest (239K records, VD16+VD17 sets — will take many hours):
   ```bash
   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=sbb
   ```
3. Run SLUB METS re-harvest (650K records — largest, overnight job):
   ```bash
   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=slub
   ```

### After All Re-harvests
4. Run full `catalog_coverage` rebuild to pick up new METS metadata:
   ```bash
   node scripts/catalog-coverage/build.mjs
   ```
5. Re-run the catalog_coverage → viewer_url/manifest patching (the build doesn't automatically propagate viewer_urls from METS yet — the build.mjs changes handle future rebuilds, but existing records need one more patch run)
6. Merge PR #367

### Future Improvements
- Store `import_candidate_id` in catalog_coverage docs during build (would make future patching trivial — no title matching needed)
- Consider running Goettingen/SBB/SLUB METS harvests on Hetzner for reliability (long-running processes)
- SLUB IIIF: their METS might expose IIIF URLs we couldn't find via oai_dc — check after harvest

## Key Numbers (Current)
| Metric | Value |
|--------|-------|
| import_candidates | 1,083,087 |
| With scan_quality | 1,083,087 (100%) |
| With author_surname | 901,442 (83.2%) |
| With harvest_format='mets' | ~5K so far (HAB + Heidelberg + partial Goettingen) |
| catalog_coverage editions | 1,565,796 |
| With scan | 329,036 (21.0%) |
| With translation | 110,501 (7.1%) |
| In Source Library | 2,401 |

## Files Modified
- `scripts/catalog-coverage/harvest-oai-libraries.mjs` — complete METS rewrite
- `scripts/catalog-coverage/build.mjs` — added viewer_url passthrough
- `src/app/admin/catalog-coverage/page.tsx` — viewer_url fallback in dashboard
- `src/app/api/catalog/coverage/route.ts` — viewer_url in API projection
- `scripts/catalog-coverage/_tmp-backfill-import-candidates.mjs` — temp backfill script (untracked)
