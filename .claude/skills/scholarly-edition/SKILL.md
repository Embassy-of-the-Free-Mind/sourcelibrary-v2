---
name: scholarly-edition
description: Create a DOI-ready scholarly edition of a translated book. Use when asked to publish, create an edition, mint a DOI, or prepare a book for scholarly publication. Generates front matter, creates versioned editions, builds EPUBs, and mints DOIs via Zenodo.
---

# Scholarly Edition Workflow

Create a complete, citable scholarly edition of a translated historical text with DOI.

## Prerequisites

Before starting, verify the book has:
- Completed OCR for all pages
- Completed translations for all pages
- Book metadata (title, author, language, publication date)

**Authentication:** Steps 2, 3, and 5 require admin authentication. When running as a Claude Code agent, requests go through the local dev server or use session cookies automatically. For manual curl commands, you need an authenticated session.

## Workflow Steps

### Step 1: Gather Book Information

First, get the book ID and check its readiness:

```bash
# Get book details and page statistics
curl -s "https://sourcelibrary.org/api/books/BOOK_ID" | jq '{
  title: .title,
  display_title: .display_title,
  author: .author,
  language: .language,
  published: .published,
  pages_count: .pages_count,
  pages_translated: .pages_translated
}'
```

The book API returns `pages_count` and `pages_translated` as cached counts. Confirm `pages_translated` equals `pages_count` before proceeding. For detailed page-level text, use `/api/books/BOOK_ID/text?content=translation`.

### Step 2: Generate Front Matter

Generate the scholarly Introduction and Methodology sections:

```bash
curl -X POST "https://sourcelibrary.org/api/books/BOOK_ID/editions/front-matter" \
  -H "Content-Type: application/json" \
  -d '{}'
```

This creates:
- **Introduction**: Historical context, author biography, work significance
- **Methodology**: OCR process, translation approach, editorial conventions

Save the response to use when creating the edition.

### Step 3: Create the Edition

Create a versioned edition with the generated front matter:

```bash
curl -X POST "https://sourcelibrary.org/api/books/BOOK_ID/editions" \
  -H "Content-Type: application/json" \
  -d '{
    "version_label": "First Edition",
    "license": "CC-BY-4.0",
    "changelog": "Initial scholarly edition with AI-assisted translation.",
    "contributors": [
      {"name": "Source Library", "role": "editor", "type": "ai"},
      {"name": "ORGANIZATION_NAME", "role": "editor", "type": "human"}
    ],
    "front_matter": {
      "introduction": "INTRODUCTION_TEXT",
      "methodology": "METHODOLOGY_TEXT",
      "generated_at": "ISO_DATE",
      "generated_by": "gemini-3-flash-preview"
    }
  }'
```

Note the returned `edition_id` for the next step.

### Step 4: Verify Scholarly EPUB

Test the scholarly EPUB download:

```bash
curl -sL "https://sourcelibrary.org/api/books/BOOK_ID/download?format=epub-scholarly" \
  -o /tmp/scholarly-test.epub

# Check file size
ls -lh /tmp/scholarly-test.epub
```

The EPUB should include:
- Title page with DOI badge (placeholder until minted)
- Copyright and license page
- Introduction
- Methodology
- All translated pages with facsimile images
- Summary (if indexed)
- Glossary (if vocabulary indexed)
- Index (if keywords/concepts indexed)
- Colophon with citation information

### Step 5: Mint DOI via Zenodo

Mint a permanent DOI for the edition:

```bash
curl -X POST "https://sourcelibrary.org/api/books/BOOK_ID/editions/mint-doi" \
  -H "Content-Type: application/json" \
  -d '{"edition_id": "EDITION_ID"}'
```

This will:
1. Create a Zenodo deposit
2. Upload the translation text
3. Set metadata (title, creators, license, keywords)
4. Publish and mint the DOI

The response includes:
- `doi`: The permanent DOI (e.g., `10.5281/zenodo.12345678`)
- `doi_url`: The resolvable DOI URL
- `zenodo_url`: Direct link to Zenodo record

## License Options

Valid SPDX license identifiers:
- `CC-BY-4.0` - Attribution (recommended for scholarly work)
- `CC-BY-SA-4.0` - Attribution-ShareAlike
- `CC-BY-NC-4.0` - Attribution-NonCommercial
- `CC-BY-NC-SA-4.0` - Attribution-NonCommercial-ShareAlike
- `CC0-1.0` - Public Domain

## Version Numbering

Follow semantic versioning:
- `1.0.0` - First published edition
- `1.1.0` - Minor corrections, improved translations
- `2.0.0` - Major revision, new translations

## Output Summary

After completion, provide:

| Field | Value |
|-------|-------|
| Book | [Title] |
| Edition | [Version] - [Label] |
| Pages | [Count] translated |
| DOI | [DOI] |
| DOI URL | [URL] |
| Zenodo Record | [URL] |
| License | [License] |
| EPUB Download | `?format=scholarly` |

## Troubleshooting

### Zenodo Validation Errors
- Check that all required metadata fields are present
- Ensure license is a valid SPDX identifier
- Verify creators array is not empty

### Missing Front Matter
- Run the front-matter API first
- Check that the book has sufficient content for AI generation

### EPUB Issues
- Verify all page images are accessible
- Check that translations exist for included pages
