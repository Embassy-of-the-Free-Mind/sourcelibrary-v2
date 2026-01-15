import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { getShortUrl } from '@/lib/shortlinks';

interface RouteContext {
  params: Promise<{ id: string }>;
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
    translation: string;
    original?: string;
    page: number;
    book_id: string;
    book_title: string;
    display_title?: string;
    author: string;
    published: string;
    language: string;
  };
  citation: Citation;
  context?: {
    previous_page?: string;
    next_page?: string;
  };
}

function generateCitations(
  book: Book,
  pageNumber: number,
  bookId: string,
  pageId: string,
  edition?: TranslationEdition
): Citation {
  const year = book.published || 'n.d.';
  const author = book.author || 'Unknown';
  const title = book.display_title || book.title;
  const doi = edition?.doi || book.doi;
  const doiUrl = doi ? `https://doi.org/${doi}` : undefined;
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

  // Inline citation
  const inline = `(${authorParts[0]} ${year}, p. ${pageNumber})`;

  // Footnote (Chicago style note)
  const footnote = `${authorFirstLast}, ${title}, trans. Source Library (${translationYear}), ${pageNumber}${doi ? `. DOI: ${doi}` : ''}.`;

  // Bibliography entry
  const bibliography = `${authorLastFirst}. ${title}. Translated by Source Library. ${translationYear}.${doi ? ` DOI: ${doi}.` : ''}`;

  // BibTeX
  const bibtexKey = `${authorParts[0].toLowerCase().replace(/[^a-z]/g, '')}${year}`;
  const bibtex = `@book{${bibtexKey},
  author = {${authorLastFirst}},
  title = {${title}},
  year = {${year}},
  translator = {Source Library},
  note = {Translation published ${translationYear}}${doi ? `,
  doi = {${doi}},
  url = {${doiUrl}}` : ''}
}`;

  // Chicago (Author-Date)
  const chicago = `${authorLastFirst}. ${year}. ${title}. Translated by Source Library. ${translationYear}.${doi ? ` ${doiUrl}.` : ''}`;

  // MLA
  const mla = `${authorLastFirst}. ${title}. Translated by Source Library, ${translationYear}.${doi ? ` DOI: ${doi}.` : ''}`;

  // Direct URL to page in Source Library
  const url = `https://sourcelibrary.org/book/${bookId}/page/${pageId}`;

  // Short URL for sharing
  const short_url = getShortUrl(bookId, pageNumber, pageId);

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
    const { id: bookId } = await context.params;
    const { searchParams } = new URL(request.url);
    const pageNumber = parseInt(searchParams.get('page') || '1');
    const includeOriginal = searchParams.get('include_original') !== 'false';
    const includeContext = searchParams.get('include_context') === 'true';

    if (isNaN(pageNumber) || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get the requested page
    const page = await db.collection('pages').findOne({
      book_id: bookId,
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
        translation: page.translation.data,
        page: pageNumber,
        book_id: book.id,
        book_title: book.title,
        display_title: book.display_title,
        author: book.author,
        published: book.published,
        language: book.language,
      },
      citation: generateCitations(book, pageNumber, bookId, page.id, currentEdition),
    };

    // Include original text if requested
    if (includeOriginal && page.ocr?.data) {
      response.quote.original = page.ocr.data;
    }

    // Include context (adjacent pages) if requested
    if (includeContext) {
      const [prevPage, nextPage] = await Promise.all([
        db.collection('pages').findOne({
          book_id: bookId,
          page_number: pageNumber - 1,
        }),
        db.collection('pages').findOne({
          book_id: bookId,
          page_number: pageNumber + 1,
        }),
      ]);

      response.context = {
        previous_page: (prevPage as unknown as Page | null)?.translation?.data,
        next_page: (nextPage as unknown as Page | null)?.translation?.data,
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting quote:', error);
    return NextResponse.json({ error: 'Failed to get quote' }, { status: 500 });
  }
}
