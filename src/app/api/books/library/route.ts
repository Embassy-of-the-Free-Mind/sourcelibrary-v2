import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

type SortOption = 'recent-translation' | 'recent' | 'title-asc' | 'title-desc';

function buildSortStage(sort: SortOption) {
  switch (sort) {
    case 'recent':
      return { $sort: { last_processed: -1, title: 1 } as Record<string, 1 | -1> };
    case 'title-asc':
      return { $sort: { sort_title: 1 } as Record<string, 1 | -1> };
    case 'title-desc':
      return { $sort: { sort_title: -1 } as Record<string, 1 | -1> };
    case 'recent-translation':
    default:
      return { $sort: { has_translations: -1, last_translation_at: -1, last_processed: -1, title: 1 } as Record<string, 1 | -1> };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT)), MAX_LIMIT);
    const skip = Math.max(parseInt(searchParams.get('skip') || '0'), 0);
    const search = searchParams.get('search') || '';
    const language = searchParams.get('language') || '';
    const category = searchParams.get('category') || '';
    const sort = (searchParams.get('sort') || 'recent-translation') as SortOption;

    const db = await getDb();

    // Build match conditions
    const matchConditions: Record<string, unknown>[] = [
      { hidden: { $ne: true } },
    ];

    if (search.trim()) {
      // Build diacritic-insensitive regex: "bohme" matches "Böhme"
      // Replace each base letter with a character class including accented variants
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const diacriticPattern = escaped.replace(/[a-zA-Z]/g, (ch) => {
        const map: Record<string, string> = {
          a: '[aàáâãäåæ]', e: '[eèéêë]', i: '[iìíîï]', o: '[oòóôõöø]',
          u: '[uùúûü]', n: '[nñ]', c: '[cç]', y: '[yýÿ]', s: '[sß]',
        };
        return map[ch.toLowerCase()] || ch;
      });
      const searchRegex = { $regex: diacriticPattern, $options: 'i' };
      matchConditions.push({
        $or: [
          { title: searchRegex },
          { display_title: searchRegex },
          { author: searchRegex },
          { language: searchRegex },
          { categories: searchRegex },
        ],
      });
    }

    if (language) {
      matchConditions.push({ language });
    }

    if (category) {
      matchConditions.push({ categories: category });
    }

    const matchStage = matchConditions.length > 0
      ? [{ $match: { $and: matchConditions } }]
      : [];

    const pipeline = [
      ...matchStage,
      {
        $addFields: {
          id: { $ifNull: ['$id', { $toString: '$_id' }] },
          pages_count: { $ifNull: ['$pages_count', 0] },
          pages_translated: { $ifNull: ['$pages_translated', 0] },
          pages_ocr: { $ifNull: ['$pages_ocr', 0] },
          last_processed: { $ifNull: ['$updated_at', '$created_at'] },
          last_translation_at: { $ifNull: ['$last_translation_at', null] },
        },
      },
      {
        $addFields: {
          translation_percent: {
            $cond: {
              if: { $eq: ['$language', 'English'] },
              then: {
                $cond: {
                  if: { $gt: ['$pages_count', 0] },
                  then: { $round: [{ $multiply: [{ $divide: ['$pages_ocr', '$pages_count'] }, 100] }] },
                  else: 0,
                },
              },
              else: {
                $cond: {
                  if: { $gt: ['$pages_count', 0] },
                  then: { $round: [{ $multiply: [{ $divide: ['$pages_translated', '$pages_count'] }, 100] }] },
                  else: 0,
                },
              },
            },
          },
          has_translations: { $cond: { if: { $gt: ['$last_translation_at', null] }, then: 1, else: 0 } },
          sort_title: { $toLower: { $ifNull: ['$display_title', '$title'] } },
        },
      },
      buildSortStage(sort),
      {
        $facet: {
          books: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: 1,
                title: 1,
                display_title: 1,
                author: 1,
                thumbnail: 1,
                thumbnail_blob: 1,
                language: 1,
                published: 1,
                categories: 1,
                pages_count: 1,
                pages_ocr: 1,
                pages_translated: 1,
                translation_percent: 1,
                last_processed: 1,
                last_translation_at: 1,
                featured: 1,
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await db.collection('books').aggregate(pipeline, {
      collation: { locale: 'en', strength: 1 },
    }).toArray();

    const books = result.books || [];
    const total = result.total[0]?.count || 0;

    return NextResponse.json({ books, total });
  } catch (error) {
    console.error('Error in /api/books/library:', error);
    return NextResponse.json(
      { error: 'Failed to fetch books' },
      { status: 500 }
    );
  }
}
