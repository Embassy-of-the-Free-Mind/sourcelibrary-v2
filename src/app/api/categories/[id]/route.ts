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
                  $and: [
                    { $ne: ['$$page.translation', null] },
                    { $ne: ['$$page.translation.data', null] },
                    { $gt: [{ $strLenCP: { $ifNull: ['$$page.translation.data', ''] } }, 50] }
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
              if: { $gt: ['$pages_count', 0] },
              then: { $round: [{ $multiply: [{ $divide: ['$pages_translated', '$pages_count'] }, 100] }] },
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
