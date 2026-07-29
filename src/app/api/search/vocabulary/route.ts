import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

// In-memory cache (survives across requests on the same Vercel instance)
let cachedVocabulary: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * GET /api/search/vocabulary
 *
 * Returns a deduplicated list of book titles and authors for client-side autocomplete.
 * Aggressively cached — vocabulary changes slowly.
 */
export async function GET() {
  const now = Date.now();

  if (!cachedVocabulary || now - cacheTimestamp > CACHE_TTL) {
    const db = await getReadDb();
    const books = await db.collection('books')
      .find(
        { visible: true, pages_count: { $gt: 0 } },
        { projection: { title: 1, display_title: 1, author: 1 } }
      )
      .toArray();

    const terms = new Set<string>();
    for (const book of books) {
      if (book.display_title) terms.add(book.display_title);
      else if (book.title) terms.add(book.title);
      if (book.author) terms.add(book.author);
    }

    cachedVocabulary = Array.from(terms).sort();
    cacheTimestamp = now;
  }

  return NextResponse.json(cachedVocabulary, {
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
