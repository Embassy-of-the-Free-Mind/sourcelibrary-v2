import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findSuggestions } from '@/lib/fuzzy';

// In-memory vocabulary cache (refreshed every 10 minutes)
let vocabularyCache: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Tokenize a phrase into individual words suitable for fuzzy matching.
 * Keeps only words >= 3 chars to avoid noise from articles/prepositions.
 */
function tokenize(text: string): string[] {
  return text
    .split(/[\s,;:]+/)
    .map(w => w.replace(/[^a-zA-ZÀ-ÿ\-']/g, ''))
    .filter(w => w.length >= 3);
}

async function getVocabulary(): Promise<string[]> {
  const now = Date.now();
  if (vocabularyCache && now - cacheTimestamp < CACHE_TTL) {
    return vocabularyCache;
  }

  const db = await getDb();

  // Fetch book titles and authors (~1200 books)
  const books = await db.collection('books')
    .find({}, { projection: { title: 1, display_title: 1, author: 1 } })
    .toArray();

  const terms = new Set<string>();

  for (const book of books) {
    // Add full titles for multi-word matching
    if (book.title) terms.add(book.title);
    if (book.display_title) terms.add(book.display_title);
    if (book.author) terms.add(book.author);

    // Also add individual words for single-word typo matching
    for (const field of [book.title, book.display_title, book.author]) {
      if (field) {
        for (const word of tokenize(field)) {
          terms.add(word);
        }
      }
    }
  }

  // Fetch index terms from books with generated indexes
  const indexedBooks = await db.collection('books')
    .find(
      { 'index.generatedAt': { $exists: true } },
      { projection: { 'index.concepts': 1, 'index.people': 1, 'index.places': 1, 'index.keyTerms': 1 } }
    )
    .toArray();

  for (const book of indexedBooks) {
    const idx = book.index;
    if (!idx) continue;

    for (const arr of [idx.concepts, idx.people, idx.places, idx.keyTerms]) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const name = typeof item === 'string' ? item : item?.term || item?.name;
        if (name && name.length >= 2) {
          terms.add(name);
          // Tokenize multi-word index terms too
          for (const word of tokenize(name)) {
            terms.add(word);
          }
        }
      }
    }
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
