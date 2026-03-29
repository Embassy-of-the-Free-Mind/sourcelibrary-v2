import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { BPH_COLLECTIONS, EXCLUDED_COLLECTIONS } from '@/lib/kdp-scoring';

/**
 * GET /api/admin/kdp — Dashboard data: ranked candidates with scores + publication status
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const db = await getDb();
    const url = new URL(request.url);

    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const language = url.searchParams.get('language');
    const minScore = parseInt(url.searchParams.get('minScore') || '0');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const sort = url.searchParams.get('sort') || 'score';

    // Build book filter: pipeline complete with translations, BPH collections only
    const bookFilter: Record<string, unknown> = {
      'pipeline_auto.status': 'complete',
      pages_translated: { $gt: 0 },
      collections: { $in: BPH_COLLECTIONS, $nin: EXCLUDED_COLLECTIONS },
    };
    if (minScore > 0) bookFilter.kdp_score = { $gte: minScore };
    if (category) bookFilter.categories = category;
    if (language) bookFilter.language = language;

    // Sort
    const sortSpec: Record<string, 1 | -1> = sort === 'title'
      ? { title: 1 }
      : sort === 'engagement'
        ? { read_count: -1 }
        : { kdp_score: -1 };

    const [books, total] = await Promise.all([
      db.collection('books').find(bookFilter, {
        projection: {
          id: 1, title: 1, display_title: 1, author: 1, language: 1,
          published: 1, categories: 1, thumbnail_blob: 1, thumbnail: 1,
          pages_count: 1, pages_translated: 1, pages_blank: 1, read_count: 1,
          kdp_score: 1, kdp_score_breakdown: 1, is_first_translation: 1,
          slug: 1,
        },
      })
        .sort(sortSpec)
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('books').countDocuments(bookFilter),
    ]);

    // Left-join with kdp_publications
    const bookIds = books.map(b => b.id);
    const publications = await db.collection('kdp_publications').find(
      { book_id: { $in: bookIds } },
      { projection: { book_id: 1, status: 1, asin: 1, kindle_url: 1, goodreads_url: 1 } }
    ).toArray();
    const pubMap = new Map(publications.map(p => [p.book_id, p]));

    // Filter by publication status if requested
    let results = books.map(b => ({
      id: b.id,
      slug: b.slug,
      title: b.display_title || b.title,
      original_title: b.title,
      author: b.author,
      language: b.language,
      published: b.published,
      categories: b.categories || [],
      thumbnail: b.thumbnail_blob || b.thumbnail,
      pages_count: b.pages_count || 0,
      pages_translated: b.pages_translated || 0,
      translation_pct: b.pages_count ? Math.round((b.pages_translated || 0) / Math.max(b.pages_count - (b.pages_blank || 0), 1) * 100) : 0,
      read_count: b.read_count || 0,
      kdp_score: b.kdp_score || 0,
      kdp_score_breakdown: b.kdp_score_breakdown || null,
      is_first_translation: b.is_first_translation || false,
      publication: pubMap.get(b.id) ? {
        status: pubMap.get(b.id)!.status,
        asin: pubMap.get(b.id)!.asin,
        kindle_url: pubMap.get(b.id)!.kindle_url,
        goodreads_url: pubMap.get(b.id)!.goodreads_url,
      } : null,
    }));

    if (status) {
      if (status === 'unpublished') {
        results = results.filter(r => !r.publication);
      } else {
        results = results.filter(r => r.publication?.status === status);
      }
    }

    // Summary stats
    const allPubs = await db.collection('kdp_publications').find({}).toArray();
    const stats = {
      total_candidates: total,
      total_scored: await db.collection('books').countDocuments({ kdp_score: { $exists: true } }),
      publications_by_status: allPubs.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      avg_score: books.length > 0
        ? Math.round(books.reduce((s, b) => s + (b.kdp_score || 0), 0) / books.length)
        : 0,
    };

    return NextResponse.json({
      results,
      total,
      offset,
      limit,
      stats,
    });
  } catch (error) {
    console.error('KDP dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch KDP data' }, { status: 500 });
  }
});
