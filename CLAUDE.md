# Claude Code Guidelines for Source Library

## Data Protection Rules - CRITICAL

### NEVER Delete Source Material Without Explicit Confirmation
- **NEVER** call DELETE endpoints on books, pages, or any source material without the user explicitly saying "delete [specific item]"
- **NEVER** batch delete multiple items - always list them first and ask for confirmation
- If cleaning up data, **ALWAYS** list the specific items first and wait for user to say "yes, delete those"
- When in doubt, **DO NOT DELETE** - ask the user first
- The `deleted_books` collection contains recoverable items - check there before assuming data is lost
- To restore: `POST /api/books/restore/[id]`
- To list deleted: `GET /api/books/deleted`

### Assume All Books Are Valuable
- Books without IA identifiers may be from other catalogs (EFM, manuscripts, etc.)
- "Modern" looking titles may still be valuable historical sources
- When auditing the library, ONLY flag items - never delete without explicit approval

## Security Rules - CRITICAL

### Never Read Secret Files
- **NEVER** read `.env`, `.env.local`, `.env.prod`, `.env.vercel`, or any `.env*` files
- **NEVER** read files that may contain credentials, API keys, or passwords
- If you need to know what environment variables exist, ask the user to list the variable NAMES only (not values)

### Never Embed Secrets in Code
- **NEVER** use `process.env.VAR || 'hardcoded-fallback'` patterns with actual secret values
- **NEVER** copy credentials, API keys, or passwords from environment files into source code
- If a script needs database access, it MUST read from environment variables with NO fallback, like:
  ```javascript
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  ```

### Before Committing
- Review any new scripts in `/scripts` directory for hardcoded credentials
- Ensure no secrets appear in code, even as "fallback" values
- When in doubt, ask the user to review before committing

## IA Page Count Audit

Books imported from Internet Archive before Dec 30, 2025 may have incorrect page counts. See full report: `docs/ia-page-count-bug-report.md`

### Quick Reference

**Audit:** `npx tsx scripts/audit-ia-page-counts.ts`

**Fix TOO MANY pages** (safe, preserves OCR):
```bash
npx tsx scripts/fix-ia-page-counts.ts --book-id=XXX --correct-count=YYY
```

**Fix TOO FEW pages** (loses OCR):
```bash
curl -X POST https://sourcelibrary.org/api/books/{id}/reimport \
  -H "Content-Type: application/json" -d '{"mode":"full"}'
```

### Issue Types
| Type | Symptom | Fix |
|------|---------|-----|
| TOO MANY | Calibration targets, Google disclaimers after content | Trim excess pages |
| TOO FEW | 100 pages when book has more | Reimport (loses OCR) |

## QA Audit Workflow

When acting as Quality Management Assistant:

1. **Audit Process:**
   - Check 20-30 pages per book for translation quality
   - Compare catalog metadata against title page OCR
   - Align to USTC when possible
   - Make brief reports, no changes to data

2. **Reporting:**
   - Save all reports to `QAreport.md` with date/time
   - Use consistent table format for metadata comparison
   - Note translation quality percentage and any issues

3. **Continuous Work:**
   - After completing a batch of audits, notify user and **continue with the next batch**
   - Don't stop and wait - keep auditing until user says to stop
   - Update todo list as you progress

## Import APIs

Source Library supports importing from three digital library sources:

### Gallica (Bibliothèque nationale de France)
```
POST /api/import/gallica
{
  "ark": "bpt6k61073880",        // Gallica ARK identifier
  "title": "Book Title",
  "author": "Author Name",
  "year": 1617,                   // Optional
  "original_language": "Latin"    // Optional
}
```

### Internet Archive
```
POST /api/import/ia
{
  "ia_identifier": "bookid123",   // Archive.org identifier
  "title": "Book Title",
  "author": "Author Name",
  "year": 1617,                   // Optional
  "original_language": "Latin"    // Optional
}
```

### MDZ (Münchener DigitalisierungsZentrum / Bavarian State Library)
```
POST /api/import/mdz
{
  "bsb_id": "bsb00029099",        // BSB identifier (with or without 'bsb' prefix)
  "title": "Book Title",
  "author": "Author Name",
  "year": 1473,                   // Optional
  "original_language": "Latin"    // Optional
}
```

