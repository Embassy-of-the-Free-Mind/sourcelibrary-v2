# Source Library v2 - Project Context

## Purpose
A web application for digitizing, translating, and publishing rare Hermetic/alchemical manuscripts. Makes historical texts accessible to modern readers through AI-powered OCR, translation, and summarization.

## Tech Stack
- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: MongoDB
- **AI**: Google Gemini (OCR, translation, split detection)
- **Storage**: AWS S3 (images)
- **Hosting**: Vercel
- **Styling**: Tailwind CSS

## Workflow Stages

### 1. Ingest
- Upload raw photos (phone photos, scans)
- Store originals untouched in S3
- Create book record with Dublin Core metadata

### 2. Prepare (`/book/[id]/prepare`)
- AI detects single vs two-page spreads (Gemini)
- Review UI: approve/reject/adjust splits
- Manual tools: delete pages, reorder
- Crop and save individual page images
- Reset capability to revert all changes

### 3. Digitize (`/book/[id]/page/[pageId]`)
- OCR each page with context from previous
- Translate sequentially (German/Latin → English)
- Generate page summaries

### 4. Publish
- Generate book summary from page summaries
- Export formats: TXT (implemented), PDF/EPUB (planned)
- Display on website with search

## Key Files

### Types & Schema
- `src/lib/types.ts` - Book, Page, DublinCoreMetadata, CropData interfaces

### Pages
- `src/app/page.tsx` - Homepage with book grid
- `src/app/book/[id]/page.tsx` - Book detail with summary
- `src/app/book/[id]/prepare/page.tsx` - Split detection workflow
- `src/app/book/[id]/page/[pageId]/page.tsx` - Page editor/reader

### Components
- `src/components/TranslationEditor.tsx` - Main read/edit interface
- `src/components/NotesRenderer.tsx` - Markdown + custom markup rendering
- `src/components/FullscreenImageViewer.tsx` - Mobile image zoom

### APIs
- `src/app/api/books/[id]/route.ts` - Get book with pages
- `src/app/api/books/[id]/reset/route.ts` - Reset to original state
- `src/app/api/pages/[id]/route.ts` - Page CRUD
- `src/app/api/pages/[id]/split/route.ts` - Apply page split
- `src/app/api/pages/[id]/detect-split/route.ts` - AI split detection
- `src/app/api/process/route.ts` - OCR/translation/summary
- `src/app/api/image/route.ts` - Image resize (S3 + local)

## Custom Text Markup

The `NotesRenderer` component supports:

| Markup | Purpose | Color |
|--------|---------|-------|
| `->text<-` or `::text::` | Centered text | - |
| `[[notes: text]]` | AI/editorial notes | Amber |
| `[[margin: text]]` | Marginalia from original | Teal |
| `[[gloss: text]]` | Interlinear glosses | Purple |
| `[[insert: text]]` | Later insertions | Green |
| `[[unclear: text]]` | Illegible text | Gray |
| `[[page number: N]]` | Page marker | Gray badge |

Plus full GitHub Flavored Markdown (tables, lists, headings, etc.)

## Database Schema

### Books Collection
```javascript
{
  id: string,
  title: string,
  display_title?: string,
  author: string,
  language: string,
  published: string,
  thumbnail?: string,
  summary?: string | BookSummary,
  status?: 'draft' | 'in_progress' | 'complete' | 'published',
  dublin_core?: DublinCoreMetadata,
  doi?: string,
  license?: string
}
```

### Pages Collection
```javascript
{
  id: string,
  book_id: string,
  page_number: number,
  photo: string,
  photo_original?: string,  // Original S3 URL before cropping
  crop?: { xStart, xEnd },  // 0-1000 scale
  split_from?: string,      // Parent page ID if split
  split_detection?: {...},  // AI detection result
  ocr: { data, language, model },
  translation: { data, source_language, target_language, model },
  summary?: { data, model }
}
```

## CLI Tools (in /tmp/booksplit-demo/)

```bash
# Page management
node page-manager.js list <book_id>
node page-manager.js duplicates <book_id>
node page-manager.js delete <page_id>
node page-manager.js reset <book_id>

# Split detection (Gemini 3 Pro)
node split-detector.js page <book_id> <page_num>
node split-review.js <book_id>  # Generate HTML review

# Full pipeline (Gemini 2.0 Flash)
node full-pipeline.js  # Split → OCR → Translate → Summarize
```

## Pending Work

1. **Remove split from page editor** - Split now lives in Prepare workflow
2. **Upload UI** - Add new books/pages from web interface
3. **Page reordering** - Drag-drop in Prepare view
4. **IIIF manifests** - For image interoperability
5. **PDF/EPUB export** - Beyond current TXT download
6. **User authentication** - Multi-tenant support

## Test Book
- ID: `6909c8ebcf28baa1b4cafbb7`
- Title: "Fountain of Wisdom and Knowledge of Nature"
- Language: German → English
- 30 original pages (can be split to ~55)

## Environment
- MongoDB URI and DB name in `.env.local`
- Gemini API key in `.env.local` (GEMINI_API_KEY)
- Local dev: `npm run dev` (port 3000)
