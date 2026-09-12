import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import archiver from 'archiver';
import { Readable } from 'stream';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { isBookReadable } from '@/lib/book-access';
import { isInnerCircle } from '@/lib/auth-helpers';
import { classifyImageAccess, hasPurchased, type ImageAccess } from '@/lib/purchases';
import { checkAndRecordDownload } from '@/lib/download-cap';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { markForExport } from '@/lib/provenance';
import { generateCitations, type Citation } from '@/lib/citation';
import { getRequestBaseUrl } from '@/lib/shortlinks';
import { resolveImprintPlace } from '@/lib/imprint';
import { pageExportImageUrl, fetchAndCompressImage } from '@/lib/export-page-images';
import type { Book, Page, TranslationEdition } from '@/lib/types';

/**
 * GET /api/books/[id]/pages/[pageId]/package
 *
 * "Download this page" — the one thing neither the whole-book download route
 * nor the bare-JPEG scan link gives a reader: a single page complete enough to
 * cite on its own. A ZIP containing the scan (licence permitting), the
 * transcription, the translation, and a README carrying the bibliographic
 * record.
 *
 * Conventions deliberately mirror the whole-book route
 * (`src/app/api/books/[id]/download/route.ts`) rather than inventing a new
 * scheme: sign-in required, image licence via `classifyImageAccess()`, the
 * same free-tier daily cap (`checkAndRecordDownload`), the same streamed-ZIP
 * shape (never buffer the whole archive before responding).
 *
 * Two deliberate departures from the whole-book route, both because a single
 * page is a citation-shaped artifact, not a bulk export:
 *  - A blocked image licence OMITS the scan and says so in the README, rather
 *    than 403ing the whole package — the transcription/translation/citation
 *    are still worth having without the image.
 *  - It stays in the free/capped tier (never the Stripe paid-format gate):
 *    one page's scan is not the bulk facsimile export that gate protects
 *    against, and gating it there would also require adding a new
 *    `BookDownloadFormats` member for a route that isn't a `format=` value on
 *    the download route at all.
 *
 * Book resolution (id → slug → ObjectId) matches the sibling
 * `pages/[pageId]/alignment` route, not the whole-book route's bare
 * `findOne({ id })` — this route lives under the same `pages/[pageId]/`
 * segment and should resolve the same way its neighbour does.
 */

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string; pageId: string }>;
}

