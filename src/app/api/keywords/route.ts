import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { CrossBookKeyword, KeywordGraph } from '@/lib/types';

interface BookIndex {
  vocabulary?: { term: string; pages: number[] }[];
  keywords?: { term: string; pages: number[] }[];
  people?: { term: string; pages: number[] }[];
  places?: { term: string; pages: number[] }[];
  concepts?: { term: string; pages: number[] }[];
  generatedAt?: Date;
}

interface BookWithIndex {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  index?: BookIndex;
}

// Normalize a keyword for comparison (lowercase, trim, collapse whitespace)
function normalizeKeyword(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")  // Normalize apostrophes
    .replace(/[""]/g, '"'); // Normalize quotes
}

// Known aliases: map variant spellings to canonical forms
const KEYWORD_ALIASES: Record<string, string> = {
  // Latin ↔ English
  'anima mundi': 'world-soul',
  'world soul': 'world-soul',
  'lapis philosophorum': "philosopher's stone",
  'philosophers stone': "philosopher's stone",
  'philosopher stone': "philosopher's stone",
  'prima materia': 'prime matter',
  'spiritus mundi': 'spirit of the world',
  'corpus hermeticum': 'corpus hermeticum',

  // Name variants
  'hermes trismegistus': 'hermes trismegistus',
  'mercurius trismegistus': 'hermes trismegistus',
  'thrice-great hermes': 'hermes trismegistus',
  'marsilio ficino': 'marsilio ficino',
  'marsilius ficinus': 'marsilio ficino',
  'paracelsus': 'paracelsus',
  'theophrastus paracelsus': 'paracelsus',
  'philippus aureolus theophrastus bombastus von hohenheim': 'paracelsus',

  // Concept variants
  'alchemy': 'alchemy',
  'alchymie': 'alchemy',
  'alchemia': 'alchemy',
  'kabbalah': 'kabbalah',
  'cabala': 'kabbalah',
  'qabalah': 'kabbalah',
  'kabbala': 'kabbalah',
};

// Get canonical form of a keyword
function getCanonicalKeyword(term: string): string {
  const normalized = normalizeKeyword(term);
  return KEYWORD_ALIASES[normalized] || normalized;
}

// Determine category based on term characteristics
function categorizeKeyword(term: string, sourceCategory?: string): 'person' | 'place' | 'concept' {
  if (sourceCategory === 'people' || sourceCategory === 'person') return 'person';
  if (sourceCategory === 'places' || sourceCategory === 'place') return 'place';
  if (sourceCategory === 'concepts' || sourceCategory === 'concept') return 'concept';

  const lower = term.toLowerCase();

  // Person indicators
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(term)) return 'person';
  if (lower.includes('von ') || lower.includes(' de ') || lower.includes(' of ')) return 'person';

  // Place indicators
  const placeWords = ['city', 'kingdom', 'empire', 'rome', 'egypt', 'florence', 'venice', 'germany', 'france'];
  if (placeWords.some(p => lower.includes(p))) return 'place';

  return 'concept';
}