All import routes:
- Fetch IIIF manifests to get page counts and image URLs
- Create book and page records in MongoDB
- Queue split detection for two-page spreads
- Return book ID and URL on success

## Image Archiving & Provenance

Images from external sources (IA, Gallica, MDZ) are archived to Vercel Blob for reliability and performance. **Original provenance is always preserved.**

### Archive Endpoint
```
POST /api/books/[id]/archive-images
{ "limit": 100 }    // Archive up to 100 pages
```

### Provenance Fields (Book Level)
Every imported book has an `image_source` object:
```json
{
  "provider": "gallica",
  "provider_name": "Gallica (Bibliothèque nationale de France)",
  "source_url": "https://gallica.bnf.fr/ark:/12148/btv1b107201676",
  "iiif_manifest": "https://gallica.bnf.fr/iiif/ark:/12148/.../manifest.json",
  "identifier": "btv1b107201676",
  "license": "https://gallica.bnf.fr/html/und/conditions-dutilisation...",
  "license_url": "https://...",
  "attribution": "Bibliothèque nationale de France",
  "access_date": "2026-01-01T21:46:58.840Z"
}
```

Dublin Core identifiers also stored: `dublin_core.dc_source`, `dublin_core.dc_identifier`

### Provenance Fields (Page Level)
- `photo_original` - Original IIIF URL from source institution (never overwritten)
- `archived_photo` - Vercel Blob URL (used for display when available)
- `archive_metadata.source_url` - URL archived from
- `archive_metadata.archived_at` - Timestamp of archiving
- `archive_metadata.bytes` - File size

### Why Archive?
- Source IIIF servers can be slow or rate-limited
- Vercel Blob CDN provides faster, more reliable access
- Original URLs preserved for citation and verification
- No data loss - originals always accessible via `photo_original`

## Project Context

This is Source Library v2, a Next.js application for digitizing and translating historical texts.

- **Stack**: Next.js 14, MongoDB, Gemini AI for OCR/translation
- **Database**: MongoDB Atlas (credentials in .env.local - DO NOT READ)
- **Deployment**: Vercel

## Gemini Models

Use the latest available Gemini models. As of December 2025:

**Gemini 3 (Latest)**
- `gemini-3-pro-preview` - Best multimodal understanding
- `gemini-3-flash-preview` - Balanced speed/scale/intelligence (use for summarization)

**Gemini 2.5**
- `gemini-2.5-flash` - Stable flash model
- `gemini-2.5-pro` - Stable pro model

**Current Usage**
- Summary/Index generation: `gemini-3-flash-preview`
- OCR: Check batch-ocr route
- Translation: Check translate route

Reference: https://ai.google.dev/gemini-api/docs/models

## Image Extraction

Extract illustrations from book scans with AI-generated metadata (bounding boxes, quality scores, museum descriptions).

### Extract Images from a Book

```bash
# Full extraction - processes ALL pages (recommended for important books)
node scripts/evaluate-extraction.mjs BOOK_ID

# Run in background for large books
node scripts/evaluate-extraction.mjs BOOK_ID &
```

**Output per image:**
- Bounding box coordinates (for cropping)
- Type: emblem, woodcut, engraving, portrait, diagram, etc.
- Gallery quality score (0-1, ≥0.75 shows in gallery guide)
- Museum description (2-3 sentences)
- Metadata: subjects, figures, symbols, style, technique

### Find Book IDs

```bash
# Search by author/title
node -e "
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = await db.collection('books').find({
    \$or: [
      { author: { \$regex: 'SEARCH_TERM', \$options: 'i' } },
      { title: { \$regex: 'SEARCH_TERM', \$options: 'i' } }
    ]
  }).project({ id: 1, title: 1, author: 1 }).toArray();
  books.forEach(b => console.log(b.id, '-', b.title));
  await client.close();
}
main();
"
```

### View Results

- Gallery: `https://sourcelibrary.org/gallery?book=BOOK_ID`
- Single image: `https://sourcelibrary.org/gallery/image/PAGE_ID:INDEX`

### Cost

~$0.0003/page, ~$0.10-0.25 for a 300-800 page book

### Database

**Important:** The production database is `bookstore` (1,200+ books), not `sourcelibrary_research` (old test database).
