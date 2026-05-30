import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { semanticPageSearchScoped } from '@/lib/semantic-search';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

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
  return stripEditorialWrappers(text)           // drop <meta>/<summary>/<keywords>/<vocab> prose first
    .replace(/<[^>]+>/g, '')                    // strip remaining tags, keep inner body text
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // strip markdown bold
    .replace(/\*([^*]+)\*/g, '$1')              // strip markdown italic
    .replace(/original:\s*[^;]+;?\s*/gi, '')    // strip "original: Latin;" annotations
    .replace(/\s+/g, ' ')                       // collapse whitespace
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
    const tenantContext = getTenantContextFromRequest(request.headers);

    if (tenantContext.slug && !tenantContext.id) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    const trimmedQuery = query.trim();
    // Strip surrounding quotes for matching — buildPageSearchStage handles phrase detection internally
    const isPhrase = /^".*"$/.test(trimmedQuery);
    const matchQuery = isPhrase ? trimmedQuery.slice(1, -1) : trimmedQuery;
    const db = await getDb();

    // Run keyword search and semantic search in parallel
    const [keywordResults, semanticResults] = await Promise.all([
      // --- Keyword search (Atlas Search with regex fallback) ---
      (async (): Promise<SearchResult[]> => {
        let pages: Record<string, unknown>[];
        let usedAtlas = false;

        try {
          pages = await db.collection('pages').aggregate([
            buildPageSearchStage(trimmedQuery, bookId),
            { $match: { page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
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
          const regex = new RegExp(escapeRegex(matchQuery), 'i');
          const regexFilter: Record<string, unknown> = {
            book_id: bookId,
            page_type: { $nin: NON_CONTENT_PAGE_TYPES },
            $or: [
              { 'ocr.data': { $regex: regex } },
              { 'translation.data': { $regex: regex } }
            ]
          };
          if (tenantContext.id) regexFilter.tenantId = tenantContext.id;
          pages = await db.collection('pages')
            .find(regexFilter, {
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
              const raw = cleanText(hl.texts.map(t => t.value).join(''));
              // Cap highlight length — Atlas Search can return entire page content
              const MAX_SNIPPET = 300;
              let snippet = raw;
              if (raw.length > MAX_SNIPPET) {
                // Find the highlight hit (marked by type: 'hit') and center around it
                const hitText = hl.texts.find(t => t.type === 'hit')?.value?.toLowerCase() || matchQuery.toLowerCase();
                const hitPos = raw.toLowerCase().indexOf(hitText);
                if (hitPos >= 0) {
                  const half = Math.floor(MAX_SNIPPET / 2);
                  const start = Math.max(0, hitPos - half);
                  const end = Math.min(raw.length, hitPos + hitText.length + half);
                  snippet = (start > 0 ? '...' : '') + raw.slice(start, end) + (end < raw.length ? '...' : '');
                } else {
                  snippet = raw.slice(0, MAX_SNIPPET) + '...';
                }
              }
              matches.push({ field, snippet, position: 0 });
            }
          } else {
            const ocr = page.ocr as { data?: string } | undefined;
            const translation = page.translation as { data?: string } | undefined;
            if (ocr?.data) {
              const ocrMatches = generateSnippet(ocr.data, matchQuery);
              matches.push(...ocrMatches.map(m => ({ ...m, field: 'ocr' as const })));
            }
            if (translation?.data) {
              const translationMatches = generateSnippet(translation.data, matchQuery);
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
        return results;
      })(),

      // --- Semantic search (conceptual matches via page embeddings) ---
      (async (): Promise<SearchResult[]> => {
        try {
          const pages = await semanticPageSearchScoped(trimmedQuery, [bookId], 10);
          const filtered = pages.filter(p => p.snippet && p.snippet.length > 20);
          if (filtered.length === 0) return [];
          // Look up page_type to drop boilerplate (title-page, blank, illustration, etc.)
          // — these have embeddings in Supabase but aren't real book content.
          const pageIds = filtered.map(p => p.page_id);
          const pageTypeDocs = await db.collection('pages')
            .find({ id: { $in: pageIds } }, { projection: { id: 1, page_type: 1 } })
            .toArray();
          const badIds = new Set(
            pageTypeDocs
              .filter(d => (NON_CONTENT_PAGE_TYPES as readonly string[]).includes(d.page_type as string))
              .map(d => d.id as string),
          );
          return filtered
            .filter(p => !badIds.has(p.page_id))
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

    // Merge: keyword results first, then semantic results for pages not already found
    const seenPages = new Set(keywordResults.map(r => r.pageNumber));
    const results: SearchResult[] = [...keywordResults];
    for (const sem of semanticResults) {
      if (!seenPages.has(sem.pageNumber)) {
        results.push(sem);
        seenPages.add(sem.pageNumber);
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
      filters: { book_id: bookId, source: 'book_search', tenantId: tenantContext.id || null },
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
