import { createHash } from 'crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import sharp, { type OverlayOptions } from 'sharp';
import { getReadDb } from '@/lib/mongodb';
import { r2Url, storagePut } from '@/lib/storage';

// Single composited hero-collage image for a collection: a MASONRY of the
// collection's gallery images at their natural aspect ratios (auto heights),
// packed into columns and returned as ONE compressed webp so the hero loads a
// single optimized asset instead of many images flashing in. Reusable by any
// collection page.
//
// Built once a week and kept on R2, like the book hero mosaic: this route
// 302s to the stored file. Building takes 1-3s (48 fetches + sharp), and the
// edge cache alone could not hold it — Cloudflare is purged on every merge to
// main (~45/day) and Vercel's CDN never cached it — so most visitors were
// waiting on a fresh build. Now a cold edge costs one R2 HEAD.
export const runtime = 'nodejs';
export const revalidate = 86400;

// Bump to rebuild every stored collage after a change to the layout below.
const COLLAGE_VERSION = 1;

// Match the book hero mosaic (api/books/[id]/hero-mosaic): a thin gap between
// tiles so the dark ground shows through as a grid, and the same #14100c the
// book hero uses, so the two heroes read as one system rather than two.
const GAP = 6;
const COLW = 200;
// Two shapes. The landscape default fills a wide desktop hero. `?shape=portrait`
// exists because a phone hero is a PORTRAIT box: object-cover on the 1448x900
// landscape sheet scaled it up and showed only ~40% of its width (under three of
// seven columns), so plates read as slabs of texture rather than specimens. The
// portrait sheet is narrow and tall, so a phone sees every column at full width.
const SHAPES = {
  landscape: { cols: 7, h: 900 },
  portrait: { cols: 3, h: 1100 },
} as const;
type ShapeName = keyof typeof SHAPES;
const canvasWidth = (cols: number) => cols * COLW + (cols + 1) * GAP;
const BG = '#14100c';
const FETCH_LIMIT = 48;
// Below this many matches a filtered collage looks broken, so we fall back.
const MIN_COLLAGE = 14;

async function solid(maxAge: number, cols: number = SHAPES.landscape.cols, h: number = SHAPES.landscape.h): Promise<Response> {
  const out = await sharp({ create: { width: canvasWidth(cols), height: h, channels: 3, background: BG } }).webp({ quality: 60 }).toBuffer();
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': `public, max-age=${maxAge}` } });
}

// Returns the collage, or null when there is nothing to show (the caller then
// serves a plain dark sheet, short-cached and NOT stored, so it is retried).
async function buildCollage(id: string, COLS: number, H: number, match: string | null): Promise<Buffer | null> {
  const W = canvasWidth(COLS);
  const db = await getReadDb();
  const bookDocs = await db.collection('books').find({ collections: id, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray();
  const bookIds = bookDocs.map((d) => d.id as string);
  if (!bookIds.length) return null;

  // Optional ?match=<regex> narrows the collage to plates whose description
  // matches — a collection about one subject inside broader books (slime
  // moulds inside general mycology) otherwise gets a hero full of the wrong
  // plates. Falls back to the unfiltered set when the match is too thin to
  // fill a collage, so the hero degrades to "broadly right" rather than to a
  // handful of images tiled over seven columns.
  const base = { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } };
  const proj = { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1, page_id: 1, detection_index: 1 }, maxTimeMS: 5000 };
  let imgs: Record<string, unknown>[] = [];
  if (match) {
    const rx = match.slice(0, 600);
    imgs = await db.collection('gallery_images').find({
      ...base,
      $or: [
        { description: { $regex: rx, $options: 'i' } },
        { museum_description: { $regex: rx, $options: 'i' } },
      ],
    }, proj).sort({ gallery_quality: -1 }).limit(FETCH_LIMIT).toArray();
  }
  if (imgs.length < MIN_COLLAGE) {
    imgs = await db.collection('gallery_images').find(base, proj)
      .sort({ gallery_quality: -1 }).limit(FETCH_LIMIT).toArray();
  }
  const urls = imgs.map((g) => (g.thumbnail_url || g.extracted_url || g.image_url) as string | undefined).filter((u): u is string => Boolean(u));
  if (!urls.length) return null;

  // Fetch + resize to column width in parallel (natural height preserved).
  const resized = (await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u);
      if (!res.ok) return null;
      const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: COLW }).toBuffer({ resolveWithObject: true });
      return { data, height: info.height };
    } catch { return null; }
  }))).filter((r) => r !== null);
  if (!resized.length) return null;

  // Masonry pack: each image goes to the currently-shortest column; the bottom
  // overflowing tile in a column is cropped so nothing exceeds the canvas.
  const colH = new Array(COLS).fill(GAP);
  const tiles: OverlayOptions[] = [];
  for (const r of resized) {
    let c = 0;
    for (let j = 1; j < COLS; j++) if (colH[j] < colH[c]) c = j;
    if (colH[c] >= H) { if (Math.min(...colH) >= H) break; continue; }
    const remaining = H - colH[c];
    const input = r.height > remaining
      ? await sharp(r.data).extract({ left: 0, top: 0, width: COLW, height: remaining }).toBuffer()
      : r.data;
    tiles.push({ input, left: GAP + c * (COLW + GAP), top: colH[c] });
    colH[c] += r.height + GAP;
  }
  if (!tiles.length) return null;

  return sharp({ create: { width: W, height: H, channels: 3, background: BG } }).composite(tiles).webp({ quality: 68 }).toBuffer();
}

