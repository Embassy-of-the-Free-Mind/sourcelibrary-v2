import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getReadDb } from '@/lib/mongodb';
import { getPageImageUrl } from '@/lib/page-image-url';

// Returns ONLY the extracted illustration of a gallery image (pageId-idx),
// cropped from the full page via the detection bbox — so a plate can be used as
// a clean background without the surrounding page text. Cached as one webp.
export const runtime = 'nodejs';
export const revalidate = 86400;

const PROJ = { detected_images: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = id.match(/^(.+)-(\d+)$/);
  if (!m) return new Response('bad id', { status: 400 });
  const pageId = m[1];
  const idx = parseInt(m[2], 10);
  try {
    const db = await getReadDb();
    const page = await db.collection('pages').findOne({ id: pageId }, { projection: PROJ });
    if (!page) return new Response('not found', { status: 404 });
    let src = getPageImageUrl(page as unknown as Parameters<typeof getPageImageUrl>[0], 'original')
      || getPageImageUrl(page as unknown as Parameters<typeof getPageImageUrl>[0], 'display');
    // getPageImageUrl may return the Next image-proxy wrapper (/api/image?url=…),
    // a relative URL fetch() can't parse — unwrap it to the absolute source.
    if (src && src.startsWith('/')) {
      try { src = new URL(src, 'https://sourcelibrary.org').searchParams.get('url') || src; } catch { /* keep */ }
    }
    if (!src || !/^https?:\/\//.test(src)) return new Response('no absolute image', { status: 404 });
    const res = await fetch(src);
    if (!res.ok) return new Response('fetch failed', { status: 502 });
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    const bbox = (page.detected_images as { bbox?: { x: number; y: number; width: number; height: number } }[] | undefined)?.[idx]?.bbox;

    let out: Buffer;
    if (bbox && W && H) {
      const left = Math.max(0, Math.min(W - 1, Math.round(bbox.x * W)));
      const top = Math.max(0, Math.min(H - 1, Math.round(bbox.y * H)));
      const width = Math.max(1, Math.min(W - left, Math.round(bbox.width * W)));
      const height = Math.max(1, Math.min(H - top, Math.round(bbox.height * H)));
      out = await sharp(buf).extract({ left, top, width, height }).webp({ quality: 80 }).toBuffer();
    } else {
      out = await sharp(buf).webp({ quality: 80 }).toBuffer();
    }
    return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch (e) {
    return new Response('error: ' + (e instanceof Error ? `${e.name}: ${e.message}` : String(e)), { status: 500 });
  }
}
