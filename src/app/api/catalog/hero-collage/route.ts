import sharp, { type OverlayOptions } from 'sharp';
import { getReadDb } from '@/lib/mongodb';

/**
 * The catalogue hero's background: ONE composited masonry of the library's best
 * plates, so the page loads a single optimized asset instead of fifty thumbnails
 * flashing in behind the search box.
 *
 * Same shape as `/api/collections/[id]/hero-collage`, drawn from the whole
 * corpus rather than one collection. Behind ISR-length caching, so the query
 * runs once a day per region rather than per visitor.
 */
export const runtime = 'nodejs';
export const revalidate = 86400;

const COLS = 8, COLW = 200, H = 760, W = COLS * COLW;
const BG = '#14100c';
const FETCH_LIMIT = 56;

async function solid(maxAge: number): Promise<Response> {
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).webp({ quality: 60 }).toBuffer();
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': `public, max-age=${maxAge}` } });
}

export async function GET() {
  try {
    const db = await getReadDb();
    // `gallery_images` is a materialized view (~207K rows) and this reads its
    // top slice by an indexed score — bounded work that does not grow with the
    // corpus the way a `pages` scan would (request-path-queries.md).
    const imgs = await db.collection('gallery_images').find(
      {
        gallery_quality: { $gte: 0.9 },
        book_visible: { $ne: false },
        type: { $in: ['engraving', 'woodcut', 'diagram', 'illustration'] },
      },
      { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1 }, maxTimeMS: 8000 },
    ).sort({ gallery_quality: -1 }).limit(FETCH_LIMIT).toArray();

    const urls = imgs
      .map((g) => (g.thumbnail_url || g.extracted_url || g.image_url) as string | undefined)
      .filter((u): u is string => Boolean(u));
    if (!urls.length) return solid(3600);

    const resized = (await Promise.all(urls.map(async (u) => {
      try {
        const res = await fetch(u);
        if (!res.ok) return null;
        const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: COLW }).toBuffer({ resolveWithObject: true });
        return { data, height: info.height };
      } catch { return null; }
    }))).filter((r) => r !== null);
    if (!resized.length) return solid(3600);

    // Masonry pack: each tile goes to the shortest column; the tile that
    // overflows the canvas is cropped rather than dropped.
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
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } });
  } catch {
    return solid(600);
  }
}
