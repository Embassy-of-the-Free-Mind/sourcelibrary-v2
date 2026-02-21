import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface IndexSearchResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
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
    const queryLower = query.toLowerCase();

    // Build the list of index array types to search
    const termTypes: { field: string; type: IndexSearchResult['type'] }[] = [];
    if (!type || type === 'vocabulary') termTypes.push({ field: 'index.vocabulary', type: 'vocabulary' });
    if (!type || type === 'keyword') termTypes.push({ field: 'index.keywords', type: 'keyword' });
    if (!type || type === 'person') termTypes.push({ field: 'index.people', type: 'person' });
    if (!type || type === 'place') termTypes.push({ field: 'index.places', type: 'place' });
    if (!type || type === 'concept') termTypes.push({ field: 'index.concepts', type: 'concept' });

    // Build pre-filter: only books with matching terms in relevant arrays
    const preFilterOr = termTypes.map(t => ({ [`${t.field}.term`]: queryRegex }));
    if (!type || type === 'quote') {
      preFilterOr.push({ 'index.sectionSummaries.quotes.text': queryRegex });
    }

    // Build $concatArrays for all requested term types
    const concatInputs = termTypes.map(t => ({
      $map: {
        input: { $ifNull: [`$${t.field}`, []] },
        as: 'e',
        in: { term: '$$e.term', pages: '$$e.pages', type: t.type }
      }
    }));

    // Run term search and quote search in parallel
    const termSearchPromise = concatInputs.length > 0
      ? db.collection('books').aggregate([
          { $match: {
              'index.generatedAt': { $exists: true },
              hidden: { $ne: true },
              $or: termTypes.map(t => ({ [`${t.field}.term`]: queryRegex }))
            }
          },
          { $project: {
              id: 1,
              book_title: { $ifNull: ['$display_title', '$title'] },
              book_author: { $ifNull: ['$author', 'Unknown'] },
              entries: { $concatArrays: concatInputs }
            }
          },
          { $unwind: '$entries' },
          { $match: { 'entries.term': queryRegex } },
          { $addFields: {
              _exactMatch: { $eq: [{ $toLower: '$entries.term' }, queryLower] },
              _pageCount: { $size: { $ifNull: ['$entries.pages', []] } }
            }
          },
          { $sort: { _exactMatch: -1, _pageCount: -1 } },
          { $limit: limit },
          { $project: {
              _id: 0,
              type: '$entries.type',
              term: '$entries.term',
              book_id: '$id',
              book_title: 1,
              book_author: 1,
              pages: '$entries.pages'
            }
          }
        ]).toArray()
      : Promise.resolve([]);

    // Quote search: needs double-unwind (sectionSummaries → quotes)
    const quoteSearchPromise = (!type || type === 'quote')
      ? db.collection('books').aggregate([
          { $match: {
              'index.generatedAt': { $exists: true },
              hidden: { $ne: true },
              'index.sectionSummaries.quotes.text': queryRegex
            }
          },
          { $project: {
              id: 1,
              book_title: { $ifNull: ['$display_title', '$title'] },
              book_author: { $ifNull: ['$author', 'Unknown'] },
              sections: { $ifNull: ['$index.sectionSummaries', []] }
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
              book_title: 1,
              book_author: 1,
              quote_text: '$sections.quotes.text',
              quote_page: '$sections.quotes.page',
              quote_significance: '$sections.quotes.significance',
              section_title: '$sections.title'
            }
          }
        ]).toArray()
      : Promise.resolve([]);

    const [termResults, quoteResults] = await Promise.all([termSearchPromise, quoteSearchPromise]);
    const results = [...termResults, ...quoteResults].slice(0, limit) as IndexSearchResult[];

    // Group results by type for summary
    const byType = {
      vocabulary: 0, keyword: 0, concept: 0, person: 0, place: 0, quote: 0,
    };
    for (const r of results) {
      byType[r.type as keyof typeof byType]++;
    }

    return NextResponse.json({
      query,
      total: results.length,
      byType,
      results,
    });
  } catch (error) {
    console.error('Index search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
