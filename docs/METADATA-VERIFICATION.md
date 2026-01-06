# Metadata Verification System

Verifies and enriches book metadata using external catalog sources (EFM, USTC, Internet Archive).

## Overview

Source Library contains 600+ books, many with incomplete metadata (Unknown year/language). This system matches books against authoritative catalogs to fill gaps with verified data.

## Catalog Sources

| Source | Coverage | Records |
|--------|----------|---------|
| **EFM** (Embassy of the Free Mind) | Western esoterica, alchemy, magic | ~50K |
| **Internet Archive** | Latin texts, general | ~200K |
| **USTC** | Pre-1601 European books | Enrichment data |

Catalogs are synced to MongoDB `external_catalog` collection via `scripts/sync-catalog-from-supabase.js`.

## Scripts

### LLM-Based Matching (Recommended)

```bash
# Dry run - see matches without applying
node scripts/verify-metadata-llm.mjs --dry-run

# Apply high-confidence matches
node scripts/verify-metadata-llm.mjs --apply

# Check specific book
node scripts/verify-metadata-llm.mjs --book "Agrippa" --dry-run

# Limit number of books
node scripts/verify-metadata-llm.mjs --limit 50 --dry-run
```

**How it works:**
1. Finds books with Unknown year/language
2. Searches catalogs by author surname (most reliable identifier)
3. Uses Claude Haiku to semantically match against candidates
4. Handles Latin declensions (Agrippa/Agrippae), abbreviated titles, editions
5. Returns confidence levels: high/medium/low

**Results format:**
```
=== SUMMARY ===
High confidence: 264
Medium confidence: 86
Low confidence: 3
No match: 315
```

### String-Based Matching (Fallback)

```bash
node scripts/verify-metadata-from-catalogs.mjs --dry-run
node scripts/verify-metadata-from-catalogs.mjs --apply
```

Uses fuzzy prefix matching for Latin name variations. Lower accuracy than LLM approach.

## API Endpoint

```
GET /api/books/{id}/verify-metadata
```

Returns catalog matches for a single book.

```
POST /api/books/{id}/verify-metadata
```

Applies verified metadata. Body:
```json
{
  "year": "1533",
  "language": "Latin",
  "source": "EFM",
  "confidence": 95
}
```

## Year Search

The search API now supports year filtering:

```
GET /api/search?q=alchemy&year=1533           # Exact year
GET /api/search?q=alchemy&year_from=1500&year_to=1600  # Range
```

### Nearby Books

When using exact year search (`year=`), the response includes nearby books:

```json
{
  "results": [...],
  "nearby": [...],
  "nearby_range": "1528-1538"
}
```

- `nearby`: Books within 5 years of target (sorted by distance)
- `nearby_range`: The year window searched (e.g., "1528-1538" for year=1533)

## Verification Results (2025-01-06)

- **668 books** checked (all with Unknown year/language)
- **276 books** updated with high-confidence catalog data
- **82 books** have medium-confidence matches (manual review available)
- **309 books** not in catalogs (Eastern texts, manuscripts, modern editions)

## Cost

LLM verification using Haiku costs approximately $0.10-0.15 for 700 books.

## Technical Details

### Matching Strategy

1. **Author-first search**: Extract author surname, search catalog author field
2. **Title fallback**: If no author matches, search by distinctive title words
3. **LLM evaluation**: Haiku compares book against 30 candidates, returns:
   - `match_index`: Best matching candidate
   - `confidence`: high/medium/low
   - `reason`: Explanation of match

### Database Updates

High-confidence matches update:
- `published`: Year from catalog
- `language`: Language from catalog
- `updated_at`: Timestamp

### Catalog Sync

To refresh catalog data from Supabase:
```bash
node scripts/sync-catalog-from-supabase.js
```

Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` in environment.
