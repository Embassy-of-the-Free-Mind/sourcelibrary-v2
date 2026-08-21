import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { isBookReadable } from '@/lib/book-access';
import { anonActionGate } from '@/lib/anon-gate';
import { getOrCreateWordAlignment } from '@/lib/word-alignment';
import type { Book } from '@/lib/types';

/**
 * GET /api/books/[id]/pages/[pageId]/alignment — span-level OCR↔translation
 * alignment for the reader's trace mode (issue #3091).
 *
 * Serves the cached `pages.word_alignment` when its text hashes still match;
 * otherwise generates it with one flash-lite call and caches it on the page.
 * Cached serves are free and ungated; generation (a paid Gemini call) is
 * rate-limited per IP for anonymous visitors via anonActionGate.
 */

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; pageId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookIdParam, pageId } = await context.params;
    const db = await getDb();

    // Same id → slug → ObjectId fallback chain as the quote route.
    let book = await db.collection('books').findOne({ id: bookIdParam }) as unknown as Book | null;
    if (!book) {
      book = await db.collection('books').findOne({ slug: bookIdParam }) as unknown as Book | null;
    }
    if (!book && ObjectId.isValid(bookIdParam)) {
      book = await db.collection('books').findOne({ _id: new ObjectId(bookIdParam) }) as unknown as Book | null;
    }
    if (!book || !(await isBookReadable(book, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const page = await db.collection('pages').findOne(
      { id: pageId, book_id: book.id },
      { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1, 'transliteration.data': 1, word_alignment: 1 } },
    );
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // First pass without generation: a cache hit costs nothing and needs no gate.
    let result = await getOrCreateWordAlignment(db, page as never, book.language || 'the original language', {
      allowGenerate: false,
    });

    if (result.status === 'unavailable') {
      // Cache miss — generation is a paid Gemini call, so gate anonymous volume.
      const gate = await anonActionGate(request, { name: 'word-alignment', limit: 60 });
      if (!gate.allowed) {
        return NextResponse.json(
          { status: 'rate_limited', retry_after: gate.retryAfter },
          { status: 429, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : undefined },
        );
      }
      result = await getOrCreateWordAlignment(db, page as never, book.language || 'the original language', {
        allowGenerate: true,
      });
    }

    if (result.status !== 'ready') {
      return NextResponse.json({ status: result.status }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return NextResponse.json(
      {
        status: 'ready',
        version: result.alignment.version,
        model: result.alignment.model,
        pairs: result.alignment.pairs,
      },
      // Immutable per text revision (hash-keyed), so let the browser hold it.
      { headers: { 'Cache-Control': 'private, max-age=3600' } },
    );
  } catch (error) {
    console.error('Error serving word alignment:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
