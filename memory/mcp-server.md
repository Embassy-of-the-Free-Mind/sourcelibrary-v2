# MCP Server

Source Library exposes a Model Context Protocol server for Claude Desktop, Claude Code, and other MCP clients. It surfaces search and book-fetch tools backed by the production database.

## Where It Lives

- **Code:** `mcp-server/` (separate package at the repo root, not under `src/`)
- **Entry point:** `mcp-server/src/index.ts` (tool list + dispatch)
- **HTTP transport:** `mcp-server/src/api.ts`
- **CLI runner:** `mcp-server/src/cli.ts`
- **Published as:** an npm package; the `mcp-server/README.md` and `mcp-server/CHANGELOG.md` track external versions.

## Available Tools

Confirmed in `mcp-server/src/index.ts`:

- `search_library` — top-level keyword search across books
- `list_books` — filtered enumeration (collection, author, etc.)
- `search_translations` — search within translated text
- `search_within_book` — scoped search inside one book
- `search_concept` — semantic concept search
- `search_images` — gallery / artwork search
- `get_book` — book metadata by id or slug
- `get_book_text` — full OCR + translation text for a book
- `get_quote` — single-quote fetch with citation URL
- `check_duplicate` — pre-import duplicate detection
- `submit_feedback` — user feedback ingestion

## Notes

- All tools are read-only against the production `bookstore` database except `submit_feedback`, which writes to a feedback collection.
- The MCP server reuses the same Mongo connection helpers as the web app — rate limiting and the Vercel WAF rules cover it.
- The remote MCP server (with OAuth) is described in the auto-memory entry `remote-mcp-server.md`.
- `/api/mcp` on the web side gets heavy crawler attention (~32K bot hits / 30 days as of 2026-05) — kept behind the Vercel Bot Management rules.
