import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { sortCollections } from '@/lib/collections-utils';
import EraTimeline, { type DecadeBucket } from '@/components/collections/EraTimeline';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic'; // ISR: rebuild every hour

export const metadata: Metadata = {
  title: 'Collections | Source Library',
  description: 'Browse thousands of historical texts organized into thematic collections: Western esotericism, classical philosophy, sacred texts, and more.',
  alternates: { canonical: '/collections' },
};

interface FeaturedImage {
  id: string;
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
  description?: string;
  type?: string;
  book_title?: string;
}

interface CollectionDoc {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  order: number;
  book_count: number;
  type?: 'category' | 'curated';
  published?: boolean;
  featured_images?: FeaturedImage[];
  languages: { lang: string; count: number }[];
  children_count?: number;
  collection_type?: string;
}

async function fetchCollections(): Promise<CollectionDoc[]> {
  const db = await getDb();
  const [docs, childCounts] = await Promise.all([
    db.collection('collections').find({
      parent: { $exists: false },
      type: { $ne: 'curated' },
      collection_type: { $ne: 'visual_art' },
      hidden: { $ne: true },
    }).toArray(),
    db.collection('collections').aggregate<{ _id: string; count: number }>([
      { $match: { parent: { $exists: true }, hidden: { $ne: true } } },
      { $group: { _id: '$parent', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const childCountMap = new Map(childCounts.map(c => [c._id, c.count]));
  const all = docs.map(({ _id, ...rest }) => ({
    ...rest,
    children_count: childCountMap.get(rest.slug) || 0,
  })) as unknown as CollectionDoc[];

  return sortCollections(all);
}

async function fetchTimelineDecades(): Promise<{ decades: DecadeBucket[]; total: number }> {
  try {
    const db = await getDb();
    const pipeline = [
      { $match: { year: { $exists: true, $ne: null }, hidden: { $ne: true } } },
      { $project: { year: 1, language: { $ifNull: ['$language', 'Unknown'] } } },
      {
        $group: {
          _id: {
            decade: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] },
            language: '$language',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.decade': 1 as const, count: -1 as const } },
      {
        $group: {
          _id: '$_id.decade',
          count: { $sum: '$count' },
          languages: { $push: { lang: '$_id.language', count: '$count' } },
        },
      },
      { $sort: { _id: 1 as const } },
    ];
    const raw = await db.collection('books').aggregate(pipeline, { maxTimeMS: 5000 }).toArray();
    const decades: DecadeBucket[] = raw.map(d => ({
      decade: d._id,
      count: d.count,
      languages: d.languages,
    }));
    const total = decades.reduce((sum, d) => sum + d.count, 0);
    return { decades, total };
  } catch {
    return { decades: [], total: 0 };
  }
}

function CollectionCard({ col }: { col: CollectionDoc }) {
  const hero = col.featured_images?.find(
    img => img.extracted_url || img.image_url || img.thumbnail_url
  );
  const heroUrl = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url;

  return (
    <Link
      key={col.slug}
      href={`/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
    >
      {heroUrl ? (
        <Image
          src={heroUrl}
          alt={`Illustration from ${col.name}`}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
        <p className="text-white/50 text-xs mb-1 hidden sm:block">
          {col.book_count > 0 ? `${col.book_count.toLocaleString()} ${col.collection_type === 'visual_art' ? 'works' : 'books'}` : ''}
          {col.children_count ? ` · ${col.children_count} sub-collections` : ''}
        </p>
        <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h2>
      </div>
    </Link>
  );
}



export default async function CollectionsPage() {
  const [categories, timeline] = await Promise.all([
    fetchCollections(),
    fetchTimelineDecades(),
  ]);
  const totalBooks = categories.reduce((s, c) => s + c.book_count, 0);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Collections"
          subtitle={`${totalBooks.toLocaleString()} books organized into ${categories.length} thematic collections spanning three millennia of human knowledge.`}
        />
      }
    >

      {/* Link to curated exhibitions */}
      <div className="mb-8">
        <Link
          href="/curated"
          className="group inline-flex items-center gap-2 text-sm text-accent-rust hover:text-accent-rust/80 transition-colors"
        >
          Browse curated exhibitions
          <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
        </Link>
      </div>

      {/* Category collections */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {categories.map((col) => (
          <CollectionCard key={col.slug} col={col} />
        ))}
      </div>

      {/* Era timeline — full-bleed dark section */}
      <EraTimeline decades={timeline.decades} total={timeline.total} />
    </ContentPageLayout>
  );
}
