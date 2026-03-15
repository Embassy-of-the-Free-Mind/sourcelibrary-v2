import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { FACETS } from '@/lib/taxonomy/faceted-vocabulary';

/**
 * GET /api/books/facets
 *
 * Query books by faceted tags. Supports filtering by any combination of facets.
 *
 * Query params:
 *   tradition=hermetic,alchemical    — books matching ANY of these tradition tags
 *   domain=medicine                  — books matching this domain tag
 *   form=treatise                    — books matching this form tag
 *   sphere=latin                     — books matching this sphere tag
 *   era=renaissance                  — books matching this era tag
 *   mode=practical                   — books matching this mode tag
 *   page=1                           — pagination (default 1)
 *   limit=50                         — results per page (default 50, max 200)
 *   counts=true                      — return facet value counts instead of books
 *
 * All facet filters are AND'd across facets, OR'd within a facet.
 * Example: tradition=hermetic&domain=medicine returns books that are
 *          hermetic AND in the medicine domain.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const db = await getDb();

  const countsOnly = searchParams.get('counts') === 'true';

  // Build MongoDB query from facet filters
  const query: Record<string, unknown> = {
    'faceted_tags': { $exists: true },
    hidden: { $ne: true },
  };

  const facetIds = ['tradition', 'domain', 'form', 'sphere', 'era', 'mode'];
  const activeFilters: Record<string, string[]> = {};

  for (const facetId of facetIds) {
    const param = searchParams.get(facetId);
    if (param) {
      const values = param.split(',').map(v => v.trim()).filter(Boolean);
      if (values.length > 0) {
        query[`faceted_tags.${facetId}`] = { $in: values };
        activeFilters[facetId] = values;
      }
    }
  }

  // If counts mode, return aggregated facet counts
  if (countsOnly) {
    const counts: Record<string, Record<string, number>> = {};

    for (const facetId of facetIds) {
      const pipeline = [
        { $match: query },
        { $unwind: `$faceted_tags.${facetId}` },
        { $group: { _id: `$faceted_tags.${facetId}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ];
      const results = await db.collection('books').aggregate(pipeline).toArray();
      counts[facetId] = {};
      for (const r of results) {
        counts[facetId][r._id as string] = r.count;
      }
    }

    return NextResponse.json({
      total: await db.collection('books').countDocuments(query),
      activeFilters,
      counts,
      vocabulary: FACETS.map(f => ({
        id: f.id,
        label: f.label,
        question: f.question,
        values: f.values.map(v => ({ id: v.id, label: v.label })),
      })),
    });
  }

  // Paginated book results
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const skip = (page - 1) * limit;

  const [books, total] = await Promise.all([
    db.collection('books')
      .find(query, {
        projection: {
          _id: 1, title: 1, display_title: 1, slug: 1, author: 1,
          published: 1, language: 1, thumbnail_blob: 1, thumbnail: 1,
          faceted_tags: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1,
        },
      })
      .sort({ read_count: -1, pages_translated: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('books').countDocuments(query),
  ]);

  return NextResponse.json({
    books,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    activeFilters,
  });
}
