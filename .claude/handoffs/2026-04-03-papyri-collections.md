# Papyri & Manuscripts Collections — 2026-04-03

## What happened
Triggered by news of 30 unpublished Empedocles verses found on P.Fouad inv. 218 in Cairo, we built out two major new collections and a papyrus artifact import pipeline.

## What was created

### Collections
- **Ancient Papyri** (93 items): https://sourcelibrary.org/collections/ancient-papyri
  - Sub: Greek Magical Papyri (10), Literary Papyri (9), Historical Documents (8), Early Christian (5), Philosophical (2), School Papyri (2)
- **Great Manuscripts** (50 items): https://sourcelibrary.org/collections/great-manuscripts

### Imports
- 26 Oxyrhynchus Papyri volumes from IA (Parts 1-73, various)
- 2 Empedocles fragment editions (Leonard translation + Diels' Poetarum Philosophorum Fragmenta)
- 2 Nag Hammadi Codex facsimiles (I & II)
- 36 Berlin Papyrus fragments with 600 DPI images on R2 (`papyri/{bookId}/{side}.jpg`)
  - resource_type: "papyrus_fragment" — new content type
  - Source: berlpap.smb.museum, 600 DPI reflected-light scans
  - Highlights: PGM I & II (Theban Magical Library), Timotheus' Persians (oldest Greek book roll), Cleopatra VII decree, Sappho Book V, Cicero Pro Plancio, soldier Apion's letter

### Cleanup
- 12 duplicate entries archived (Sinaiticus 6→3, Alexandrinus 2→1, Book of Dead 4→2, Tibetan 2→1, Hildegard single-images 4→0, Nasaraeus 2→1)
- All soft-deleted with `archived_reason: 'duplicate_cleanup_2026-04-03'`
- Restored Alexandrinus Vol 2 after spot-check found it was 400 PPI (kept version is only 96 PPI)

## GitHub Issue
- #735: Primary source gallery — papyri, manuscripts, physical artifacts

## Harvested but not yet imported
- **British Library**: 73 IIIF manifest URLs cataloged in `scripts/output/bl-papyri-iiif.json`. Servers are DOWN (2023 cyberattack recovery). Manifest pattern: `https://bl.digirati.io/iiif/ark:/81055/[LARK_ID]`. Key items: Aristotle Constitution of Athens, Egerton Gospel, PGM V & VIII, Bankes Homer. ~300 total estimated across full 2,112-item catalog.
- **Berlin remaining**: berlpap has ~9,000 items total. We imported 40 curated highlights. URL pattern: `https://berlpap.smb.museum/Original/P_{ID}_{R/V}_001.jpg`
- **Oxford SDS**: Oxyrhynchus papyrus photographs (vols I-LXXIII). No API, search-only web portal. Contact EES for access.

## Key files
- `scripts/output/berlin-papyri-pilot.json` — 40-item curated Berlin batch with full metadata
- `scripts/output/bl-papyri-iiif.json` — 73 BL IIIF manifests
- `scripts/tmp-import-berlin-papyri.mjs` — Berlin import script (R2 upload + collection tagging)
- `scripts/tmp-batch-import-oxyrhynchus.mjs` — IA batch import script

## Copyright basis
Bridgeman v. Corel (1999): faithful photographs of 2D public domain works are not copyrightable in US. Papyrus photographs are "slavish copies" of millennia-old originals.

## Scan quality audit
- Spot-checked IA `ppi` metadata for kept vs archived pairs
- Sinaiticus: both ~350 PPI — correct choice
- Ani: kept 600 PPI version (best), archived 400 PPI and unknown — correct
- Alexandrinus: caught mistake — restored 400 PPI Vol 2 that was wrongly archived. The "complete" 1595p version is only 96 PPI. Both now visible.
- Lesson: always check IA `ppi` metadata when comparing scans

## Broader dedup audit (library-wide)
- Most "duplicates" are multi-volume sets (Russian lit, Chinese encyclopedias, Nicene Fathers) — correctly structured
- Real issues:
  - 112 "Unknown" titled items (3-20 pages, likely ETCSL Sumerian fragments)
  - 11 "Hasidic discourses" with identical titles (need volume numbers)
  - 6 "Opera Omnia" with identical titles (need author disambiguation)
- These are title quality issues, not true duplicates

## Next steps
- Collection hero images and expanded descriptions (use /curate-collection)
- More Berlin imports (9,000 items available, we have 36)
- Monitor BL IIIF recovery — check `api.bl.uk` periodically
- Contact Oxford EES about SDS Oxyrhynchus image access
- Consider viewer for papyrus fragments (recto/verso, not sequential pages)
- The "news" feature connecting discoveries to library holdings (from #735)
- Title quality cleanup: Unknown items, generic "Hasidic discourses" / "Opera Omnia"
- For future imports: always check IA `ppi` field to pick best scan
