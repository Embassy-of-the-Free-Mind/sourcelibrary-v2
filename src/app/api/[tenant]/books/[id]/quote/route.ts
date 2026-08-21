import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { citationYear, citationYearOrNd } from '@/lib/publication-date';
import { resolveImprintPlace } from '@/lib/imprint';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { getShortUrl, getRequestBaseUrl } from '@/lib/shortlinks';
import { readerPageUrl } from '@/lib/slugify';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { resolveQuoteText, OCR_ORIGINAL_NOTE, SOURCE_COLUMN_NOTE, type QuoteTextSource } from '@/lib/quote-text';
import { romanizedForQuote } from '@/lib/romanization';
import { CONTENT_LICENSE, type ContentLicense } from '@/lib/license-info';
import { isBot, isTrustedBot, botMaxPage } from '@/lib/bot-gate';
import { resolveTenantId } from '@/lib/tenant-context';
import { isBookReadable } from '@/lib/book-access';

interface RouteContext {
  params: Promise<{ tenant: string; id: string }>;
}

interface Citation {
  inline: string;           // (Drebbel 1628, p. 15)
  footnote: string;         // Full footnote citation
  bibliography: string;     // Bibliography entry
  bibtex: string;           // BibTeX format
  chicago: string;          // Chicago style
  mla: string;              // MLA style
  url: string;              // Direct link to page in Source Library
  short_url: string;        // Shortlink for sharing (e.g., Twitter)
  doi_url?: string;         // Clickable DOI URL
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
     * `translation` normally; `ocr_original` where the leaf is already English
     * and the transcription IS the citable text; `source_column` where a
     * bilingual leaf's own column is already in the requested language, so the
     * words belong to the historical translator and not to us.
     */
    text_source: QuoteTextSource;
    /** Set when text_source is `ocr_original` or `source_column` — see those notes. */
    transcription_note?: string;
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
  };
  citation: Citation;
  license: ContentLicense;
  context?: {
    previous_page?: string;
    next_page?: string;
  };
}

