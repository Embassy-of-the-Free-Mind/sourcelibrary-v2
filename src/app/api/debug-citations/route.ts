import { NextResponse, NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(req: NextRequest) {
  const bookId = req.nextUrl.searchParams.get('book_id');
  if (!bookId) return NextResponse.json({ error: 'book_id required' }, { status: 400 });

  const timings: Record<string, number> = {};
  const t0 = Date.now();

  try {
    const db = await getDb();
    timings.db_connect = Date.now() - t0;

    const t1 = Date.now();
    const personEntities = await db.collection('entities').aggregate([
      { $match: { type: 'person', 'books.book_id': bookId } },
      { $project: {
        name: 1,
        aliases: 1,
        books: { $map: {
          input: '$books',
          as: 'b',
          in: { book_id: '$$b.book_id', book_author: '$$b.book_author' },
        }},
      }},
    ]).toArray();
    timings.entity_query = Date.now() - t1;

    const directCitationBookIds = new Map<string, string>();
    for (const entity of personEntities) {
      const names = [entity.name, ...(entity.aliases || [])].filter(
        (n: string) => n && n.length >= 4,
      );
      for (const bookEntry of entity.books || []) {
        if (bookEntry.book_id === bookId) continue;
        const authorStr = (bookEntry.book_author || '');
        if (!authorStr || authorStr.toLowerCase() === 'unknown') continue;
        for (const name of names) {
          const nameLower = name.toLowerCase();
          const authorLower = authorStr.toLowerCase();
          const idx = authorLower.indexOf(nameLower);
          if (idx === -1) continue;
          const charBefore = idx > 0 ? authorLower[idx - 1] : ' ';
          const isWordStart = !/[a-z]/.test(charBefore);
          const afterIdx = idx + nameLower.length;
          const charAfter = afterIdx < authorLower.length ? authorLower[afterIdx] : ' ';
          const isWordEnd = !/[a-z]/.test(charAfter);
          const isSingleWord = !name.includes(' ');
          const commaIdx = authorLower.indexOf(',');
          const isBeforeComma = commaIdx === -1 || idx < commaIdx;
          if (isWordStart && isWordEnd && (!isSingleWord || name.length >= 8 || isBeforeComma)) {
            directCitationBookIds.set(bookEntry.book_id, entity.name);
            break;
          }
        }
      }
    }
    timings.matching = Date.now() - t1 - timings.entity_query;

    const t2 = Date.now();
    let directBooks: Array<{ id: string; title: string; author: string; cited_as?: string }> = [];
    if (directCitationBookIds.size > 0) {
      const bookDocs = await db.collection('books').find(
        { id: { $in: [...directCitationBookIds.keys()] }, hidden: { $ne: true } },
        { projection: { id: 1, display_title: 1, title: 1, author: 1, published: 1 } },
      ).toArray();
      directBooks = bookDocs.map(doc => ({
        id: doc.id as string,
        title: (doc.display_title || doc.title) as string,
        author: (doc.author || 'Unknown') as string,
        cited_as: directCitationBookIds.get(doc.id as string),
      }));
    }
    timings.book_lookup = Date.now() - t2;
    timings.total = Date.now() - t0;

    return NextResponse.json({
      bookId,
      person_entities: personEntities.length,
      direct_citation_ids: directCitationBookIds.size,
      direct_books: directBooks.length,
      timings,
      sample_books: directBooks.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json({
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
      timings,
    }, { status: 500 });
  }
}
