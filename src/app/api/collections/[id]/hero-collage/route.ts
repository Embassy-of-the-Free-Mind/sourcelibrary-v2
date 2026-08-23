import { NextRequest } from 'next/server';
import sharp, { type OverlayOptions } from 'sharp';
import { getReadDb } from '@/lib/mongodb';

// Single composited hero-collage image for a collection: a MASONRY of the
// collection's gallery images at their natural aspect ratios (auto heights),
// packed into columns and returned as ONE compressed webp so the hero loads a
// single optimized asset instead of many images flashing in. Reusable by any
// collection page.
export const runtime = 'nodejs';
export const revalidate = 86400;

const COLS = 7, COLW = 200, H = 900, W = COLS * COLW;
const BG = '#1a1612';
const FETCH_LIMIT = 48;
// Below this many matches a filtered collage looks broken, so we fall back.
const MIN_COLLAGE = 14;

async function solid(maxAge: number): Promise<Response> {
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).webp({ quality: 60 }).toBuffer();
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': `public, max-age=${maxAge}` } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getReadDb();
    const bookDocs = await db.collection('books').find({ collections: id, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray();
    const bookIds = bookDocs.map((d) => d.id as string);
    if (!bookIds.length) return solid(3600);

    // Optional ?match=<regex> narrows the collage to plates whose description
    // matches — a collection about one subject inside broader books (slime
    // moulds inside general mycology) otherwise gets a hero full of the wrong
    // plates. Falls back to the unfiltered set when the match is too thin to
    // fill a collage, so the hero degrades to "broadly right" rather than to a
    // handful of images tiled over seven columns.
    const match = req.nextUrl.searchParams.get('match');
    const base = { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } };
    const proj = { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1 }, maxTimeMS: 5000 };
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
    if (!urls.length) return solid(3600);

    // Fetch + resize to column width in parallel (natural height preserved).
    const resized = (await Promise.all(urls.map(async (u) => {
      try {
        const res = await fetch(u);
        if (!res.ok) return null;
        const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: COLW }).toBuffer({ resolveWithObject: true });
        return { data, height: info.height };
      } catch { return null; }
    }))).filter((r) => r !== null);
    if (!resized.length) return solid(3600);

    // Masonry pack: each image goes to the currently-shortest column; the bottom
    // overflowing tile in a column is cropped so nothing exceeds the canvas.
    const colH = new Array(COLS).fill(0);
    const tiles: OverlayOptions[] = [];
    for (const r of resized) {
      let c = 0;
      for (let j = 1; j < COLS; j++) if (colH[j] < colH[c]) c = j;
      if (colH[c] >= H) { if (Math.min(...colH) >= H) break; continue; }
      const remaining = H - colH[c];
      const input = r.height > remaining
        ? await sharp(r.data).extract({ left: 0, top: 0, width: COLW, height: remaining }).toBuffer()
        : r.data;
      tiles.push({ input, left: c * COLW, top: colH[c] });
      colH[c] += r.height;
    }
    if (!tiles.length) return solid(3600);

    const out = await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).composite(tiles).webp({ quality: 68 }).toBuffer();
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch {
    return solid(600);
  }
}
