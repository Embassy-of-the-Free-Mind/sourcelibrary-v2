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
citation: { title, original_title, original_author, original_language, work_language?, target_language },
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

#### The citation block's two languages (#3959)

`citation.original_language` does not mean what its name suggests. It is the
language of the leaves **we translated from**, which on a translated edition is
not the language of the work: de Slane's 1863 French *Muqaddimah* yields
`original_language: "French"` — true about our English translation's source,
silent about the work being Arabic. Under-specified, not wrong.

`citation.work_language` (added #3959) names the work's language, and appears
**only when it differs**, so a citation for a translation-of-a-translation can
state the whole chain. Both are built by `citationLanguageFields()` in
`src/lib/edition-language.ts`, with a lockstep twin at
`scripts/lib/edition-citation-language.mjs` for the batch minters — node can't
import `.ts`. `scripts/audit/edition-citation-language-twins.mjs` asserts the two
agree (`node --import tsx …`); run it if you touch either.

Two rules, because this block is persisted into `books.editions[]` and travels
into minted DOI payloads:

- **`original_language` is written verbatim from `books.language`, never
  normalised.** Normalising would rewrite `"lat"` → `"Latin"` and
  `"Ancient Greek"` → `"Greek"` on every future edition, silently changing what
  an already-published citation series claims. Only the new field is normalised.
- **Historic rows are not backfilled.** A minted citation is a published
  artifact; editions without `work_language` keep reading exactly as minted, and
  every consumer treats the absent field as "no distinction to draw". As of
  2026-08-14 this affects 1 of 167 edition-holding books (a Boethius *De
  consolatione philosophiae* whose leaves are English over a Latin work).

Zenodo's own language metadata is a **separate** instance of the same
manifestation-vs-work conflation — `buildDepositionMetadata` reads only
`citation.title` and re-derives `languages`/`subjects` straight from
`book.language` (`src/lib/zenodo.ts:379-390`, `:406`). Fixing the citation block
does not touch DOI payload languages; that is its own issue.

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
