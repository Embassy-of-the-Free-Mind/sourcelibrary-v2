import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ContributeBook } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = await getDb();

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'ocr';
    const limit = parseInt(searchParams.get('limit') || '50');

    // Find books that need work
    let query;

    if (type === 'ocr') {
      // Books where pages_ocr < pages_count
      query = {
        pages_count: { $gt: 0 },
        $expr: { $lt: ['$pages_ocr', '$pages_count'] },
      };
    } else {
      // Books where pages_translated < pages_ocr (needs OCR first)
      query = {
        pages_ocr: { $gt: 0 },
        $expr: { $lt: ['$pages_translated', '$pages_ocr'] },
      };
    }

    const books = await db.collection('books')
      .find(query)
      .project({
        _id: 1,
        title: 1,
        author: 1,
        pages_count: 1,
        pages_ocr: { $ifNull: ['$pages_ocr', 0] },
        pages_translated: { $ifNull: ['$pages_translated', 0] },
        original_language: 1,
      })
      .sort(type === 'ocr' ? { pages_count: 1 } : { pages_ocr: 1 })
      .limit(limit)
      .toArray() as unknown as ContributeBook[];

    // Add estimated cost
    const booksWithCost = books.map((book) => {
      const remaining = type === 'ocr'
        ? (book.pages_count || 0) - (book.pages_ocr || 0)
        : (book.pages_ocr || 0) - (book.pages_translated || 0);

      // Rough estimate: $0.0008/page for OCR, $0.0012/page for translation
      const costPerPage = type === 'ocr' ? 0.0008 : 0.0012;

      return {
        ...book,
        pages_ocr: book.pages_ocr || 0,
        pages_translated: book.pages_translated || 0,
        estimatedCost: remaining * costPerPage,
      };
    });

    return NextResponse.json({ books: booksWithCost });
  } catch (error) {
    console.error('Error fetching books for contribution:', error);
    return NextResponse.json(
      { error: 'Failed to fetch books', books: [] },
      { status: 500 }
    );
  }
}
