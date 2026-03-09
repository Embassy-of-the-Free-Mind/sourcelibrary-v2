import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '../route';

// GET /api/categories/[id] - Get books in a category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

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
                    { $in: [{ $ifNull: ['$$page.page_type', ''] }, ['blank', 'illustration', 'map', 'frontispiece', 'diagram']] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          translation_percent: {
            $cond: {
              if: { $gt: [{ $ifNull: ['$pages_ocr', 0] }, 0] },
              then: { $round: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_ocr', 0] }] }, 100] }] },
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
