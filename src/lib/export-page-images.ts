import archiver from 'archiver';
import sharp from 'sharp';
import { images } from '@/lib/api-client';
import { getPageImageUrl } from '@/lib/page-image-url';
import { streamOrdered } from '@/lib/ordered-stream';
import type { Page } from '@/lib/types';

/**
 * Page-image resolution and fetching for the download exports.
 *
 * This lived in BOTH download routes (`/api/books/[id]/download` and its tenant
 * twin), and the twins drifted: fixes landed on the global route and were ported
 * to the tenant one only at the call site that motivated them, leaving three of
 * four tenant image formats on the legacy path for months (#3909). The failure
 * was silent in both directions — a wrong image is still a valid JPEG, and a
 * serial fetch is just slow until Cloudflare cuts it.
 *
 * The mechanics here are tenant-independent: what differs between the two routes
 * is which books they may serve, not how an image is resolved or fetched. Import
 * these; do not re-implement them beside a call site.
 */

const IMAGE_WIDTH = 600;
const IMAGE_HEIGHT = 900;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

/**
 * Fetch and process an image for EPUB/PDF embedding.
 * Minimal processing: resize, grayscale, normalize (auto contrast), compress.
 */
export async function fetchAndCompressImage(url: string): Promise<Buffer | null> {
  try {
    const buffer = await images.fetchBuffer(url, { timeout: 60000 });

    const processed = await sharp(buffer)
      .resize(IMAGE_WIDTH, IMAGE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .grayscale()
      .normalize()  // Auto contrast stretch
      .jpeg({
        quality: 75,
        mozjpeg: true
      })
      .toBuffer();

    console.log(`Image processed: ${url.slice(-30)} -> ${(processed.length / 1024).toFixed(1)}KB`);
    return processed;
  } catch (error) {
    console.error(`Failed to fetch/process image: ${url}`, error);
    return null;
  }
}

/**
 * Facsimile-PDF image variant. Unlike fetchAndCompressImage() above (600×900
 * grayscale — sized for e-reader screens), the facsimile PDF is a print-shaped
 * artifact whose scan fills a full A4 page, so it keeps COLOR and real
 * resolution. Reader feedback (2026-08-10) flagged the washed-out gray scans
 * as part of "the layout is off." 1600px on the long edge ≈ 260 DPI on the A4
 * text block.
 */
export async function fetchFacsimilePdfImage(url: string): Promise<Buffer | null> {
  try {
    const buffer = await images.fetchBuffer(url, { timeout: 60000 });
    return await sharp(buffer)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    console.error(`Failed to fetch/process facsimile image: ${url}`, error);
    return null;
  }
}

/**
 * Resolve a page's export image via the canonical resolver (R2 display variant
 * first). `photo` is the SOURCE-provider URL — often a slow Internet Archive
 * fetch, and on split-from-spread pages it is the WRONG IMAGE ENTIRELY: the
 * uncropped spread rather than the single page the reader sees. Falls back to
 * the legacy field priority the routes used historically.
 *
 * Every export format must resolve through here. Reading `photo ||
 * compressed_photo` directly at a call site is the #3909 bug, and it does not
 * announce itself — the export succeeds and simply contains the wrong picture.
 */
export function pageExportImageUrl(page: Page): string | null {
  const legacy = (page as { compressed_photo?: string }).compressed_photo || page.photo || null;
  const resolved = getPageImageUrl(page, 'display') || legacy;
  if (!resolved) return null;
  return resolved.startsWith('/') ? `${BASE_URL}${resolved}` : resolved;
}

/** True when a page has an image any export format can embed. */
export function hasExportImage(page: Page): boolean {
  return pageExportImageUrl(page) !== null;
}

/**
 * Prefetch page images with BOUNDED concurrency, preserving page order.
 *
 * Serial fetching made a ~126-page book take >100s of response silence, so
 * Cloudflare cut the connection (HTTP 524) and readers saved the CF error page
 * as a corrupt .zip/.epub (footer feedback, 2026-07-02). Unbounded Promise.all
 * is the opposite failure: hundreds of concurrent image fetches.
 */
export async function fetchPageImagesOrdered(
  validPages: Page[],
  concurrency = 8,
): Promise<{ page: Page; imageBuffer: Buffer | null }[]> {
  const results: { page: Page; imageBuffer: Buffer | null }[] = new Array(validPages.length);
  let next = 0;
  async function worker() {
    while (next < validPages.length) {
      const i = next++;
      const page = validPages[i];
      const url = pageExportImageUrl(page);
      results[i] = { page, imageBuffer: url ? await fetchAndCompressImage(url) : null };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, validPages.length) }, worker));
  return results;
}

