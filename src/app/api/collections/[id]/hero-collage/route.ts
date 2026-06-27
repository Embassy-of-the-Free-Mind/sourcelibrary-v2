import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getReadDb } from '@/lib/mongodb';

// Single composited hero-collage image for a collection: a grid of 2:3 tiles
// (like the book pages) drawn from the collection's gallery, returned as ONE
// compressed webp so the hero loads a single optimized asset instead of many
// images flashing in individually. Reusable by any collection page.
export const runtime = 'nodejs';
export const revalidate = 86400;

const COLS = 7, ROWS = 3, TW = 200, TH = 300; // 2:3 tiles
const W = COLS * TW, H = ROWS * TH;
const BG = '#1a1612';

async function solid(maxAge: number): Promise<Response> {
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).webp({ quality: 60 }).toBuffer();
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': `public, max-age=${maxAge}` } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getReadDb();
    const bookDocs = await db.collection('books').find({ collections: id, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray();
    const bookIds = bookDocs.map((d) => d.id as string);
    if (!bookIds.length) return solid(3600);

    const imgs = await db.collection('gallery_images').find(
      { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } },
      { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1 }, maxTimeMS: 5000 },
    ).sort({ gallery_quality: -1 }).limit(COLS * ROWS).toArray();
    const urls = imgs
      .map((g) => (g.thumbnail_url || g.extracted_url || g.image_url) as string | undefined)
      .filter((u): u is string => Boolean(u))
      .slice(0, COLS * ROWS);
    if (!urls.length) return solid(3600);

    const tiles = (await Promise.all(urls.map(async (u, i) => {
      try {
        const res = await fetch(u);
        if (!res.ok) return null;
        const resized = await sharp(Buffer.from(await res.arrayBuffer())).resize(TW, TH, { fit: 'cover' }).toBuffer();
        return { input: resized, top: Math.floor(i / COLS) * TH, left: (i % COLS) * TW } as sharp.OverlayOptions;
      } catch { return null; }
    }))).filter((t): t is sharp.OverlayOptions => t !== null);
    if (!tiles.length) return solid(3600);

    const out = await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
      .composite(tiles).webp({ quality: 68 }).toBuffer();
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch {
    return solid(600);
  }
}
