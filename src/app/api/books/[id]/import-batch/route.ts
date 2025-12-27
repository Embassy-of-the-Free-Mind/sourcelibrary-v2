import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Import batch OCR/translation results into a book's pages.
 *
 * POST /api/books/[id]/import-batch
 * Body: {
 *   type: "ocr" | "translation",
 *   results: {
 *     "ocr_0001-0010": "=== PAGE 1 ===\n...\n=== PAGE 2 ===\n...",
 *     ...
 *   },
 *   model?: string,
 *   language?: string
 * }
 *
 * The results keys are in format "ocr_XXXX-YYYY" or "trans_XXXX-YYYY"
 * where XXXX is start page and YYYY is end page.
 * Each result contains text with "=== PAGE N ===" markers.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const {
      type,
      results,
      model = 'gemini-3-flash-preview',
      language = 'Latin'
    }: {
      type: 'ocr' | 'translation';
      results: Record<string, string>;
      model?: string;
      language?: string;
    } = body;

    if (!type || !results) {
      return NextResponse.json(
        { error: 'Missing required fields: type, results' },
        { status: 400 }
      );
    }

    if (type !== 'ocr' && type !== 'translation') {
      return NextResponse.json(
        { error: 'type must be "ocr" or "translation"' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Find the book
    const book = await db.collection('books').findOne({
      $or: [{ id: bookId }, { ia_identifier: bookId }]
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const actualBookId = book.id || book._id.toString();

    // Get all pages for this book
    const pages = await db.collection('pages')
      .find({ book_id: actualBookId })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found for book' }, { status: 404 });
    }

    // Create page number -> page ID mapping
    const pageMap = new Map(pages.map(p => [p.page_number, p.id]));

    // Parse results and update pages
    const updates: { pageNumber: number; pageId: string; text: string }[] = [];
    const errors: string[] = [];

    for (const [key, batchText] of Object.entries(results)) {
      // Parse key like "ocr_0001-0010" or "trans_0001-0010"
      const match = key.match(/(?:ocr|trans)_(\d+)-(\d+)/);
      if (!match) {
        errors.push(`Invalid key format: ${key}`);
        continue;
      }

      const startPage = parseInt(match[1], 10);
      const endPage = parseInt(match[2], 10);

      // Parse the batch text to extract individual page results
      // Format: === PAGE N ===, <page-num>N</page-num>, or [[page number: N]]
      const pageTexts = parseBatchText(batchText, startPage, endPage);

      for (const { pageNumber, text } of pageTexts) {
        const pageId = pageMap.get(pageNumber);
        if (!pageId) {
          errors.push(`Page ${pageNumber} not found in book`);
          continue;
        }
        updates.push({ pageNumber, pageId, text });
      }
    }

    // Apply updates
    const now = new Date();
    let updatedCount = 0;

    for (const { pageId, text } of updates) {
      const updateField = type === 'ocr' ? 'ocr' : 'translation';
      const updateData = type === 'ocr'
        ? {
            data: text,
            updated_at: now,
            model,
            language,
          }
        : {
            data: text,
            updated_at: now.toISOString(),
            model,
            source_language: language,
            target_language: 'English',
          };

      await db.collection('pages').updateOne(
        { id: pageId },
        { $set: { [updateField]: updateData, updated_at: now } }
      );
      updatedCount++;
    }

    return NextResponse.json({
      success: true,
      bookId: actualBookId,
      type,
      updatedPages: updatedCount,
      totalResults: Object.keys(results).length,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Import batch error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Parse batch text containing multiple pages into individual page texts.
 * Handles formats:
 * - === PAGE N ===
 * - <page-num>N</page-num>
 * - [[page number: N]]
 * - Page N:
 */
function parseBatchText(
  batchText: string,
  startPage: number,
  endPage: number
): { pageNumber: number; text: string }[] {
  const results: { pageNumber: number; text: string }[] = [];

  // Try different splitting patterns

  // Pattern 1: === PAGE N ===
  const pageMarkerPattern = /===\s*PAGE\s*(\d+)\s*===/gi;
  const parts = batchText.split(pageMarkerPattern);

  if (parts.length > 1) {
    // parts[0] is before first marker, then alternating: pageNum, content, pageNum, content...
    for (let i = 1; i < parts.length; i += 2) {
      const pageNum = parseInt(parts[i], 10);
      const text = parts[i + 1]?.trim();
      if (text && pageNum >= startPage && pageNum <= endPage) {
        results.push({ pageNumber: pageNum, text });
      }
    }
    if (results.length > 0) return results;
  }

  // Pattern 2: <page-num>N</page-num> markers (new XML syntax)
  const xmlPattern = /<page-num>(\d+)<\/page-num>/gi;
  const xmlParts = batchText.split(xmlPattern);

  if (xmlParts.length > 1) {
    for (let i = 1; i < xmlParts.length; i += 2) {
      const pageNum = parseInt(xmlParts[i], 10);
      const text = xmlParts[i + 1]?.trim();
      if (text && pageNum >= startPage && pageNum <= endPage) {
        results.push({ pageNumber: pageNum, text });
      }
    }
    if (results.length > 0) return results;
  }

  // Pattern 3: [[page number: N]] markers (legacy bracket syntax)
  const bracketPattern = /\[\[page number:\s*(\d+)\]\]/gi;
  const bracketParts = batchText.split(bracketPattern);

  if (bracketParts.length > 1) {
    for (let i = 1; i < bracketParts.length; i += 2) {
      const pageNum = parseInt(bracketParts[i], 10);
      const text = bracketParts[i + 1]?.trim();
      if (text && pageNum >= startPage && pageNum <= endPage) {
        results.push({ pageNumber: pageNum, text });
      }
    }
    if (results.length > 0) return results;
  }

  // Pattern 3: Just split evenly if we know the page range
  // This is a fallback for when no markers are found
  const pageCount = endPage - startPage + 1;
  if (pageCount === 1) {
    // Single page batch - just use the whole text
    results.push({ pageNumber: startPage, text: batchText.trim() });
    return results;
  }

  // Try splitting by common separators
  const separatorPattern = /\n\s*[-=]{3,}\s*\n/;
  const sections = batchText.split(separatorPattern).filter(s => s.trim());

  if (sections.length === pageCount) {
    for (let i = 0; i < sections.length; i++) {
      results.push({ pageNumber: startPage + i, text: sections[i].trim() });
    }
    return results;
  }

  // Last resort: treat entire batch as one page (first page)
  console.warn(`Could not parse batch for pages ${startPage}-${endPage}, using as single block`);
  results.push({ pageNumber: startPage, text: batchText.trim() });

  return results;
}
