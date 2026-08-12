import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { generateCitations, type Citation } from '@/lib/citation';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { getShortUrl, getRequestBaseUrl } from '@/lib/shortlinks';
import { readerPageUrl } from '@/lib/slugify';
import { markForExport } from '@/lib/provenance';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { romanizedForQuote } from '@/lib/romanization';
import { CONTENT_LICENSE, type ContentLicense } from '@/lib/license-info';
import { getPageImageUrl } from '@/lib/page-image-url';
import { isBot, isTrustedBot, botMaxPage } from '@/lib/bot-gate';
import { withApiAuth } from '@/lib/api-auth';
import { isBookReadable } from '@/lib/book-access';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface QuoteResponse {
  quote: {
    translation: string;
    original?: string;
    /**
     * Romanization of the original for non-Latin scripts (#3828) — AI-derived
     * apparatus, never a transcription, hence `romanized` and not
     * `original_romanized`. Served only when the page carries a
     * transliteration that is still current against its OCR.
     */
    romanized?: string;
    page: number;
    book_id: string;
    book_title: string;
    display_title?: string;
    author: string;
    published: string;
    language: string;
    /** Display-sized scan of the cited leaf (≤1200px, browser-safe). Only when ?include_image=true. */
    page_image_url?: string;
  };
  citation: Citation;
  license: ContentLicense;
  context?: {
    previous_page?: string;
    next_page?: string;
  };
}

// GET /api/books/[id]/quote?page=N - Get a quote from a specific page
export const GET = withApiAuth(async (request: NextRequest, context: RouteContext) => {
  try {
    const { id: bookId } = await context.params;
    const { searchParams } = new URL(request.url);
    const pageNumber = parseInt(searchParams.get('page') || '1');
    const includeOriginal = searchParams.get('include_original') !== 'false';
    const includeContext = searchParams.get('include_context') === 'true';
    const includeImage = searchParams.get('include_image') === 'true';

    if (isNaN(pageNumber) || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    const db = await getReadDb();

    // Get book by id, slug, or _id
    let book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
    if (!book) {
      book = await db.collection('books').findOne({ slug: bookId }) as unknown as Book | null;
    }
    if (!book && /^[a-f0-9]{24}$/i.test(bookId)) {
      const { ObjectId } = await import('mongodb');
      book = await db.collection('books').findOne({ _id: new ObjectId(bookId) }) as unknown as Book | null;
    }
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — 404 unless the caller is an
    // editor session or carries CRON_SECRET (pipeline / Claude Code).
    if (!(await isBookReadable(book, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Bot page gating: only allow quotes from the first 20% of pages
    const resolvedBookId = book.id;
    if (isBot(request) && !(await isTrustedBot(request))) {
      const maxPage = botMaxPage(book.pages_count || 0);
      if (pageNumber > maxPage) {
        return NextResponse.json({
          error: `Page ${pageNumber} is beyond the bot-accessible range (pages 1–${maxPage}). Install the MCP server for full access: claude mcp add source-library -- npx -y @source-library/mcp-server`,
          accessible_pages: maxPage,
          partnership: 'https://sourcelibrary.org/llms.txt',
        }, { status: 403 });
      }
    }

    const page = await db.collection('pages').findOne({
      book_id: resolvedBookId,
      page_number: pageNumber,
    }) as unknown as Page | null;

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    if (!page.translation?.data) {
      return NextResponse.json({
        error: 'No translation available for this page',
        page_number: pageNumber,
      }, { status: 404 });
    }

    // Get current edition for DOI
    const editions = (book.editions || []) as TranslationEdition[];
    const currentEdition = editions.find(e => e.status === 'published');

    // Build response
    const response: QuoteResponse = {
      quote: {
        // Editorial annotation blocks (<meta>/<summary>/… and the OCR page
        // envelope) describe the page — they are never verbatim source text
        // and must not be served as quotable content (PR #2232).
        translation: markForExport(stripEditorialWrappers(page.translation.data).trim(), book.id),
        page: pageNumber,
        book_id: book.id,
        book_title: book.title,
        display_title: book.display_title,
        author: book.author,
        published: book.published,
        language: book.language,
      },
      citation: generateCitations(book, pageNumber, resolvedBookId, page.id, getRequestBaseUrl(request.headers), currentEdition),
      license: CONTENT_LICENSE,
    };

    // Include the scan image of the cited leaf if requested. Display size only
    // (≤1200px via the canonical resolver) — the quote path is a citation
    // apparatus, not a download channel.
    if (includeImage) {
      const imageUrl = getPageImageUrl(page, 'display');
      if (imageUrl) response.quote.page_image_url = imageUrl;
    }

    // Include original text if requested
    if (includeOriginal && page.ocr?.data) {
      response.quote.original = stripEditorialWrappers(page.ocr.data).trim();
      // …and, for non-Latin scripts, its romanization — the third layer of the
      // citation (#3828). Rides the same flag as `original`: it is a reading of
      // the original, so a caller that asked for translation only should not
      // get the source text back in Latin letters.
      const romanized = romanizedForQuote(page);
      if (romanized) response.quote.romanized = romanized;
    }

    // Include context (adjacent pages) if requested
    if (includeContext) {
      const [prevPage, nextPage] = await Promise.all([
        db.collection('pages').findOne({
          book_id: resolvedBookId,
          page_number: pageNumber - 1,
        }),
        db.collection('pages').findOne({
          book_id: resolvedBookId,
          page_number: pageNumber + 1,
        }),
      ]);

      const prevText = (prevPage as unknown as Page | null)?.translation?.data;
      const nextText = (nextPage as unknown as Page | null)?.translation?.data;
      response.context = {
        previous_page: prevText ? markForExport(stripEditorialWrappers(prevText).trim(), book.id) : undefined,
        next_page: nextText ? markForExport(stripEditorialWrappers(nextText).trim(), book.id) : undefined,
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting quote:', error);
    return NextResponse.json({ error: 'Failed to get quote' }, { status: 500 });
  }
}, { route: 'books.quote' });
