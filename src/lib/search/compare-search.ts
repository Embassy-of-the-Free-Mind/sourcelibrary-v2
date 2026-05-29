/**
 * Compare-search — runs the four /api/search lanes ONCE for a given tenant and
 * returns the SAME candidate set in two orderings: the legacy heuristic ladder
 * and Reciprocal Rank Fusion. Backs the BPH librarian compare page, which asks
 * which ordering they prefer per query.
 *
 * Why a dedicated module (not two /api/search calls): a fair A/B needs one lane
 * execution (identical candidates + no timeout variance between calls), and it
 * must be tenant-scopable explicitly (the compare page runs on a preview where
 * there's no tenant subdomain to set headers). Tenant purity is enforced by a
 * single book-metadata join filtered on tenantId — every lane's hits, including
 * the GLOBAL semantic book lane, are dropped unless the book belongs to the
 * tenant (the same class of leak fixed in /api/search; here it can't happen by
 * construction).
 */
import { getReadDb } from '@/lib/mongodb';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { searchBookIds } from '@/lib/books-catalog';
import { semanticBookSearch, semanticPageSearchGlobal } from '@/lib/semantic-search';
import { rrfScores } from '@/lib/search/rrf';

export interface CompareResult {
  id: string;            // book.id (book) or `${book_id}-p${page_number}` (page)
  type: 'book' | 'page';
  book_id: string;
  slug?: string;
  title: string;
  author?: string;
  language?: string;
  published?: string;
  page_number?: number;
  snippet?: string;
  /** Which lanes surfaced this hit — shown for transparency, not scored. */
  lanes: string[];
}

export interface CompareResponse {
  query: string;
  tenant: string;
  count: number;
  ladder: CompareResult[];
  rrf: CompareResult[];
}

