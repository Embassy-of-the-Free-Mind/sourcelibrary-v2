import { NextRequest, NextResponse } from 'next/server';
import { resolveSlugToHeldBook } from '@/lib/embassy/librarian';
import { isResolvableSlug } from '@/lib/not-found-recovery';

/**
 * GET /api/not-found/suggestion?slug=<dead book slug>
 *
 * The closest public book for a /book/<slug> that 404ed, using the resolver the
 * Librarian repairs its own links with (#8216). The 404 page shows it as an
 * offer with its title: it is a best guess, so the reader chooses, and nothing
 * redirects.
 *
 * Global library only: the resolver searches every public book, and a partner's
 * room must not offer books outside it (tenant-lockdown.md).
 */
const HOUR = 3600;

function respond(suggestion: { slug: string; title: string } | null, cdnMaxAge: number) {
  return NextResponse.json({ suggestion }, {
    headers: {
      'Cache-Control': `public, max-age=${HOUR}`,
      'CDN-Cache-Control': `public, max-age=${cdnMaxAge}`,
    },
  });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug') ?? '';
  if (!isResolvableSlug(slug) || request.headers.get('x-tenant-id')) return respond(null, 24 * HOUR);
  try {
    const held = await resolveSlugToHeldBook(slug);
    return respond(held ? { slug: held.slug, title: held.title } : null, held ? 24 * HOUR : HOUR);
  } catch {
    return NextResponse.json({ suggestion: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