// Build the cross-book keyword graph
async function buildKeywordGraph(books: BookWithIndex[]): Promise<KeywordGraph> {
  // Map: canonical_term -> { displayTerm, category, books: Map<book_id, {pages, frequency}> }
  const keywordMap = new Map<string, {
    displayTerm: string;
    displayCount: Map<string, number>; // Track which display form is most common
    category: 'person' | 'place' | 'concept';
    books: Map<string, { bookId: string; bookTitle: string; author: string; pages: number[]; frequency: number }>;
    aliases: Set<string>;
  }>();

  // Process each book's index
  for (const book of books) {
    if (!book.index) continue;

    const bookTitle = book.display_title || book.title;
    const bookId = book.id;
    const author = book.author;

    // Process keywords from different categories
    const categoryData: { terms: { term: string; pages: number[] }[]; category: string }[] = [
      { terms: book.index.keywords || [], category: 'concept' },
      { terms: book.index.people || [], category: 'person' },
      { terms: book.index.places || [], category: 'place' },
      { terms: book.index.concepts || [], category: 'concept' },
      { terms: book.index.vocabulary || [], category: 'concept' },
    ];

    for (const { terms, category } of categoryData) {
      for (const { term, pages } of terms) {
        const canonical = getCanonicalKeyword(term);
        const normalized = normalizeKeyword(term);

        if (!keywordMap.has(canonical)) {
          keywordMap.set(canonical, {
            displayTerm: term,
            displayCount: new Map([[term, 1]]),
            category: categorizeKeyword(term, category),
            books: new Map(),
            aliases: new Set(),
          });
        }

        const entry = keywordMap.get(canonical)!;

        // Track display term frequency
        entry.displayCount.set(term, (entry.displayCount.get(term) || 0) + 1);

        // Track aliases
        if (normalized !== canonical) {
          entry.aliases.add(term);
        }

        // Add/update book entry
        if (!entry.books.has(bookId)) {
          entry.books.set(bookId, {
            bookId,
            bookTitle,
            author,
            pages: [...pages],
            frequency: pages.length,
          });
        } else {
          const bookEntry = entry.books.get(bookId)!;
          // Merge pages, avoiding duplicates
          const allPages = new Set([...bookEntry.pages, ...pages]);
          bookEntry.pages = Array.from(allPages).sort((a, b) => a - b);
          bookEntry.frequency = bookEntry.pages.length;
        }
      }
    }
  }

  // Convert to CrossBookKeyword array
  const keywords: CrossBookKeyword[] = [];

  for (const [canonical, entry] of keywordMap) {
    // Find most common display form
    let maxCount = 0;
    let bestDisplay = canonical;
    for (const [display, count] of entry.displayCount) {
      if (count > maxCount) {
        maxCount = count;
        bestDisplay = display;
      }
    }

    const booksArray = Array.from(entry.books.values()).map(b => ({
      book_id: b.bookId,
      book_title: b.bookTitle,
      author: b.author,
      pages: b.pages,
      frequency: b.frequency,
    }));

    keywords.push({
      term: canonical,
      display_term: bestDisplay,
      category: entry.category,
      books: booksArray,
      total_books: booksArray.length,
      total_occurrences: booksArray.reduce((sum, b) => sum + b.frequency, 0),
      aliases: entry.aliases.size > 0 ? Array.from(entry.aliases) : undefined,
    });
  }

  // Sort by number of books (most connected first), then by total occurrences
  keywords.sort((a, b) => {
    if (b.total_books !== a.total_books) return b.total_books - a.total_books;
    return b.total_occurrences - a.total_occurrences;
  });

  // Build book connections (which books share keywords)
  const bookConnections: KeywordGraph['book_connections'] = [];
  const bookPairs = new Map<string, { sharedKeywords: Set<string>; bookA: BookWithIndex; bookB: BookWithIndex }>();

  for (const keyword of keywords) {
    if (keyword.total_books < 2) continue; // Skip keywords in only one book

    const bookIds = keyword.books.map(b => b.book_id);

    // Generate all pairs
    for (let i = 0; i < bookIds.length; i++) {
      for (let j = i + 1; j < bookIds.length; j++) {
        const pairKey = [bookIds[i], bookIds[j]].sort().join('|');

        if (!bookPairs.has(pairKey)) {
          const bookA = books.find(b => b.id === bookIds[i])!;
          const bookB = books.find(b => b.id === bookIds[j])!;
          bookPairs.set(pairKey, {
            sharedKeywords: new Set([keyword.display_term]),
            bookA,
            bookB,
          });
        } else {
          bookPairs.get(pairKey)!.sharedKeywords.add(keyword.display_term);
        }
      }
    }
  }

  // Convert pairs to connections array
  for (const [, pair] of bookPairs) {
    bookConnections.push({
      book_a_id: pair.bookA.id,
      book_a_title: pair.bookA.display_title || pair.bookA.title,
      book_b_id: pair.bookB.id,
      book_b_title: pair.bookB.display_title || pair.bookB.title,
      shared_keywords: Array.from(pair.sharedKeywords),
      connection_strength: pair.sharedKeywords.size,
    });
  }

  // Sort connections by strength
  bookConnections.sort((a, b) => b.connection_strength - a.connection_strength);

  // Build by_category lookup
  const people = keywords.filter(k => k.category === 'person');
  const places = keywords.filter(k => k.category === 'place');
  const concepts = keywords.filter(k => k.category === 'concept');

  return {
    keywords,
    books_indexed: books.filter(b => b.index).length,
    total_keywords: keywords.length,
    generated_at: new Date(),
    by_category: { people, places, concepts },
    book_connections: bookConnections,
  };
}

