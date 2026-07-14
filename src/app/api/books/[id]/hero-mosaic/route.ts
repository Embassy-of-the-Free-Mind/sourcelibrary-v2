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

const MOSAIC_VERSION = 7; // bump to force-regenerate cached mosaics
const MAX_TILES = 50;

/**
 * Column count for the composited grid, scaled to the tile count so a mosaic is
 * always as full as it can be — a landscape-ish 10×5 at the top end, shrinking
 * gracefully all the way down to 2×2 and a single tile for short items.
 *   50→10  30→8  20→7  12→5  6→4  4→3  2→2  1→1
 */
function chooseColumns(n: number): number {
  if (n <= 1) return 1;
  if (n <= 3) return 2;
  return Math.min(10, Math.max(3, Math.round(Math.sqrt(n * 2.2))));
}

const TILE_W = 168;
const TILE_H = 224; // 3:4
const GAP = 6; // thin gap between tiles (shows the dark bg through)
const JPEG_QUALITY = 58;
const PURE_PLATE_MIN = 6; // ≥ this many plates ⇒ illustration-only mosaic
const ILLUS_TYPES = new Set(['frontispiece', 'plate', 'illustration']);
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

    // Curated plates (illustrations) make the nicest, text-free tiles — prefer
    // them. Enough of them → a pure plate mosaic; otherwise plates lead and page
    // scans fill (illustration-type pages first).
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
    )).slice(0, MAX_TILES);

    let urls: string[];
    if (plateUrls.length >= PURE_PLATE_MIN) {
      urls = plateUrls; // enough plates for a clean illustration-only mosaic
    } else {
      const pages = await db.collection('pages')
        .find({ book_id: book.id, page_type: { $ne: 'blank' } }, { projection: PAGE_IMAGE_PROJECTION, maxTimeMS: 8000 })
        .sort({ page_number: 1 })
        .limit(120)
        .toArray();
      // Illustration-type pages first, then the rest in reading order.
      const ranked = [...pages].sort((a, b) => {
        const ai = ILLUS_TYPES.has((a.page_type || '').toLowerCase()) ? 0 : 1;
        const bi = ILLUS_TYPES.has((b.page_type || '').toLowerCase()) ? 0 : 1;
        return ai - bi || (a.page_number ?? 0) - (b.page_number ?? 0);
      });
      const pageUrls = ranked
        .map(p => getPageImageUrl(p as PageImageFields, 'thumb'))
        .filter((u): u is string => !!u && RENDERABLE.test(u));
      // Plates lead, then pages; dedupe; cap.
      urls = Array.from(new Set([...plateUrls, ...pageUrls])).slice(0, MAX_TILES);
    }

    if (urls.length === 0) return cacheNegative();

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

    if (distinct.length === 0) return noMosaic(); // all fetches failed → retry later
    // Many source images that collapse to ≤2 distinct = the cover-fallback bug
    // (every "thumb" resolved to one shared cover) → cache negative, dark hero.
    if (urls.length >= 8 && distinct.length <= 2) return cacheNegative();
    // Otherwise build with whatever distinct tiles we have — down to a single one.

    // Adapt the column count to how many tiles we have, so short books still
    // read as a full, balanced grid rather than one sparse row. Aim for a
    // roughly landscape mosaic (cols ≈ 1.4 × rows).
    const cols = chooseColumns(distinct.length);
    const rows = Math.ceil(distinct.length / cols);
    const width = cols * TILE_W + (cols + 1) * GAP;
    const height = rows * TILE_H + (rows + 1) * GAP;

    const canvas = sharp({ create: { width, height, channels: 3, background: BG } })
      .composite(distinct.map((buf, i) => ({
        input: buf,
        left: GAP + (i % cols) * (TILE_W + GAP),
        top: GAP + Math.floor(i / cols) * (TILE_H + GAP),
      })));

    // Skip mosaics that are mostly black — dark manuscripts, palm-leaf strips on
    // black grounds, etc. They tile into odd stripes and, under the hero tint,
    // add nothing over a plain dark panel. Cache the negative → dark hero.
    const raw = await canvas.clone().removeAlpha().toColourspace('b-w').raw().toBuffer();
    const meanLuma = raw.reduce((s, v) => s + v, 0) / raw.length;
    if (meanLuma < 55) return cacheNegative();

    const composed = await canvas.jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true }).toBuffer();

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
