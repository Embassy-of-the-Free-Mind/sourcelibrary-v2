import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const decade = searchParams.get('decade');
    const language = searchParams.get('language') || '';
    const collection = searchParams.get('collection') || '';

    const db = await getDb();

    // Base filter: has year, not hidden
    const baseMatch: Record<string, unknown> = {
      year: { $exists: true, $ne: null },
      hidden: { $ne: true },
    };
    if (language) baseMatch.language = language;
    if (collection) baseMatch.categories = collection;

    // Drill-down mode: return books for a specific decade
    if (decade) {
      const decadeNum = parseInt(decade);
      if (isNaN(decadeNum)) {
        return NextResponse.json({ error: 'Invalid decade' }, { status: 400 });
      }

      const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

      const decadeMatch = {
        ...baseMatch,
        year: { $gte: decadeNum, $lt: decadeNum + 10 },
      };

      const [books, total] = await Promise.all([
        db.collection('books')
          .find(decadeMatch)
          .project({
            id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
            language: 1, thumbnail_blob: 1, thumbnail: 1,
            pages_count: 1, pages_translated: 1, published: 1,
          })
          .sort({ year: 1, title: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
        db.collection('books').countDocuments(decadeMatch),
      ]);

      const mapped = books.map(b => ({
        id: b.id,
        slug: b.slug,
        title: b.display_title || b.title,
        display_title: b.display_title,
        author: b.author,
        year: b.year,
        language: b.language,
        thumbnail: b.thumbnail || b.thumbnail_blob,
        pages_count: b.pages_count,
        pages_translated: b.pages_translated,
        published: b.published,
      }));

      return NextResponse.json({ decade: decadeNum, books: mapped, total, offset }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    }

    // Overview mode — read pre-computed snapshot from system_config (live agg takes 30-80s)
    const cached = await db.collection('system_config')
      .findOne({ _id: 'timeline_overview' } as any)
      .catch(() => null);

    if (cached?.data) {
      return NextResponse.json(cached.data, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    }

    // Fallback: compute live (will likely timeout on Atlas, but try)
    const pipeline = [
      { $match: baseMatch },
      {
        $group: {
          _id: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] },
          count: { $sum: 1 },
          languages: { $push: '$language' },
        },
      },
      { $sort: { _id: 1 as const } },
    ];

    const rawDecades = await db.collection('books').aggregate(pipeline, { maxTimeMS: 15000 }).toArray();

    const decades = rawDecades.map(d => {
      const langCounts: Record<string, number> = {};
      for (const lang of d.languages) {
        const key = lang || 'Unknown';
        langCounts[key] = (langCounts[key] || 0) + 1;
      }
      const languages = Object.entries(langCounts)
        .map(([lang, count]) => ({ lang, count }))
        .sort((a, b) => b.count - a.count);
      return { decade: d._id, count: d.count, languages };
    });

    const total = decades.reduce((sum, d) => sum + d.count, 0);
    const allYears = decades.map(d => d.decade);
    const yearRange = {
      min: allYears.length ? allYears[0] : 0,
      max: allYears.length ? allYears[allYears.length - 1] + 9 : 0,
    };

    const globalLangCounts: Record<string, number> = {};
    for (const d of decades) {
      for (const l of d.languages) {
        globalLangCounts[l.lang] = (globalLangCounts[l.lang] || 0) + l.count;
      }
    }
    const topLanguages = Object.entries(globalLangCounts)
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);

    // Read filter options from cache
    const cachedFilters = await db.collection('system_config')
      .findOne({ _id: 'timeline_filters' } as any)
      .catch(() => null);

    const languages = cachedFilters?.data?.languages || [];
    const collections = cachedFilters?.data?.collections || [];

    return NextResponse.json({
      decades,
      summary: { total, yearRange, topLanguages },
      filters: {
        languages: languages.filter(Boolean).sort(),
        collections: collections.filter(Boolean).sort(),
      },
    });
  } catch (error) {
    console.error('Timeline API error:', error);
    return NextResponse.json({ error: 'Failed to fetch timeline data' }, { status: 500 });
  }
}
