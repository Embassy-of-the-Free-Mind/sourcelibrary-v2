# MCP Server Data Infrastructure Prep — 2026-02-17

## Goal
Prepare Source Library's data for an MCP server that lets Claude Code users do cross-book research (conceptual webs, entity networks, temporal analysis, source discovery).

## Completed (Phase 1 — metadata cleanup)

### Year backfill
- **Script:** `scripts/backfill-year-from-published.mjs`
- Parsed numeric `year` from `published` string for 4,203 books (regex: 2,248, Gemini: 1,955)
- Coverage: 526 → 4,729 books with numeric year (93.1%)
- 318 unresolved (published="Unknown" or truly ambiguous)
- Adds `year_source` field ("regex" or "gemini") for provenance

### Language normalization
- **Script:** `scripts/normalize-languages.mjs`
- Deterministic: 54 books (lat→Latin, eng→English, fre→French, spa→Spanish, latin→Latin)
- Gemini text-based inference: 2,686 books classified from titles/authors/OCR samples
- Coverage: 2,952 Unknown → 141 Unknown (2.8%)
- Adds `language_source` ("gemini_text" or "gemini_vision") and `language_confidence` fields
- Top languages: Latin 1,039, English 799, German 646, Chinese 559, Greek 474, Sanskrit 430

### Audit script
- **Script:** `scripts/audit-data-infrastructure.mjs` — run anytime to check coverage

## Remaining Work (Priority Order)

### Phase 1b — Bulk text endpoint (no AI cost)
- Add `GET /api/books/[id]/text` — returns all pages' OCR + translation in one call
- Essential for MCP server: Claude needs full book text without 700 round trips
- Could also add `?format=markdown` for clean reading format

### Phase 2 — Index & summary generation (AI cost, use batch API)
- Only 102/5,077 books have AI indexes (2%)
- Only 1 book has a reading summary
- Run on all books with 10+ translated pages via batch API (50% off)
- This populates the entity knowledge graph — the backbone of cross-book analysis

### Phase 3 — Entity enrichment (AI cost)
- 15,118 entities exist but are hollow: 0% have aliases, 0% have descriptions
- Need: descriptions, aliases (spelling variants), type cleanup
- Cross-book entities (1,564 in 2+ books) are highest priority
- Entity dedup: only 10 exact dupes found, but many near-misses likely (e.g., "Hermes"/"Hermes Trismegistus")

### Phase 4 — Build MCP server
- `mcp-server/` directory already exists
- ~8-10 tools: search_books, search_content, search_index, get_book, get_pages, get_entity, search_gallery, get_citation, list_books, get_book_index
- API-backed (calls sourcelibrary.org/api/...) — no DB credentials needed for users
- Claude composes tools autonomously for complex research queries

## Key Numbers (post-backfill)
| Metric | Value |
|--------|-------|
| Books | 5,077 |
| Pages | 1,827,399 |
| Pages with OCR | 301,344 (16.5%) |
| Pages with translation | 81,651 (4.5%) |
| Books with numeric year | 4,729 (93.1%) |
| Books with known language | 4,936 (97.2%) |
| Books with AI index | 102 (2.0%) |
| Entities | 15,118 (0 with aliases/descriptions) |
| Gallery images | 34,364 |

## Notes
- Background `secret-lover run` doesn't work — Keychain not accessible. Use foreground only.
- Scripts load `.env.local` as fallback but it may not exist; `secret-lover run --` in foreground is reliable.
- Gemini model used: `gemini-2.5-flash` for both year and language inference.
