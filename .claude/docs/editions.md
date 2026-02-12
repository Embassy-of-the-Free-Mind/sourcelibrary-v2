# Edition Publishing

## Overview

Books with completed translations can be published as citable scholarly editions with DOIs, front matter, and exports. Editions are immutable snapshots — republishing creates a new version.

## Type Definition

`src/lib/types/edition.ts` — `TranslationEdition`:
```
id, book_id, version (semver), version_label, status (draft|published|superseded),
doi, doi_url, zenodo_id, zenodo_url,
page_ids[], page_count, content_hash (SHA-256),
contributors: [{ name, role, type (ai|human), orcid, model }],
citation: { title, original_title, original_author, original_language, target_language },
license (SPDX: CC-BY-4.0, CC0-1.0, etc.),
previous_version_id, previous_version_doi, changelog,
front_matter: { introduction, methodology, acknowledgments, generated_at },
exports: { pdf_a, epub, txt, tei_xml },
created_at, published_at
```

## Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/books/[id]/editions` | GET | List editions |
| `/api/books/[id]/editions` | POST | Create new edition |
| `/api/books/[id]/editions` | PATCH | Update edition fields |
| `/api/books/[id]/editions/[editionId]` | GET/PATCH | Get or update specific edition |
| `/api/books/[id]/editions/mint-doi` | POST | Mint DOI via Zenodo |
| `/api/books/[id]/editions/front-matter` | POST | Generate scholarly front matter |

## Publishing Workflow

### 1. Create Edition
`POST /api/books/{id}/editions` with license (required), version_label, changelog, contributors.

The route:
- Fetches all pages with translations
- Computes content hash (SHA-256 of concatenated translation text)
- Determines version (first: `1.0.0`, subsequent: minor bump)
- Gathers AI contributors from page translation models
- Creates immutable edition record
- Marks previous published edition as `superseded`

### 2. Generate Front Matter
`POST /api/books/{id}/editions/front-matter`

Uses `gemini-3-flash-preview` to generate:
- **Introduction** (800-1200 words): historical context, author, significance
- **Methodology** (500-800 words): translation approach, OCR process, AI models, limitations

Builds context from: book metadata, summary, sample page summaries, index (people/concepts).

### 3. Mint DOI
`POST /api/books/{id}/editions/mint-doi`

Zenodo integration (`src/lib/zenodo.ts`):
1. Create deposit (or new version of existing)
2. Set metadata (title, creators, license, description)
3. Upload translation text file
4. Publish deposit → mints DOI
5. Update edition record with DOI, zenodo_id, URLs

License mapping to Zenodo IDs: `CC0-1.0` → `cc-zero`, `CC-BY-4.0` → `cc-by-4.0`, etc.

## UI Components

- `src/components/editions/EditionsPanel.tsx` — displays edition info, DOI, citations (APA + BibTeX), contributor list
- `src/components/editions/PublishEditionButton.tsx` — modal for publishing with license, changelog, contributor fields

## API Client

`books.editions.list()`, `.create()`, `.get()`, `.update()`, `.updateFields()`, `.delete()`, `.generateFrontMatter()`, `.mintDoi()` in `src/lib/api-client/books.ts`
