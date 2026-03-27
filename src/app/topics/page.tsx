import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';
import { FACETS, DOMAIN_GROUPS, facetDbField } from '@/lib/taxonomy/faceted-vocabulary';

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
      { $unwind: `$faceted_tags.${facetDbField(facet)}` },
      {
        $group: {
          _id: `$faceted_tags.${facetDbField(facet)}`,
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

function FacetValueCard({ value, facetId }: { value: FacetCount; facetId: string }) {
  return (
    <Link
      href={`/topics/${facetId}--${value.id}`}
      className="group relative block overflow-hidden rounded-lg border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all"
    >
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
  );
}

function FacetGrid({ values, facetId }: { values: FacetCount[]; facetId: string }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {values.map((value) => (
        <FacetValueCard key={value.id} value={value} facetId={facetId} />
      ))}
    </div>
  );
}

function DomainGroupedGrid({ values, facetId }: { values: FacetCount[]; facetId: string }) {
  const valueMap = new Map(values.map(v => [v.id, v]));

  // Filter to groups that have at least one domain with books
  const activeGroups = DOMAIN_GROUPS
    .map(g => ({
      ...g,
      domainValues: g.domains
        .map(id => valueMap.get(id))
        .filter((v): v is FacetCount => !!v && v.count > 0),
    }))
    .filter(g => g.domainValues.length > 0);

  return (
    <div className="space-y-8">
      {activeGroups.map((group) => (
        <div key={group.id}>
          <h3 className="font-display text-base text-secondary mb-3">
            {group.label}
          </h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.domainValues.map((value) => (
              <FacetValueCard key={value.id} value={value} facetId={facetId} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function TopicsPage() {
  const { groups, totalBooks } = await fetchFacetCounts().catch((err) => {
    console.error('Facet counts fetch failed:', err);
    return { groups: [] as FacetGroup[], totalBooks: 0 };
  });

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

            {/* Domain facet: render with sub-groups */}
            {group.id === 'domain' ? (
              <DomainGroupedGrid values={group.values} facetId={group.id} />
            ) : (
              <FacetGrid values={group.values} facetId={group.id} />
            )}
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
