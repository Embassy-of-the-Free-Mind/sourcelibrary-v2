import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { FACETS, facetDbField } from '@/lib/taxonomy/faceted-vocabulary';

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
    visible: true,
  };

  const activeFilters: Record<string, string[]> = {};

  for (const facet of FACETS) {
    const param = searchParams.get(facet.id);
    if (param) {
      const values = param.split(',').map(v => v.trim()).filter(Boolean);
      if (values.length > 0) {
        query[`faceted_tags.${facetDbField(facet)}`] = { $in: values };
        activeFilters[facet.id] = values;
      }
    }
  }

  // If counts mode, return aggregated facet counts -- single $facet pipeline
  if (countsOnly) {
    const facetStages = Object.fromEntries(
      FACETS.map(facet => {
        const dbf = facetDbField(facet);
        return [
          facet.id,
          [
            { $unwind: `$faceted_tags.${dbf}` },
            { $group: { _id: `$faceted_tags.${dbf}`, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
        ];
      })
    );

    const [result] = await db.collection('books').aggregate([
      { $match: query },
      { $facet: { _total: [{ $count: 'n' }], ...facetStages } },
    ]).toArray();

    const counts: Record<string, Record<string, number>> = {};
    for (const facet of FACETS) {
      counts[facet.id] = {};
      for (const r of (result[facet.id] as { _id: string; count: number }[])) {
        counts[facet.id][r._id] = r.count;
      }
    }

    return NextResponse.json({
      total: (result._total as { n: number }[])[0]?.n ?? 0,
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
