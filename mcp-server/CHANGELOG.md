# Changelog

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
