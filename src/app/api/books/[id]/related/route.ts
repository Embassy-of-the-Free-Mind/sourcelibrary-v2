import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface BookIndex {
  vocabulary?: { term: string; pages: number[] }[];
  keywords?: { term: string; pages: number[] }[];
  people?: { term: string; pages: number[] }[];
  places?: { term: string; pages: number[] }[];
  concepts?: { term: string; pages: number[] }[];
}

interface BookWithIndex {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  thumbnail?: string;
  language?: string;
  published?: string;
  index?: BookIndex;
}

// Normalize a keyword for comparison
function normalizeKeyword(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"');
}

// Extract all keywords from a book's index
function extractAllKeywords(index: BookIndex): Set<string> {
  const keywords = new Set<string>();

  const addTerms = (terms?: { term: string; pages: number[] }[]) => {
    if (!terms) return;
    for (const { term } of terms) {
      keywords.add(normalizeKeyword(term));
    }
  };

  addTerms(index.keywords);
  addTerms(index.people);
  addTerms(index.places);
  addTerms(index.concepts);
  addTerms(index.vocabulary);

  return keywords;
}

// GET /api/books/[id]/related - Get books related by shared keywords
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get('limit') || '10');
    const minShared = parseInt(searchParams.get('min_shared') || '1');

    // Get the target book
    const targetBook = await db.collection('books').findOne(
      { id },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, index: 1 } }
    ) as unknown as BookWithIndex | null;

    if (!targetBook) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (!targetBook.index) {
      return NextResponse.json({
        related: [],
        message: 'Book has no keyword index. Generate the index first.',
      });
    }

    // Get target book's keywords
    const targetKeywords = extractAllKeywords(targetBook.index);

    if (targetKeywords.size === 0) {
      return NextResponse.json({
        related: [],
        message: 'Book has no extracted keywords.',
      });
    }

    // Fetch all other books with indexes
    const otherBooks = await db.collection('books')
      .find(
        { id: { $ne: id }, index: { $exists: true } },
        { projection: { id: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, language: 1, published: 1, index: 1 } }
      )
      .toArray() as unknown as BookWithIndex[];

    // Calculate similarity for each book
    const similarities: {
      book: BookWithIndex;
      shared_keywords: string[];
      similarity_score: number;
    }[] = [];

    for (const book of otherBooks) {
      if (!book.index) continue;

      const bookKeywords = extractAllKeywords(book.index);
      const shared: string[] = [];

      for (const keyword of targetKeywords) {
        if (bookKeywords.has(keyword)) {
          shared.push(keyword);
        }
      }

      if (shared.length >= minShared) {
        // Jaccard similarity: intersection / union
        const union = new Set([...targetKeywords, ...bookKeywords]);
        const similarity = shared.length / union.size;

        similarities.push({
          book,
          shared_keywords: shared.sort(),
          similarity_score: similarity,
        });
      }
    }

    // Sort by number of shared keywords (or similarity score)
    similarities.sort((a, b) => {
      // Primary: number of shared keywords
      if (b.shared_keywords.length !== a.shared_keywords.length) {
        return b.shared_keywords.length - a.shared_keywords.length;
      }
      // Secondary: similarity score
      return b.similarity_score - a.similarity_score;
    });

    // Return top results
    const related = similarities.slice(0, limit).map(({ book, shared_keywords, similarity_score }) => ({
      id: book.id,
      title: book.display_title || book.title,
      author: book.author,
      thumbnail: book.thumbnail,
      language: book.language,
      published: book.published,
      shared_keywords,
      shared_count: shared_keywords.length,
      similarity_score: Math.round(similarity_score * 100) / 100,
    }));

    return NextResponse.json({
      book_id: id,
      book_title: targetBook.display_title || targetBook.title,
      book_keywords_count: targetKeywords.size,
      related,
      total_related: similarities.length,
    });
  } catch (error) {
    console.error('Error finding related books:', error);
    return NextResponse.json(
      { error: 'Failed to find related books' },
      { status: 500 }
    );
  }
}