function cleanText(t: string): string {
  return t.replace(/<[^>]+>/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * Legacy relevance ladder, kept in sync with src/app/api/search/route.ts.
 * (A future refactor could share one comparator; duplicated here to avoid
 * touching the route while #2154 is under review.)
 */
function ladderCompare(query: string) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 3);
  const ENGLISH = 'English';
  return (a: CompareResult, b: CompareResult): number => {
    if (a.type !== b.type) return a.type === 'book' ? -1 : 1;
    const aText = `${a.title.toLowerCase()} ${(a.author || '').toLowerCase()}`;
    const bText = `${b.title.toLowerCase()} ${(b.author || '').toLowerCase()}`;
    const aHits = queryWords.filter(w => aText.includes(w)).length;
    const bHits = queryWords.filter(w => bText.includes(w)).length;
    if (aHits !== bHits) return bHits - aHits;
    const aExact = a.title.toLowerCase().includes(queryLower);
    const bExact = b.title.toLowerCase().includes(queryLower);
    if (aExact !== bExact) return aExact ? -1 : 1;
    const aOrig = a.language !== ENGLISH ? 1 : 0;
    const bOrig = b.language !== ENGLISH ? 1 : 0;
    if (aOrig !== bOrig) return bOrig - aOrig;
    const aYear = parseInt(a.published?.match(/\d{3,4}/)?.[0] || '9999');
    const bYear = parseInt(b.published?.match(/\d{3,4}/)?.[0] || '9999');
    return aYear - bYear;
  };
}

export async function compareSearch(
  query: string,
  tenantId: string,
  tenantSlug: string,
  perColumn = 12,
): Promise<CompareResponse> {
  const matchQuery = /^".*"$/.test(query.trim()) ? query.trim().slice(1, -1) : query;
  const db = await getReadDb();

  // Four lanes in parallel (each fails soft to []).
  const [kwBookIds, kwPages, semBooks, semPages] = await Promise.all([
    searchBookIds(query, { limit: 40 }).catch(() => [] as string[]),
    db.collection('pages').aggregate([
      buildPageSearchStage(query),
      { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
      { $limit: 40 },
      { $project: { id: 1, page_number: 1, book_id: 1, 'translation.data': 1, 'ocr.data': 1 } },
    ], { maxTimeMS: 8000 }).toArray().catch(() => [] as any[]),
    semanticBookSearch(matchQuery, 25).catch(() => [] as any[]),
    semanticPageSearchGlobal(matchQuery, 20, { tenantId, maxPerBook: 2 }).catch(() => [] as any[]),
  ]);

  // Single tenant-scoped book-metadata join — the tenant purity gate. Any hit
  // whose book isn't a visible, paged book of THIS tenant is dropped.
  const allBookIds = [...new Set<string>([
    ...kwBookIds,
    ...kwPages.map(p => p.book_id as string),
    ...semBooks.map((b: any) => b.book_id as string),
    ...semPages.map((p: any) => p.book_id as string),
  ])];
  const bookDocs = allBookIds.length > 0
    ? await db.collection('books')
        .find({ id: { $in: allBookIds }, tenantId, visible: true, pages_count: { $gt: 0 } })
        .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, reading_summary: 1, summary: 1, quality_score: 1 })
        .toArray()
    : [];
  const bookMap = new Map(bookDocs.map(b => [b.id as string, b]));

  // Assemble candidates keyed by result id; remember per-lane ranked id lists.
  const candidates = new Map<string, CompareResult>();
  const laneIds: Record<string, string[]> = { kwBook: [], kwPage: [], semBook: [], semPage: [] };

  const addBook = (bookId: string, lane: string) => {
    const b = bookMap.get(bookId);
    if (!b) return null;
    const id = b.id as string;
    laneIds[lane].push(id);
    if (!candidates.has(id)) {
      const summary = (b as any).reading_summary?.overview
        || (typeof (b as any).summary === 'string' ? (b as any).summary : (b as any).summary?.data) || '';
      candidates.set(id, {
        id, type: 'book', book_id: id, slug: b.slug as string,
        title: (b.display_title as string) || (b.title as string), author: b.author as string,
        language: b.language as string, published: b.published as string,
        snippet: summary ? cleanText(summary).slice(0, 220) : undefined,
        lanes: [lane],
      });
    } else { candidates.get(id)!.lanes.push(lane); }
    return id;
  };
  const addPage = (bookId: string, pageNumber: number, snippet: string, lane: string) => {
    const b = bookMap.get(bookId);
    if (!b) return null;
    const id = `${bookId}-p${pageNumber}`;
    laneIds[lane].push(id);
    if (!candidates.has(id)) {
      candidates.set(id, {
        id, type: 'page', book_id: bookId, slug: b.slug as string,
        title: (b.display_title as string) || (b.title as string), author: b.author as string,
        language: b.language as string, published: b.published as string,
        page_number: pageNumber, snippet: snippet ? cleanText(snippet).slice(0, 220) : undefined,
        lanes: [lane],
      });
    } else { candidates.get(id)!.lanes.push(lane); }
    return id;
  };

  for (const bid of kwBookIds) addBook(bid, 'kwBook');
  for (const p of kwPages) addPage(p.book_id, p.page_number, (p.translation?.data || p.ocr?.data || ''), 'kwPage');
  for (const b of semBooks) addBook(b.book_id, 'semBook');
  for (const p of semPages) addPage(p.book_id, p.page_number, p.snippet || '', 'semPage');

  const all = [...candidates.values()];
  const rrf = rrfScores([laneIds.kwBook, laneIds.kwPage, laneIds.semBook, laneIds.semPage]);
  const ladder = ladderCompare(matchQuery);

  const ladderOrder = [...all].sort(ladder).slice(0, perColumn);
  const rrfOrder = [...all].sort((a, b) => {
    const sa = rrf.get(a.id) ?? 0, sb = rrf.get(b.id) ?? 0;
    if (sb !== sa) return sb - sa;
    return ladder(a, b);
  }).slice(0, perColumn);

  return { query, tenant: tenantSlug, count: all.length, ladder: ladderOrder, rrf: rrfOrder };
}
