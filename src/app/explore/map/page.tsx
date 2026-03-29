import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import EntityMapLoader from '@/components/explore/EntityMapLoader';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  // Single query — no book lookup needed. Use biographical dates for century ranges.
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
      },
    },
  ], { maxTimeMS: 45000 }).toArray();

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

    // No book-year fallback — biographical dates only (avoids expensive book lookup)

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
  try {
    const data = await fetchMapData();
    return <EntityMapLoader entities={data.entities} stats={data.stats} />;
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500">Map data is temporarily unavailable. Please try again shortly.</p>
      </div>
    );
  }
}
