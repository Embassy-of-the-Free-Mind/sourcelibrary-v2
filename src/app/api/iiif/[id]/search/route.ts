/**
 * IIIF Content Search API 2.0
 *
 * GET /api/iiif/{bookId}/search?q={query}
 *
 * Searches OCR and translation text within a book, returning results
 * as IIIF Annotations targeting canvases. Compatible with Mirador 3
 * and Universal Viewer search panels.
 *
 * Spec: https://iiif.io/api/search/2.0/
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isBot, isTrustedBot, botMaxPage } from '@/lib/bot-gate';

const BASE = 'https://sourcelibrary.org';
const MAX_RESULTS = 200;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function corsHeaders() {
  return {
    'Content-Type': 'application/ld+json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=600',
  };
}

interface TextMatch {
  prefix: string;
  exact: string;
  suffix: string;
  position: number;
}

function findMatches(text: string, query: string, maxMatches = 10): TextMatch[] {
  const matches: TextMatch[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let pos = 0;
  while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1 && matches.length < maxMatches) {
    const prefixStart = Math.max(0, pos - 40);
    const suffixEnd = Math.min(text.length, pos + query.length + 40);
    matches.push({
      prefix: text.slice(prefixStart, pos),
      exact: text.slice(pos, pos + query.length),
      suffix: text.slice(pos + query.length, suffixEnd),
      position: pos,
    });
    pos += query.length;
  }
  return matches;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const motivation = searchParams.get('motivation');

    // Build ignored params list (spec requires reporting unimplemented params)
    const ignored: string[] = [];
    if (searchParams.has('date')) ignored.push('date');
    if (searchParams.has('user')) ignored.push('user');

    const requestUrl = `${BASE}/api/iiif/${id}/search${query ? `?q=${encodeURIComponent(query)}` : ''}`;

    // No query → empty result
    if (!query) {
      return NextResponse.json(
        {
          '@context': 'http://iiif.io/api/search/2/context.json',
          id: requestUrl,
          type: 'AnnotationPage',
          items: [],
          ...(ignored.length ? { ignored } : {}),
        },
        { headers: corsHeaders() }
      );
    }

    const db = await getDb();

    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      { projection: { id: 1, pages_count: 1, pages_ocr: 1 } }
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookId = book.id as string;
    const pagesCount = (book.pages_count as number) || 0;

    // Bot gating
    const bot = isBot(request);
    const trusted = bot && isTrustedBot(request);
    const maxPage = bot && !trusted ? botMaxPage(pagesCount) : pagesCount;

    // Use MongoDB $regex to filter pages server-side (scoped to one book, safe)
    const regexFilter = { $regex: query, $options: 'i' };
    const textFilter: Record<string, unknown>[] = [];

    if (!motivation || motivation.includes('supplementing')) {
      textFilter.push({ 'ocr.data': regexFilter });
      textFilter.push({ 'translation.data': regexFilter });
    }

    if (textFilter.length === 0) {
      textFilter.push({ 'ocr.data': regexFilter });
    }

    const pageFilter: Record<string, unknown> = {
      book_id: bookId,
      $or: textFilter,
    };

    // Apply bot gating
    if (bot && !trusted) {
      pageFilter.page_number = { $lte: maxPage };
    }

    const pages = await db
      .collection('pages')
      .find(pageFilter, {
        projection: {
          page_number: 1,
          'ocr.data': 1,
          'ocr.language': 1,
          'translation.data': 1,
        },
        sort: { page_number: 1 },
        limit: 100, // Cap pages scanned
      })
      .maxTimeMS(10000)
      .toArray();

    // Build annotations
    const items: Record<string, unknown>[] = [];
    const highlights: Record<string, unknown>[] = [];
    let totalMatches = 0;

    for (const page of pages) {
      if (totalMatches >= MAX_RESULTS) break;
      const pageNum = page.page_number;
      const canvasId = `${BASE}/api/iiif/${bookId}/canvas/p${pageNum}`;

      // Check OCR text
      const ocrText = page.ocr?.data as string | undefined;
      if (ocrText) {
        const ocrMatches = findMatches(ocrText, query);
        if (ocrMatches.length > 0) {
          const annoId = `${BASE}/api/iiif/${bookId}/search/anno/p${pageNum}-ocr`;
          items.push({
            id: annoId,
            type: 'Annotation',
            motivation: 'supplementing',
            body: {
              type: 'TextualBody',
              value: ocrText.slice(0, 500),
              format: 'text/plain',
              language: page.ocr?.language || 'none',
            },
            target: canvasId,
          });

          for (let i = 0; i < ocrMatches.length && totalMatches < MAX_RESULTS; i++) {
            const m = ocrMatches[i];
            highlights.push({
              id: `${BASE}/api/iiif/${bookId}/search/match/p${pageNum}-ocr-${i}`,
              type: 'Annotation',
              motivation: 'highlighting',
              target: {
                type: 'SpecificResource',
                source: annoId,
                selector: [{
                  type: 'TextQuoteSelector',
                  prefix: m.prefix,
                  exact: m.exact,
                  suffix: m.suffix,
                }],
              },
            });
            totalMatches++;
          }
        }
      }

      // Check translation text
      const transText = page.translation?.data as string | undefined;
      if (transText) {
        const transMatches = findMatches(transText, query);
        if (transMatches.length > 0) {
          const annoId = `${BASE}/api/iiif/${bookId}/search/anno/p${pageNum}-trans`;
          items.push({
            id: annoId,
            type: 'Annotation',
            motivation: 'supplementing',
            body: {
              type: 'TextualBody',
              value: transText.slice(0, 500),
              format: 'text/plain',
              language: 'en',
            },
            target: canvasId,
          });

          for (let i = 0; i < transMatches.length && totalMatches < MAX_RESULTS; i++) {
            const m = transMatches[i];
            highlights.push({
              id: `${BASE}/api/iiif/${bookId}/search/match/p${pageNum}-trans-${i}`,
              type: 'Annotation',
              motivation: 'highlighting',
              target: {
                type: 'SpecificResource',
                source: annoId,
                selector: [{
                  type: 'TextQuoteSelector',
                  prefix: m.prefix,
                  exact: m.exact,
                  suffix: m.suffix,
                }],
              },
            });
            totalMatches++;
          }
        }
      }
    }

    const response: Record<string, unknown> = {
      '@context': 'http://iiif.io/api/search/2/context.json',
      id: requestUrl,
      type: 'AnnotationPage',
      items,
    };

    if (highlights.length > 0) {
      response.annotations = [{
        type: 'AnnotationPage',
        items: highlights,
      }];
    }

    if (ignored.length > 0) {
      response.ignored = ignored;
    }

    return NextResponse.json(response, { headers: corsHeaders() });
  } catch (error) {
    console.error('IIIF search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
