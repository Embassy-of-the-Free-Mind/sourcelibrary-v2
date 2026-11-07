import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreStats from '@/components/explore/ExploreStats';
import CenturyHeatmap from '@/components/explore/CenturyHeatmap';
import ExploreNav from '@/components/explore/ExploreNav';
import DataSources from '@/components/explore/DataSources';
import { getReadDb } from '@/lib/mongodb';
import { getLibraryStats } from '@/lib/library-stats';
import type { Db } from 'mongodb';
import {
  ENTITY_STATS_CONFIG_ID,
  type EntityStatsDoc,
} from '@/lib/canonical-entities';

export const revalidate = 86400;

/**
 * Live book count — the same number the homepage shows. A bare
 * `books.estimatedDocumentCount()` also counts hidden books and artwork-only
 * records (`pages_count: 0`) and read ~3x the live figure (134,002 vs 42,133,
 * 2026-10-07). Falls back to the canonical live filter if the stats cache is
 * missing (visibility-and-stats.md).
 */
async function liveBookCount(db: Db): Promise<number> {
  const stats = await getLibraryStats();
  if (stats?.books) return stats.books;
  return db.collection('books').countDocuments(
    { visible: true, pages_count: { $gt: 0 } },
    { maxTimeMS: 15000 },
  );
}
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Explore | Source Library',
  description: 'Interactive visualizations of the people, places, and concepts indexed across the library. Century heatmaps, era highlights, and data source breakdowns.',
  alternates: { canonical: '/explore' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' }],
    title: 'Explore | Source Library',
    description: 'Interactive visualizations of the Western esoteric tradition, enriched with Wikidata.',
  },
};

/**
 * All entity-side counts come from `system_config.entity_stats`, written
 * nightly by scripts/maintenance/build-canonical-entities.mjs — zero queries
 * against the ~1.2M-doc `entities` collection. This page prerenders at build
 * time, and the legacy path (distinct + six countDocuments over `entities`)
 * failed whole production builds whenever a bulk `entities` writer pushed a
 * count past maxTimeMS (#3373). Production already served this path behind
 * CANONICAL_ENTITIES_READPATH; the hub no longer consults the flag, so
 * unsetting it cannot bring those build-time counts back.
 *
 * Count semantics shift deliberately: with_dates / with_coordinates /
 * with_wikidata are CANONICAL counts (one per merged QID: 6,291 / 1,924 /
 * 20,861 at build time) instead of raw `entities`-row counts (7,948 / 2,257 /
 * 27,854 measured 2026-07-05) — consistent with what the migrated timeline
 * and map pages actually display. `total` and the per-type distribution stay
 * raw row counts, same semantics as today.
 */
async function fetchExploreStatsCanonical() {
  const db = await getReadDb();

  const [statsDocRaw, totalBooks, heatmapData] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.collection('system_config').findOne({ _id: ENTITY_STATS_CONFIG_ID as any }),
    liveBookCount(db),
    // Covered by visible_year_heatmap (ensure-indexes.mjs): 0 docs examined,
    // ~50-150 ms. Keep the predicate to exactly these two fields — an extra
    // `$exists` forces a FETCH of every 17 KB book doc (5-60 s, #3373), and
    // `$gt: 0` already excludes missing/null years.
    db.collection('books').aggregate([
      { $match: { visible: true, year: { $gt: 0 } } },
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
  const statsDoc = statsDocRaw as unknown as EntityStatsDoc | null;

  // No catch-into-fallback (#2974): a missing stats doc means the nightly
  // build has not run — throw so ISR keeps serving the last good page rather
  // than caching zeroed stats for the 24h revalidate window.
  if (!statsDoc) {
    throw new Error(
      'system_config.entity_stats missing — run scripts/maintenance/build-canonical-entities.mjs',
    );
  }

  const heatmap = heatmapData.map((row) => ({
    century: row._id as number,
    type: 'book' as string,
    count: row.count as number,
  }));

  const dataSources = {
    entities: {
      label: 'Entity Index',
      description: 'Extracted from AI-generated book indexes (people, places, concepts)',
      count: statsDoc.total,
    },
    wikidata: {
      label: 'Wikidata Alignment',
      description: 'Entities linked to Wikidata via Wikipedia URLs and name matching',
      count: statsDoc.with_wikidata_id,
      coverage: statsDoc.total > 0 ? +(statsDoc.with_wikidata_id / statsDoc.total * 100).toFixed(1) : 0,
    },
    dates: {
      label: 'Biographical Dates',
      description: 'Birth/death years from Wikidata claims P569/P570',
      count: statsDoc.with_dates,
    },
    coordinates: {
      label: 'Geographic Coordinates',
      description: 'Lat/lon from Wikidata claim P625 (places) and P19 (birthplaces)',
      count: statsDoc.with_coordinates,
    },
    books: {
      label: 'Source Books',
      description: 'Digitized historical texts from 13 partner libraries',
      count: totalBooks,
    },
  };

  return {
    totals: {
      entities: statsDoc.total,
      with_dates: statsDoc.with_dates,
      with_coordinates: statsDoc.with_coordinates,
      with_wikidata: statsDoc.with_wikidata_id,
      books: totalBooks,
    },
    type_distribution: { ...statsDoc.by_type },
    heatmap,
    top_entities_by_era: [],
    data_sources: dataSources,
  };
}

export default async function ExplorePage() {
  const stats = await fetchExploreStatsCanonical();

  return (
    <ContentPageLayout
      header={
        <ContentHeader maxWidth="wide"
          title="Explore"
          subtitle="Interactive visualizations of the people, places, and concepts indexed across the library, enriched with Wikidata."
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
