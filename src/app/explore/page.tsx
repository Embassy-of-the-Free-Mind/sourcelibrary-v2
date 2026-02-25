import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreStats from '@/components/explore/ExploreStats';
import CenturyHeatmap from '@/components/explore/CenturyHeatmap';
import EraHighlights from '@/components/explore/EraHighlights';
import ExploreNav from '@/components/explore/ExploreNav';
import DataSources from '@/components/explore/DataSources';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

async function fetchExploreStats() {
  const db = await getDb();

  const [
    totalEntities,
    withDates,
    withCoordinates,
    withWikidata,
    totalBooks,
    typeDistribution,
    heatmapData,
    topByEra,
  ] = await Promise.all([
    db.collection('entities').countDocuments(),
    db.collection('entities').countDocuments({
      $or: [
        { wikidata_birth_date: { $exists: true, $ne: null } },
        { wikidata_death_date: { $exists: true, $ne: null } },
      ],
    }),
    db.collection('entities').countDocuments({
      wikidata_coordinates: { $exists: true, $ne: null },
    }),
    db.collection('entities').countDocuments({
      wikidata_id: { $exists: true, $ne: null },
    }),
    db.collection('books').countDocuments({ hidden: { $ne: true } }),
    db.collection('entities').aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).toArray(),

    // Century x type heatmap — bin entities by the century of their associated books
    db.collection('entities').aggregate([
      { $unwind: '$books' },
      {
        $lookup: {
          from: 'books',
          localField: 'books.book_id',
          foreignField: 'id',
          as: 'book_doc',
        },
      },
      { $unwind: '$book_doc' },
      { $match: { 'book_doc.year': { $exists: true, $gt: 0 } } },
      {
        $group: {
          _id: {
            entity: '$name',
            type: '$type',
            century: {
              $add: [
                { $floor: { $divide: [{ $subtract: ['$book_doc.year', 1] }, 100] } },
                1,
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: { century: '$_id.century', type: '$_id.type' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.century': 1 } },
    ]).toArray(),

    // Top entities per era
    db.collection('entities').aggregate([
      { $match: { book_count: { $gte: 2 } } },
      { $unwind: '$books' },
      {
        $lookup: {
          from: 'books',
          localField: 'books.book_id',
          foreignField: 'id',
          as: 'book_doc',
        },
      },
      { $unwind: '$book_doc' },
      { $match: { 'book_doc.year': { $exists: true, $gt: 0 } } },
      {
        $group: {
          _id: {
            entity: '$name',
            type: '$type',
            century: {
              $add: [
                { $floor: { $divide: [{ $subtract: ['$book_doc.year', 1] }, 100] } },
                1,
              ],
            },
          },
          book_count: { $first: '$book_count' },
        },
      },
      { $sort: { book_count: -1 } },
      {
        $group: {
          _id: '$_id.century',
          entities: {
            $push: {
              name: '$_id.entity',
              type: '$_id.type',
              book_count: '$book_count',
            },
          },
        },
      },
      {
        $project: {
          century: '$_id',
          entities: { $slice: ['$entities', 5] },
        },
      },
      { $sort: { century: 1 } },
    ]).toArray(),
  ]);

  const heatmap = heatmapData.map((row) => ({
    century: row._id.century as number,
    type: row._id.type as string,
    count: row.count as number,
  }));

  const types: Record<string, number> = {};
  for (const row of typeDistribution) {
    types[row._id as string] = row.count as number;
  }

  const topEntitiesByEra = topByEra.map((row) => ({
    century: row.century as number,
    entities: row.entities as Array<{ name: string; type: string; book_count: number }>,
  }));

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
    top_entities_by_era: topEntitiesByEra,
    data_sources: dataSources,
  };
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
        {/* Quick stats */}
        <ExploreStats totals={stats.totals} />

        {/* Visualization navigation cards */}
        <section>
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--text-primary)' }}>
            Visualizations
          </h2>
          <ExploreNav totals={stats.totals} />
        </section>

        {/* Century x type heatmap */}
        <section>
          <h2 className="font-serif text-2xl mb-2" style={{ color: 'var(--text-primary)' }}>
            Entities by Century
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Distribution of entities across centuries and types. Each cell shows how many unique entities appear in books from that era. Click a cell to search.
          </p>
          <CenturyHeatmap data={stats.heatmap} />
        </section>

        {/* Era highlights */}
        <EraHighlights eras={stats.top_entities_by_era} />

        {/* Data sources */}
        <DataSources sources={stats.data_sources} />
      </div>
    </ContentPageLayout>
  );
}
