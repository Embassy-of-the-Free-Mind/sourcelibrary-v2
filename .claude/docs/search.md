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

Returns `{ books: { results, total }, index: { results, total } }`.

## Within-Book Search (`/api/books/[id]/search`)

Searches page content within a single book. Uses `$text` on `pages_text_idx` with `book_id` filter. Hard-capped at 50 results.

## UI

**Page:** `src/app/search/page.tsx`
**Client:** `src/lib/api-client/search.ts`
**Types:** `src/lib/api-client/types/search.ts`

Features:
- Two modes: "Books & Pages" and "Index (Concepts, People, Quotes)"
- Sort dropdown (Relevance / Newest / Oldest / Title A-Z)
- Pagination (prev/next, 20 per page)
- Filter panel: language, category, date range, DOI, translation
- Results grouped by category
- Index results with type badges and page references

## Analytics

Search queries logged to `analytics_events` collection with `event: 'search_query'` from all three search routes. Schema: `{ event, query, results_count, filters, timestamp, ip, created_at }`.

**Dashboard:** `GET /api/analytics/search?days=30` — top queries, zero-result queries (content gaps), volume by source/day. Visible on the Search tab at `/analytics`.
