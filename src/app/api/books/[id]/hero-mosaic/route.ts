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

const MOSAIC_VERSION = 4; // bump to force-regenerate cached mosaics
const MAX_TILES = 50;

/**
 * Column count for the composited grid, scaled to the number of distinct tiles
 * so short books still make a full, roughly-landscape mosaic (≈1.4:1) instead
 * of one sparse row. e.g. 6 tiles → 3 cols (2 rows); 50 → 9 cols (6 rows).
 */
function chooseColumns(n: number): number {
  const cols = Math.max(3, Math.round(Math.sqrt(n * 2.2)));
  return Math.min(10, cols);
}

const TILE_W = 168;
const TILE_H = 224; // 3:4
const GAP = 6; // thin gap between tiles (shows the dark bg through)
const JPEG_QUALITY = 58;
const MIN_UNIQUE_TILES = 6; // fewer distinct tiles than this ⇒ degenerate mosaic
const BG = { r: 20, g: 16, b: 12 }; // matches the hero's #14100c

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

    const pages = await db.collection('pages')
      .find({ book_id: book.id, page_type: { $ne: 'blank' } }, { projection: PAGE_IMAGE_PROJECTION, maxTimeMS: 8000 })
      .sort({ page_number: 1 })
      .limit(120)
      .toArray();

    // Dedupe the resolved thumb URLs — repeated URLs can only make repeated tiles.
    const urls = Array.from(new Set(
      pages
        .map(p => getPageImageUrl(p as PageImageFields, 'thumb'))
        .filter((u): u is string => !!u && RENDERABLE.test(u)),
    )).slice(0, MAX_TILES);

    // Too few distinct source pages to ever make a mosaic — a permanent fact.
    if (urls.length < MIN_UNIQUE_TILES) return cacheNegative();

    // Fetch + resize each tile (one retry each), dropping any that fail.
    const tiles = await Promise.all(urls.map(async (url) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await images.fetchBuffer(url, { timeout: 15000 });
          return await sharp(buf).resize(TILE_W, TILE_H, { fit: 'cover', position: 'centre' }).toBuffer();
        } catch {
          if (attempt === 1) return null;
        }
      }
      return null;
    }));

    const fetched = tiles.filter((b): b is Buffer => !!b);

    // Keep only distinct tiles (identical bytes ⇒ same hash) so a cover-fallback
    // book doesn't render many copies of one image.
    const seen = new Set<string>();
    const distinct: Buffer[] = [];
    for (const buf of fetched) {
      const h = createHash('md5').update(buf).digest('hex');
      if (seen.has(h)) continue;
      seen.add(h);
      distinct.push(buf);
    }

    if (distinct.length < MIN_UNIQUE_TILES) {
      // We fetched plenty of tiles but they collapsed to near-identical images
      // (the cover-fallback case) → cache the negative result permanently.
      // Otherwise most fetches just FAILED (transient) → 404 WITHOUT caching so
      // the next request retries instead of locking in "no mosaic" forever.
      if (fetched.length >= MIN_UNIQUE_TILES) return cacheNegative();
      return noMosaic();
    }

    // Adapt the column count to how many tiles we have, so short books still
    // read as a full, balanced grid rather than one sparse row. Aim for a
    // roughly landscape mosaic (cols ≈ 1.4 × rows).
    const cols = chooseColumns(distinct.length);
    const rows = Math.ceil(distinct.length / cols);
    const width = cols * TILE_W + (cols + 1) * GAP;
    const height = rows * TILE_H + (rows + 1) * GAP;

    const composed = await sharp({ create: { width, height, channels: 3, background: BG } })
      .composite(distinct.map((buf, i) => ({
        input: buf,
        left: GAP + (i % cols) * (TILE_W + GAP),
        top: GAP + Math.floor(i / cols) * (TILE_H + GAP),
      })))
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
