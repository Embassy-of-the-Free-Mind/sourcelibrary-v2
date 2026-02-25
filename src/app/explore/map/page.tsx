import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import EntityMapLoader from '@/components/explore/EntityMapLoader';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Map — Explore — Source Library',
  description:
    'Interactive map of 1,600+ places, people, and institutions from the Western esoteric tradition, plotted from Wikidata coordinates.',
  openGraph: {
    title: 'Map — Explore — Source Library',
    description:
      'Geographic distribution of entities across 1,200+ digitized historical texts.',
    url: 'https://sourcelibrary.org/explore/map',
    siteName: 'Source Library',
    type: 'website',
  },
};

async function fetchMapData() {
  const db = await getDb();

  const entities = await db.collection('entities').aggregate([
    { $match: { wikidata_coordinates: { $exists: true, $ne: null } } },
    {
      $lookup: {
        from: 'books',
        localField: 'books.book_id',
        foreignField: 'id',
        as: 'book_docs',
        pipeline: [
          { $match: { year: { $exists: true, $gt: 0 } } },
          { $project: { year: 1 } },
        ],
      },
    },
    {
      $project: {
        _id: 0,
        name: 1,
        type: 1,
        coordinates: '$wikidata_coordinates',
        book_count: 1,
        total_mentions: 1,
        description: 1,
        wikidata_id: 1,
        wikidata_birth_date: 1,
        wikidata_death_date: 1,
        years: '$book_docs.year',
      },
    },
  ]).toArray();

  const byType: Record<string, number> = {};
  const byCentury: Record<string, number> = {};

  const mapped = entities.map((e) => {
    const type = e.type as string;
    byType[type] = (byType[type] || 0) + 1;

    // Prefer biographical dates for century range (people),
    // fall back to book publication years (places, concepts, or people without dates)
    let century_range: [number, number] | null = null;

    const birthStr = e.wikidata_birth_date as string | undefined;
    const deathStr = e.wikidata_death_date as string | undefined;
    const birthYear = birthStr ? parseInt(birthStr.slice(0, 4), 10) : NaN;
    const deathYear = deathStr ? parseInt(deathStr.slice(0, 4), 10) : NaN;

    if (!isNaN(birthYear) || !isNaN(deathYear)) {
      // Use biographical dates — handles BCE as positive year strings (e.g. "0550" = 550 BCE...
      // but actually stored as positive CE-style, so 0550 = 550 CE in the string).
      // These are all positive ints from Wikidata.
      const bioYears = [birthYear, deathYear].filter((y) => !isNaN(y) && y > 0);
      if (bioYears.length > 0) {
        const minY = Math.min(...bioYears);
        const maxY = Math.max(...bioYears);
        const minC = Math.floor((minY - 1) / 100) + 1;
        const maxC = Math.floor((maxY - 1) / 100) + 1;
        century_range = [minC, maxC];
      }
    }

    // Fall back to book years if no biographical dates
    if (!century_range) {
      const years = (e.years as number[]).filter((y: number) => y > 0);
      if (years.length > 0) {
        const minY = Math.min(...years);
        const maxY = Math.max(...years);
        const minC = Math.floor((minY - 1) / 100) + 1;
        const maxC = Math.floor((maxY - 1) / 100) + 1;
        century_range = [minC, maxC];
      }
    }

    if (century_range) {
      for (let c = century_range[0]; c <= century_range[1]; c++) {
        byCentury[String(c)] = (byCentury[String(c)] || 0) + 1;
      }
    }

    // Build lifespan string from biographical dates
    let lifespan: string | undefined;
    if (!isNaN(birthYear) && birthYear > 0 && !isNaN(deathYear) && deathYear > 0) {
      lifespan = `${birthYear}–${deathYear}`;
    } else if (!isNaN(birthYear) && birthYear > 0) {
      lifespan = `b. ${birthYear}`;
    } else if (!isNaN(deathYear) && deathYear > 0) {
      lifespan = `d. ${deathYear}`;
    }

    return {
      name: e.name as string,
      type: type as 'person' | 'place' | 'concept',
      coordinates: e.coordinates as { lat: number; lng: number },
      book_count: (e.book_count as number) || 0,
      total_mentions: (e.total_mentions as number) || 0,
      description: (e.description as string) || undefined,
      wikidata_id: (e.wikidata_id as string) || undefined,
      century_range,
      lifespan,
    };
  });

  return {
    entities: mapped,
    stats: {
      total: mapped.length,
      by_type: byType,
      by_century: byCentury,
    },
  };
}

export default async function MapPage() {
  const data = await fetchMapData();

  return <EntityMapLoader entities={data.entities} stats={data.stats} />;
}
