import { NextResponse } from 'next/server';

/**
 * Pages of a collection's works past what the prototype has saved. Reads the live site's public
 * collection API (GET only, same order as the saved snapshot), so it can't change anything.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = (u.searchParams.get('slug') || '').replace(/[^a-z0-9-]/gi, '');
  const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0);
  if (!slug) return NextResponse.json({ books: [] }, { status: 400 });
  const r = await fetch(`https://sourcelibrary.org/api/collections/${slug}?limit=20&offset=${offset}`, { headers: { 'User-Agent': 'sourcelibrary-revamp' }, next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ books: [], status: r.status }, { status: r.status === 429 ? 429 : 502 });
  const j = await r.json();
  return NextResponse.json({ books: j.books ?? [] });
}
