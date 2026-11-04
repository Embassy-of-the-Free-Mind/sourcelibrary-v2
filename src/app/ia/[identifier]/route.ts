/**
 * /ia/<identifier>: from an Internet Archive item to our copy of the same scan.
 *
 * Who it is for: someone looking at a book on archive.org, or an assistant
 * holding an archive.org link, who wants to read it with a transcription, an
 * English translation and a citable page. The Archive's item page could link
 * here with no lookup of its own, because the identifier is the whole address.
 *
 * Only a live book answers. A hidden one looks the same as one we do not have,
 * and the refusal points back to the Archive's own page.
 *
 * Redirect, not a page, so this carries no text and adds nothing to scrape: the
 * reader on the other side keeps its own limits. It needs the `ia_identifier`
 * index (scripts/maintenance/create-ia-identifier-index.mjs): without it every
 * hit scans `books`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

// The characters the Archive allows in an identifier. Anything else cannot be one.
const IA_IDENTIFIER = /^[A-Za-z0-9._-]{1,100}$/;
const DAY = 86400;

function notHeld(identifier: string | null): NextResponse {
  const lines = ['Source Library does not have a readable copy of this Internet Archive item.'];
  if (identifier) lines.push(`The item itself: https://archive.org/details/${identifier}`);
  lines.push('Search what we do have: https://sourcelibrary.org/search');
  return new NextResponse(`${lines.join('\n')}\n`, {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Short: the day a book goes live this address should start working.
      'Cache-Control': 'public, s-maxage=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  if (!IA_IDENTIFIER.test(identifier)) return notHeld(null);

  const db = await getDb();
  // Nine identifiers are shared by two books (measured 2026-11-05). The one with
  // more translated pages is the better place to land.
  const [book] = await db.collection('books')
    .find(
      { ia_identifier: identifier, visible: true, pages_count: { $gt: 0 } },
      { projection: { _id: 0, id: 1, slug: 1 } },
    )
    .sort({ pages_translated: -1 })
    .limit(1)
    .toArray();
  if (!book) return notHeld(identifier);

  const target = new URL(`/book/${book.slug || book.id}`, 'https://sourcelibrary.org');
  return NextResponse.redirect(target, {
    status: 302,
    headers: { 'Cache-Control': `public, s-maxage=${DAY}`, 'X-Robots-Tag': 'noindex' },
  });
}
