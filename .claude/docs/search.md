# Search System

## Overview

Multi-lane search across books, pages, indexes, images, and artworks. Combines keyword matching (Supabase trigrams, MongoDB Atlas Search) with vector semantic search (Gemini embeddings, Supabase HNSW) and CLIP visual search.

## Architecture: 7 Search Lanes

The unified search (`/api/search/unified`) fires all lanes in parallel with per-lane timeouts:

| Lane | Source | What it finds |
|------|--------|---------------|
| **Books** | Supabase `books_catalog` (trigram GIN) | Title/author matches |
| **Index** | MongoDB `entities` (Atlas Search autocomplete) | Concepts, people, places in book indexes |
| **Gallery** | MongoDB `gallery_images` (Atlas Search) | Extracted illustrations by description |
| **Visual** | Hetzner CLIP server → Supabase `clip_embeddings` | Images by visual similarity to text |
| **Semantic** | Gemini embedding → Supabase `book_embeddings` (HNSW) | Conceptually related books |
| **Artworks** | Gemini embedding → Supabase `artwork_embeddings` | Artwork by semantic similarity |
| **Collections** | MongoDB `collections` (regex) | Collection name/description matches |

### Similarity Floors

Vector search always returns *something* — nonsense queries still get nearest neighbors. Floors prevent random results:

- **Semantic/Artwork**: 0.65 when keyword results exist, 0.55 as fallback
- **Visual (CLIP)**: 0.28
- Calibrated 2026-04-23: real queries score 0.67+, nonsense scores 0.57-0.63

## Routes

| Route | Purpose | Primary index |
|-------|---------|---------------|
| `GET /api/search/unified` | All tab — 7-lane parallel search | Multiple (see above) |
| `GET /api/search` | Books tab — full book + page content search | Supabase trigram + Atlas Search `pages_search` |
| `GET /api/search/semantic` | Standalone semantic book search | Gemini embedding → Supabase HNSW |
| `GET /api/search/index` | Index-only search | Atlas Search `entities_search` |
| `GET /api/books/[id]/search` | Within-book page search | Atlas Search `pages_search` + semantic |
| `GET /api/search/visual` | CLIP text→image search | Hetzner CLIP → Supabase |
| `GET /api/search/ai-expand` | AI narration + term expansion (streaming) | Gemini LLM |

## Quoted Phrase Search (2026-05-02)

When a query is wrapped in double quotes (e.g. `"venus humanitas"`):

