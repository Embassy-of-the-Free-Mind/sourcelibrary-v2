import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildBookIndex } from '@/lib/build-book-index';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = await getDb();

  const book = await db.collection('books').findOne(
    { id },
    { projection: { id: 1, title: 1, dublin_core: 1, reading_summary: 1 } }
  );

  if (!book) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  // Fetch OCR and translation text for all pages
  const pages = await db.collection('pages')
    .find(
      { book_id: id },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  const allEntries = buildBookIndex(pages as unknown as { page_number: number; ocr?: { data?: string }; translation?: { data?: string } }[]);

  // Store all entries — they're already sorted by page count desc
  // The UI will paginate/truncate as needed
  await db.collection('books').updateOne(
    { id },
    {
      $set: {
        'index.entries': allEntries,
        'index.generatedAt': new Date(),
        'index.pagesCovered': pages.length,
        'index.method': 'tag-extraction',
        updated_at: new Date(),
      }
    }
  );

  return NextResponse.json({
    bookId: id,
    entriesCount: allEntries.length,
    entries: allEntries.slice(0, 20), // preview
  });
}