// ISO-ish week bucket (UTC): the stored collage is rebuilt once a week so new
// plates in the collection surface without anyone remembering to refresh it.
function weekBucket(d: Date): string {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.floor((d.getTime() - start) / (7 * 86400_000));
  return `${d.getUTCFullYear()}w${String(week).padStart(2, '0')}`;
}

// `edited` is the collection's updated_at, so a curation save (which bumps it)
// lands on a new key and the next visit rebuilds instead of waiting a week.
function collageKey(id: string, shape: ShapeName, match: string | null, edited: string, bucket: string): string {
  const h = createHash('sha1').update(`${match ?? ''}|${edited}`).digest('hex').slice(0, 10);
  return `collection-hero/${id}-${shape}-${h}-v${COLLAGE_VERSION}-${bucket}.webp`;
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000), cache: 'no-store' });
    return res.ok;
  } catch { return false; }
}

function redirectTo(url: string): NextResponse {
  const res = NextResponse.redirect(url, 302);
  // Short, so the weekly rebuild is picked up; the R2 file itself is static.
  res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res;
}

async function buildAndStore(id: string, shapeName: ShapeName, match: string | null, key: string): Promise<string | Buffer | null> {
  const { cols, h } = SHAPES[shapeName];
  const out = await buildCollage(id, cols, h, match);
  if (!out) return null;
  try {
    return (await storagePut(key, out, { contentType: 'image/webp', allowOverwrite: true })).url;
  } catch {
    return out; // R2 not configured (e.g. local dev): still serve the bytes.
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shapeParam = req.nextUrl.searchParams.get('shape');
  const shapeName: ShapeName = (shapeParam as ShapeName) in SHAPES ? (shapeParam as ShapeName) : 'landscape';
  const { cols: COLS, h: H } = SHAPES[shapeName];
  const match = req.nextUrl.searchParams.get('match');
  // The id becomes part of an R2 key; collection ids are plain slugs.
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return solid(3600, COLS, H);
  try {
    const db = await getReadDb();
    const coll = await db.collection('collections').findOne({ slug: id }, { projection: { _id: 0, updated_at: 1 }, maxTimeMS: 3000 });
    const edited = coll?.updated_at ? new Date(coll.updated_at as Date).toISOString() : '';
    const now = new Date();
    const key = collageKey(id, shapeName, match, edited, weekBucket(now));
    if (await exists(r2Url(key))) return redirectTo(r2Url(key));

    // New week: keep serving last week's collage and rebuild in the background,
    // so no visitor waits on the build.
    const lastKey = collageKey(id, shapeName, match, edited, weekBucket(new Date(now.getTime() - 7 * 86400_000)));
    if (await exists(r2Url(lastKey))) {
      after(() => buildAndStore(id, shapeName, match, key).then(() => {}, () => {}));
      return redirectTo(r2Url(lastKey));
    }

    // Nothing stored yet: build now (first visitor only).
    const built = await buildAndStore(id, shapeName, match, key);
    if (typeof built === 'string') return redirectTo(built);
    if (built) return new Response(new Uint8Array(built), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600' } });
    return solid(3600, COLS, H);
  } catch {
    return solid(600, COLS, H);
  }
}
