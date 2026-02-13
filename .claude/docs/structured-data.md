# Schema.org Structured Data

## Overview

Source Library emits Schema.org JSON-LD on key page types for search engine discovery, rich results, and Google Scholar indexing. All structured data is rendered server-side as `<script type="application/ld+json">` tags.

## Components

All in `src/components/seo/`:

| Component | Page | Schema.org types | Data source |
|-----------|------|-----------------|-------------|
| `HomePageSchema` | `/` | `WebSite`, `Organization`, `CollectionPage` | Book count, sample books |
| `SchemaOrgMetadata` | `/book/[id]` | `Book`, `CreativeWork`, `WebPage`, `BreadcrumbList` | Book record, edition, page counts |
| `GallerySchema` | `/gallery` | `CollectionPage`, `BreadcrumbList` | Static (no DB query) |
| `GalleryImageSchema` | `/gallery/image/[id]` | `VisualArtwork` + `ImageObject`, `WebPage`, `BreadcrumbList` | Page detection + book join |
| `EntitySchema` | `/encyclopedia/[name]` | `Person` / `Place` / `DefinedTerm`, `WebPage`, `BreadcrumbList` | Entity record |

Shared utility: `schema-utils.ts` — exports `BASE_URL` and `getLicenseUrl()`.

## Where schemas are rendered

- **Homepage:** `HomePageSchema` rendered directly in the page component
- **Book pages:** `SchemaOrgMetadata` rendered in `src/app/book/[id]/page.tsx`
- **Gallery landing:** `GallerySchema` rendered in `src/app/gallery/layout.tsx`
- **Gallery images:** `GalleryImageSchema` rendered in `src/app/gallery/image/[id]/layout.tsx` (data fetched via `cache()` to share with `generateMetadata`)
- **Encyclopedia:** `EntitySchema` rendered in `src/app/encyclopedia/[name]/layout.tsx` (data fetched via `cache()`)

## Gallery image schema details

The highest-value structured data. Each gallery image gets:
- **VisualArtwork + ImageObject** dual typing (semantic richness + Google compatibility)
- `artform` mapped from detection type (woodcut, engraving, emblem, etc.)
- `artMedium` from `metadata.technique`
- `about` from `metadata.subjects`
- `description` from `museum_description` (2-3 sentence museum label)
- `creator`, `dateCreated` from parent book
- `license`, `creditText` from book's `image_source`
- `isPartOf` linking back to the parent `Book`

## Entity type mapping

| Entity type | Schema.org type | Extra properties |
|------------|----------------|-----------------|
| `person` | `Person` | `subjectOf` (books) |
| `place` | `Place` | `subjectOf` (books) |
| `concept` | `DefinedTerm` | `inDefinedTermSet`, `subjectOf` (books) |

Entity books use `book_id` and `book_title` fields (not `id`/`title`).

## Data flow for entity books

The `entities` collection stores books as:
```json
{ "book_id": "abc123", "book_title": "On the Mysteries", "book_author": "Ficino", "pages": [1, 2, 3] }
```
`EntitySchema` maps these to Schema.org `Book` with `@id` and `name`.

## Validation

Run the validation script or check manually:
1. View page source → find `<script type="application/ld+json">`
2. Paste into [Google Rich Results Test](https://search.google.com/test/rich-results)
3. Or use [Schema.org Validator](https://validator.schema.org/)

Key checks:
- No `undefined` in any `@id` or `name` fields
- `@context` is `https://schema.org`
- `BreadcrumbList` has sequential `position` values starting at 1
- Image URLs resolve (especially `contentUrl` on gallery images)