function formatAccessedDate(): string {
  const d = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function generateCitations(
  book: Book,
  pageNumber: number,
  bookId: string,
  pageId: string,
  baseUrl: string,
  edition?: TranslationEdition
): Citation {
  // `published` is free text: 23% of the corpus is not a year, and ~1,500 books
  // carry raw Wikidata QuickStatements ("1573date QS:P571,+1573-...Z/9"). That
  // string was landing in the BibTeX `year` field and the inline citation, i.e.
  // straight into scholars' bibliographies. Assert a bare year or `n.d.`.
  const year = citationYearOrNd(book.published);
  // BibTeX keys must stay alphanumeric — 'n.d.' would emit a key with dots.
  const bibtexYearKey = citationYear(book.published) ?? 'nd';
  const author = book.author || 'Unknown';
  const title = book.display_title || book.title;
  const doi = edition?.doi || book.doi;
  const doiUrl = doi ? `https://doi.org/${doi}` : undefined;
  const accessed = formatAccessedDate();
  const translationYear = edition?.published_at
    ? new Date(edition.published_at).getFullYear()
    : new Date().getFullYear();

  // Clean author name (remove extra spaces, handle "Lastname, Firstname")
  const authorParts = author.split(',').map(s => s.trim());
  const authorLastFirst = authorParts.length === 2
    ? `${authorParts[0]}, ${authorParts[1]}`
    : author;
  const authorFirstLast = authorParts.length === 2
    ? `${authorParts[1]} ${authorParts[0]}`
    : author;

  // Original-edition imprint (place, publisher, format, USTC) of the source
  // printing being translated — the bibliographic record of the original work,
  // distinct from the Source Library translation credit. Mirrors the "Cite"
  // dropdown (CiteButton) and the bibliographic panel (BibliographicInfo).
  // Family resolver (#4043) — `place_published` alone misses the catalogue
  // and OCR columns; 3,300 visible books held a place and cited none.
  const imprintPlace = resolveImprintPlace(book)?.display;
  const pubImprint = [imprintPlace, book.publisher].filter(Boolean).join(': ');
  const imprint = [pubImprint, book.format, book.ustc_id ? `USTC ${book.ustc_id}` : ''].filter(Boolean).join('. ');
  const imprintStr = imprint ? `${imprint}. ` : '';

  // Inline citation
  const inline = `(${authorParts[0]} ${year}, p. ${pageNumber})`;

  // Footnote (Chicago style note)
  const footnote = `${authorFirstLast}, ${title}, ${imprintStr}trans. Source Library (${translationYear}), ${pageNumber}${doi ? `. DOI: ${doi}` : ''}.`;

  // Bibliography entry
  const bibliography = `${authorLastFirst}. ${title}. ${imprintStr}Translated by Source Library. ${translationYear}.${doi ? ` DOI: ${doi}.` : ` Accessed ${accessed}.`}`;

  // BibTeX — original imprint (address/publisher) + translation credit (note)
  const bibtexKey = `${authorParts[0].toLowerCase().replace(/[^a-z]/g, '')}${bibtexYearKey}`;
  const bibtexLines = [
    `@book{${bibtexKey},`,
    `  author = {${authorLastFirst}},`,
    `  title = {${title}},`,
    `  year = {${year}},`,
  ];
  if (imprintPlace) bibtexLines.push(`  address = {${imprintPlace}},`);
  bibtexLines.push(`  publisher = {${book.publisher || 'Source Library'}},`);
  bibtexLines.push(`  translator = {Source Library},`);
  if (doi) {
    bibtexLines.push(`  doi = {${doi}},`);
    bibtexLines.push(`  url = {${doiUrl}},`);
  }
  const bibtexNote = [`Translation published ${translationYear}`];
  if (book.format) bibtexNote.push(book.format);
  if (book.ustc_id) bibtexNote.push(`USTC ${book.ustc_id}`);
  bibtexLines.push(`  note = {${bibtexNote.join('; ')}}`);
  bibtexLines.push(`}`);
  const bibtex = bibtexLines.join('\n');

  // Chicago (Author-Date)
  const chicago = `${authorLastFirst}. ${year}. ${title}. ${imprintStr}Translated by Source Library. ${translationYear}.${doi ? ` ${doiUrl}.` : ` Accessed ${accessed}.`}`;

  // MLA
  const mla = `${authorLastFirst}. ${title}. ${imprintStr}Translated by Source Library, ${translationYear}.${doi ? ` DOI: ${doi}.` : ''} Accessed ${accessed}.`;

  // Direct URL to page in Source Library (pinned to edition version).
  // baseUrl is the request host so citations rendered on tenant subdomains
  // (e.g. bph.sourcelibrary.org) link back to the same subdomain.
  //
  // Built from the book's slug, not the requested id: this URL gets printed
  // into papers and footnotes, so it has to say which book it is. Calling the
  // API by id would otherwise mint a permanent citation to /book/<objectid>.
  // Still a relative path joined to the request host, so it stays on the
  // tenant subdomain (lockdown invariant 4/5).
  const editionVersion = edition?.version;
  const vParam = editionVersion ? `?v=${editionVersion}` : '';
  const url = `${baseUrl}${readerPageUrl({ slug: book.slug, id: bookId }, pageId)}${vParam}`;

  // Short URL for sharing
  const short_url = getShortUrl(bookId, pageNumber, pageId, baseUrl);

  return {
    inline,
    footnote,
    bibliography,
    bibtex,
    chicago,
    mla,
    url,
    short_url,
    doi_url: doiUrl,
  };
}

// GET /api/books/[id]/quote?page=N - Get a quote from a specific page
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { tenant, id: bookId } = await context.params;
    const { searchParams } = new URL(request.url);
    const pageNumber = parseInt(searchParams.get('page') || '1');
    const includeOriginal = searchParams.get('include_original') !== 'false';
    const includeContext = searchParams.get('include_context') === 'true';

    if (isNaN(pageNumber) || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    const db = await getReadDb();
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get book by id, slug, or _id
    let book = await db.collection('books').findOne({ id: bookId, tenantId }) as unknown as Book | null;
    if (!book) {
      book = await db.collection('books').findOne({ slug: bookId, tenantId }) as unknown as Book | null;
    }
    if (!book && /^[a-f0-9]{24}$/i.test(bookId)) {
      const { ObjectId } = await import('mongodb');
      book = await db.collection('books').findOne({ _id: new ObjectId(bookId), tenantId }) as unknown as Book | null;
    }
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — 404 unless editor session
    // or CRON_SECRET (pipeline / Claude Code).
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
      tenantId,
      page_number: pageNumber,
    }) as unknown as Page | null;

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Translation when we have one; the OCR transcription when the leaf is
    // already English and therefore is itself the citable text (#3939).
    const quotable = resolveQuoteText(page, book.id);

    // A caller that explicitly said include_original=false wants English we
    // produced, so an English-original page has nothing to give it either.
    if (!quotable || (quotable.source === 'ocr_original' && !includeOriginal)) {
      const hasOriginal = !!page.ocr?.data;
      return NextResponse.json({
        // See the main route: an untranscribed leaf is not a foreign leaf, and
        // since #3939 the "no translation" wording implies foreignness.
        error: hasOriginal
          ? 'No translation available for this page'
          : 'No text available for this page: the scan has not been transcribed',
        page_number: pageNumber,
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
        ...(quotable.source === 'ocr_original' ? { transcription_note: OCR_ORIGINAL_NOTE } : {}),
        ...(quotable.source === 'source_column' ? { transcription_note: SOURCE_COLUMN_NOTE } : {}),
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
          tenantId,
          page_number: pageNumber - 1,
        }),
        db.collection('pages').findOne({
          book_id: resolvedBookId,
          tenantId,
          page_number: pageNumber + 1,
        }),
      ]);

      // Same resolution as the cited page — on an English-original book the
      // neighbours have no translation either, and context is what lets a
      // sentence spanning the leaf break be quoted whole (#3939).
      const neighbour = (p: unknown) => {
        const pg = p as Page | null;
        return pg ? resolveQuoteText(pg, resolvedBookId)?.text : undefined;
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
}
