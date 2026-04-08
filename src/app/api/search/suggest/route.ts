import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findSuggestions } from '@/lib/fuzzy';

// In-memory cache backed by system_config snapshot.
// The snapshot is pre-built by scripts/workers/suggest-vocabulary-snapshot.mjs
// and refreshed every 2 hours. This route just reads it (<50ms).
let vocabularyCache: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 min — re-read snapshot from DB

async function getVocabulary(): Promise<string[]> {
  const now = Date.now();
  if (vocabularyCache && now - cacheTimestamp < CACHE_TTL) {
    return vocabularyCache;
  }

  const db = await getReadDb();

  // Read pre-computed vocabulary from system_config (single doc, <50ms).
  // Falls back to a lightweight titles-only query if snapshot doesn't exist yet.
  const snapshot = await db.collection('system_config')
    .findOne({ _id: 'suggest_vocabulary' as unknown as any }, { maxTimeMS: 5000 });

  if (snapshot?.terms?.length) {
    vocabularyCache = snapshot.terms as string[];
    cacheTimestamp = now;
    return vocabularyCache;
  }

  // Fallback: lightweight query (titles + authors only, no index terms)
  const books = await db.collection('books')
    .find(
      { visible: true, pages_count: { $gt: 0 } },
      {
        projection: { title: 1, display_title: 1, author: 1 },
        maxTimeMS: 8000,
      },
    )
    .toArray();

  const terms = new Set<string>();
  for (const book of books) {
    if (book.display_title) terms.add(book.display_title);
    else if (book.title) terms.add(book.title);
    if (book.author) terms.add(book.author);
  }

  vocabularyCache = Array.from(terms);
  cacheTimestamp = now;
  return vocabularyCache;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const vocabulary = await getVocabulary();
    const suggestions = findSuggestions(query.trim(), vocabulary, { maxResults: 5 });

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Suggest error:', error);
    return NextResponse.json({ suggestions: [] });
  }
}
