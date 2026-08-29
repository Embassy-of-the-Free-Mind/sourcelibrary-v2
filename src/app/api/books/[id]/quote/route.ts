import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { generateCitations, type Citation } from '@/lib/citation';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { getShortUrl, getRequestBaseUrl } from '@/lib/shortlinks';
import { readerPageUrl } from '@/lib/slugify';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { resolveQuoteText, containsMarginalia, MARGINALIA_NOTE, OCR_ORIGINAL_NOTE, SOURCE_COLUMN_NOTE, type QuoteTextSource } from '@/lib/quote-text';
import { romanizedForQuote } from '@/lib/romanization';
import { CONTENT_LICENSE, type ContentLicense } from '@/lib/license-info';
import { getPageImageUrl } from '@/lib/page-image-url';
import { isBot, isTrustedBot, botMaxPage } from '@/lib/bot-gate';
import { withApiAuth } from '@/lib/api-auth';
import { isBookReadable } from '@/lib/book-access';
import { languageApparatusFields } from '@/lib/edition-language';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface QuoteResponse {
  quote: {
    /**
     * Our English translation of the leaf. ABSENT on an English-original page,
     * where there is no translation because none is needed — read `text_source`
     * and quote from `original` there (#3939).
     */
    translation?: string;
    original?: string;
    /**
     * Which field holds the quotable text, and whose words they are:
     * `translation` normally; `ocr_original` where the leaf is already English and
     * the transcription IS the citable text; `source_column` where a bilingual
     * leaf's own column is already in the requested language, so the words belong
     * to the historical translator and not to us. Always present, so a caller can
     * branch instead of inferring from which fields came back.
     */
    text_source: QuoteTextSource;
    /** Set when text_source is `ocr_original` or `source_column` — see those notes. */
    transcription_note?: string;
    /**
     * The page carries marginal text (#4362) — copy-specific by nature: it
     * exists only in the one physical copy that was scanned. Set together
     * with `marginalia_note`, which says how to cite it.
     */
    contains_marginalia?: boolean;
    marginalia_note?: string;
    /**
     * ISO code of the language the quoted text is IN — always present, so a
     * caller branches on it rather than assuming English (#4095).
     */
    lang: string;
    /** Set only when `lang` differs from the `lang` parameter that was asked for. */
    lang_note?: string;
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
    /**
     * Language of the leaves in THIS scan. On a translated edition it is the
     * translator's language, not the author's — which is why the three
     * apparatus fields below ride alongside it (#3942). Kept as `language`
     * rather than renamed, so existing clients keep reading a true value.
     */
    language: string;
    /** Language of the work, when it differs from `language`. */
    work_language?: string;
    /** original | period-translation | modern-translation, when classified. */
    text_role?: string;
    /**
     * Set only where `original` below is a translator's text rather than the
     * author's. A quote is a claim about who wrote the words; where the chain
     * runs English←French←Arabic the citation has to say so.
     */
    translation_note?: string;
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
    // Which EDITION of the page to quote (#4095). Falls back to English when
    // the book has no such edition — and SAYS so, in `quote.lang`. A quote is a
    // claim about words; a silent substitution makes the caller assert
    // something it never checked.
    const langParam = (searchParams.get('lang') || '').trim().toLowerCase();
    const requestedLang = /^[a-z]{2,3}$/.test(langParam) ? langParam : 'en';

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

    // Translation when we have one; the OCR transcription when the leaf is
    // already English and therefore is itself the citable text (#3939).
    const quotable = resolveQuoteText(page, book.id, requestedLang);

    // A caller that explicitly said include_original=false wants English we
    // produced, so an English-original page has nothing to give it either.
    if (!quotable || (quotable.source === 'ocr_original' && !includeOriginal)) {
      const hasOriginal = !!page.ocr?.data;
      return NextResponse.json({
        // Two different facts, and they need different sentences: an
        // untranscribed leaf holds no text at all, while "no translation" now
        // implies a foreign source (an English one is served as a quote —
        // #3939). Conflating them told callers an un-OCR'd page was foreign.
        error: hasOriginal
          ? 'No translation available for this page'
          : 'No text available for this page: the scan has not been transcribed',
        page_number: pageNumber,
        // Lets the caller fall back to the original language instead of reading
        // this as "the page is missing" (see src/lib/mcp-errors.ts).
        has_original: hasOriginal,
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
        // and must not be served as quotable content (PR #2232). Stripped in
        // resolveQuoteText, for both text sources.
        // `source_column` rides in `translation` too — a Spanish reader asked for
        // Spanish and got Spanish — but `text_source` and the note below say who
        // wrote it, because the field alone cannot tell Ximenez's 1701 Spanish
        // from a machine pivot of our English.
        ...(quotable.source === 'translation' || quotable.source === 'source_column'
          ? { translation: quotable.text }
          : {}),
        text_source: quotable.source,
        lang: quotable.lang,
        ...(requestedLang !== quotable.lang
          ? { lang_note: `This page has no text in "${requestedLang}", so the English translation was served (lang: "${quotable.lang}"). Do not present it as the "${requestedLang}" edition.` }
          : {}),
        ...(quotable.source === 'ocr_original' ? { transcription_note: OCR_ORIGINAL_NOTE } : {}),
        ...(quotable.source === 'source_column' ? { transcription_note: SOURCE_COLUMN_NOTE } : {}),
        // Checked on the served text AND the OCR original: a translation often
        // renders the note without the mark-up, so the transcription is the
        // authority on whether the leaf carries one (#4362).
        ...(containsMarginalia(quotable.text) || containsMarginalia(page.ocr?.data || '')
          ? { contains_marginalia: true, marginalia_note: MARGINALIA_NOTE }
          : {}),
        page: pageNumber,
        book_id: book.id,
        book_title: book.title,
        display_title: book.display_title,
        author: book.author,
        published: book.published,
        language: book.language,
        ...languageApparatusFields(book),
      },
      // The citation links follow the edition actually served, never the one
      // asked for — a `/es` URL for a book we fell back on would 307 straight
      // back to English.
      citation: generateCitations(book, pageNumber, resolvedBookId, page.id, getRequestBaseUrl(request.headers), currentEdition, quotable.lang),
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

      // Same resolution as the cited page: on an English-original book the
      // neighbours have no translation either, and context exists precisely so a
      // sentence running across the leaf break can be quoted whole — serving it
      // only for translated pages would leave that unreachable exactly where the
      // fallback matters (#3939).
      // Context exists so a sentence running across a leaf break can be quoted
      // whole — it must therefore be in the SAME language as the quote, or the
      // two halves cannot be joined.
      const neighbour = (p: unknown) => {
        const pg = p as Page | null;
        return pg ? resolveQuoteText(pg, resolvedBookId, quotable.lang)?.text : undefined;
      };
      response.context = {
        previous_page: neighbour(prevPage),
        next_page: neighbour(nextPage),
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting quote:', error);
    return NextResponse.json({ error: 'Failed to get quote' }, { status: 500 });
  }
}, { route: 'books.quote' });
