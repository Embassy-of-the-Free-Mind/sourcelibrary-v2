import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import SiteHeader from '@/components/layout/SiteHeader';
import BookMapLoader from '@/components/explore/BookMapLoader';
import type { BookLocation } from '@/components/explore/BookMap';

export const revalidate = 86400;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Map — Explore — Source Library',
  description:
    'Interactive map of 7,000+ books plotted by publication city and author birthplace from Wikidata coordinates.',
  openGraph: {
    title: 'Map — Explore — Source Library',
    description:
      'Geographic distribution of historical texts across 500+ cities worldwide.',
    url: 'https://sourcelibrary.org/explore/map',
    siteName: 'Source Library',
    type: 'website',
  },
};

async function fetchMapData() {
  const db = await getDb();

  // Read pre-computed map data from system_config (fast single-doc read)
  const cached = await db
    .collection('system_config')
    .findOne({ _id: 'map_data' as any }, { maxTimeMS: 10000 });

  if (cached?.data) {
    return cached.data as {
      locations: BookLocation[];
      stats: { total_books: number; total_locations: number; by_type: Record<string, number> };
    };
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

  const groups = new Map<string, BookLocation>();
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
          type: loc.type as BookLocation['type'], books: [],
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
    return (
      <>
        <SiteHeader />
        <BookMapLoader locations={data.locations} stats={data.stats} />
      </>
    );
  } catch (err) {
    console.error('Map page error:', err);
    return (
      <>
        <SiteHeader />
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-stone-500">Map data is temporarily unavailable. Please try again shortly.</p>
        </div>
      </>
    );
  }
}
