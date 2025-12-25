# Source Library Architecture

## Overview

Source Library is a Next.js application for digitizing, processing, and translating early printed books (primarily pre-1650 works). It uses MongoDB for storage, Gemini AI for OCR and translation, and integrates with USTC (Universal Short Title Catalogue) for bibliographic metadata.

## Key Workflows

### 1. Book Import
- Upload PDFs or import from archive.org/IIIF sources
- Images stored as page records in MongoDB
- USTC metadata can be linked for bibliographic accuracy

### 2. Page Splitting (`/book/[id]/split`)
- Many source scans are two-page spreads
- Split page detects gutter position (auto, dark, bright, center, Gemini AI)
- Creates two virtual pages with crop coordinates (non-destructive)
- Original images preserved

### 3. OCR & Translation (`/book/[id]` actions)
- Gemini-powered OCR extracts text from page images
- Translation to English with scholarly annotations
- Page summaries for indexing

### 4. Reading & Export
- `/book/[id]/read` - Parallel text reader (Loeb-style)
- EPUB export in multiple formats
- Citation generation with USTC links

## Architectural Decisions

### ADR-001: Split Page vs Prepare Page (2024-12)

**Status:** Decided

**Context:** Two overlapping pages existed for book preparation:
- `/book/[id]/prepare` (1543 lines) - Monolithic page handling split, OCR, translation, summary
- `/book/[id]/split` (906 lines) - Focused on split detection workflow

**Decision:** Keep `/split`, deprecate `/prepare`

**Rationale:**
1. **Single responsibility** - Split page does one thing well
2. **Maintainability** - Smaller, focused codebase is easier to maintain
3. **User flow** - Split is a distinct step before OCR/translation
4. **Existing patterns** - OCR and translation actions already accessible from book detail page

**Consequences:**
- Remove `/book/[id]/prepare` directory
- Update any links pointing to prepare page
- Split functionality remains at `/book/[id]/split`
- OCR/translation initiated from book detail page buttons

## Directory Structure

```
src/
  app/
    book/[id]/
      page.tsx         - Book detail (main hub for actions)
      split/page.tsx   - Dedicated split detection workflow
      read/page.tsx    - Parallel text reader
      summary/page.tsx - Book summary and index
    api/
      books/           - Book CRUD
      pages/           - Page processing
      image/           - Image proxy with cropping
      download/        - EPUB/PDF export
  components/
    BookPagesSection   - Grid view of pages
    SplitModeOverlay   - Split line adjustment UI
    TranslationEditor  - Side-by-side OCR/translation view
    BibliographicInfo  - USTC metadata display
  lib/
    types.ts           - Shared TypeScript types
    mongodb.ts         - Database connection
```

## Data Model

### Book
```typescript
{
  id: string;           // Custom ID (slug)
  title: string;        // Original language title (USTC-aligned)
  display_title: string; // English translation for non-English works
  author: string;
  language: string;
  published: string;    // Publication year
  ustc_id: string;      // USTC catalog reference
  place_published: string;
  publisher: string;
  format: string;       // folio, quarto, octavo, etc.
  thumbnail: string;
  editions: TranslationEdition[];

  // Image source and licensing
  image_source?: {
    provider: 'internet_archive' | 'google_books' | 'user_upload' | ...;
    provider_name: string;  // "Internet Archive"
    source_url: string;     // Link to original
    license: string;        // SPDX: "publicdomain", "CC-BY-4.0"
    attribution?: string;   // Required credit text
  };
}
```

### Page
```typescript
{
  id: string;
  book_id: string;
  page_number: number;
  photo: string;        // Image URL (possibly cropped view)
  photo_original: string; // Original uncropped image
  crop?: {              // Virtual crop coordinates
    xStart: number;
    xEnd: number;
  };
  split_from?: string;  // If created from split, parent page ID
  ocr?: { data: string; model: string; timestamp: Date };
  translation?: { data: string; model: string; timestamp: Date };
  summary?: { data: string; model: string; timestamp: Date };
}
```

## Future Considerations

- **IIIF Integration** - Manifest generation for interoperability
- **TEI Export** - Scholarly XML format
- **Collaborative editing** - Multiple users per book
