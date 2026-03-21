---
name: Faceted tagging system
description: 6-facet classification system (tradition, domain, form, sphere, era, mode) replacing flat categories — vocabulary, tagger, query API
type: project
---

## Faceted Tagging System (built 2026-03-15)

Replaces the old 29 hardcoded categories with a Llull-inspired combinatorial system: 6 independent facets × ~12 values each = 65 tag values producing ~1M unique intersections.

**Why:** The old categories were too narrow (Western esotericism only), single-assignment, and keyword-matched. The ML clusters (52) are single-assignment too. Faceted tags are multi-label, cover the full collection (Chinese, Sanskrit, Islamic, indigenous), and enable combinatorial queries.

**How to apply:** Use `faceted_tags` for any new browse/filter/search UI. The old `categories` field still exists but is superseded.

### Files
- **Vocabulary:** `src/lib/taxonomy/faceted-vocabulary.ts` — 6 facets, 65 values, each with differentia
- **Tagger script:** `scripts/maintenance/faceted-tagger.mjs` — Gemini 3 Flash, ~$0.70 for full library
- **Query API:** `src/app/api/books/facets/route.ts` — filter + count aggregation
- **Book type:** `faceted_tags` field on Book interface (`src/lib/types/book.ts`)

### Running the tagger
```bash
set -a; source .env.production.local; set +a; node scripts/maintenance/faceted-tagger.mjs
```
Flags: `--dry-run`, `--limit N`, `--retag`, `--batch N`, `--book ID`

### Facets
| Facet | Values | Cardinality | Question |
|-------|--------|-------------|----------|
| tradition | 17 | 0-3 | What intellectual lineage? |
| domain | 15 | 1-3 | What subject matter? |
| form | 10 | 1-2 | What kind of text? |
| sphere | 11 | 1-2 | What cultural world? |
| era | 7 | 1-2 | When composed? |
| mode | 5 | 1-2 | How does it generate knowledge? |

### API usage
- Counts: `GET /api/books/facets?counts=true`
- Filter: `GET /api/books/facets?tradition=alchemical&sphere=arabic`
- OR within facet: `?tradition=hermetic,alchemical`
- AND across facets: `?tradition=hermetic&domain=medicine`

### Design lineage
Inspired by the library's own books on classification:
- Llull: combinatorial (few principles, multiplicative power)
- Bacon: cognitive grounding (Memory/Reason/Imagination → epistemic mode facet)
- Porphyry: differentia (each tag value has a boundary definition)
- Gessner: multiple access points (no single facet is primary)
- Dionysius: ranked tags (source vs bridge vs browse — future refinement)
