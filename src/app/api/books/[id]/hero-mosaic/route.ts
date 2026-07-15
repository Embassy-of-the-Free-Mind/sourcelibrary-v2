import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// sharp + mongodb + node:crypto require the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import { storagePut } from '@/lib/storage';
import { images } from '@/lib/api-client/images';
import { getPageImageUrl, type PageImageFields } from '@/lib/page-image-url';

/**
 * GET /api/books/[id]/hero-mosaic
 *
 * Builds (once) and caches a single tiled background image for the book-page
 * hero — a 10-column grid of page-scan thumbnails composited server-side into
 * one compressed JPEG on R2. On a cache hit it 302-redirects to the stored R2
 * URL; the first hit for a book composes and stores it. When a book can't make
 * a good mosaic (too few *distinct* pages — e.g. every "thumb" fell back to the
 * same cover), we cache a negative result and 404 so the hero shows a plain
 * dark panel instead of a wall of identical tiles.
 */

const MOSAIC_VERSION = 10; // bump to force-regenerate cached mosaics
const MAX_TILES = 50;

/**
 * Column count for the masonry, scaled to the tile count and whether the tiles
 * are text pages or curated plates.
 *   - Text pages read best dense: never below 6 columns (up to 10).
 *   - Plates read best larger: 3–6 columns (a "smaller grid" of bigger images).
 * Always clamped to the tile count so we never leave an empty column.
 */
function chooseColumns(n: number, plate: boolean): number {
  if (n <= 1) return 1;
  const cols = plate
    ? Math.max(2, Math.min(6, Math.round(Math.sqrt(n))))
    : (n <= 5 ? n : Math.min(10, Math.max(6, Math.round(Math.sqrt(n * 2.2)))));
  return Math.min(cols, n);
}

const TILE_W = 168; // fixed column width; height follows the page's true aspect
const MAX_TILE_H = 340; // clamp very tall strips so one tile can't dominate a column
const GAP = 6; // thin gap between tiles (shows the dark bg through)
const JPEG_QUALITY = 58;
const CANDIDATE_LIMIT = 80; // fetch extra so outlier-height filtering still leaves ~50
const BG = { r: 20, g: 16, b: 12 }; // matches the hero's #14100c

// Page types we never tile: blanks, digitizer inserts, and the scanner
// calibration / colour-card / cover / spine shots. Excluding them keeps the
// grid to real content pages of a consistent shape (and out of the height
// discrepancy that odd cover/foldout scans introduce).
const JUNK_PAGE_TYPES = ['blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata', 'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target', 'cover', 'spine', 'frontcover', 'backcover'];

const PAGE_IMAGE_PROJECTION = {
  _id: 0,
  page_number: 1,
  page_type: 1,
  photo: 1,
  photo_original: 1,
  archived_photo: 1,
  enhanced_photo: 1,
  cropped_photo: 1,
  display_photo: 1,
  image_thumb: 1,
  thumbnail_blob: 1,
  thumbnail: 1,
  split_from_spread: 1,
  crop: 1,
} as const;

