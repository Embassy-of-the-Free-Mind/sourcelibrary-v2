import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const ENTITIES_SEARCH_INDEX = 'entities_search';

interface IndexSearchResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
  book_slug?: string;
  book_title: string;
  book_author: string;
  pages?: number[];
  // For quotes
  quote_text?: string;
  quote_page?: number;
  quote_significance?: string;
  section_title?: string;
}

// GET /api/search/index - Search across all book indexes
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const type = searchParams.get('type'); // Filter by type: keyword, concept, person, place, vocabulary, quote
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Query must be at least 2 characters',
        results: [],
        total: 0,
      }, { status: 400 });
    }

    const db = await getDb();
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const queryRegex = new RegExp(escapedQuery, 'i');

    const wantTerms = !type || !['quote'].includes(type);
    const wantQuotes = !type || type === 'quote';

    // Run entity search + quote search in parallel
    const [termResults, quoteResults] = await Promise.all([
      wantTerms ? searchEntities(db, query, queryRegex, type, limit) : Promise.resolve([]),
      wantQuotes ? searchQuotes(db, queryRegex, limit) : Promise.resolve([]),
    ]);

    const results = [...termResults, ...quoteResults].slice(0, limit);

    // Group results by type for summary
    const byType: Record<string, number> = {
      vocabulary: 0, keyword: 0, concept: 0, person: 0, place: 0, quote: 0,
    };
    for (const r of results) {
      byType[r.type] = (byType[r.type] || 0) + 1;
    }

    // Log search query (fire-and-forget)
    db.collection('analytics_events').insertOne({
      event: 'search_query',
      query,
      results_count: results.length,
      filters: { type, source: 'index' },
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      created_at: new Date(),
    }).catch(() => {});

    const response = NextResponse.json({ query, total: results.length, byType, results });
    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return response;
  } catch (error) {
    console.error('Index search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

/**
 * Search the entities collection (Atlas Search with autocomplete + fuzzy).
 * Falls back to regex if Atlas Search index unavailable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchEntities(db: any, query: string, queryRegex: RegExp, type: string | null, limit: number): Promise<IndexSearchResult[]> {
  // Map type filter to entity types
  const entityTypeFilter = type && type !== 'quote'
    ? [type === 'keyword' ? 'keyword' : type === 'vocabulary' ? 'keyword' : type]
    : undefined;

  let entities;
  try {
    // Primary: Atlas Search on entities collection
    const compound: Record<string, unknown> = {
      should: [
        { autocomplete: { query, path: 'name', score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
        { autocomplete: { query, path: 'aliases', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
      ],
      minimumShouldMatch: 1,
    };
    if (entityTypeFilter) {
      compound.filter = [{ text: { query: entityTypeFilter, path: 'type' } }];
    }

    entities = await db.collection('entities').aggregate([
      { $search: { index: ENTITIES_SEARCH_INDEX, compound } },
      { $limit: limit * 3 },
      { $project: { name: 1, type: 1, books: 1, book_count: 1 } },
    ], { maxTimeMS: 5000 }).toArray();
  } catch {
    // Fallback: regex on entities collection
    const filter: Record<string, unknown> = {
      $or: [{ name: queryRegex }, { aliases: queryRegex }],
    };
    if (entityTypeFilter) filter.type = { $in: entityTypeFilter };

    entities = await db.collection('entities')
      .find(filter)
      .project({ name: 1, type: 1, books: 1, book_count: 1 })
      .sort({ book_count: -1 })
      .limit(limit * 3)
      .maxTimeMS(5000)
      .toArray();
  }

  // Expand entities into per-book results
  const results: IndexSearchResult[] = [];
  for (const entity of entities) {
    for (const book of (entity.books || []).slice(0, 3)) {
      results.push({
        type: entity.type === 'person' ? 'person' : entity.type === 'place' ? 'place' : entity.type === 'keyword' ? 'keyword' : 'concept',
        term: entity.name,
        book_id: book.book_id,
        book_slug: book.book_slug,
        book_title: book.book_title || '',
        book_author: book.book_author || '',
        pages: book.pages?.slice(0, 10),
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  // If entities returned nothing, fall back to book index arrays (with maxTimeMS)
  if (results.length === 0 && query.length >= 3) {
    const books = await db.collection('books').find({
      'index.generatedAt': { $exists: true },
      visible: true,
      pages_count: { $gt: 0 },
      $or: [
        { 'index.concepts.term': queryRegex },
        { 'index.people.term': queryRegex },
        { 'index.places.term': queryRegex },
        { 'index.keywords.term': queryRegex },
      ],
    }).project({
      id: 1, slug: 1, title: 1, display_title: 1, author: 1,
      'index.concepts': 1, 'index.people': 1, 'index.places': 1, 'index.keywords': 1,
    }).limit(10).maxTimeMS(8000).toArray();

    for (const book of books) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allEntries: any[] = [
        ...(book.index?.concepts || []).map((e: any) => ({ ...e, type: 'concept' })),
        ...(book.index?.people || []).map((e: any) => ({ ...e, type: 'person' })),
        ...(book.index?.places || []).map((e: any) => ({ ...e, type: 'place' })),
        ...(book.index?.keywords || []).map((e: any) => ({ ...e, type: 'keyword' })),
      ];
      const matching = allEntries.filter(e => queryRegex.test(e.term));
      for (const entry of matching.slice(0, 3)) {
        results.push({
          type: entry.type,
          term: entry.term,
          book_id: book.id || book._id?.toString(),
          book_slug: book.slug,
          book_title: book.display_title || book.title,
          book_author: book.author || 'Unknown',
          pages: entry.pages?.slice(0, 10),
        });
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }
  }

  return results;
}

/**
 * Search quotes in book section summaries.
 * Uses maxTimeMS to prevent runaway aggregation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchQuotes(db: any, queryRegex: RegExp, limit: number): Promise<IndexSearchResult[]> {
  try {
    const quoteResults = await db.collection('books').aggregate([
      { $match: {
          'index.generatedAt': { $exists: true },
          visible: true,
          pages_count: { $gt: 0 },
          'index.sectionSummaries.quotes.text': queryRegex,
        }
      },
      { $limit: 20 }, // Limit books scanned before unwind
      { $project: {
          id: 1,
          slug: 1,
          book_title: { $ifNull: ['$display_title', '$title'] },
          book_author: { $ifNull: ['$author', 'Unknown'] },
          sections: { $ifNull: ['$index.sectionSummaries', []] },
        }
      },
      { $unwind: '$sections' },
      { $unwind: { path: '$sections.quotes', preserveNullAndEmptyArrays: false } },
      { $match: { 'sections.quotes.text': queryRegex } },
      { $limit: limit },
      { $project: {
          _id: 0,
          type: { $literal: 'quote' },
          term: { $substrCP: ['$sections.quotes.text', 0, 100] },
          book_id: '$id',
          book_slug: '$slug',
          book_title: 1,
          book_author: 1,
          quote_text: '$sections.quotes.text',
          quote_page: '$sections.quotes.page',
          quote_significance: '$sections.quotes.significance',
          section_title: '$sections.title',
        }
      },
    ], { maxTimeMS: 8000 }).toArray();

    return quoteResults;
  } catch (err) {
    console.error('Quote search error:', err instanceof Error ? err.message : err);
    return []; // Graceful degradation — return terms without quotes
  }
}
