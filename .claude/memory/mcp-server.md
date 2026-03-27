# MCP Server

Source Library exposes an MCP server for Claude Code integration, enabling direct database queries and book operations from the CLI.

## Setup

The MCP server is configured in `.claude/settings.json` under `mcpServers`. It runs as a Node.js process using `npx tsx`.

## Available Tools

- `search_books` — Search by title, author, or query
- `get_book` — Get full book details by ID or slug
- `get_page` — Get a specific page with OCR and translation
- `list_collections` — Browse collections
- `query_stats` — Database statistics
- `run_query` — Direct MongoDB queries (admin, read-only)

## Key Files

- `src/mcp/server.ts` — MCP server entry point
- `src/mcp/tools/` — Tool implementations

## Notes

- MCP server uses read-only database access — no writes
- Queries go through the same `getDb()` connection as the web app
- Rate limiting applies to MCP calls same as API calls
