import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { resolveTenantId } from '@/lib/tenant-context';
import { isBookReadable } from '@/lib/book-access';
import { logSearchEvent } from '@/lib/search-event-log';

interface SearchMatch {
  field: 'ocr' | 'translation';
  snippet: string;
  position: number;
}

interface SearchResult {
  pageId: string;
  pageNumber: number;
  matches: SearchMatch[];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateSnippet(text: string, query: string, contextChars: number = 80): SearchMatch[] {
  const matches: SearchMatch[] = [];
  // Strip editorial wrappers (<meta>/<summary>/<keywords>/<vocab>) AND remaining
  // XML tags before searching/slicing — this route previously sliced raw text,
  // so snippets carried both AI page-descriptions and markup.
  const cleaned = stripEditorialWrappers(text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const lowerText = cleaned.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter(w => w.length > 0);

  // Find all positions where query words appear
  const positions: number[] = [];

  for (const word of words) {
    let pos = 0;
    while ((pos = lowerText.indexOf(word, pos)) !== -1) {
      positions.push(pos);
      pos += 1;
    }
  }

  // Dedupe and sort positions
  const uniquePositions = [...new Set(positions)].sort((a, b) => a - b);

  // Generate snippets for first few matches (limit to 3 per field)
  const snippetPositions: number[] = [];
  for (const pos of uniquePositions) {
    // Skip if too close to an existing snippet
    if (snippetPositions.some(p => Math.abs(p - pos) < contextChars * 2)) {
      continue;
    }
    snippetPositions.push(pos);
    if (snippetPositions.length >= 3) break;
  }

  for (const pos of snippetPositions) {
    const start = Math.max(0, pos - contextChars);
    const end = Math.min(cleaned.length, pos + contextChars + query.length);

    let snippet = cleaned.slice(start, end);

    // Add ellipsis
    if (start > 0) snippet = '...' + snippet;
    if (end < cleaned.length) snippet = snippet + '...';

    matches.push({
      field: 'ocr', // Will be set by caller
      snippet,
      position: pos
    });
  }

  return matches;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  try {
    const { tenant, id: bookId } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    const trimmedQuery = query.trim();
    const db = await getDb();
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — gate before searching their
    // text. 404 unless editor session or CRON_SECRET (pipeline / Claude Code).
    // A book is only "hidden" if its books doc exists with visible:false; if no
    // doc is found we preserve prior behavior (just search pages) rather than 404.
    const gateBook = await db.collection('books').findOne(
      { id: bookId, tenantId },
      { projection: { id: 1, visible: 1 } }
    );
    if (gateBook && !(await isBookReadable(gateBook, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Use regex search with book_id filter — fast because book_id index narrows
    // to just this book's pages (~300 docs) before regex runs.
    // $text search is NOT used here because the pages text index lacks a book_id
    // prefix, so $text + book_id filter scans the entire 420k+ page index.
    const regex = new RegExp(escapeRegex(trimmedQuery), 'i');

    const pages = await db.collection('pages')
      .find({
        book_id: bookId,
        tenantId,
        $or: [
          { 'ocr.data': { $regex: regex } },
          { 'translation.data': { $regex: regex } }
        ]
      }, {
        projection: {
          id: 1,
          page_number: 1,
          'ocr.data': 1,
          'translation.data': 1
        }
      })
      .sort({ page_number: 1 })
      .limit(50)
      .toArray();

    // Generate results with snippets
    const results: SearchResult[] = [];

    for (const page of pages) {
      const matches: SearchMatch[] = [];

      // Search in OCR text
      if (page.ocr?.data) {
        const ocrMatches = generateSnippet(page.ocr.data, trimmedQuery);
        matches.push(...ocrMatches.map(m => ({ ...m, field: 'ocr' as const })));
      }

      // Search in translation
      if (page.translation?.data) {
        const translationMatches = generateSnippet(page.translation.data, trimmedQuery);
        matches.push(...translationMatches.map(m => ({ ...m, field: 'translation' as const })));
      }

      if (matches.length > 0) {
        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          matches
        });
      }
    }

    // Count pages with OCR vs translation matches
    let ocrPages = 0;
    let translationPages = 0;
    for (const result of results) {
      const hasOcr = result.matches.some(m => m.field === 'ocr');
      const hasTranslation = result.matches.some(m => m.field === 'translation');
      if (hasOcr) ocrPages++;
      if (hasTranslation) translationPages++;
    }

    // Log search query (fire-and-forget) — see src/lib/search-event-log.ts
    logSearchEvent({
      request, db, query: trimmedQuery, resultsCount: results.length, source: 'book_search',
      tenantId,
      filters: { book_id: bookId },
    });

    return NextResponse.json({
      query: trimmedQuery,
      total: results.length,
      ocrPages,
      translationPages,
      results
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