### Behavior per lane
- **Atlas Search** (`buildPageSearchStage`): Uses `phrase` operator instead of `text` — requires words to be adjacent
- **Supabase** (`searchBooksCatalog`, `searchBookIds`): Strips quotes, does exact phrase `ilike` only — no word splitting or cross-field matching
- **Index/entity search**: Skipped entirely (autocomplete returns loose single-word noise)
- **Semantic/visual/artwork**: Quotes stripped before embedding (embeddings don't need them)
- **Regex fallback**: Quotes stripped before regex construction

### Passages in All tab
For quoted phrases, the search page fires a parallel page-content search (`/api/search` with `search_content=true`) alongside the unified search. This surfaces specific passages where the phrase appears in book text, shown as a "Passages" section at the top of results. If no book-title matches exist, book results from the full-text search are backfilled into the unified view.

The implementation uses two parallel calls: an unquoted full-text search (finds pages with both words anywhere) and a quoted phrase search (finds exact contiguous matches). Exact matches are promoted to the top.

### Key files
- `src/lib/atlas-search.ts` — `buildPageSearchStage()` detects `"..."` pattern
- `src/lib/books-catalog.ts` — `searchBooksCatalog()` and `searchBookIds()` detect and strip quotes
- `src/app/api/search/unified/route.ts` — `isPhrase` flag, `matchQuery` for all lanes
- `src/app/api/search/route.ts` — `isPhrase`/`matchQuery` for global search
- `src/app/api/books/[id]/search/route.ts` — `isPhrase`/`matchQuery` for within-book search
- `src/app/[tenant]/search/page.tsx` — `passageResults` state, parallel search for quoted queries

## Atlas Search Indexes

### `books_search` on `books` collection
- **Text fields** (lucene.standard): `title` (boost 10), `display_title` (boost 10), `author` (boost 5), `reading_summary.overview` (boost 1)
- **Filter fields** (token): `language`, `categories`
- **Boolean fields**: `hidden`, `is_first_translation`
- **Number fields**: `year`, `pages_translated`

### `pages_search` on `pages` collection
- **Text fields** (lucene.standard): `translation.data` (boost 2), `ocr.data` (boost 1)
- **Filter fields** (token): `book_id`, `id`
- **Number fields**: `page_number`
- Highlights: `maxCharsToExamine: 100000`, `maxNumPassages: 2`

### `entities_search` on `entities` collection
- **Autocomplete fields**: `name`, `aliases`
- **Score boost**: `book_count` (popular entities rank higher)

### `gallery_search` on `gallery_images` collection
- **Autocomplete**: `description` (boost 3)
- **Text**: `museum_description` (boost 2), `metadata.subjects`, `metadata.figures`
- **Filter**: `gallery_quality >= 0.5`

## Snippet Handling

### XML/markup stripping
All search snippets pass through `cleanText()` which strips:
- XML/HTML tags (`<note>`, `</note>`, etc.)
- Markdown bold (`**text**`) and italic (`*text*`)
- "original: Latin;" annotations
- Excess whitespace

### Snippet length cap
Atlas Search highlights can return entire page content. Within-book search caps highlights to 300 chars centered on the match position. Falls back to truncating from the start if no match position is found.

### Image error handling
Search result cards use `onError` handlers with Book icon fallbacks for broken thumbnails. The `RelatedResultCard`, `SemanticResultCard`, and `BookResultCard` components all handle image load failures gracefully.

## Smoke Tests

15 tests covering all search endpoints. Run with:

```
npx vitest run -c vitest.smoke.config.ts
```

Tests verify: quoted phrase handling, XML stripping, snippet length caps, thumbnail enrichment, index noise suppression, and response shapes.

File: `tests/smoke/search.test.ts`

## UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `SearchPage` | `src/app/[tenant]/search/page.tsx` | Full search page with All/Books/Index/Images tabs |
| `UnifiedSearch` | `src/components/search/UnifiedSearch.tsx` | Homepage dropdown with typeahead |
| `BookResultCard` | (in SearchPage) | Book/page result with auto-passage expansion |
| `SemanticResultCard` | (in SearchPage) | Semantic match with thumbnail + similarity hint |
| `RelatedResultCard` | (in SearchPage) | AI-expanded related result with error-handled image |
| `IndexResultCard` | (in SearchPage) | Entity result with type badge and page refs |
| `ImageResultCard` | (in SearchPage) | Gallery/visual/artwork image card |
| `SearchCollectionCard` | (in SearchPage) | Collection match card |
| `HighlightedText` | `src/components/search/HighlightedText.tsx` | Query term highlighting in results |
| `BookSearchResults` | `src/app/[tenant]/book/[id]/search/BookSearchResults.tsx` | Within-book search UI |

## Search Page View Modes

- **unified** (All tab): Shows all lanes — collections, books, semantic, index, images, passages (for quoted queries)
- **books**: Full `/api/search` with page content, pagination, sort
- **index**: Entity search with type filters
- **images**: Gallery browser with pagination

### AI-Assisted Search
The search page streams AI narration via `/api/search/ai-expand` which returns:
- **Narration**: Brief contextual explanation of the query
- **Expanded terms**: Related search terms as clickable pills
- **Image terms**: Targeted gallery search terms
- **Display hint**: `images_first`, `books_first`, or `not_in_collection`

Results from expanded terms appear in the "Related in the Library" section.

## Analytics

Search queries logged to `analytics_events` with `event: 'search_query'`. Fields: `query`, `results_count`, `filters` (including `source`: unified/global/book_search), `timestamp`, `ip`.

Dashboard: `GET /api/analytics/search?days=30` — top queries, zero-result queries, volume by source/day.
