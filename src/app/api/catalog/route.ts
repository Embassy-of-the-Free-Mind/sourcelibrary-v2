import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();

    // Get all books sorted by title
    const books = await db.collection('books').find({}).sort({ title: 1 }).toArray();

    // Get page counts for all books
    const pageCounts = await db.collection('pages').aggregate([
      { $group: { _id: '$book_id', count: { $sum: 1 } } }
    ]).toArray();

    const pageCountMap = new Map(pageCounts.map(p => [p._id, p.count]));

    // Get first available summary for each book
    const summaries = await db.collection('pages').aggregate([
      { $match: { 'summary.data': { $exists: true, $ne: '' } } },
      { $sort: { page_number: 1 } },
      { $group: { _id: '$book_id', summary: { $first: '$summary.data' } } }
    ]).toArray();

    const summaryMap = new Map(summaries.map(s => [s._id, s.summary]));

    const catalog = books.map(book => {
      const tenant = book.tenant;
      const location = typeof tenant === 'object' && tenant?.name ? tenant.name : 'Unknown';
      const bookId = book.id || '';

      return {
        id: bookId,
        original_title: book.title || '',
        translated_title: book.display_title || book.title || '',
        author: book.author || 'Unknown',
        year: book.published || 'Unknown',
        language: book.language || 'Unknown',
        location,
        pages: pageCountMap.get(bookId) || 0,
        thumbnail: book.thumbnail || '',
        summary: summaryMap.get(bookId)?.substring(0, 500) || '',
        url: `https://sourcelibrary.org/book/${bookId}`
      };
    });

    return NextResponse.json({
      total: catalog.length,
      description: 'Source Library: Digitizing and translating rare Hermetic, esoteric, and humanist texts',
      website: 'https://sourcelibrary.org',
      catalog
    });
  } catch (error) {
    console.error('Error fetching catalog:', error);
    return NextResponse.json({ error: 'Failed to fetch catalog' }, { status: 500 });
  }
}
