import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { embedQuery, SEMANTIC_DIMENSIONS } from '@/lib/semantic-embeddings';
import { bookUrl } from '@/lib/slugify';

export const preferredRegion = 'fra1';

const VECTOR_INDEX_BOOKS = 'book_fingerprints';
const VECTOR_INDEX_PAGES_OCR = 'page_ocr_vectors';
const VECTOR_INDEX_PAGES_TRANSLATION = 'page_translation_vectors';

interface SemanticBookResult {
  id: string;
  title: string;
  author?: string;
  year?: number;
  language?: string;
  slug?: string;
  url: string;
  score: number;
  thumbnail?: string;
}

interface SemanticPageResult {
  book_id: string;
  book_title: string;
  book_author?: string;
  page_number: number;
  snippet: string;
  field: 'ocr' | 'translation';
  score: number;
  url: string;
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * GET /api/search/semantic?q=...&type=books|pages&field=ocr|translation&limit=20
 *
 * Semantic search using vector embeddings.
 * - type=books: search book fingerprints (fast, broad)
 * - type=pages: search page-level embeddings (deep, specific)
 * - field=ocr: search original language text (cross-lingual)
 * - field=translation: search English translations (default)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const type = searchParams.get('type') || 'books';
    const field = searchParams.get('field') || 'translation';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const numCandidates = Math.min(limit * 5, 500);

    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    // Embed the query
    const queryVector = await embedQuery(query);

    if (queryVector.length !== SEMANTIC_DIMENSIONS) {
      return NextResponse.json({ error: 'Embedding dimension mismatch' }, { status: 500 });
    }

    const db = await getDb();

    if (type === 'books') {
      return await searchBooks(db, queryVector, limit, numCandidates);
    } else if (type === 'pages') {
      return await searchPages(db, queryVector, field, limit, numCandidates);
    }

    return NextResponse.json({ error: 'Invalid type. Use "books" or "pages".' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[semantic-search]', message);

    // Graceful degradation if vector index doesn't exist
    if (message.includes('index not found') || message.includes('vectorSearch')) {
      return NextResponse.json({
        error: 'Semantic search index not yet configured. Use text search instead.',
        fallback: '/api/search',
      }, { status: 503 });
    }

    return NextResponse.json({ error: 'Semantic search failed' }, { status: 500 });
  }
}

async function searchBooks(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  queryVector: number[],
  limit: number,
  numCandidates: number
): Promise<NextResponse> {
  const results = await db.collection('books').aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX_BOOKS,
        path: 'embedding.fingerprint',
        queryVector,
        numCandidates,
        limit,
        filter: { hidden: { $ne: true }, pages_count: { $gt: 0 } },
      },
    },
    {
      $project: {
        id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        year: 1,
        language: 1,
        slug: 1,
        thumbnail: 1,
        pages_count: 1,
        pages_translated: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]).toArray();

  const books: SemanticBookResult[] = results.map(r => ({
    id: r.id,
    title: r.display_title || r.title,
    author: r.author,
    year: r.year,
    language: r.language,
    slug: r.slug,
    url: bookUrl({ slug: r.slug, id: r.id }),
    score: r.score,
    thumbnail: r.thumbnail,
  }));

  return NextResponse.json({ query: '', type: 'books', results: books, count: books.length });
}

async function searchPages(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  queryVector: number[],
  field: string,
  limit: number,
  numCandidates: number
): Promise<NextResponse> {
  const indexName = field === 'ocr' ? VECTOR_INDEX_PAGES_OCR : VECTOR_INDEX_PAGES_TRANSLATION;
  const vectorPath = field === 'ocr' ? 'embedding.ocr' : 'embedding.translation';

  const results = await db.collection('pages').aggregate([
    {
      $vectorSearch: {
        index: indexName,
        path: vectorPath,
        queryVector,
        numCandidates,
        limit,
      },
    },
    {
      $project: {
        book_id: 1,
        page_number: 1,
        'ocr.data': { $substrBytes: [{ $ifNull: ['$ocr.data', ''] }, 0, 500] },
        'translation.data': { $substrBytes: [{ $ifNull: ['$translation.data', ''] }, 0, 500] },
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]).toArray();

  // Look up book info for all results
  const bookIds = [...new Set(results.map(r => r.book_id))];
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, display_title: 1, author: 1, slug: 1 } })
    .toArray();
  const bookMap = new Map(books.map(b => [b.id, b]));

  const pages: SemanticPageResult[] = results.map(r => {
    const book = bookMap.get(r.book_id);
    const textField = field === 'ocr' ? r.ocr?.data : r.translation?.data;
    return {
      book_id: r.book_id,
      book_title: book?.display_title || book?.title || 'Unknown',
      book_author: book?.author,
      page_number: r.page_number,
      snippet: cleanText(textField || '').slice(0, 300),
      field: field as 'ocr' | 'translation',
      score: r.score,
      url: bookUrl({ slug: book?.slug, id: r.book_id }) + `?page=${r.page_number}`,
    };
  });

  return NextResponse.json({ query: '', type: 'pages', field, results: pages, count: pages.length });
}
