import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();

    const books = await db.collection('books').aggregate([
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
          page_timestamps: {
            $map: {
              input: '$pages_array',
              as: 'page',
              in: {
                page_number: '$$page.page_number',
                ocr_updated: '$$page.ocr.updated_at',
                translation_updated: '$$page.translation.updated_at'
              }
            }
          },
          max_page_timestamp: {
            $max: {
              $map: {
                input: '$pages_array',
                as: 'page',
                in: {
                  $max: [
                    { $ifNull: ['$$page.ocr.updated_at', null] },
                    { $ifNull: ['$$page.translation.updated_at', null] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          last_processed: {
            $ifNull: ['$max_page_timestamp', '$updated_at']
          }
        }
      },
      {
        $project: {
          title: 1,
          updated_at: 1,
          max_page_timestamp: 1,
          last_processed: 1,
          pages_count: { $size: '$pages_array' },
          sample_timestamps: { $slice: ['$page_timestamps', 3] }
        }
      },
      { $sort: { last_processed: -1, title: 1 } },
      { $limit: 10 }
    ]).toArray();

    return NextResponse.json({
      message: 'Top 10 books by last_processed',
      books: books.map(b => ({
        title: b.title,
        pages_count: b.pages_count,
        book_updated_at: b.updated_at,
        max_page_timestamp: b.max_page_timestamp,
        last_processed: b.last_processed,
        sample_timestamps: b.sample_timestamps
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
