import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getReadDb } from '@/lib/mongodb';
import { weaveBySubject, dedupeImages, topicTermsFromName, type RankableImage } from '@/lib/collection-image-ranking';

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
// Pull a larger quality pool, then re-rank toward subject matter and take the top
// FETCH_LIMIT — so the hero leads with the collection's topic (plants, fungi, …)
// rather than the author portraits that dominate a pure quality sort.
const POOL = 140;

async function solid(maxAge: number): Promise<Response> {
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).webp({ quality: 60 }).toBuffer();
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': `public, max-age=${maxAge}` } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getReadDb();
    const [collectionDoc, bookDocs] = await Promise.all([
      db.collection('collections').findOne({ slug: id }, { projection: { _id: 0, name: 1 }, maxTimeMS: 3000 }),
      db.collection('books').find({ collections: id, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray(),
    ]);
    const bookIds = bookDocs.map((d) => d.id as string);
    if (!bookIds.length) return solid(3600);

    const pool = await db.collection('gallery_images').find(
      { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } },
      { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1, type: 1, description: 1, museum_description: 1, gallery_quality: 1 }, maxTimeMS: 5000 },
    ).sort({ gallery_quality: -1 }).limit(POOL).toArray();
    // Dedupe exact repeats, weave toward subject matter (plants/fungi over
    // portraits/frontispieces) while keeping a range, then take FETCH_LIMIT.
    const topicTerms = topicTermsFromName((collectionDoc?.name as string) || id);
    const urlOf = (g: Record<string, unknown>) => (g.thumbnail_url || g.extracted_url || g.image_url) as string | undefined;
    const unique = dedupeImages(pool as Array<Record<string, unknown>>, (g) => urlOf(g));
    const imgs = weaveBySubject(unique as RankableImage[], topicTerms).slice(0, FETCH_LIMIT) as Array<Record<string, unknown>>;
    const urls = imgs.map(urlOf).filter((u): u is string => Boolean(u));
    if (!urls.length) return solid(3600);

    // Fetch + resize to column width in parallel (natural height preserved).
    const resized = (await Promise.all(urls.map(async (u) => {
      try {
        const res = await fetch(u);
        if (!res.ok) return null;
        const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: COLW }).toBuffer({ resolveWithObject: true });
        return { data, height: info.height };
      } catch { return null; }
    }))).filter((r): r is { data: Buffer; height: number } => r !== null);
    if (!resized.length) return solid(3600);

    // Masonry pack: each image goes to the currently-shortest column; the bottom
    // overflowing tile in a column is cropped so nothing exceeds the canvas.
    const colH = new Array(COLS).fill(0);
    const tiles: sharp.OverlayOptions[] = [];
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
