import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';
import { FACETS } from '@/lib/taxonomy/faceted-vocabulary';

export const revalidate = 300; // 5 min — facet aggregations are expensive

export const metadata: Metadata = {
  title: 'Browse by Topic | Source Library',
  description: 'Explore historical texts across six dimensions: tradition, domain, form, cultural sphere, era, and epistemic mode. Filter and combine to find exactly what you\'re looking for.',
  alternates: { canonical: '/topics' },
};

function facetSlug(facetId: string, valueId: string): string {
  return `${facetId}--${valueId}`;
}

interface FacetCount {
  id: string;
  label: string;
  count: number;
  thumbnails: string[];
}

interface FacetGroup {
  id: string;
  label: string;
  question: string;
  values: FacetCount[];
}

async function fetchFacetCounts(): Promise<{ groups: FacetGroup[]; totalBooks: number }> {
  const db = await getDb();

  const totalBooks = await db.collection('books').countDocuments({
    faceted_tags: { $exists: true },
    hidden: { $ne: true },
  });

  const groups: FacetGroup[] = [];

  for (const facet of FACETS) {
    const pipeline = [
      {
        $match: {
          faceted_tags: { $exists: true },
          hidden: { $ne: true },
        },
      },
      { $unwind: `$faceted_tags.${facet.id}` },
      {
        $group: {
          _id: `$faceted_tags.${facet.id}`,
          count: { $sum: 1 },
          thumbnails: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$thumbnail_blob', null] },
                    { $ne: ['$thumbnail_blob', ''] },
                  ],
                },
                '$thumbnail_blob',
                {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$thumbnail', null] },
                        { $ne: ['$thumbnail', ''] },
                        {
                          $regexMatch: {
                            input: { $ifNull: ['$thumbnail', ''] },
                            regex: /^https?:\/\//,
                          },
                        },
                      ],
                    },
                    '$thumbnail',
                    '$$REMOVE',
                  ],
                },
              ],
            },
          },
        },
      },
      { $sort: { count: -1 as const } },
    ];

    const results = await db
      .collection('books')
      .aggregate(pipeline, { allowDiskUse: true })
      .toArray();

    const values: FacetCount[] = results.map((r) => {
      const vocabValue = facet.values.find((v) => v.id === r._id);
      return {
        id: r._id as string,
        label: vocabValue?.label || (r._id as string),
        count: r.count,
        thumbnails: (r.thumbnails || []).filter(Boolean).slice(0, 4),
      };
    });

    groups.push({
      id: facet.id,
      label: facet.label,
      question: facet.question,
      values,
    });
  }

  return { groups, totalBooks };
}

export default async function TopicsPage() {
  const { groups, totalBooks } = await fetchFacetCounts();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Browse the Library"
          subtitle={`${totalBooks.toLocaleString()} books across six dimensions. Click any tag to explore, or combine tags to narrow your search.`}
        />
      }
    >

      <div className="space-y-12">
        {groups.map((group) => (
          <section key={group.id}>
            <div className="mb-4">
              <h2 className="font-display text-xl md:text-2xl text-primary">
                {group.label}
              </h2>
              <p className="text-sm text-muted mt-1">{group.question}</p>
            </div>

            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.values.map((value) => (
                <Link
                  key={value.id}
                  href={`/topics/${group.id}--${value.id}`}
                  className="group relative block overflow-hidden rounded-lg border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all"
                >
                  {/* Thumbnail strip */}
                  {value.thumbnails.length > 0 && (
                    <div className="flex h-16 overflow-hidden">
                      {value.thumbnails.slice(0, 4).map((url, i) => (
                        <div key={i} className="relative flex-1 overflow-hidden">
                          <Image
                            src={url}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 25vw, 12vw"
                            className="object-cover group-hover:scale-105 transition-transform duration-500"
                            unoptimized
                          />
                        </div>
                      ))}
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight">
                        {value.label}
                      </h3>
                      <span className="text-xs text-muted whitespace-nowrap flex-shrink-0">
                        {value.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Link to old cluster view */}
      <div className="mt-16 pt-8 border-t border-border-light">
        <p className="text-sm text-muted">
          Looking for the AI-discovered topic clusters?{' '}
          <Link href="/topics/clusters" className="text-accent-rust hover:underline">
            Browse 48 clusters
          </Link>{' '}
          found by embedding analysis.
        </p>
      </div>
    </ContentPageLayout>
  );
}
