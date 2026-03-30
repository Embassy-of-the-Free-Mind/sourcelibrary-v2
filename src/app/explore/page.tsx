import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreStats from '@/components/explore/ExploreStats';
import CenturyHeatmap from '@/components/explore/CenturyHeatmap';
import ExploreNav from '@/components/explore/ExploreNav';
import DataSources from '@/components/explore/DataSources';
import { getDb } from '@/lib/mongodb';

export const revalidate = 600;
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
  try {
    const db = await getDb();

    // Use estimatedDocumentCount (instant, uses collection metadata)
    // and a single aggregation for all entity stats to avoid multiple slow scans
    const [
      totalEntities,
      totalBooks,
      entityStats,
      heatmapData,
    ] = await Promise.all([
      db.collection('entities').estimatedDocumentCount(),
      db.collection('books').estimatedDocumentCount(),
      // Single aggregation for type distribution + filtered counts
      db.collection('entities').aggregate([
        {
          $facet: {
            byType: [{ $group: { _id: '$type', count: { $sum: 1 } } }],
            withDates: [{ $match: { $or: [{ wikidata_birth_date: { $exists: true, $ne: null } }, { wikidata_death_date: { $exists: true, $ne: null } }] } }, { $count: 'n' }],
            withCoords: [{ $match: { wikidata_coordinates: { $exists: true, $ne: null } } }, { $count: 'n' }],
            withWikidata: [{ $match: { wikidata_id: { $exists: true, $ne: null } } }, { $count: 'n' }],
          },
        },
      ], { maxTimeMS: 25000 }).toArray(),

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

    const facets = entityStats[0] || { byType: [], withDates: [], withCoords: [], withWikidata: [] };
    const withDates = facets.withDates[0]?.n || 0;
    const withCoordinates = facets.withCoords[0]?.n || 0;
    const withWikidata = facets.withWikidata[0]?.n || 0;
    const typeDistribution = facets.byType;

    const heatmap = heatmapData.map((row) => ({
      century: row._id as number,
      type: 'book' as string,
      count: row.count as number,
    }));

    const types: Record<string, number> = {};
    for (const row of typeDistribution) {
      types[row._id as string] = row.count as number;
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
  } catch (err) {
    console.error('Explore data fetch failed:', err);
    return {
      totals: { entities: 0, with_dates: 0, with_coordinates: 0, with_wikidata: 0, books: 0 },
      type_distribution: {},
      heatmap: [],
      top_entities_by_era: [],
      data_sources: {},
    };
  }
}

export default async function ExplorePage() {
  const stats = await fetchExploreStats();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
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
