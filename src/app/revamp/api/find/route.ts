import { NextResponse } from 'next/server';

/** Finding a work to add to a collection. Reads the live Library search (GET only, read-only). */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 120);
  if (!q) return NextResponse.json({ books: [] });
  const r = await fetch(`https://sourcelibrary.org/api/books/library?search=${encodeURIComponent(q)}&limit=8`, { headers: { 'User-Agent': 'sourcelibrary-revamp' }, next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ books: [], status: r.status }, { status: r.status === 429 ? 429 : 502 });
  const j = await r.json();
  return NextResponse.json({ books: (j.books ?? []).slice(0, 8) });
}
