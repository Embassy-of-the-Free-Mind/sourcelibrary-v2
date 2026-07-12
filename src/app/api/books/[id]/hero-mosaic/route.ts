import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getDb } from '@/lib/mongodb';
import { storagePut } from '@/lib/storage';
import { images } from '@/lib/api-client/images';
import { getPageImageUrl, type PageImageFields } from '@/lib/page-image-url';

/**
 * GET /api/books/[id]/hero-mosaic
 *
 * Builds (once) and caches a single tiled background image for the book-page
 * hero — a 10-column grid of page-scan thumbnails composited server-side into
 * one compressed JPEG on R2. Replaces loading 40+ individual <img> tiles in the
 * browser. On a cache hit it 302-redirects to the stored R2 URL; the first hit
 * for a book composes and stores it.
 */

const COLS = 10;
const MAX_TILES = 50;
const TILE_W = 168;
const TILE_H = 224; // 3:4
const JPEG_QUALITY = 58;
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

const RENDERABLE = /(images\.sourcelibrary\.org|public\.blob\.vercel-storage\.com|upload\.wikimedia\.org|\/full\/|\/iiif\/|\/api\/image)/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      { projection: { _id: 0, id: 1, hero_mosaic_url: 1 } },
    );
    if (!book?.id) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

    if (book.hero_mosaic_url) return redirectToMosaic(book.hero_mosaic_url);

    const pages = await db.collection('pages')
      .find({ book_id: book.id, page_type: { $ne: 'blank' } }, { projection: PAGE_IMAGE_PROJECTION, maxTimeMS: 8000 })
      .sort({ page_number: 1 })
      .limit(120)
      .toArray();

    const urls = pages
      .map(p => getPageImageUrl(p as PageImageFields, 'thumb'))
      .filter((u): u is string => !!u && RENDERABLE.test(u))
      .slice(0, MAX_TILES);

    if (urls.length === 0) return NextResponse.json({ error: 'No page scans available' }, { status: 404 });

    // Fetch + resize each tile; drop any that fail so gaps just show the dark bg.
    const tiles = await Promise.all(urls.map(async (url, i) => {
      try {
        const buf = await images.fetchBuffer(url, { timeout: 12000 });
        const resized = await sharp(buf).resize(TILE_W, TILE_H, { fit: 'cover', position: 'centre' }).toBuffer();
        return { i, buf: resized };
      } catch {
        return null;
      }
    }));

    const ok = tiles.filter((t): t is { i: number; buf: Buffer } => !!t);
    if (ok.length === 0) return NextResponse.json({ error: 'Could not fetch page scans' }, { status: 502 });

    const rows = Math.ceil(urls.length / COLS);
    const width = COLS * TILE_W;
    const height = rows * TILE_H;

    const composed = await sharp({ create: { width, height, channels: 3, background: BG } })
      .composite(ok.map(({ i, buf }) => ({
        input: buf,
        left: (i % COLS) * TILE_W,
        top: Math.floor(i / COLS) * TILE_H,
      })))
      .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
      .toBuffer();

    const key = `hero-mosaic/${book.id}.jpg`;
    const uploaded = await storagePut(key, composed, { contentType: 'image/jpeg', allowOverwrite: true });

    await db.collection('books').updateOne({ id: book.id }, { $set: { hero_mosaic_url: uploaded.url, hero_mosaic_at: new Date() } }).catch(() => {});

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
