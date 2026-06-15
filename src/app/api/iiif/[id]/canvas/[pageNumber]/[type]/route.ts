/**
 * IIIF Annotation Pages — OCR and Translation
 *
 * GET /api/iiif/{bookId}/canvas/{pageNumber}/ocr
 * GET /api/iiif/{bookId}/canvas/{pageNumber}/translation
 *
 * Returns a IIIF AnnotationPage with supplementing annotations.
 * These are referenced (not inline) from the manifest and loaded on demand
 * by IIIF viewers like Mirador or Universal Viewer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { aiGenerator } from '@/lib/iiif-provenance';
import { isBookReadable } from '@/lib/book-access';

const BASE = 'https://sourcelibrary.org';

const LANG_CODES: Record<string, string> = {
  latin: 'la',
  german: 'de',
  french: 'fr',
  english: 'en',
  italian: 'it',
  dutch: 'nl',
  spanish: 'es',
  greek: 'el',
  hebrew: 'he',
  arabic: 'ar',
};

function langCode(language?: string): string {
  if (!language) return 'none';
  return LANG_CODES[language.toLowerCase()] || language.toLowerCase().slice(0, 2);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageNumber: string; type: string }> }
) {
  try {
    const { id, pageNumber, type } = await params;
    const pageNum = parseInt(pageNumber);

    if (isNaN(pageNum)) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    if (type !== 'ocr' && type !== 'translation') {
      return NextResponse.json(
        { error: 'Type must be "ocr" or "translation"' },
        { status: 400 }
      );
    }

    const db = await getReadDb();

    // Hidden (visible:false) books are not public — gate before serving any
    // page transcription. 404 unless editor session or CRON_SECRET.
    const gateBook = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      { projection: { id: 1, visible: 1 } }
    );
    if (!gateBook || !(await isBookReadable(gateBook, request))) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Fetch only the field we need
    const projection =
      type === 'ocr'
        ? { 'ocr.data': 1, 'ocr.language': 1, 'ocr.model': 1, page_number: 1 }
        : { 'translation.data': 1, 'translation.language': 1, 'translation.model': 1, page_number: 1 };

    const page = await db.collection('pages').findOne(
      { book_id: id, page_number: pageNum },
      { projection }
    );

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const content = type === 'ocr' ? page.ocr : page.translation;
    if (!content?.data) {
      return NextResponse.json({ error: `No ${type} data for this page` }, { status: 404 });
    }

    // Strip AI editorial wrapper blocks (<meta>/<summary>/<keywords>/<vocab>)
    // before serving as a transcription/translation. These describe the page
    // (often naming content from ADJACENT pages) and are never verbatim source —
    // overlaying them in a viewer fabricates citations to words not on the page
    // (the "mercury on page 89" misquote, PR #2232). Strip content, not just tags.
    const value = stripEditorialWrappers(content.data).trim();
    if (!value) {
      return NextResponse.json({ error: `No ${type} data for this page` }, { status: 404 });
    }

    const canvasId = `${BASE}/api/iiif/${id}/canvas/p${pageNum}`;
    const annoPageId = `${BASE}/api/iiif/${id}/canvas/${pageNum}/${type}`;
    const language = type === 'translation' ? 'en' : langCode(content.language);

    const annotationPage = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: annoPageId,
      type: 'AnnotationPage',
      items: [
        {
          id: `${annoPageId}/anno`,
          type: 'Annotation',
          motivation: 'supplementing',
          body: {
            type: 'TextualBody',
            value,
            format: 'text/plain',
            language,
          },
          // Machine origin made explicit so AI text is never mistaken for a
          // human-verified transcript.
          generator: aiGenerator(type, content.model),
          target: canvasId,
        },
      ],
    };

    return new NextResponse(JSON.stringify(annotationPage, null, 2), {
      headers: {
        'Content-Type': 'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"',
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('Error building IIIF annotation page:', error);
    return NextResponse.json({ error: 'Failed to build annotation page' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}
