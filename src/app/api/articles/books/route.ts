import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import articleBooks from '@/generated/article-books.json';

// The books an article links to, as card data for the "Books in this article"
// grid (src/app/articles/ArticleBooks.tsx). Which books comes from
// src/generated/article-books.json (scripts/maintenance/generate-article-books.mjs);
// this only looks them up. Cached at the edge for a day: the list changes only
// with a deploy, and the card numbers (pages, OCR, translated) can lag a day.

const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
  language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translatable: 1, pages_blank: 1,
  translation_state: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_card: 1, thumbnail_frame: 1,
  is_first_translation: 1, ft_disposition: 1, 'translation_verification.disposition': 1, resource_type: 1, preview: 1,
} as const;

const MAX_BOOKS = 80;

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || '';
  const refs = ((articleBooks as Record<string, string[]>)[slug] || []).slice(0, MAX_BOOKS);
  if (!refs.length) {
    return NextResponse.json({ books: [] }, { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });
  }

  const db = await withTimeout(getReadDb(), 8000, null);
  if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 503 });

  const rows = (await db
    .collection('books')
    .find({ $or: [{ id: { $in: refs } }, { slug: { $in: refs } }], visible: { $ne: false } }, { projection: BOOK_PROJECTION, maxTimeMS: 8000 })
    .toArray()) as Record<string, unknown>[];

  // Keep the order the article mentions them in; one card per book.
  const byRef = new Map<string, Record<string, unknown>>();
  for (const b of rows) {
    if (b.id) byRef.set(b.id as string, b);
    if (b.slug) byRef.set(b.slug as string, b);
  }
  const seen = new Set<string>();
  const books = refs.flatMap((ref) => {
    const b = byRef.get(ref);
    if (!b || seen.has(b.id as string)) return [];
    seen.add(b.id as string);
    const { translation_verification, ...rest } = b as Record<string, unknown> & { translation_verification?: { disposition?: string } };
    return [{
      ...rest,
      thumbnail: sanitizeThumbnail(b.thumbnail_blob as string) || sanitizeThumbnail(b.thumbnail as string),
      ft_disposition: (b.ft_disposition as string | undefined) || translation_verification?.disposition,
    }];
  });

  return NextResponse.json(
    { books },
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' } },
  );
}
