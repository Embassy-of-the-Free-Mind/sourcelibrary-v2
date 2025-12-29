# Split Page Detection

This document describes the system for detecting and handling two-page book scans (spreads) that need to be split into individual pages.

## Overview

Many digitized books from Internet Archive and Gallica are scanned as two-page spreads (open book). These need to be split into individual pages before OCR and translation for best results.

## Detection Flow

### At Import Time (Automatic)

When a book is imported via `/api/import/ia` or `/api/import/gallica`:

1. Pages are created with `photo_original` URLs
2. A non-blocking call is made to `/api/books/[id]/check-needs-split`
3. The check samples pages 10 and 15 (avoids cover/title pages)
4. Sets `book.needs_splitting` based on aspect ratio analysis

### Manual Check

```bash
# Check a specific book
curl "https://sourcelibrary.org/api/books/BOOK_ID/check-needs-split"

# Dry run (don't update book)
curl "https://sourcelibrary.org/api/books/BOOK_ID/check-needs-split?dryRun=true"

# Use AI for ambiguous cases (costs ~$0.001/page)
curl "https://sourcelibrary.org/api/books/BOOK_ID/check-needs-split?useAI=true"
```

### Batch Audit

```bash
# See which books need checking
curl "https://sourcelibrary.org/api/books/audit-splits"

# Check up to 10 unchecked books
curl -X POST "https://sourcelibrary.org/api/books/audit-splits" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}'

# Check specific books
curl -X POST "https://sourcelibrary.org/api/books/audit-splits" \
  -H "Content-Type: application/json" \
  -d '{"bookIds": ["id1", "id2", "id3"]}'
```

## Detection Algorithm

### Aspect Ratio Thresholds

| Aspect Ratio | Classification | Confidence |
|--------------|----------------|------------|
| < 0.9 | Single page (portrait) | High |
| 0.9 - 1.3 | Ambiguous | Low (needs AI or manual) |
| > 1.3 | Two-page spread (landscape) | High |

### Sample Pages

We sample pages 10 and 15 because:
- Avoids cover pages (often different format)
- Avoids front matter (title pages, TOC)
- Representative of actual content
- Two samples provide redundancy

### Decision Logic

```
If all samples are spreads (>1.3) → needs_splitting = true (high confidence)
If all samples are single (<0.9) → needs_splitting = false (high confidence)
If majority spreads → needs_splitting = true (medium confidence)
If majority single → needs_splitting = false (medium confidence)
If tie or all ambiguous → needs_splitting = null (manual review needed)
```

## Book Fields

```typescript
interface Book {
  // ...existing fields...

  needs_splitting?: boolean | null;  // true = spreads, false = single, null = ambiguous
  split_check?: {
    checked_at: Date;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    sample_results?: Array<{
      pageNumber: number;
      aspectRatio: number;
      classification: 'single' | 'spread' | 'ambiguous';
      error?: string;
    }>;
  };
}
```

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/books/[id]/check-needs-split` | GET | Check if book needs splitting |
| `/api/books/audit-splits` | GET | List unchecked books |
| `/api/books/audit-splits` | POST | Batch check multiple books |

## Integration with Curator Workflow

The agent curator can:

1. **After import**: Check `book.needs_splitting` flag
2. **If true**: Queue for split workflow using `/book/[id]/split` UI or ML auto-split
3. **If null**: Flag for manual review
4. **If false**: Proceed directly to OCR/translation

### Example Curator Query

```javascript
// Find books that need splitting
const booksNeedingSplit = await db.collection('books')
  .find({ needs_splitting: true })
  .toArray();

// Find books with ambiguous results (need manual review)
const ambiguousBooks = await db.collection('books')
  .find({ needs_splitting: null, 'split_check': { $exists: true } })
  .toArray();
```

## Related Documentation

- [BATCH-PROCESSING.md](./BATCH-PROCESSING.md) - Pipeline for OCR/translation
- [Split Detection ML](../src/lib/splitDetectionML.ts) - ML model for split position
- [Split UI](../src/app/book/[id]/split/page.tsx) - Manual split interface
