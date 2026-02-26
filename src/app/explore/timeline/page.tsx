import { Metadata } from 'next';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import TimelineLoader from '@/components/explore/TimelineLoader';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Timeline — Explore — Source Library',
  description:
    'Interactive timeline of 2,900+ historical figures from the Western esoteric tradition, plotted by birth and death dates from Wikidata.',
  openGraph: {
    title: 'Timeline — Explore — Source Library',
    description:
      'Lifespans of historical figures — who was alive when, and how intellectual movements clustered.',
    url: 'https://sourcelibrary.org/explore/timeline',
    siteName: 'Source Library',
    type: 'website',
  },
};

// Map fine-grained categories → broad traditions for color coding
const CATEGORY_TO_TRADITION: Record<string, string> = {
  hermeticism: 'hermeticism', alchemy: 'hermeticism', 'spiritual-alchemy': 'hermeticism',
  paracelsian: 'hermeticism', 'prisca-theologia': 'hermeticism',
  philosophy: 'philosophy', neoplatonism: 'philosophy', 'florentine-platonism': 'philosophy',
  pythagoreanism: 'philosophy', Aristotelianism: 'philosophy',
  'ritual-magic': 'magic', 'natural-magic': 'magic', astrology: 'magic',
  divination: 'magic', witchcraft: 'magic', 'Angel Magic': 'magic', 'Astrological Magic': 'magic',
  theology: 'mysticism', mysticism: 'mysticism', 'christian-mysticism': 'mysticism',
  'biblical-studies': 'mysticism',
  'jewish-kabbalah': 'kabbalah', 'christian-cabala': 'kabbalah',
  rosicrucianism: 'rosicrucianism', freemasonry: 'rosicrucianism', theosophy: 'rosicrucianism',
  'natural-philosophy': 'science', medicine: 'science', astronomy: 'science',
  mathematics: 'science', chemistry: 'science', botany: 'science', Anatomy: 'science',
};

async function fetchTimelineData() {
  const db = await getDb();

  // Fetch entities with their book_ids for tradition lookup
  const entities = await db
    .collection('entities')
    .aggregate([
      {
        $match: {
          $or: [
            { wikidata_birth_date: { $exists: true, $ne: null } },
            { wikidata_death_date: { $exists: true, $ne: null } },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          name: 1,
          type: 1,
          book_count: 1,
          total_mentions: 1,
          description: 1,
          wikidata_birth_date: 1,
          wikidata_death_date: 1,
          'books.book_id': 1,
        },
      },
    ])
    .toArray();

  // Build book_id → categories map from books collection
  const allBookIds = new Set<string>();
  for (const e of entities) {
    for (const b of (e.books as { book_id: string }[]) || []) {
      allBookIds.add(b.book_id);
    }
  }

  const bookIdArr = [...allBookIds];
  // Book IDs can be ObjectId hex strings or UUID strings
  const objectIds = bookIdArr
    .filter((id) => /^[a-f0-9]{24}$/.test(id))
    .map((id) => new ObjectId(id));
  const stringIds = bookIdArr.filter((id) => !/^[a-f0-9]{24}$/.test(id));

  const bookCats = await db.collection('books').find(
    { $or: [
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
      ...(stringIds.length ? [{ _id: { $in: stringIds as unknown as ObjectId[] } }] : []),
    ] },
    { projection: { _id: 1, categories: 1 } }
  ).toArray();

  const bookCatMap = new Map<string, string[]>();
  for (const b of bookCats) {
    const cats = (b.categories as string[]) || [];
    bookCatMap.set(String(b._id), cats);
  }

  // Compute dominant tradition for an entity from its books' categories
  function getDominantTradition(books: { book_id: string }[] | undefined): string {
    if (!books || books.length === 0) return 'other';
    const counts: Record<string, number> = {};
    for (const b of books) {
      const cats = bookCatMap.get(b.book_id) || [];
      for (const cat of cats) {
        const tradition = CATEGORY_TO_TRADITION[cat];
        if (tradition) counts[tradition] = (counts[tradition] || 0) + 1;
      }
    }
    let best = 'other';
    let bestCount = 0;
    for (const [t, c] of Object.entries(counts)) {
      if (c > bestCount) { best = t; bestCount = c; }
    }
    return best;
  }

  const byCentury: Record<string, number> = {};
  let minYear = Infinity;
  let maxYear = -Infinity;

  const mapped = entities
    .map((e) => {
      const birthStr = e.wikidata_birth_date as string | undefined;
      const deathStr = e.wikidata_death_date as string | undefined;
      // parseInt handles negative dates correctly: "-0384-01-01" → -384
      const birthYear = birthStr ? parseInt(birthStr, 10) : NaN;
      const deathYear = deathStr ? parseInt(deathStr, 10) : NaN;

      const bY = !isNaN(birthYear) && birthYear !== 0 ? birthYear : null;
      const dY = !isNaN(deathYear) && deathYear !== 0 ? deathYear : null;

      if (!bY && !dY) return null;

      // Filter out Anno Mundi / mythological dates (Eve, Noah, Cain, etc.)
      if ((bY && Math.abs(bY) > 2026) || (dY && Math.abs(dY) > 2026)) return null;

      // Track year range
      if (bY && bY < minYear) minYear = bY;
      if (dY && dY > maxYear) maxYear = dY;
      if (bY && bY > maxYear) maxYear = bY;
      if (dY && dY < minYear) minYear = dY;

      // Century stats — use absolute value for bucketing
      const refYear = bY || dY!;
      const absYear = Math.abs(refYear);
      const century = refYear < 0
        ? -Math.floor((absYear - 1) / 100) - 1
        : Math.floor((absYear - 1) / 100) + 1;
      byCentury[String(century)] = (byCentury[String(century)] || 0) + 1;

      return {
        name: e.name as string,
        type: (e.type as string) === 'person' ? 'person' : 'concept',
        birth_year: bY,
        death_year: dY,
        book_count: (e.book_count as number) || 0,
        total_mentions: (e.total_mentions as number) || 0,
        description: (e.description as string) || undefined,
        tradition: getDominantTradition(e.books as { book_id: string }[] | undefined),
      };
    })
    .filter(Boolean) as {
    name: string;
    type: 'person' | 'concept';
    birth_year: number | null;
    death_year: number | null;
    book_count: number;
    total_mentions: number;
    description?: string;
    tradition: string;
  }[];

  return {
    entities: mapped,
    stats: {
      total: mapped.length,
      year_range: [
        minYear === Infinity ? -500 : minYear,
        maxYear === -Infinity ? 2000 : maxYear,
      ] as [number, number],
      by_century: byCentury,
    },
  };
}

export default async function TimelinePage() {
  const data = await fetchTimelineData();

  return <TimelineLoader entities={data.entities} stats={data.stats} />;
}
