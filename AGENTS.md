# AGENTS.md - AI Agent Context

Technical documentation for AI agents working on this codebase.

## Image Processing

### `/api/image/route.ts`
Resizes and crops images using Sharp. Parameters:
- `url` - Source image URL (must be from allowed hosts)
- `w` - Target width (default 400)
- `q` - JPEG quality (default 75)
- `cx` - Crop X start (0-1000 scale)
- `cw` - Crop X end (0-1000 scale)

### Image URL Generation
`TranslationEditor.tsx` has `getImageUrl(page, tier)` function:
```typescript
tier: 'thumbnail' | 'display' | 'full'
// thumbnail: 400px, 70% quality
// display: 1200px, 80% quality
// full: 2400px, 90% quality
```

### Split Page Handling

Pages with `crop.xStart` and `crop.xEnd` are split pages. Three scenarios:

1. **Has `cropped_photo`** - Use the pre-generated Vercel Blob URL directly
2. **Has crop settings only** - Crop on-demand via `/api/image` or inline with Sharp
3. **No crop settings** - Use original image

OCR endpoints (`/api/process/batch-ocr`, `/api/jobs/[id]/process`) crop inline with Sharp and save to Vercel Blob in background.

## Database Schema

### Pages Collection
```typescript
{
  id: string,
  book_id: string,
  page_number: number,
  photo: string,              // Current image URL
  photo_original: string,     // Original before any processing
  thumbnail: string,          // Pre-generated thumbnail
  cropped_photo: string,      // Pre-generated cropped image (Vercel Blob)
  crop: {
    xStart: number,           // 0-1000 scale
    xEnd: number
  },
  ocr: { data: string, language: string },
  translation: { data: string, language: string },
  summary: { data: string }
}
```

### Books Collection
```typescript
{
  id: string,
  title: string,
  author: string,
  language: string,
  page_count: number,
  cover_image: string,
  summary: { overview: string, notable_passages: [], key_themes: [] }
}
```

## Key API Routes

| Route | Purpose |
|-------|---------|
| `/api/books/[id]` | Get book with all pages |
| `/api/pages/[id]` | PATCH to update OCR/translation |
| `/api/process/batch-ocr` | Batch OCR with inline cropping |
| `/api/process/batch-translate` | Batch translation |
| `/api/image` | On-demand image resizing/cropping |
| `/api/jobs/[id]/process` | Pipeline job processor |

## Processing Notes

- OCR uses Gemini Vision API with base64-encoded images
- Translation uses Gemini with previous page context for continuity
- Batch endpoints process up to 5 pages at once
- Jobs processor handles long-running pipeline operations

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