function buildReadme(opts: {
  book: Book;
  page: Page;
  bookTitle: string;
  citation: Citation;
  imageAccess: ImageAccess;
  hasImage: boolean;
}): string {
  const { book, page, bookTitle, citation, imageAccess, hasImage } = opts;
  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('SOURCE LIBRARY');
  lines.push(`Page ${page.page_number} of "${bookTitle}"`);
  lines.push('='.repeat(60));
  lines.push('');

  // Bibliographic record.
  lines.push(`Title: ${bookTitle}`);
  if (book.display_title && book.title !== book.display_title) {
    lines.push(`Original Title: ${book.title}`);
  }
  lines.push(`Author: ${book.author}`);
  lines.push(`Original Language: ${book.language}`);
  if (book.published) lines.push(`Published: ${book.published}`);
  const place = resolveImprintPlace(book)?.display;
  if (place) lines.push(`Place: ${place}`);
  if (book.publisher) lines.push(`Publisher: ${book.publisher}`);
  lines.push('');
  lines.push(`Page: ${page.page_number}`);
  lines.push(`Canonical URL: ${citation.url}`);
  if (citation.doi_url) lines.push(`DOI: ${citation.doi_url}`);
  lines.push('');

  // Contents manifest — say what's here AND what was left out, and why.
  lines.push('CONTENTS OF THIS PACKAGE');
  if (hasImage) {
    lines.push(`  - page-${String(page.page_number).padStart(4, '0')}.jpg — the page scan`);
  } else if (imageAccess === 'blocked') {
    lines.push('  - [scan NOT included] the source institution has not released this');
    lines.push('    book\'s scans under a redistributable license.');
  } else {
    lines.push('  - [scan NOT included] no scan is archived for this page.');
  }
  if (page.ocr?.data) {
    lines.push('  - transcription.txt — the original-language text');
  } else {
    lines.push('  - [transcription NOT included] this page has not been transcribed.');
  }
  if (page.translation?.data) {
    lines.push('  - translation.txt — the English translation');
  } else {
    lines.push('  - [translation NOT included] no translation available for this page.');
  }
  lines.push('');

  // Provenance — who/what produced the text, named plainly.
  lines.push('PROVENANCE');
  lines.push(
    page.ocr?.model
      ? `Transcription produced by: ${page.ocr.model}`
      : 'Transcription: not yet produced.'
  );
  lines.push(
    page.translation?.model
      ? `Translation produced by: ${page.translation.model}`
      : 'Translation: not yet produced.'
  );
  lines.push('');

  // Citation, reusing the same apparatus the Cite panel and quote API build.
  lines.push('HOW TO CITE THIS PAGE');
  lines.push(citation.bibliography);
  lines.push('');
  lines.push(citation.inline);
  lines.push('');

  lines.push('-'.repeat(60));
  lines.push(`Downloaded: ${now}`);
  lines.push('License: CC BY-SA 4.0 (Creative Commons Attribution-ShareAlike)');
  lines.push('Produced by SourceLibrary.org in Amsterdam, 2026');
  lines.push('Please cite Source Library when using this material.');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: bookIdParam, pageId } = await params;

    // All downloads require sign-in — same rule as the whole-book route.
    const session = await auth();
    const userId = session?.user?.id || null;
    if (!userId) {
      return NextResponse.json(
        { error: 'Sign in required', requires_signin: true },
        { status: 401 },
      );
    }

    const db = await getDb();

    // id → slug → ObjectId fallback, matching the sibling alignment route.
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
    const bookId = book.id;

    const page = await db.collection('pages').findOne({ id: pageId, book_id: bookId }) as unknown as Page | null;
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Daily free-tier cap (#3290) — a page package rides the same free/capped
    // tier as the plain-text book formats. Members, per-book purchasers, and
    // editor/admin sessions are exempt, same as the whole-book route.
    const isMember = (session?.user as { membership?: unknown } | undefined)?.membership != null;
    const isExemptEditor = await isInnerCircle();
    const isPurchased = isMember || isExemptEditor ? false : await hasPurchased(userId, 'book', bookId);
    if (!isMember && !isExemptEditor && !isPurchased) {
      const cap = await checkAndRecordDownload(userId, bookId);
      if (!cap.allowed) {
        return NextResponse.json(
          {
            error: 'Daily download limit reached (20 books/24h). For bulk or programmatic access, see https://sourcelibrary.org/licensing',
            limit_reached: true,
          },
          { status: 429 },
        );
      }
    }

    // Same image-licence classification the whole-book route uses. Unlike
    // that route, a blocked licence does not fail the request — it just
    // means no scan goes in the ZIP (see module doc above).
    const imageAccess = await classifyImageAccess(bookId);
    const imageUrl = imageAccess !== 'blocked' ? pageExportImageUrl(page) : null;

    const baseUrl = getRequestBaseUrl(request.headers);
    const editions = (book.editions || []) as TranslationEdition[];
    const edition =
      editions.find(e => e.id === book.current_edition_id) ||
      editions.find(e => e.status === 'published') ||
      null;
    const citation = generateCitations(book, page.page_number, bookId, page.id, baseUrl, edition || undefined);

    const bookTitle = book.display_title || book.title || 'untitled';
    const safeTitle = bookTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
    const paddedPage = String(page.page_number).padStart(4, '0');
    const zipFilename = `${safeTitle}-p${paddedPage}.zip`;

    // Streamed ZIP — same shape as generateImagesZipStream(): the archive is
    // returned immediately and filled asynchronously, so the response starts
    // flowing without waiting on the image fetch. Only one image is ever in
    // flight here, so no bounded-concurrency machinery is needed.
    const archive = archiver('zip', { zlib: { level: 9 } });

    (async () => {
      try {
        if (imageUrl) {
          const imageBuffer = await fetchAndCompressImage(imageUrl);
          if (imageBuffer) {
            archive.append(imageBuffer, { name: `page-${paddedPage}.jpg` });
          }
        }

        // Whole-page text for reuse (not a snippet/quote), so keepTables:true —
        // see .claude/docs/invariants/text-helpers-and-exports.md. The OCR text
        // is the original source and is never provenance-marked; the
        // translation carries the same invisible mark every other download
        // format does.
        if (page.ocr?.data) {
          const ocrText = stripEditorialWrappers(page.ocr.data, { keepTables: true }).trim();
          archive.append(ocrText, { name: 'transcription.txt' });
        }
        if (page.translation?.data) {
          const translationText = stripEditorialWrappers(page.translation.data, { keepTables: true }).trim();
          archive.append(markForExport(translationText, bookId), { name: 'translation.txt' });
        }

        archive.append(
          buildReadme({ book: book as Book, page, bookTitle, citation, imageAccess, hasImage: !!imageUrl }),
          { name: 'README.txt' },
        );

        await archive.finalize();
      } catch (err) {
        console.error('page-package stream failed:', err);
        archive.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Page package download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