// A per-page thumbnail on a renderable host. Deliberately EXCLUDES the archive
// .org `thumbnail` fallback: on many imports every page shares the same item
// URL there (= the cover), which produced walls of identical cover tiles.
const RENDERABLE = /(images\.sourcelibrary\.org|public\.blob\.vercel-storage\.com|upload\.wikimedia\.org|\/full\/|\/iiif\/|\/api\/image)/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      { projection: { _id: 0, id: 1, hero_mosaic_url: 1, hero_mosaic_version: 1 } },
    );
    if (!book?.id) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

    // Up-to-date cache: redirect to the stored image, or 404 the negative result.
    if (book.hero_mosaic_version === MOSAIC_VERSION) {
      return book.hero_mosaic_url ? redirectToMosaic(book.hero_mosaic_url) : noMosaic();
    }

    const cacheNegative = async () => {
      await db.collection('books').updateOne({ id: book.id }, { $set: { hero_mosaic_url: null, hero_mosaic_version: MOSAIC_VERSION, hero_mosaic_at: new Date() } }).catch(() => {});
      return noMosaic();
    };

    // The hero grid is built from PAGE SCANS in reading order — never a wall of
    // cropped plates. Pages that happen to contain a plate/illustration are a
    // welcome bonus, but we don't front-load them; a book reads as its pages.
    // Skip blanks + scanner junk (covers, calibration cards, spines) so the
    // tiles are real content pages of a consistent shape.
    const pageDocs = await db.collection('pages')
      .find({ book_id: book.id, page_type: { $nin: JUNK_PAGE_TYPES } }, { projection: PAGE_IMAGE_PROJECTION, maxTimeMS: 8000 })
      .sort({ page_number: 1 })
      .limit(CANDIDATE_LIMIT)
      .toArray();
    const pageUrls = Array.from(new Set(
      pageDocs
        .map(p => getPageImageUrl(p as PageImageFields, 'thumb'))
        .filter((u): u is string => !!u && RENDERABLE.test(u)),
    ));

    let urls = pageUrls;
    let usingPlates = false;
    // Fallback ONLY when a book has essentially no renderable page thumbnails
    // (source not rehosted) — then curated plate crops are better than nothing.
    if (pageUrls.length < 6) {
      const plates = await db.collection('gallery_images')
        .find(
          { book_id: book.id, gallery_quality: { $gte: 0.7 }, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } },
          { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1 }, maxTimeMS: 6000 },
        )
        .sort({ gallery_quality: -1 })
        .limit(MAX_TILES)
        .toArray();
      const plateUrls = Array.from(new Set(
        plates
          .map(p => (p.thumbnail_url || p.extracted_url || p.image_url) as string | undefined)
          .filter((u): u is string => !!u && RENDERABLE.test(u)),
      ));
      if (plateUrls.length > pageUrls.length) { urls = plateUrls; usingPlates = true; }
    }
    urls = urls.slice(0, CANDIDATE_LIMIT);

    if (urls.length === 0) return cacheNegative();

    // Fetch each tile (one retry each) and resize to a fixed column WIDTH,
    // preserving the page's true aspect ratio (so pages aren't cropped to a
    // uniform box). Clamp very tall strips so one tile can't dominate a column.
    const tiles = await Promise.all(urls.map(async (url) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await images.fetchBuffer(url, { timeout: 15000 });
          const { data, info } = await sharp(buf)
            .resize({ width: TILE_W, withoutEnlargement: false })
            .toBuffer({ resolveWithObject: true });
          if (info.height <= MAX_TILE_H) return { data, height: info.height };
          // Too tall — keep the top of the page (the interesting part).
          const cropped = await sharp(data).extract({ left: 0, top: 0, width: info.width, height: MAX_TILE_H }).toBuffer();
          return { data: cropped, height: MAX_TILE_H };
        } catch {
          if (attempt === 1) return null;
        }
      }
      return null;
    }));

    type Tile = { data: Buffer; height: number };
    const fetched = tiles.filter((t): t is Tile => !!t);

    // Keep only distinct tiles (identical bytes ⇒ same hash) so a cover-fallback
    // book doesn't render many copies of one image.
    const seen = new Set<string>();
    const distinct: Tile[] = [];
    for (const t of fetched) {
      const h = createHash('md5').update(t.data).digest('hex');
      if (seen.has(h)) continue;
      seen.add(h);
      distinct.push(t);
    }

    if (distinct.length === 0) return noMosaic(); // all fetches failed → retry later

    // Height-outlier filter: keep tiles whose height sits near the MEDIAN, so
    // the rows are uniform (no single tall foldout/spread stretching a row).
    // This is what makes the hero read like the Pages section instead of a
    // jagged mix. If the band would drop too much, fall back to all tiles.
    const sortedH = distinct.map(t => t.height).sort((a, b) => a - b);
    const median = sortedH[Math.floor(sortedH.length / 2)] || MAX_TILE_H;
    let kept = distinct.filter(t => t.height >= median * 0.82 && t.height <= median * 1.2);
    if (kept.length < Math.min(distinct.length, 10)) kept = distinct;
    // Cap to a full grid's worth (10×5 for 50+ page books).
    kept = kept.slice(0, MAX_TILES);

    // Row grid — exactly like the Pages section: a fixed number of columns,
    // tiles laid out row by row at their TRUE dimensions, top-aligned within
    // each row (a shorter page leaves a little space below it). Each row is as
    // tall as its tallest tile. Only whole rows are kept so the bottom edge is
    // always a full row — never a ragged half-filled corner.
    const cols = chooseColumns(kept.length, usingPlates);
    const numRows = kept.length <= cols ? 1 : Math.floor(kept.length / cols);
    const rowCols = kept.length <= cols ? kept.length : cols;
    const used = kept.slice(0, numRows * rowCols);
    const width = rowCols * TILE_W + (rowCols + 1) * GAP;

    const placements: { input: Buffer; left: number; top: number }[] = [];
    let y = GAP;
    for (let r = 0; r < numRows; r++) {
      const row = used.slice(r * rowCols, r * rowCols + rowCols);
      const rowHeight = Math.max(...row.map(t => t.height));
      row.forEach((t, c) => {
        placements.push({ input: t.data, left: GAP + c * (TILE_W + GAP), top: y }); // top-aligned
      });
      y += rowHeight + GAP;
    }
    const height = y; // sum of row heights + gaps → a clean rectangle

    // Every book with renderable page scans gets a grid (no dark-hero opt-out) —
    // even dark manuscripts and palm-leaf strips. The hero tint + text shadow
    // keep the overlaid text legible regardless of how dark the grid is.
    const composed = await sharp({ create: { width, height, channels: 3, background: BG } })
      .composite(placements)
      .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
      .toBuffer();

    const key = `hero-mosaic/${book.id}-v${MOSAIC_VERSION}.jpg`;
    const uploaded = await storagePut(key, composed, { contentType: 'image/jpeg', allowOverwrite: true });

    await db.collection('books').updateOne({ id: book.id }, { $set: { hero_mosaic_url: uploaded.url, hero_mosaic_version: MOSAIC_VERSION, hero_mosaic_at: new Date() } }).catch(() => {});

    return redirectToMosaic(uploaded.url);
  } catch (error) {
    console.error('[hero-mosaic] generation error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

function redirectToMosaic(url: string) {
  const res = NextResponse.redirect(url, 302);
  // Cache the redirect at the edge; the R2 target itself is effectively immutable.
  res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
  return res;
}

function noMosaic() {
  const res = NextResponse.json({ error: 'No mosaic' }, { status: 404 });
  res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
  return res;
}
