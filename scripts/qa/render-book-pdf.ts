/**
 * Local PDF-download QA harness.
 *
 * Renders the SAME generator code the download routes serve
 * (src/lib/pdf-export.ts) against real production data, without auth or a
 * deploy — so download-format changes can be inspected visually before they
 * ship, and regressions reproduced from a reader report in one command.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/qa/render-book-pdf.ts <bookId> [pdf-facsimile|pdf-translation] [outPath]
 *
 * Output defaults to scripts/output/<bookId>-<format>.pdf (gitignored scratch).
 * Open the PDF in a viewer that supports two-page view (Preview: View →
 * Two Pages) to check facsimile spreads, or let Claude Read it page by page.
 *
 * The image path mirrors the route: canonical resolver (getPageImageUrl,
 * display variant) → fetch → sharp resize/compress → ordered bounded stream.
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { createWriteStream, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  generatePdfFacsimileStream,
  generatePdfTranslationStream,
  type PdfBookInfo,
  type PdfExportPage,
} from '../../src/lib/pdf-export';
import { getPageImageUrl } from '../../src/lib/page-image-url';
import { streamOrdered } from '../../src/lib/ordered-stream';

const BASE_URL = 'https://sourcelibrary.org';

type QaPage = PdfExportPage & Record<string, unknown>;

function pageExportImageUrl(page: QaPage): string | null {
  const legacy =
    (page as { compressed_photo?: string }).compressed_photo ||
    (page as { photo?: string }).photo ||
    null;
  const resolved = getPageImageUrl(page as Parameters<typeof getPageImageUrl>[0], 'display') || legacy;
  if (!resolved) return null;
  return resolved.startsWith('/') ? `${BASE_URL}${resolved}` : resolved;
}

async function fetchFacsimilePdfImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return await sharp(buffer)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    console.error(`image fetch failed: ${url}`, e);
    return null;
  }
}

async function* streamPageImagesOrdered(validPages: QaPage[]) {
  const stream = streamOrdered(
    validPages,
    page => {
      const url = pageExportImageUrl(page);
      return url ? fetchFacsimilePdfImage(url) : Promise.resolve(null);
    },
    { concurrency: 8, lookahead: 12 },
  );
  for await (const { item, value } of stream) {
    yield { page: item, imageBuffer: value };
  }
}

async function main() {
  const [bookId, format = 'pdf-facsimile', outArg] = process.argv.slice(2);
  if (!bookId || !['pdf-facsimile', 'pdf-translation'].includes(format)) {
    console.error('Usage: npx tsx scripts/qa/render-book-pdf.ts <bookId> [pdf-facsimile|pdf-translation] [outPath]');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set — source .env.production.local first');
    process.exit(1);
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('bookstore');
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    console.error(`book ${bookId} not found`);
    process.exit(1);
  }
  const pages = (await db
    .collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .toArray()) as unknown as QaPage[];
  await client.close();

  console.log(`${book.title} — ${pages.length} pages, format ${format}`);

  const outPath = outArg || join('scripts', 'output', `${bookId}-${format}.pdf`);
  mkdirSync(dirname(outPath), { recursive: true });

  const bookInfo: PdfBookInfo = {
    id: book.id,
    title: book.title,
    display_title: book.display_title,
    author: book.author || 'Anonymous',
    language: book.language || 'Unknown',
    published: book.published,
  };

  const doc =
    format === 'pdf-facsimile'
      ? generatePdfFacsimileStream(bookInfo, pages, {
          baseUrl: BASE_URL,
          hasImage: p => !!pageExportImageUrl(p),
          streamImages: streamPageImagesOrdered,
        })
      : generatePdfTranslationStream(bookInfo, pages, { baseUrl: BASE_URL });

  const out = createWriteStream(outPath);
  doc.pipe(out);
  await new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.on('error', reject);
  });
  console.log(`wrote ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
