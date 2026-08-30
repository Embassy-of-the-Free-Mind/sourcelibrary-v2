# Changelog

## 4.6.0 (2026-08-18)

### Images are first-class (parity with the remote server, #3937)

- `search_images`: the first 5 results are attached as inline MCP `image` content blocks (audience `['user','assistant']` — the model can see them). Empty results carry an explanatory `note`; under `book_id` the artwork lane is skipped (artworks don't belong to books, so they can only un-scope a book-filtered call).
- `get_quote`: new `include_image` param returns the scan of the cited leaf inline (display size, ≤1200px).
- `get_book`: cover art attached inline on every call (`cover_thumb_url` / `cover_image_url` in the JSON).
- Fetches are bounded: 5s timeout, 1MB cap per image, silent skip on failure.


## 4.3.0 (2026-05-18)

### Server-level orientation

Moved the project-level orientation paragraph from `_meta.about` on `ListToolsResult` (non-standard, unreliably surfaced to models) to the spec-blessed `instructions` field on `InitializeResult`. The new text frames Source Library as the corpus *just beyond* what current LLMs were trained on, and tells the calling model to combine its own training knowledge with web search for period terminology before querying the library.

### Tool annotations

Every tool now carries `annotations: { title, readOnlyHint }`. Read-only hints let clients auto-approve queries (fewer permission prompts). `submit_feedback` declares the writer flags explicitly.

### Versioning

Synced versions across `package.json`, `Server({version})`, `server.json` (MCP registry manifest), and the startup log to **4.3.0**. The tool count in the startup log is now computed from `TOOLS.length` rather than hardcoded (was stuck at "10 tools"; actual is 11). Updated `package.json` and `server.json` descriptions (both were stale — "1,200+" / "5,000+ rare historical texts").

### Catch-up (4.1.0 – 4.2.0)

Releases between 4.0.0 and 4.3.0 weren't logged here; key additions documented in commit history:

- **4.1.0 / 4.1.1**: `get_quote` tool, `check_duplicate` tool, API-key bypass for bot gating, npx-install fix.
- **4.2.0**: `submit_feedback` tool.
- **Between 4.2.0 and 4.3.0**: language/year filters on `search_concept`, `snippet_language` on passage results, orientation hints steering toward `get_book` for named authors/works, truncation signaling + pagination docs on `get_book_text`.

---

## 4.0.0 (2026-02-27)

**Breaking:** Reduced from 14 tools to 7. Removed single-purpose tools that duplicated functionality available through the remaining tools.

### Removed tools

| Removed | Use instead |
|---------|-------------|
| `find_quotes` | `search_translations` with a topic query |
| `get_quote` | `get_book_text` with `from`/`to` page range |
| `search_index` | `search_library` or `search_translations` |
| `search_entities` | `search_library` |
| `get_entity` | `search_library` with the entity name |
| `get_image` | `search_images` with `book_id` filter |
| `get_book_images` | `search_images` with `book_id` filter |

### New features

- **SEO slug URLs** in all responses. Book URLs now use human-readable slugs (`/book/fludd-utriusque`) instead of hex IDs. Old ID-based URLs redirect automatically.
- **Citation URLs on every page** returned by `get_book_text` (JSON format).

### 7 tools (v4)

| Tool | Purpose |
|------|---------|
| `search_library` | Full-text search across books, authors, and page content |
| `search_translations` | Search inside translated text — find what authors wrote about a topic |
| `search_within_book` | Search pages within a specific book |
| `list_books` | Browse and filter the collection |
| `get_book` | Book metadata, summary, chapters, index stats |
| `get_book_text` | Read a book — 50+ pages per call with citation URLs |
| `search_images` | Search 50,000+ historical illustrations |

---

## 3.0.0 (2026-02-17)

- Added standalone CLI with colored terminal output (`source-library` binary)
- `--json` flag for piping to jq or other tools
- Renamed `search_passages` to `search_translations` (old name still works as alias)
- 14 tools total

## 2.0.0 (2026-02-15)

- Expanded to 11 tools: added `search_passages`, `search_within_book`, `find_quotes`, `get_quote`, `search_index`, `search_entities`, `get_entity`
- Added `get_book_text` bulk reading endpoint

## 1.1.0 (2026-02-11)

- Added `search_images`, `get_image`, `get_book_images` gallery tools

## 1.0.0 (2026-02-10)

- Initial release: `search_library`, `list_books`, `get_book`
- MCP server for Claude Desktop and Claude Code
