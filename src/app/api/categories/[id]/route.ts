import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '../route';

// GET /api/categories/[id] - Get books in a category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getReadDb();

    // Find the category
    const category = LIBRARY_CATEGORIES.find(c => c.id === id);

    // Get books with this category
    const books = await db.collection('books').aggregate([
      { $match: { categories: id } },
      {
        $lookup: {
          from: 'pages',
          localField: 'id',
          foreignField: 'book_id',
          as: 'pages_array'
        }
      },
      {
        $addFields: {
          pages_count: { $size: '$pages_array' },
          pages_translated: {
            $size: {
              $filter: {
                input: '$pages_array',
                as: 'page',
                cond: {
                  $or: [
                    { $and: [
                      { $ne: ['$$page.translation', null] },
                      { $ne: ['$$page.translation.data', null] },
                      { $gt: [{ $strLenCP: { $ifNull: ['$$page.translation.data', ''] } }, 50] }
                    ]},
                    { $eq: [{ $ifNull: ['$$page.page_type', ''] }, 'blank'] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          // pages_translated / pages_count over the counts recomputed just
          // above from `pages`, clamped to 0–100. Both sides come from the same
          // lookup (blanks count as done in the numerator AND sit in the
          // denominator), so this must NOT be swapped for the stored-counter
          // formula in src/lib/translation-completeness.ts, whose denominator
          // excludes blanks. (Was the twin of src/lib/translation-percent.ts,
          // retired in #5287.) The formula that stood here before divided by
          // (pages_ocr − pages_blank), which exceeds 100% on 5,835 live books.
          translation_percent: {
            $cond: {
              if: { $gt: [{ $ifNull: ['$pages_count', 0] }, 0] },
              then: {
                $min: [100, { $round: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, '$pages_count'] }, 100] }] }],
              },
              else: 0
            }
          }
        }
      },
      { $project: { pages_array: 0 } },
      { $sort: { translation_percent: -1, title: 1 } }
    ]).toArray();

    return NextResponse.json({
      category: category || { id, name: id, description: '', icon: '📚' },
      books: books,
      total: books.length,
    });
  } catch (error) {
    console.error('Error fetching category books:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category' },
      { status: 500 }
    );
  }
}