// GET /api/keywords - Get cross-book keyword graph
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);

    // Optional filters
    const category = searchParams.get('category'); // 'person', 'place', 'concept'
    const minBooks = parseInt(searchParams.get('min_books') || '1');
    const search = searchParams.get('search')?.toLowerCase();
    const bookId = searchParams.get('book_id'); // Get keywords for specific book

    // Check for cached graph (stored in a separate collection)
    const cache = await db.collection('keyword_graph').findOne({ cache_id: 'current' });

    let graph: KeywordGraph;

    // Use cache if less than 1 hour old
    const cacheAge = cache?.generated_at ? Date.now() - new Date(cache.generated_at).getTime() : Infinity;
    const oneHour = 60 * 60 * 1000;

    if (cache && cacheAge < oneHour) {
      graph = cache as unknown as KeywordGraph;
    } else {
      // Fetch all books with indexes
      const books = await db.collection('books')
        .find(
          { index: { $exists: true } },
          { projection: { id: 1, title: 1, display_title: 1, author: 1, index: 1 } }
        )
        .toArray() as unknown as BookWithIndex[];

      graph = await buildKeywordGraph(books);

      // Cache the result
      await db.collection('keyword_graph').updateOne(
        { cache_id: 'current' },
        { $set: { ...graph, cache_id: 'current' } },
        { upsert: true }
      );
    }

    // Apply filters
    let filteredKeywords = graph.keywords;

    if (category) {
      filteredKeywords = filteredKeywords.filter(k => k.category === category);
    }

    if (minBooks > 1) {
      filteredKeywords = filteredKeywords.filter(k => k.total_books >= minBooks);
    }

    if (search) {
      filteredKeywords = filteredKeywords.filter(k =>
        k.term.includes(search) ||
        k.display_term.toLowerCase().includes(search) ||
        k.aliases?.some(a => a.toLowerCase().includes(search))
      );
    }

    if (bookId) {
      filteredKeywords = filteredKeywords.filter(k =>
        k.books.some(b => b.book_id === bookId)
      );
    }

    // Return filtered results
    return NextResponse.json({
      keywords: filteredKeywords,
      books_indexed: graph.books_indexed,
      total_keywords: graph.total_keywords,
      filtered_count: filteredKeywords.length,
      generated_at: graph.generated_at,
      by_category: category ? undefined : {
        people: graph.by_category.people.length,
        places: graph.by_category.places.length,
        concepts: graph.by_category.concepts.length,
      },
      book_connections: bookId
        ? graph.book_connections.filter(c => c.book_a_id === bookId || c.book_b_id === bookId)
        : minBooks > 1
          ? graph.book_connections.filter(c => c.connection_strength >= minBooks)
          : graph.book_connections.slice(0, 50), // Limit to top 50 by default
    });
  } catch (error) {
    console.error('Error fetching keyword graph:', error);
    return NextResponse.json(
      { error: 'Failed to fetch keyword graph' },
      { status: 500 }
    );
  }
}

// POST /api/keywords - Force regenerate the keyword graph
export async function POST(request: NextRequest) {
  try {
    const db = await getDb();

    // Fetch all books with indexes
    const books = await db.collection('books')
      .find(
        { index: { $exists: true } },
        { projection: { id: 1, title: 1, display_title: 1, author: 1, index: 1 } }
      )
      .toArray() as unknown as BookWithIndex[];

    const graph = await buildKeywordGraph(books);

    // Cache the result
    await db.collection('keyword_graph').updateOne(
      { cache_id: 'current' },
      { $set: { ...graph, cache_id: 'current' } },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Keyword graph regenerated',
      books_indexed: graph.books_indexed,
      total_keywords: graph.total_keywords,
      book_connections: graph.book_connections.length,
    });
  } catch (error) {
    console.error('Error regenerating keyword graph:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate keyword graph' },
      { status: 500 }
    );
  }
}
