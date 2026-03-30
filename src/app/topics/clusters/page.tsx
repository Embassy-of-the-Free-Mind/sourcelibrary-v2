import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'AI-Discovered Topic Clusters | Source Library',
  description: 'Explore 6,000 historical texts organized into 48 topics discovered by machine learning embedding analysis.',
  alternates: { canonical: '/topics/clusters' },
};

function topicSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface TopicSummary {
  name: string;
  slug: string;
  cluster_id: number;
  count: number;
  languages: string[];
  thumbnails: string[];
  top_terms: string[];
  has_subclusters: boolean;
}

async function fetchTopics(): Promise<{ topics: TopicSummary[]; totalBooks: number }> {
  const db = await getDb();

  const pipeline = [
    {
      $match: {
        visible: true,
        'taxonomy.cluster': { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$taxonomy.cluster',
        cluster_id: { $first: '$taxonomy.cluster_id' },
        count: { $sum: 1 },
        languages: { $addToSet: '$language' },
        thumbnails: {
          $push: {
            $cond: [
              { $and: [{ $ne: ['$thumbnail', null] }, { $ne: ['$thumbnail', ''] }] },
              '$thumbnail',
              '$$REMOVE',
            ],
          },
        },
        subclusters: { $addToSet: '$taxonomy.subcluster' },
        // Collect top index terms for display
        all_terms: {
          $push: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$index.entries', []] } }, 0] },
              { $slice: ['$index.entries', 3] },
              '$$REMOVE',
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

  let totalBooks = 0;
  const topics: TopicSummary[] = results.map((r) => {
    totalBooks += r.count;
    // Flatten and deduplicate terms
    const termSet = new Set<string>();
    for (const entries of r.all_terms || []) {
      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (e?.term && termSet.size < 6) termSet.add(e.term);
        }
      }
    }

    // Filter out null subclusters
    const realSubclusters = (r.subclusters || []).filter((s: string | null) => s != null);

    return {
      name: r._id,
      slug: topicSlug(r._id),
      cluster_id: r.cluster_id,
      count: r.count,
      languages: (r.languages || []).filter(Boolean).slice(0, 4),
      thumbnails: (r.thumbnails || [])
        .filter((t: string) => t.startsWith('http'))
        .slice(0, 4),
      top_terms: Array.from(termSet),
      has_subclusters: realSubclusters.length > 1,
    };
  });

  return { topics, totalBooks };
}

export default async function TopicsPage() {
  const { topics, totalBooks } = await fetchTopics();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Browse by Topic"
          subtitle={`${totalBooks.toLocaleString()} books organized into ${topics.length} topics, discovered by clustering the library's keyword indexes.`}
        />
      }
    >

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <Link
            key={topic.slug}
            href={`/topics/${topic.slug}`}
            className="group relative block overflow-hidden rounded-lg border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all"
          >
            {/* Thumbnail strip */}
            {topic.thumbnails.length > 0 && (
              <div className="flex h-24 overflow-hidden">
                {topic.thumbnails.slice(0, 4).map((url, i) => (
                  <div
                    key={i}
                    className="relative flex-1 overflow-hidden"
                  >
                    <Image
                      src={url}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 25vw, 15vw"
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                      unoptimized
                    />
                  </div>
                ))}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />
              </div>
            )}

            {/* Content */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="font-display text-base font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight">
                  {topic.name}
                </h2>
                <span className="text-xs text-muted whitespace-nowrap flex-shrink-0">
                  {topic.count} books
                </span>
              </div>

              {/* Keywords preview */}
              {topic.top_terms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {topic.top_terms.slice(0, 4).map((term) => (
                    <span
                      key={term}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-warm text-secondary"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              )}

              {/* Languages */}
              {topic.languages.length > 0 && (
                <p className="text-[11px] text-muted mt-2">
                  {topic.languages.join(', ')}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </ContentPageLayout>
  );
}
