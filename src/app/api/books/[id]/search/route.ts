import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage } from '@/lib/atlas-search';

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

/** Strip XML/HTML tags and clean up formatting artifacts */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateSnippet(text: string, query: string, contextChars: number = 80): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const cleaned = cleanText(text);
  const lowerText = cleaned.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter(w => w.length > 0);

  const positions: number[] = [];
  for (const word of words) {
    let pos = 0;
    while ((pos = lowerText.indexOf(word, pos)) !== -1) {
      positions.push(pos);
      pos += 1;
    }
  }

  const uniquePositions = [...new Set(positions)].sort((a, b) => a - b);
  const snippetPositions: number[] = [];
  for (const pos of uniquePositions) {
    if (snippetPositions.some(p => Math.abs(p - pos) < contextChars * 2)) continue;
    snippetPositions.push(pos);
    if (snippetPositions.length >= 3) break;
  }

  for (const pos of snippetPositions) {
    const start = Math.max(0, pos - contextChars);
    const end = Math.min(cleaned.length, pos + contextChars + query.length);
    let snippet = cleaned.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < cleaned.length) snippet = snippet + '...';
    matches.push({ field: 'ocr', snippet, position: pos });
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

    // Try Atlas Search first (stemming, relevance ranking, highlights)
    // Falls back to regex if Atlas Search index is unavailable
    let pages: Record<string, unknown>[];
    let usedAtlas = false;

    try {
      pages = await db.collection('pages').aggregate([
        buildPageSearchStage(trimmedQuery, bookId),
        { $sort: { page_number: 1 } },
        { $limit: 50 },
        {
          $project: {
            id: 1,
            page_number: 1,
            book_id: 1,
            'ocr.data': 1,
            'translation.data': 1,
            highlights: { $meta: 'searchHighlights' },
          },
        },
      ], { maxTimeMS: 10000 }).toArray();
      usedAtlas = true;
    } catch {
      // Fallback: regex search (no stemming but always works)
      const regex = new RegExp(escapeRegex(trimmedQuery), 'i');
      pages = await db.collection('pages')
        .find({
          book_id: bookId,
          $or: [
            { 'ocr.data': { $regex: regex } },
            { 'translation.data': { $regex: regex } }
          ]
        }, {
          projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 }
        })
        .sort({ page_number: 1 })
        .limit(50)
        .toArray();
    }

    const results: SearchResult[] = [];

    for (const page of pages) {
      const matches: SearchMatch[] = [];

      if (usedAtlas && Array.isArray(page.highlights) && page.highlights.length > 0) {
        // Use Atlas Search highlights
        for (const hl of page.highlights as Array<{ path: string; texts: Array<{ value: string; type: string }> }>) {
          const field: 'ocr' | 'translation' = hl.path === 'translation.data' ? 'translation' : 'ocr';
          const snippet = hl.texts.map(t => t.value).join('');
          matches.push({ field, snippet, position: 0 });
        }
      } else {
        // Fallback: generate snippets from raw text
        const ocr = page.ocr as { data?: string } | undefined;
        const translation = page.translation as { data?: string } | undefined;
        if (ocr?.data) {
          const ocrMatches = generateSnippet(ocr.data, trimmedQuery);
          matches.push(...ocrMatches.map(m => ({ ...m, field: 'ocr' as const })));
        }
        if (translation?.data) {
          const translationMatches = generateSnippet(translation.data, trimmedQuery);
          matches.push(...translationMatches.map(m => ({ ...m, field: 'translation' as const })));
        }
      }

      if (matches.length > 0) {
        results.push({
          pageId: page.id as string,
          pageNumber: page.page_number as number,
          matches
        });
      }
    }

    let ocrPages = 0;
    let translationPages = 0;
    for (const result of results) {
      if (result.matches.some(m => m.field === 'ocr')) ocrPages++;
      if (result.matches.some(m => m.field === 'translation')) translationPages++;
    }

    // Log search query (fire-and-forget)
    db.collection('analytics_events').insertOne({
      event: 'search_query',
      query: trimmedQuery,
      results_count: results.length,
      filters: { book_id: bookId, source: 'book_search' },
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      created_at: new Date(),
    }).catch(() => {});

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
