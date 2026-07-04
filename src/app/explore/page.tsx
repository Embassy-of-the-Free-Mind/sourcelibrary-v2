import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreStats from '@/components/explore/ExploreStats';
import CenturyHeatmap from '@/components/explore/CenturyHeatmap';
import ExploreNav from '@/components/explore/ExploreNav';
import DataSources from '@/components/explore/DataSources';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 86400;
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Explore — Source Library',
  description: 'Interactive visualizations of 12,500+ people, places, and concepts from the Western esoteric tradition. Century heatmaps, era highlights, and data source breakdowns.',
  alternates: { canonical: '/explore' },
  openGraph: {
    title: 'Explore — Source Library',
    description: 'Interactive visualizations of the Western esoteric tradition, enriched with Wikidata.',
  },
};

async function fetchExploreStats() {
  const db = await getReadDb();

  // Use estimatedDocumentCount (instant, uses collection metadata) and
  // index-only queries for everything else — the entities collection is ~1M
  // docs / ~1.9GB, so anything that touches documents (a $facet, a $group
  // over the collection, or a count whose $exists predicate forces a FETCH)
  // blows its time budget. Two shapes keep these index-only:
  //  - bare `{ $ne: null }` (missing counts as null, so it needs no $exists)
  //    is answered entirely from the wikidata_* partial-index bounds
  //    (~300ms vs 7-17s measured with the $exists form);
  //  - distinct('type') + one COUNT_SCAN per type instead of a $group.
  const entityTypes = ((await db
    .collection('entities')
    .distinct('type', {}, { maxTimeMS: 25000 })) as (string | null)[])
    .filter((t): t is string => t != null);

  const [
    totalEntities,
    totalBooks,
    typeCounts,
    withDates,
    withCoordinates,
    withWikidata,
    heatmapData,
  ] = await Promise.all([
    db.collection('entities').estimatedDocumentCount(),
    db.collection('books').estimatedDocumentCount(),
    Promise.all(entityTypes.map(async (t) => ({
      type: t,
      count: await db.collection('entities').countDocuments({ type: t }, { maxTimeMS: 25000 }),
    }))),
    db.collection('entities').countDocuments({
      $or: [
        { wikidata_birth_date: { $ne: null } },
        { wikidata_death_date: { $ne: null } },
      ],
    }, { maxTimeMS: 25000 }),
    db.collection('entities').countDocuments(
      { wikidata_coordinates: { $ne: null } },
      { maxTimeMS: 25000 },
    ),
    db.collection('entities').countDocuments(
      { wikidata_id: { $ne: null } },
      { maxTimeMS: 25000 },
    ),

    // Books by century — fast aggregation on books collection
    db.collection('books').aggregate([
      { $match: { year: { $exists: true, $gt: 0 }, visible: true } },
      {
        $group: {
          _id: {
            $add: [
              { $floor: { $divide: [{ $subtract: ['$year', 1] }, 100] } },
              1,
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ], { maxTimeMS: 15000 }).toArray(),
  ]);

  const heatmap = heatmapData.map((row) => ({
    century: row._id as number,
    type: 'book' as string,
    count: row.count as number,
  }));

  const types: Record<string, number> = {};
  for (const row of typeCounts) {
    types[row.type] = row.count;
  }

  const dataSources = {
    entities: {
      label: 'Entity Index',
      description: 'Extracted from AI-generated book indexes (people, places, concepts)',
      count: totalEntities,
    },
    wikidata: {
      label: 'Wikidata Alignment',
      description: 'Entities linked to Wikidata via Wikipedia URLs and name matching',
      count: withWikidata,
      coverage: totalEntities > 0 ? +(withWikidata / totalEntities * 100).toFixed(1) : 0,
    },
    dates: {
      label: 'Biographical Dates',
      description: 'Birth/death years from Wikidata claims P569/P570',
      count: withDates,
    },
    coordinates: {
      label: 'Geographic Coordinates',
      description: 'Lat/lon from Wikidata claim P625 (places) and P19 (birthplaces)',
      count: withCoordinates,
    },
    books: {
      label: 'Source Books',
      description: 'Digitized historical texts from 13 partner libraries',
      count: totalBooks,
    },
  };

  // No try/catch: a thrown error during ISR revalidation keeps serving the
  // last good page; catching it here would cache zeroed stats for the full
  // 24h revalidate window (which is exactly what happened on 2026-07-04).
  return {
    totals: {
      entities: totalEntities,
      with_dates: withDates,
      with_coordinates: withCoordinates,
      with_wikidata: withWikidata,
      books: totalBooks,
    },
    type_distribution: types,
    heatmap,
    top_entities_by_era: [],
    data_sources: dataSources,
  };
}

export default async function ExplorePage() {
  const stats = await fetchExploreStats();

  return (
    <ContentPageLayout
      header={
        <ContentHeader maxWidth="wide"
          title="Explore"
          subtitle="Interactive visualizations of 12,500+ people, places, and concepts extracted from the Western esoteric tradition — enriched with Wikidata."
        />
      }
      maxWidth="wide"
    >
      <div className="space-y-12">
        <ExploreStats totals={stats.totals} />

        <section>
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--text-primary)' }}>
            Visualizations
          </h2>
          <ExploreNav totals={stats.totals} />
        </section>

        <section>
          <h2 className="font-serif text-2xl mb-2" style={{ color: 'var(--text-primary)' }}>
            Books by Century
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Distribution of books across centuries. Click a cell to search.
          </p>
          <CenturyHeatmap data={stats.heatmap} />
        </section>

        <DataSources sources={stats.data_sources} />
      </div>
    </ContentPageLayout>
  );
}
