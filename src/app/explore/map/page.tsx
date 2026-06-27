import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreTabBar from '@/components/explore/ExploreTabBar';
import BookMapLoader from '@/components/explore/BookMapLoader';
import type { BookLocation, LocationType } from '@/components/explore/BookMap';

/**
 * The shape stored in system_config.map_data (and the live-fallback build):
 * each per-(city,type) group carries its full book list. The page strips these
 * down to the lightweight {years, undated} the client needs and lazy-loads the
 * full lists per city — keeping the initial payload ~350 KB instead of ~7 MB.
 */
interface RawLocation {
  city: string;
  country: string | null;
  lat: number;
  lng: number;
  type: LocationType;
  books: Array<{ id: string; title: string; display_title?: string; author: string; year: number | null; slug: string }>;
}
interface RawMapData {
  locations: RawLocation[];
  stats: { total_books: number; total_locations: number; by_type: Record<string, number> };
}

// Role bitmask — mirrors TYPE_BIT in BookMap.tsx (kept local so this server
// component doesn't import from the 'use client' module).
const TYPE_BIT: Record<string, number> = { publication: 1, author_birth: 2, author_death: 4, origin: 8 };

/**
 * Collapse the per-(city,type) cache groups into one lightweight record per city.
 * Books are deduped by id across roles (OR-ing their role bits) and stripped to
 * {y: year, m: role-mask} — no titles/authors/slugs/ids ship to the client; those
 * load lazily per city from /api/explore/map/city.
 */
function slimLocations(locations: RawLocation[]): BookLocation[] {
  const byCity = new Map<string, {
    city: string; country: string | null; lat: number; lng: number;
    books: Map<string, { y: number | null; m: number }>;
  }>();

  for (const loc of locations) {
    const key = `${loc.city}|${loc.country || ''}`;
    let entry = byCity.get(key);
    if (!entry) {
      entry = { city: loc.city, country: loc.country, lat: loc.lat, lng: loc.lng, books: new Map() };
      byCity.set(key, entry);
    }
    // Prefer the publication group's coords for the pin (matches prior behavior).
    if (loc.type === 'publication') { entry.lat = loc.lat; entry.lng = loc.lng; }
    const bit = TYPE_BIT[loc.type] || 0;
    for (const b of loc.books || []) {
      const ex = entry.books.get(b.id);
      if (ex) ex.m |= bit;
      else entry.books.set(b.id, { y: typeof b.year === 'number' ? b.year : null, m: bit });
    }
  }

  const out: BookLocation[] = [];
  for (const e of byCity.values()) {
    out.push({ city: e.city, country: e.country, lat: e.lat, lng: e.lng, books: [...e.books.values()] });
  }
  return out;
}

// Daily ISR so the page re-reads the system_config.map_data cache that the
// Hetzner cron rebuilds at 05:45 — `revalidate = false` froze the rendered
// page at deploy time, hiding every cache refresh. The layout chain uses no
// headers()/cookies(), so ISR is safe here (cf. explore/page.tsx).
export const revalidate = 86400;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Map — Explore — Source Library',
  description:
    'Interactive map of 10,000+ books plotted by publication city, author birthplace, and the heartland of each text’s tradition.',
  openGraph: {
    title: 'Map — Explore — Source Library',
    description:
      'Geographic distribution of historical texts across 500+ cities worldwide.',
    url: 'https://sourcelibrary.org/explore/map',
    siteName: 'Source Library',
    type: 'website',
    images: [
      {
        url: 'https://sourcelibrary.org/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Source Library map — historical texts plotted by publication city and author birthplace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Map — Explore — Source Library',
    description:
      'Geographic distribution of historical texts across 500+ cities worldwide.',
    images: ['https://sourcelibrary.org/og-image.jpg'],
  },
};

async function fetchMapData(): Promise<RawMapData> {
  const db = await getReadDb();

  // Read pre-computed map data from system_config (fast single-doc read)
  const cached = await db
    .collection('system_config')
    .findOne({ _id: 'map_data' as any }, { maxTimeMS: 10000 });

  if (cached?.data) {
    return cached.data as RawMapData;
  }

  // Fallback: compute live (slow but works if cache is empty)
  const books = await db
    .collection('books')
    .find(
      { visible: true, 'locations.0': { $exists: true } },
      {
        projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1, locations: 1 },
        maxTimeMS: 45000,
      },
    )
    .toArray();

  const groups = new Map<string, RawLocation>();
  const byType: Record<string, number> = {};
  let totalBooks = 0;

  for (const book of books) {
    const locs = book.locations as Array<{
      type: string; city: string; country: string | null; lat: number; lng: number;
    }>;
    if (!locs) continue;

    for (const loc of locs) {
      if (!loc.lat || !loc.lng || !loc.city) continue;
      const key = `${loc.city}|${loc.type}|${loc.lat.toFixed(2)}|${loc.lng.toFixed(2)}`;

      if (!groups.has(key)) {
        groups.set(key, {
          city: loc.city, country: loc.country, lat: loc.lat, lng: loc.lng,
          type: loc.type as LocationType, books: [],
        });
      }

      const group = groups.get(key)!;
      if (group.books.length < 200) {
        group.books.push({
          id: book.id as string,
          title: (book.title as string) || 'Untitled',
          display_title: (book.display_title as string) || undefined,
          author: (book.author as string) || 'Unknown',
          year: (book.year as number) || null,
          slug: (book.slug as string) || '',
        });
      }

      byType[loc.type] = (byType[loc.type] || 0) + 1;
      totalBooks++;
    }
  }

  return {
    locations: Array.from(groups.values()),
    stats: { total_books: totalBooks, total_locations: groups.size, by_type: byType },
  };
}

export default async function MapPage() {
  try {
    const data = await fetchMapData();
    const locations = slimLocations(data.locations);
    const locationCount = data.stats.total_locations;
    return (
      <ContentPageLayout
        header={
          <ContentHeader maxWidth="wide"
            title="Map"
            subtitle={`${locationCount.toLocaleString('en-US')} locations worldwide — publication cities, author birthplaces, and the heartlands of the traditions we hold`}
          >
            <div className="mt-5">
              <ExploreTabBar />
            </div>
          </ContentHeader>
        }
        maxWidth="full"
        noPadding
      >
        <BookMapLoader locations={locations} stats={data.stats} />
      </ContentPageLayout>
    );
  } catch (err) {
    console.error('Map page error:', err);
    return (
      <ContentPageLayout
        header={
          <ContentHeader maxWidth="wide" title="Map" subtitle="Map data is temporarily unavailable. Please try again shortly." >
            <div className="mt-5">
              <ExploreTabBar />
            </div>
          </ContentHeader>
        }
        maxWidth="full"
      >
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-stone-500">Map data is temporarily unavailable.</p>
        </div>
      </ContentPageLayout>
    );
  }
}
