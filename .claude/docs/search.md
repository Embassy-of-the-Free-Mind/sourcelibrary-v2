# Search System

## Overview

Full-text search across books, pages, and book indexes. Uses MongoDB `$text` indexes with regex fallback for robustness.

## Routes

| Route | Purpose | Index used |
|-------|---------|-----------|
| `GET /api/search` | Global search (books + page content) | `books_text_idx`, `pages_text_idx` |
| `GET /api/search/unified` | Homepage dropdown (books + index entries) | `books_text_idx`, `books_index_generated_idx` |
| `GET /api/search/index` | Index-only search (concepts, people, places, quotes) | `books_index_generated_idx` |
| `GET /api/books/[id]/search` | Within-book page search | `pages_text_idx` |

## Text Indexes

Both text indexes use `default_language: 'none'` (disables stemming for multilingual content) and `language_override: '_text_lang'` (prevents MongoDB from reading the document's `language` field).

### `books_text_idx`
Fields: `title` (weight 10), `display_title` (weight 10), `author` (weight 5), `reading_summary.overview` (weight 1)

### `pages_text_idx`
Fields: `translation.data` (weight 2), `ocr.data` (weight 1)

Both defined in `src/app/api/admin/ensure-indexes/route.ts`.

## Search Strategy

All routes use a **$text primary + regex fallback** pattern:
1. Try `$text` search with `textScore` relevance ranking
2. If `$text` fails (e.g., no text index), fall back to regex on key fields
3. Results sorted by `textScore` for relevance

This handles edge cases like index rebuilds or new collections gracefully.

## Global Search (`/api/search`)

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Query (min 2 chars) |
| `language` | string | — | Filter by book language |
| `category` | string | — | Filter by category ID |
| `year` | int | — | Exact year filter (numeric) |
| `year_from` | int | — | Year range start |
| `year_to` | int | — | Year range end |
| `has_doi` | "true" | — | Only books with DOIs |
| `has_translation` | "true" | — | Only books with translations |
| `book_id` | string | — | Search within specific book |
| `search_content` | "false" | "true" | Skip page content search |
| `sort` | string | "relevance" | `relevance`, `date_asc`, `date_desc`, `title` |
| `limit` | int | 20 | Max results (capped at 100) |
| `offset` | int | 0 | Pagination offset |

**Sort behavior:**
- `relevance` — books first, title matches prioritized, then `textScore`
- `date_asc` / `date_desc` — by year extracted from `published` field
- `title` — alphabetical on `display_title || title`

**Year filtering:** Uses numeric `year` field with `$gte/$lte` (not regex on string `published`). Requires `books_year_idx`.

**Nearby results:** When filtering by exact `year`, returns books within ±5 years as a `nearby` array, sorted by distance from target year.

**Response includes:** `query`, `total`, `offset`, `limit`, `sort`, `results[]`, `filters{}`, optionally `nearby[]` and `nearby_range`.

## Unified Search (`/api/search/unified`)

Fast search for the homepage dropdown. Runs book search and index search in parallel.

- Books: `$text` with `textScore`, limited to 5 results
- Index: scans all books with `index.generatedAt`, matches normalized terms in concepts/people/places/keywords
- **Alias expansion:** Before index matching, queries `entities` collection for name/alias matches and expands search terms to include all forms (e.g. "hermes" also matches "Hermes Trismegistus" and all aliases)

Returns `{ books: { results, total }, index: { results, total } }`.

## Within-Book Search (`/api/books/[id]/search`)

Searches page content within a single book. Uses `$text` on `pages_text_idx` with `book_id` filter. Hard-capped at 50 results.

## Index Search (`/api/search/index`)

Searches AI-generated book indexes for concepts, people, places, keywords, and quotes.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Query (min 2 chars) |
| `type` | string | — | Filter by type: concept, person, place, keyword, quote |
| `book_id` | string | — | Search within specific book |
| `aggregate` | "true" | — | Cross-book aggregation via entities collection |
| `limit` | int | 20 | Max results (capped at 100) |

**Aggregated mode** (`aggregate=true`):
- Queries `entities` collection instead of scanning individual book indexes
- Matches on `name` and `aliases` (regex, case-insensitive)
- Returns enriched results with `book_count`, `total_mentions`, `description`, `aliases`, `books[]`
- Sorted by `book_count` desc
- Types: `AggregatedIndexResult` / `AggregatedIndexSearchResponse` in `src/lib/api-client/types/search.ts`

**Per-book mode** (default):
- Scans all books with `index.generatedAt`, matches normalized terms
- Uses `expandSearchTerms()` for alias expansion via entities collection
- Returns per-book results with type, term, book info, page references

## UI

**Page:** `src/app/search/page.tsx`
**Client:** `src/lib/api-client/search.ts`
**Types:** `src/lib/api-client/types/search.ts`

### Search Page Features
- Two modes: "Books & Pages" and "Index (Concepts, People, Quotes)"
- Sort dropdown (Relevance / Newest / Oldest / Title A-Z)
- Pagination (prev/next, 20 per page)
- Filter panel: language, category, date range, DOI, translation
- Results grouped by category
- Index results with type badges and page references
- **Aggregation toggle** in index mode: "Grouped across books" (default) vs "Per-book results"
- **Popular queries** shown on empty search state as clickable pills (fetched from analytics)

### Homepage Dropdown (`UnifiedSearch`)
**Component:** `src/components/search/UnifiedSearch.tsx`

- Instant search with debounced API calls to `/api/search/unified`
- **Keyboard navigation:** ArrowDown/ArrowUp/Enter with visual highlight, ARIA listbox attributes
- **Popular queries:** Shown when input is focused but empty (top queries from `/api/analytics/search`)
- Results grouped into books and index entries with "See all results" link

### Search from Reader (`HighlightSelection`)
**Component:** `src/components/annotations/HighlightSelection.tsx`

- Search icon in text selection popup opens `/search?q={selectedText}` in new tab
- Truncates selection to 100 chars for URL

### Within-Book Index Panel (`BookIndexPanel`)
**Component:** `src/components/book/BookIndexPanel.tsx`

Client component on book detail pages with two states:
- **Collapsed** (default): Tag cloud with 15-per-type limit for people/places/concepts, "Browse full index" button
- **Expanded:** Search/filter input, type tabs (All/People/Places/Concepts/Keywords/Vocabulary) with count badges, alphabetical entries with encyclopedia links and page number links

Uses `normalizeText()` for diacritics-insensitive client-side filtering. Index data passed from server component — no additional API call.

## Semantic Search (Entity Aliases)

Both `/api/search/unified` and `/api/search/index` expand search terms via the `entities` collection before matching:

1. Query `entities` for documents where `name` or `aliases` match the search term (regex, case-insensitive)
2. If found, expand search terms to include canonical name + all aliases
3. Match against all expanded terms using `normalizeText()` for diacritics-insensitive comparison

Requires `{ aliases: 1 }` index on `entities` collection (defined in `ensure-indexes` route).

Coverage depends on how well-populated `entities.aliases` is — the feature works immediately with whatever aliases exist and improves as more are added.

## Analytics

Search queries logged to `analytics_events` collection with `event: 'search_query'` from all three search routes. Schema: `{ event, query, results_count, filters, timestamp, ip, created_at }`.

**Dashboard:** `GET /api/analytics/search?days=30` — top queries, zero-result queries (content gaps), volume by source/day. Visible on the Search tab at `/analytics`.
