import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import BookMapLoader from '@/components/explore/BookMapLoader';
import type { BookLocation } from '@/components/explore/BookMap';

export const revalidate = 600;
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

async function fetchBookLocations() {
  const db = await getDb();

  // Unwind book locations and group by city+type
  const pipeline = [
    { $match: { visible: true, 'locations.0': { $exists: true } } },
    { $unwind: '$locations' },
    {
      $group: {
        _id: {
          city: '$locations.city',
          country: '$locations.country',
          type: '$locations.type',
          lat: '$locations.lat',
          lng: '$locations.lng',
        },
        books: {
          $push: {
            id: '$id',
            title: '$title',
            author: '$author',
            year: '$year',
            slug: '$slug',
          },
        },
      },
    },
    { $sort: { 'books': -1 } },
  ];

  const results = await db
    .collection('books')
    .aggregate(pipeline, { maxTimeMS: 45000 })
    .toArray();

  const byType: Record<string, number> = {};
  let totalBooks = 0;

  const locations: BookLocation[] = results.map((r) => {
    const type = r._id.type as string;
    byType[type] = (byType[type] || 0) + (r.books as unknown[]).length;
    totalBooks += (r.books as unknown[]).length;

    return {
      city: r._id.city as string,
      country: r._id.country as string | null,
      lat: r._id.lat as number,
      lng: r._id.lng as number,
      type: type as BookLocation['type'],
      books: (r.books as Array<{ id: string; title: string; author: string; year: number | null; slug: string }>)
        .slice(0, 50), // Cap per-location to avoid huge payloads
    };
  });

  return {
    locations,
    stats: {
      total_books: totalBooks,
      total_locations: locations.length,
      by_type: byType,
    },
  };
}

export default async function MapPage() {
  try {
    const data = await fetchBookLocations();
    return <BookMapLoader locations={data.locations} stats={data.stats} />;
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500">Map data is temporarily unavailable. Please try again shortly.</p>
      </div>
    );
  }
}
