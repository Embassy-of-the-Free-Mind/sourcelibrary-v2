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

const MOSAIC_VERSION = 8; // bump to force-regenerate cached mosaics
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

    const isPlateMosaic = plateUrls.length >= PURE_PLATE_MIN;
    let urls: string[];
    if (isPlateMosaic) {
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
    // Many source images that collapse to ≤2 distinct = the cover-fallback bug
    // (every "thumb" resolved to one shared cover) → cache negative, dark hero.
    if (urls.length >= 8 && distinct.length <= 2) return cacheNegative();
    // Otherwise build with whatever distinct tiles we have — down to a single one.

    // Masonry layout — like the Pages grid: fixed-width columns, tiles stacked
    // top-aligned at their true aspect, each new tile added to the shortest
    // column. The canvas is then cropped to the SHORTEST column's bottom so the
    // grid is always completely filled (no ragged dark gap in a corner).
    const cols = chooseColumns(distinct.length, isPlateMosaic);
    const width = cols * TILE_W + (cols + 1) * GAP;
    const colBottoms = new Array<number>(cols).fill(GAP); // y where the next tile starts
    const placements = distinct.map((t) => {
      let c = 0;
      for (let i = 1; i < cols; i++) if (colBottoms[i] < colBottoms[c]) c = i;
      const left = GAP + c * (TILE_W + GAP);
      const top = colBottoms[c];
      colBottoms[c] = top + t.height + GAP;
      return { input: t.data, left, top };
    });
    // Build at the tallest column's height (all tiles fit — no composite
    // overflow), then crop down to the SHORTEST column's bottom so the grid is
    // completely filled with no ragged dark corner. Every column holds ≥1 tile
    // (cols ≤ tile count, shortest-first packing), so fillHeight is always > 0.
    const fullHeight = Math.max(...colBottoms);
    const fillHeight = Math.min(...colBottoms) - GAP;

    // Composite onto the full-height canvas first (all tiles fit, no overflow),
    // then crop to the fill line in a fresh pass so op ordering is unambiguous.
    const full = await sharp({ create: { width, height: fullHeight, channels: 3, background: BG } })
      .composite(placements)
      .jpeg()
      .toBuffer();
    const flat = await sharp(full).extract({ left: 0, top: 0, width, height: fillHeight }).jpeg().toBuffer();

    // Skip mosaics that are mostly black — dark manuscripts, palm-leaf strips on
    // black grounds, etc. They tile into odd stripes and, under the hero tint,
    // add nothing over a plain dark panel. Cache the negative → dark hero.
    const raw = await sharp(flat).removeAlpha().toColourspace('b-w').raw().toBuffer();
    const meanLuma = raw.reduce((s, v) => s + v, 0) / raw.length;
    if (meanLuma < 55) return cacheNegative();

    const composed = await sharp(flat).jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true }).toBuffer();

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
