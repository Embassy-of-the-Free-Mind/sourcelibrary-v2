import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { mapPlaceKey } from '@/lib/map-place';
import { getBookThumbnailUrl } from '@/lib/utils';

// Lazy book list for a single map place. The map page ships only lightweight
// per-place pin data; the clicked place's book list is fetched here on demand.
//
// The precomputed system_config.map_data snapshot says WHICH books belong to a
// place (ids + years, indexed once per warm instance). Titles, covers and
// translation state come from `books` for that place only — the snapshot stopped
// carrying titles when they pushed it to 14.5 MB of Mongo's 16 MB limit.

export const dynamic = 'force-dynamic';

interface RawLoc {
  city: string;
  country: string | null;
  lat: number;
  lng: number;
  type: string;
  books: Array<{ id: string; year: number | null }>;
}

/** What the map's side panel renders for one book. */
export interface MapPlaceBook {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  year: number | null;
  slug: string;
  thumb: string | null;
  /** Share of pages with an English translation, 0–1. */
  translated: number;
}

type PlaceIndex = Map<string, RawLoc[]>;
let indexPromise: Promise<PlaceIndex> | null = null;

async function buildIndex(): Promise<PlaceIndex> {
  const db = await getReadDb();
  const doc = await db
    .collection('system_config')
    .findOne({ _id: 'map_data' as never }, { maxTimeMS: 15000 });
  const locations: RawLoc[] = (doc?.data?.locations as RawLoc[]) || [];
  const idx: PlaceIndex = new Map();
  for (const loc of locations) {
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;
    const key = mapPlaceKey(loc.lat, loc.lng);
    const arr = idx.get(key);
    if (arr) arr.push(loc);
    else idx.set(key, [loc]);
  }
  return idx;
}

function getIndex(): Promise<PlaceIndex> {
  if (!indexPromise) {
    // Cache the build; on failure clear it so the next request retries.
    indexPromise = buildIndex().catch((e) => {
      indexPromise = null;
      throw e;
    });
  }
  return indexPromise;
}

const LIST_LIMIT = 200;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const place = sp.get('place');
  if (!place) return NextResponse.json({ books: [] });

  const from = Number(sp.get('from')) || 0;
  const to = Number(sp.get('to')) || 9999;
  const typesParam = sp.get('types');
  const types = typesParam ? new Set(typesParam.split(',').filter(Boolean)) : null;

  let idx: PlaceIndex;
  try {
    idx = await getIndex();
  } catch {
    return NextResponse.json({ books: [] }, { status: 200 });
  }

  // Which books, by the same rules as the pin count: undated books always show,
  // dated ones are gated by the active year range.
  const ids = new Set<string>();
  for (const g of idx.get(place) || []) {
    if (types && !types.has(g.type)) continue;
    for (const b of g.books || []) {
      if (!b.id) continue;
      if (b.year != null && (b.year < from || b.year > to)) continue;
      ids.add(b.id);
    }
  }
  if (ids.size === 0) return NextResponse.json({ books: [], total: 0 });

  const db = await getReadDb();
  const rows = await db.collection('books').find(
    { id: { $in: [...ids] }, visible: true },
    {
      projection: {
        _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1,
        pages_count: 1, pages_translated: 1,
        image_thumb: 1, image_display: 1, thumbnail: 1, thumbnail_blob: 1,
      },
      maxTimeMS: 8000,
    },
  ).toArray();

  const books: MapPlaceBook[] = rows.map((b) => {
    const pages = Number(b.pages_count) || 0;
    const tr = Number(b.pages_translated) || 0;
    return {
      id: b.id as string,
      title: (b.title as string) || 'Untitled',
      display_title: (b.display_title as string) || undefined,
      author: (b.author as string) || 'Unknown',
      year: typeof b.year === 'number' ? b.year : null,
      slug: (b.slug as string) || '',
      thumb: getBookThumbnailUrl(b as Parameters<typeof getBookThumbnailUrl>[0], 'thumb'),
      translated: pages > 0 ? Math.min(1, tr / pages) : 0,
    };
  });

  // Readable first: a reader who opens a city wants something they can read.
  // Within each group, oldest first; undated last.
  const readable = (b: MapPlaceBook) => (b.translated >= 0.5 ? 0 : 1);
  books.sort((a, b) =>
    readable(a) - readable(b) || (a.year ?? 99999) - (b.year ?? 99999),
  );

  return NextResponse.json(
    { books: books.slice(0, LIST_LIMIT), total: books.length },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
