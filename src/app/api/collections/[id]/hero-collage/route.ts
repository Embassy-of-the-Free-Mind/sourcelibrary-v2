import { NextRequest, NextResponse } from 'next/server';
import { buildAndStore, collageKeys, SHAPES, solid, storedHeroCollageUrl, type ShapeName } from '@/lib/collection-hero-collage';

// The collection hero collage, as a 302 to the stored R2 file (see
// src/lib/collection-hero-collage.ts). The collection pages no longer come
// through here: they resolve the R2 URL while rendering and put it in the HTML,
// because even a cold redirect cost 0.4-2.5s and Cloudflare is purged on every
// merge. This route remains for the og:image and for a collage that has never
// been built, which it builds for that first visitor.
export const runtime = 'nodejs';
export const revalidate = 86400;

function redirectTo(url: string): NextResponse {
  const res = NextResponse.redirect(url, 302);
  // Short, so the weekly rebuild is picked up; the R2 file itself is static.
  res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res;
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
    const stored = await storedHeroCollageUrl(id, shapeName, match, { cache: 'no-store' });
    if (stored) return redirectTo(stored);

    // Nothing stored yet: build now (first visitor only).
    const { key } = await collageKeys(id, shapeName, match);
    const built = await buildAndStore(id, shapeName, match, key);
    if (typeof built === 'string') return redirectTo(built);
    if (built) return new Response(new Uint8Array(built), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600' } });
    return solid(3600, COLS, H);
  } catch {
    return solid(600, COLS, H);
  }
}