/**
 * Ordered image fetch that yields each page AS IT ARRIVES, keeping only a
 * bounded look-ahead window resident.
 *
 * `fetchPageImagesOrdered()` above awaits EVERY image before returning, which
 * gives a streamed response two problems that only appear at real book sizes
 * (measured on a 366-page book, #3597):
 *
 *  - Nothing is written for the whole fetch (231s locally). The response
 *    "streams", but the producer blocks before emitting a body, so the
 *    connection sits silent and Cloudflare's ~100s window kills it long before
 *    `maxDuration` would.
 *  - Every compressed image is resident at once (74MB), and peak RSS hit 707MB
 *    against Vercel's 1024MB default. 6,987 visible books are LARGER than that
 *    test book, so this is the common case, not the tail.
 *
 * Yielding in order with a `lookahead` cap fixes both: the first page is written
 * as soon as one image lands, and at most `lookahead` buffers are held.
 */
/**
 * ZIP of all page images.
 *
 * Returns a LIVE archiver stream so the response starts flowing immediately.
 * Buffering the whole zip meant zero bytes for the full build time; big books
 * crossed Cloudflare's ~100s origin window and died with a 524, and the reader
 * saved the Cloudflare error page as a corrupt `.zip`.
 */
export function generateImagesZipStream(pages: Page[]): archiver.Archiver {
  const validPages = pages.filter(hasExportImage);
  const archive = archiver('zip', { zlib: { level: 6 } });

  (async () => {
    console.log(`Fetching ${validPages.length} images for ZIP (streaming)...`);
    // Sliding window: ~8 fetches in flight, appended strictly in page order.
    const inFlight: (Promise<Buffer | null> | undefined)[] = new Array(validPages.length);
    let started = 0;
    const startNext = () => {
      if (started >= validPages.length) return;
      const i = started++;
      const url = pageExportImageUrl(validPages[i]);
      inFlight[i] = url ? fetchAndCompressImage(url) : Promise.resolve(null);
    };
    for (let k = 0; k < Math.min(8, validPages.length); k++) startNext();

    for (let i = 0; i < validPages.length; i++) {
      const imageBuffer = await inFlight[i];
      inFlight[i] = undefined;
      startNext();
      if (imageBuffer) {
        const paddedNum = String(validPages[i].page_number).padStart(4, '0');
        archive.append(imageBuffer, { name: `page-${paddedNum}.jpg` });
      }
    }
    await archive.finalize();
  })().catch(err => {
    console.error('images-zip stream failed:', err);
    archive.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return archive;
}

export async function* streamPageImagesOrdered(
  validPages: Page[],
  fetchImage: (url: string) => Promise<Buffer | null> = fetchAndCompressImage,
): AsyncGenerator<{ page: Page; imageBuffer: Buffer | null }> {
  const stream = streamOrdered(
    validPages,
    page => {
      const url = pageExportImageUrl(page);
      return url ? fetchImage(url) : Promise.resolve(null);
    },
    { concurrency: 8, lookahead: 12 },
  );
  for await (const { item, value } of stream) {
    yield { page: item, imageBuffer: value };
  }
}
