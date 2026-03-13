# Handoff: Catalog Enrichment (USTC + BPH) — 2026-02-18

## What Was Done

Ran `scripts/enrich-from-catalogs.mjs --apply` on all 5,017 books. The script enriches Source Library metadata from two external catalogs stored in Supabase (`secondrenaissance` project):

### Phase 1: BPH Matching (ia_identifier)
- Matched 855 BPH (Bibliotheca Philosophica Hermetica) records against 3,174 SL books via `ia_identifier`
- BPH provides authoritative metadata for Western esoteric texts: publication place, printer, BPH keywords
- BPH keywords auto-mapped to SL categories (e.g. `alchemy`, `kabbalah`, `rosicrucianism`)
- Major matches: Agrippa, Ficino, Bruno, Fludd, Vaughan, Kircher, Boehme, Dee, Paracelsus

### Phase 2: USTC Matching (year + title)
- Two-pass matching strategy for speed:
  - Pass 1: Score USTC records by original title keyword overlap (no API calls)
  - Pass 2: Fetch AI-enriched `english_title` for top 30 candidates only
- Thresholds: High ≥ 85, Medium 70-84, Low rejected entirely
- Hundreds of matches across years 1533–1700
- Enriches: publication place, printer, format, language, classification, english_title, subject_tags

### Phase 3: First-Translation Assessment
- 244 books assessed as `likely_first` (pre-1700 texts with no known English translation)
- 1 confirmed `existing_english`, 83 `unknown`
- 328 books updated with `first_translation_assessment` field

### Phase 4: Metadata Quality Assessment
| Level | Count |
|-------|-------|
| verified | 788 |
| catalog_matched | 393 |
| ai_enriched | 2,364 |
| import_metadata | 126 |
| ai_partial | 30 |
| suspect | 177 |
| unknown | 1,139 |
| **Flagged for curatorial review** | **1,446** |

All 5,017 books updated with `metadata_quality` and `curatorial_review` fields.

## Key Decisions

1. **Low-confidence USTC matches rejected entirely** — not flagged, just ignored. Per user instruction.
2. **Medium and high confidence auto-applied** — both write catalog data to books.
3. **Provenance tracked**: `data_provenance: 'ustc_catalog_original'` for USTC native fields, `'ustc_ai_enriched'` for Haiku/Gemini-derived fields (english_title, subject_tags).
4. **BPH keyword → category mapping** hardcoded in script (e.g. `Alchemy` → `alchemy`, `Kabbalah` → `kabbalah`).

## Fields Written to Books

```javascript
// USTC/BPH match
catalog_refs: [{ source, record_id, title, match_confidence, match_method, matched_at }]
publication_place    // from catalog
printer             // from catalog
format              // from catalog (e.g. "4°", "8°")

// First translation
first_translation_assessment: { status, reason, assessed_at, assessed_by }

// Quality
metadata_quality: { level, reasons[], assessed_at, assessed_by }
curatorial_review: { status: 'flagged'|'none', reasons[], flagged_at, flagged_by }
```

## Script Architecture

- **Supabase REST API** queries against `ustc_editions` (1.6M rows) and `ustc_enrichments` (AI-generated)
- **BPH** matched via `bph_catalog` table on `ia_identifier`
- Indexes created: `20260218103935_create_ustc_indexes.sql` in `secondrenaissance` repo
- Full-text search index on `ustc_editions.title` for keyword matching

## Performance Notes

- Two-pass USTC matching avoids fetching enrichments for thousands of records per year
- Supabase timeout set to 15s per query
- Full run on 5,017 books completes in ~10 minutes

## Files

- `scripts/enrich-from-catalogs.mjs` — the enrichment script (supports `--dry-run`, `--apply`, `--limit N`, `--book "term"`)

## What's Next

1. **Curatorial review UI** — 1,446 books flagged. Need admin UI to review/approve/dismiss flags.
2. **Re-run after re-OCR** — books currently being reprocessed will have better metadata for enrichment.
3. **ISTC integration** — incunabula (pre-1501) catalog, not yet integrated.
