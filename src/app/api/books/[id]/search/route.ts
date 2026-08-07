import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { semanticPageSearchScoped } from '@/lib/semantic-search';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { isBookReadable } from '@/lib/book-access';
import { logSearchEvent } from '@/lib/search-event-log';
import { frontMatterVerdict } from '@/lib/front-matter';

interface SearchMatch {
  field: 'ocr' | 'translation';
  snippet: string;
  position: number;
}

interface SearchResult {
  pageId: string;
  pageNumber: number;
  matches: SearchMatch[];
  /** Introduction / preface / contents rather than the body — see src/lib/front-matter.ts. */
  is_front_matter?: boolean;
  reason?: 'roman-pagination' | 'structural-header';
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

    // Hidden (visible:false) books are not public — gate before searching their
    // text. 404 unless editor session or CRON_SECRET (pipeline / Claude Code).
    // A book is only "hidden" if its books doc exists with visible:false; if no
    // doc is found we preserve prior behavior (just search pages) rather than 404.
    const gateBook = await db.collection('books').findOne(
      { $or: [{ id: bookId }, { slug: bookId }] },
      { projection: { id: 1, visible: 1 } }
    );
    if (gateBook && !(await isBookReadable(gateBook, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

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
            // Generate the snippet from the FULL field text, not from the Atlas
            // highlight fragments. The fragments are a window around the hit, so
            // when the hit lands inside a <meta>/<summary>/<keywords>/<vocab>
            // block the fragment carries the editorial prose WITHOUT its wrapper
            // tags — stripEditorialWrappers (which needs the tags) then can't
            // remove it, and the AI page-description gets served as a quote (the
            // "mercury on page 89" leak; PRs #2232/#2233 only fixed the full-field
            // path). generateSnippet runs cleanText over the complete field, where
            // both tags are present, so the block is stripped. If the only hit was
            // inside an editorial block it's now gone, generateSnippet finds
            // nothing, and the page correctly drops out of results.
            const ocr = page.ocr as { data?: string } | undefined;
            const translation = page.translation as { data?: string } | undefined;
            for (const hl of page.highlights as Array<{ path: string; texts: Array<{ value: string; type: string }> }>) {
              const field: 'ocr' | 'translation' = hl.path === 'translation.data' ? 'translation' : 'ocr';
              const fullData = (field === 'translation' ? translation?.data : ocr?.data) || '';
              if (!fullData) continue;
              const hitText = hl.texts.find(t => t.type === 'hit')?.value || matchQuery;
              const snips = generateSnippet(fullData, hitText);
              matches.push(...snips.map(m => ({ ...m, field })));
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
            const ocrData = (page.ocr as { data?: string } | undefined)?.data;
            results.push({
              pageId: page.id as string,
              pageNumber: page.page_number as number,
              matches,
              ...frontMatterVerdict(ocrData),
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
          // Also pull the OCR so the same front-matter judgement can be made
          // here. This is the path the report was actually about — "EVERY
          // semantic search on a 400+ page book returned ~45 pages of front
          // matter" — so flagging only the keyword path would fix the quieter
          // half of the complaint.
          const pageTypeDocs = await db.collection('pages')
            .find({ id: { $in: pageIds } }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } })
            .toArray();
          const ocrById = new Map(pageTypeDocs.map((d) => [d.id as string, (d.ocr as { data?: string } | undefined)?.data]));
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
              ...frontMatterVerdict(ocrById.get(p.page_id)),
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

    // Front matter last. The reported failure was a conceptual query returning
    // 50 consecutive hits from a translator's introduction and the publisher's
    // advertising, with the wanted passage at result #52 (#3653 item 3).
    // DEMOTED, never dropped: a reader searching for what the translator said
    // about his own method is asking a real question, and the count stays
    // honest. Stable within each group, so existing order is otherwise kept.
    const bodyFirst = [
      ...results.filter((r) => !r.is_front_matter),
      ...results.filter((r) => r.is_front_matter),
    ];
    results.length = 0;
    results.push(...bodyFirst);

    let ocrPages = 0;
    let translationPages = 0;
    for (const result of results) {
      if (result.matches.some(m => m.field === 'ocr')) ocrPages++;
      if (result.matches.some(m => m.field === 'translation')) translationPages++;
    }

    // Log search query (fire-and-forget) — see src/lib/search-event-log.ts
    logSearchEvent({
      request, db, query: trimmedQuery, resultsCount: results.length, source: 'book_search',
      tenantId: tenantContext.id || null,
      filters: { book_id: bookId },
    });

    return NextResponse.json({
      query: trimmedQuery,
      total: results.length,
      ocrPages,
      translationPages,
      front_matter_results: results.filter((r) => r.is_front_matter).length,
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
