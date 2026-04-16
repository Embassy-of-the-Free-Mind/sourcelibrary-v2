import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage } from '@/lib/atlas-search';
import { semanticPageSearchScoped } from '@/lib/semantic-search';

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

/**
 * Strip OCR metadata sections from page text before searching.
 * These tags contain scan descriptions, not book content — matching
 * inside them produces false positives (e.g. "life" in <image-desc>).
 */
function stripOcrMetadata(text: string): string {
  return text
    .replace(/<warning>[\s\S]*?<\/warning>/gi, '')
    .replace(/<image-desc[\s\S]*?<\/image-desc>/gi, '')
    .replace(/<meta>[\s\S]*?<\/meta>/gi, '')
    .replace(/<page-type>[\s\S]*?<\/page-type>/gi, '')
    .replace(/<language>[\s\S]*?<\/language>/gi, '')
    .replace(/<lang>[\s\S]*?<\/lang>/gi, '')
    .replace(/<script>[\s\S]*?<\/script>/gi, '')
    .replace(/<note>[\s\S]*?<\/note>/gi, '');
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

    // Run keyword search first, then semantic only if keyword found few results
    const [keywordResults, semanticResults] = await Promise.all([
      // --- Keyword search (Atlas Search with regex fallback) ---
      (async (): Promise<SearchResult[]> => {
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
            for (const hl of page.highlights as Array<{ path: string; texts: Array<{ value: string; type: string }> }>) {
              const field: 'ocr' | 'translation' = hl.path === 'translation.data' ? 'translation' : 'ocr';
              const snippet = hl.texts.map(t => t.value).join('');
              // Skip highlights that are purely OCR metadata
              if (stripOcrMetadata(snippet).trim().length < 10) continue;
              matches.push({ field, snippet: cleanText(snippet), position: 0 });
            }
          } else {
            const ocr = page.ocr as { data?: string } | undefined;
            const translation = page.translation as { data?: string } | undefined;
            if (ocr?.data) {
              const stripped = stripOcrMetadata(ocr.data);
              if (stripped.trim().length > 20) {
                const ocrMatches = generateSnippet(stripped, trimmedQuery);
                matches.push(...ocrMatches.map(m => ({ ...m, field: 'ocr' as const })));
              }
            }
            if (translation?.data) {
              const stripped = stripOcrMetadata(translation.data);
              if (stripped.trim().length > 20) {
                const translationMatches = generateSnippet(stripped, trimmedQuery);
                matches.push(...translationMatches.map(m => ({ ...m, field: 'translation' as const })));
              }
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
        return results;
      })(),

      // --- Semantic search (conceptual matches via page embeddings) ---
      (async (): Promise<SearchResult[]> => {
        try {
          const pages = await semanticPageSearchScoped(trimmedQuery, [bookId], 10);
          return pages
            .filter(p => p.snippet && p.snippet.length > 20)
            .map(p => ({
              pageId: p.page_id,
              pageNumber: p.page_number,
              matches: [{
                field: 'translation' as const,
                snippet: p.snippet,
                position: 0,
              }],
            }));
        } catch {
          return [];
        }
      })(),
    ]);

    // Merge: keyword results first, then semantic results for pages not already found.
    // Only add semantic results when keyword returned few matches — if keyword found
    // 10+ pages, semantic additions are redundant and add noise.
    const seenPages = new Set(keywordResults.map(r => r.pageNumber));
    const results: SearchResult[] = [...keywordResults];
    if (keywordResults.length < 10) {
      for (const sem of semanticResults) {
        if (!seenPages.has(sem.pageNumber)) {
          results.push(sem);
          seenPages.add(sem.pageNumber);
        }
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
