import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

// Lazy book list for a single map city. The map page ships only lightweight
// per-city marker data (~0.4 MB); the full book list for the clicked city is
// fetched here on demand, so the initial payload stays small.
//
// Source of truth is the same precomputed system_config.map_data cache the page
// reads. We build a city index once per warm instance (the doc is large), then
// serve slices filtered by the active role toggles and year range.

export const dynamic = 'force-dynamic';

interface RawBook {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  year: number | null;
  slug: string;
}
interface RawLoc {
  city: string;
  country: string | null;
  type: string;
  books: RawBook[];
}

type CityIndex = Map<string, RawLoc[]>;
let indexPromise: Promise<CityIndex> | null = null;

async function buildIndex(): Promise<CityIndex> {
  const db = await getReadDb();
  const doc = await db
    .collection('system_config')
    .findOne({ _id: 'map_data' as never }, { maxTimeMS: 15000 });
  const locations: RawLoc[] = (doc?.data?.locations as RawLoc[]) || [];
  const idx: CityIndex = new Map();
  for (const loc of locations) {
    const key = `${loc.city}|${loc.country || ''}`;
    const arr = idx.get(key);
    if (arr) arr.push(loc);
    else idx.set(key, [loc]);
  }
  return idx;
}

function getIndex(): Promise<CityIndex> {
  if (!indexPromise) {
    // Cache the build; on failure clear it so the next request retries.
    indexPromise = buildIndex().catch((e) => {
      indexPromise = null;
      throw e;
    });
  }
  return indexPromise;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const city = sp.get('city');
  if (!city) return NextResponse.json({ books: [] });

  const country = sp.get('country') || '';
  const from = Number(sp.get('from')) || 0;
  const to = Number(sp.get('to')) || 9999;
  const typesParam = sp.get('types');
  const types = typesParam ? new Set(typesParam.split(',').filter(Boolean)) : null;

  let idx: CityIndex;
  try {
    idx = await getIndex();
  } catch {
    return NextResponse.json({ books: [] }, { status: 200 });
  }

  const groups = idx.get(`${city}|${country}`) || [];
  const seen = new Set<string>();
  const books: RawBook[] = [];
  for (const g of groups) {
    if (types && !types.has(g.type)) continue;
    for (const b of g.books || []) {
      if (seen.has(b.id)) continue;
      // Undated books always show (matches the marker count); dated ones are
      // gated by the active year range.
      if (b.year != null && (b.year < from || b.year > to)) continue;
      seen.add(b.id);
      books.push(b);
      if (books.length >= 200) break;
    }
    if (books.length >= 200) break;
  }

  // Stable reading order: by year ascending, undated last.
  books.sort((a, b) => (a.year ?? 99999) - (b.year ?? 99999));

  return NextResponse.json(
    { books },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
