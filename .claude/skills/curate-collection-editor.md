# Collection Curator Skill (Editor)

Create and curate Source Library collections via the editor API.

## Setup

Set your API key as an environment variable:
```
export SL_API_KEY="sl_editor_..."
```

## Workflow

### 1. Research — Find books for the collection
Use the Source Library MCP tools to search:
- `search_library` — find books by topic
- `get_book` — check a specific book's details
- `search_within_book` — verify content relevance

### 2. Create — Make the collection
```bash
curl -X POST https://sourcelibrary.org/api/editor/collections \
  -H "Authorization: Bearer $SL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Collection Name",
    "description": "A concise description of the collection.",
    "subtitle": "One-line summary for card display",
    "parent": "parent-collection-slug",
    "bookIds": ["book-id-1", "book-id-2"]
  }'
```

Response includes a `preview_url` — open it to see the draft.

### 3. Curate — Add highlights and editorial content
```bash
curl -X PATCH https://sourcelibrary.org/api/editor/collections \
  -H "Authorization: Bearer $SL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "collection-slug",
    "expanded_description": "Longer editorial prose about the collection...",
    "highlighted_books": [
      {"book_id": "id", "tier": 1, "rank": 1, "title": "Start Here Book", "note": "Why this is essential"},
      {"book_id": "id", "tier": 2, "rank": 2, "title": "Essential Reading"},
      {"book_id": "id", "tier": 3, "rank": 3, "title": "Also Notable"}
    ],
    "addBookIds": ["more-book-id"],
    "removeBookIds": ["wrong-book-id"]
  }'
```

### 4. Publish — Make it live
```bash
curl -X POST https://sourcelibrary.org/api/editor/collections/SLUG/publish \
  -H "Authorization: Bearer $SL_API_KEY"
```

Validates the collection has a name, description, and at least one book before publishing.

### 5. List your collections
```bash
curl https://sourcelibrary.org/api/editor/collections \
  -H "Authorization: Bearer $SL_API_KEY"
```

## Highlight tiers
- **Tier 1**: "Start here" — the single most important book, shown prominently
- **Tier 2**: "Essential Reading" — 3-5 core texts
- **Tier 3**: "Also Notable" — 5-10 additional works

## Tips
- Collections start as drafts (`visible: false`) — preview at the URL before publishing
- The slug is auto-generated from the name but can be overridden
- Featured images are auto-picked from book illustrations
- Use `parent` to place the collection as a subcollection
- You can only edit collections you created
