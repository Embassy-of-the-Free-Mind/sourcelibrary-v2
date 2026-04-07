/**
 * IIIF Content Search Autocomplete — API 2.0
 *
 * GET /api/iiif/{bookId}/autocomplete?q={prefix}
 *
 * Returns term completions for the search service. Tokenizes OCR and
 * translation text, finds unique words matching the prefix, returns
 * sorted by frequency.
 *
 * Spec: https://iiif.io/api/search/2.0/
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const BASE = 'https://sourcelibrary.org';
const MAX_TERMS = 20;
const MIN_WORD_LENGTH = 3;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function corsHeaders() {
  return {
    'Content-Type': 'application/ld+json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const minCount = parseInt(searchParams.get('min') || '1', 10);

    if (!query || query.length < 2) {
      return NextResponse.json(
        {
          '@context': 'http://iiif.io/api/search/2/context.json',
          id: `${BASE}/api/iiif/${id}/autocomplete?q=${encodeURIComponent(query || '')}`,
          type: 'TermPage',
          items: [],
        },
        { headers: corsHeaders() }
      );
    }

    const db = await getDb();

    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      { projection: { id: 1 } }
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookId = book.id as string;

    // Fetch text from pages — limit to first 200 pages for performance
    const pages = await db
      .collection('pages')
      .find(
        { book_id: bookId },
        {
          projection: { 'ocr.data': 1, 'translation.data': 1 },
          limit: 200,
        }
      )
      .maxTimeMS(10000)
      .toArray();

    // Tokenize and count words matching the prefix
    const wordCounts = new Map<string, number>();
    const lowerQuery = query.toLowerCase();

    for (const page of pages) {
      const texts = [
        page.ocr?.data as string | undefined,
        page.translation?.data as string | undefined,
      ].filter(Boolean);

      for (const text of texts) {
        // Split on non-word characters, filter by prefix
        const words = (text as string)
          .toLowerCase()
          .split(/[^a-zA-ZÀ-ÿ\u0100-\u024F]+/)
          .filter((w) => w.length >= MIN_WORD_LENGTH && w.startsWith(lowerQuery));

        for (const word of words) {
          wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
      }
    }

    // Sort by frequency, filter by min count, take top N
    const terms = Array.from(wordCounts.entries())
      .filter(([, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TERMS)
      .map(([value, total]) => ({ value, total }));

    return NextResponse.json(
      {
        '@context': 'http://iiif.io/api/search/2/context.json',
        id: `${BASE}/api/iiif/${bookId}/autocomplete?q=${encodeURIComponent(query)}`,
        type: 'TermPage',
        items: terms,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error('IIIF autocomplete error:', error);
    return NextResponse.json({ error: 'Autocomplete failed' }, { status: 500 });
  }
}
