import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface BookStatus {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language?: string;
  total_pages: number;
  pages_with_translation: number;
  pages_with_ocr: number;
  translation_percent: number;
  has_summary: boolean;
  summary_generated_at?: Date;
  can_generate_summary: boolean;
}

// GET /api/books/status - Get summary readiness status for all books
export async function GET() {
  try {
    const db = await getDb();

    // Aggregate book data with page counts
    const books = await db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          localField: 'id',
          foreignField: 'book_id',
          as: 'pages'
        }
      },
      {
        $addFields: {
          total_pages: { $size: '$pages' },
          pages_with_translation: {
            $size: {
              $filter: {
                input: '$pages',
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
          },
          pages_with_ocr: {
            $size: {
              $filter: {
                input: '$pages',
                as: 'page',
                cond: {
                  $and: [
                    { $ne: ['$$page.ocr', null] },
                    { $ne: ['$$page.ocr.data', null] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $project: {
          pages: 0 // Don't return the full pages array
        }
      },
      {
        $sort: { created_at: -1 }
      }
    ]).toArray();

    // Transform to status objects
    const statuses: BookStatus[] = books.map(book => {
      const totalPages = book.total_pages || 0;
      const translatedPages = book.pages_with_translation || 0;
      const translationPercent = totalPages > 0
        ? Math.round((translatedPages / totalPages) * 100)
        : 0;

      // Can generate summary if at least 1 page is translated
      const canGenerateSummary = translatedPages >= 1;

      // Has summary if index.bookSummary.brief exists
      const hasSummary = !!(book.index?.bookSummary?.brief);

      return {
        id: book.id,
        title: book.title,
        display_title: book.display_title || undefined,
        author: book.author || 'Unknown',
        language: book.language || undefined,
        total_pages: totalPages,
        pages_with_translation: translatedPages,
        pages_with_ocr: book.pages_with_ocr || 0,
        translation_percent: translationPercent,
        has_summary: hasSummary,
        summary_generated_at: book.index?.generatedAt || undefined,
        can_generate_summary: canGenerateSummary,
      };
    });

    // Sort by translation percent descending (most ready first)
    statuses.sort((a, b) => {
      // Books with summaries first
      if (a.has_summary && !b.has_summary) return -1;
      if (!a.has_summary && b.has_summary) return 1;
      // Then by translation percent
      return b.translation_percent - a.translation_percent;
    });

    return NextResponse.json({
      total_books: statuses.length,
      books_with_summaries: statuses.filter(s => s.has_summary).length,
      books_ready_for_summary: statuses.filter(s => s.can_generate_summary && !s.has_summary).length,
      books: statuses,
    });

  } catch (error) {
    console.error('Error fetching book status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch book status' },
      { status: 500 }
    );
  }
}
