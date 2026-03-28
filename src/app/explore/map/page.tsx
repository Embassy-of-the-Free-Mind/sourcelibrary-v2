import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import EntityMapLoader from '@/components/explore/EntityMapLoader';

// ISR: rebuild every 6 hours (entity data changes slowly)
export const revalidate = 21600;

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

  // Fetch entities with coordinates — avoid $lookup (too slow on Atlas)
  const entities = await db.collection('entities').aggregate([
    { $match: { wikidata_coordinates: { $exists: true, $ne: null } } },
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
        'books.book_id': 1,
      },
    },
  ], { maxTimeMS: 10000 }).toArray();

  // Build book_id → year map separately (much faster than $lookup)
  const allBookIds = new Set<string>();
  for (const e of entities) {
    for (const b of (e.books as { book_id: string }[]) || []) {
      allBookIds.add(b.book_id);
    }
  }
  const bookYearDocs = allBookIds.size > 0
    ? await db.collection('books').find(
        { id: { $in: [...allBookIds] }, year: { $exists: true, $gt: 0 } },
        { projection: { id: 1, year: 1 } }
      ).toArray()
    : [];
  const bookYearMap = new Map<string, number>();
  for (const b of bookYearDocs) {
    if (b.id && b.year) bookYearMap.set(b.id, b.year as number);
  }

  // Attach years to entities
  for (const e of entities) {
    const years: number[] = [];
    for (const b of (e.books as { book_id: string }[]) || []) {
      const y = bookYearMap.get(b.book_id);
      if (y) years.push(y);
    }
    e.years = years;
    delete e.books;
  }

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
    // parseInt handles negative dates: "-0384-01-01" → -384
    const birthYear = birthStr ? parseInt(birthStr, 10) : NaN;
    const deathYear = deathStr ? parseInt(deathStr, 10) : NaN;

    if (!isNaN(birthYear) || !isNaN(deathYear)) {
      const bioYears = [birthYear, deathYear].filter((y) => !isNaN(y) && y !== 0);
      if (bioYears.length > 0) {
        const minY = Math.min(...bioYears);
        const maxY = Math.max(...bioYears);
        const toCentury = (y: number) => y < 0
          ? -Math.floor((Math.abs(y) - 1) / 100) - 1
          : Math.floor((y - 1) / 100) + 1;
        century_range = [toCentury(minY), toCentury(maxY)];
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
    const fmtYear = (y: number) => y < 0 ? `${Math.abs(y)} BCE` : String(y);
    let lifespan: string | undefined;
    if (!isNaN(birthYear) && birthYear !== 0 && !isNaN(deathYear) && deathYear !== 0) {
      lifespan = `${fmtYear(birthYear)}\u2013${fmtYear(deathYear)}`;
    } else if (!isNaN(birthYear) && birthYear !== 0) {
      lifespan = `b.\u00a0${fmtYear(birthYear)}`;
    } else if (!isNaN(deathYear) && deathYear !== 0) {
      lifespan = `d.\u00a0${fmtYear(deathYear)}`;
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
