import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import TimelineLoader from '@/components/explore/TimelineLoader';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// Map book language → cultural tradition for color coding
function languageToTradition(lang: string | undefined | null): string | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  if (l.includes('sanskrit') || l.includes('tamil') || l.includes('hindi') ||
      l.includes('telugu') || l.includes('punjabi') || l.includes('avestan')) return 'indian';
  if (l.includes('chinese') || l.includes('japanese') || l.includes('korean') ||
      l.includes('tibetan') || l.includes('burmese') || l.includes('javanese') ||
      l.includes('malay')) return 'east_asian';
  if (l.includes('arabic') || l.includes('persian') || l.includes('turkish')) return 'islamic';
  if (l.includes('hebrew') || l.includes('talmud')) return 'jewish';
  if (l.includes('syriac') || l.includes('armenian') || l.includes('aramaic') ||
      l.includes('ethiopic') || l.includes('coptic') || l.includes('ge\'ez') ||
      l.includes('demotic') || l.includes('egyptian')) return 'near_eastern';
  if (/\bgreek\b/.test(l) && !l.includes('latin') && !l.includes('english') &&
      !l.includes('german') && !l.includes('french')) return 'classical';
  if (l.includes('navajo') || l.includes('maori') || l.includes('maya') ||
      l.includes('nahuatl') || l.includes('iroquoi') || l.includes('haida') ||
      l.includes('algonq') || l.includes('hopi') || l.includes('lenape') ||
      l.includes('tsimshian') || l.includes('mixtec') || l.includes('nuxalk') ||
      l.includes('k\'iche')) return 'indigenous';
  return 'european';
}

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
    ], { maxTimeMS: 45000 })
    .toArray();

  // Build book_id → language map from books collection
  const allBookIds = new Set<string>();
  for (const e of entities) {
    for (const b of (e.books as { book_id: string }[]) || []) {
      allBookIds.add(b.book_id);
    }
  }

  // Query by `id` field (app-level ID) — avoids needing ObjectId/string split
  const bookDocs = allBookIds.size > 0
    ? await db.collection('books').find(
        { id: { $in: [...allBookIds] } },
        { projection: { id: 1, language: 1 } }
      ).toArray()
    : [];

  const bookLangMap = new Map<string, string>();
  for (const b of bookDocs) {
    if (b.language && b.id) bookLangMap.set(b.id as string, b.language as string);
  }

  // Compute dominant cultural tradition for an entity from its books' languages
  function getDominantTradition(books: { book_id: string }[] | undefined): string {
    if (!books || books.length === 0) return 'other';
    const counts: Record<string, number> = {};
    for (const b of books) {
      const lang = bookLangMap.get(b.book_id);
      const tradition = languageToTradition(lang);
      if (tradition) counts[tradition] = (counts[tradition] || 0) + 1;
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
  try {
    const data = await fetchTimelineData();
    return <TimelineLoader entities={data.entities} stats={data.stats} />;
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500">Timeline data is temporarily unavailable. Please try again shortly.</p>
      </div>
    );
  }
}
