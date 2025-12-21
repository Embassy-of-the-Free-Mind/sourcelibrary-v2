import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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
  const lowerText = text.toLowerCase();
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
    const end = Math.min(text.length, pos + contextChars + query.length);

    let snippet = text.slice(start, end);

    // Add ellipsis
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    // Highlight all query words in the snippet
    for (const word of words) {
      const regex = new RegExp(`(${escapeRegex(word)})`, 'gi');
      snippet = snippet.replace(regex, '<mark>$1</mark>');
    }

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    const trimmedQuery = query.trim();
    const db = await getDb();

    // Try text search first (requires index), fall back to regex
    let pages;
    try {
      // Text search with MongoDB $text (if index exists)
      pages = await db.collection('pages')
        .find({
          book_id: bookId,
          $text: { $search: trimmedQuery }
        }, {
          projection: {
            id: 1,
            page_number: 1,
            'ocr.data': 1,
            'translation.data': 1,
            score: { $meta: 'textScore' }
          }
        })
        .sort({ score: { $meta: 'textScore' } })
        .limit(50)
        .toArray();
    } catch {
      // Fall back to regex search if no text index
      const regexPattern = trimmedQuery.split(/\s+/).map(escapeRegex).join('|');
      const regex = new RegExp(regexPattern, 'i');

      pages = await db.collection('pages')
        .find({
          book_id: bookId,
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
    }

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
