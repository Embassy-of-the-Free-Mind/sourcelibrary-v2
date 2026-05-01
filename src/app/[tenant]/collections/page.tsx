import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { sortCollections, sanitizeThumbnail, collectionCountLabel } from '@/lib/collections-utils';
import EraTimeline, { type DecadeBucket } from '@/components/collections/EraTimeline';
import ShowMorePathways from '@/components/collections/ShowMorePathways';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import type { Metadata } from 'next';

export const revalidate = 86400;

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
  artwork_count?: number;
  type?: 'category' | 'curated';
  published?: boolean;
  featured_images?: FeaturedImage[];
  languages: { lang: string; count: number }[];
  children_count?: number;
  collection_type?: string;
}

async function fetchCollections(tenantId: string | null): Promise<CollectionDoc[]> {
  const db = await getReadDb();
  const baseMatch: Record<string, unknown> = {
    parent: { $exists: false },
    type: { $ne: 'curated' },
    collection_type: { $ne: 'visual_art' },
    visible: true,
  };
  if (tenantId) baseMatch.tenantId = tenantId;

  const childMatch: Record<string, unknown> = {
    parent: { $exists: true },
    visible: true,
  };
  if (tenantId) childMatch.tenantId = tenantId;

  const [docs, childCounts] = await Promise.all([
    db.collection('collections').find(baseMatch).toArray(),
    db.collection('collections').aggregate<{ _id: string; count: number }>([
      { $match: childMatch },
      { $unwind: { path: '$parent', preserveNullAndEmptyArrays: false } },
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

// Hand-picked subcollections that serve as compelling entry points.
// These are the "hooks" — evocative names that pull readers in.
const CURATED_PATHWAYS = [
  'courts-of-wonder',
  'maps-of-the-invisible',
  'rosicrucian-moment',
  'grimoire-tradition',
  'women-of-the-secret-tradition',
  'alchemical-emblem',
  'ficinos-florence',
  'dance-of-death',
  'bestiary-tradition',
  'ancient-egyptian',
  'art-of-memory',
  'behmenist-underground',
  'visions-ecstasies',
  'yokai-oni',
  'sumerian-mesopotamian',
  'forbidden-books',
  'music-of-the-spheres',
  'rudolf-prague',
  'contemplative-traditions',
  'newtons-other-science',
  'sympathy-of-all-things',
  'kepler-fludd-debate',
  'neoplatonism',
  'the-cosmos',
  'indic-traditions',
  'chinese-classics',
  'great-manuscripts',
  'herbalism',
  'jungs-library',
  'kloss-collection',
];

async function fetchCuratedPathways(tenantId: string | null): Promise<CollectionDoc[]> {
  const db = await getReadDb();
  const query: Record<string, unknown> = { slug: { $in: CURATED_PATHWAYS } };
  if (tenantId) query.tenantId = tenantId;

  const docs = await db.collection('collections').find(query).toArray();

  // Maintain the hand-picked order
  const bySlug = new Map(docs.map(d => [d.slug, d]));
  return CURATED_PATHWAYS
    .map(slug => bySlug.get(slug))
    .filter((d): d is NonNullable<typeof d> => d != null)
    .map(({ _id, ...rest }) => rest) as unknown as CollectionDoc[];
}

async function fetchTimelineDecades(): Promise<{ decades: DecadeBucket[]; total: number }> {
  try {
    const db = await getReadDb();
    const pipeline = [
      { $match: { year: { $exists: true, $ne: null }, visible: true } },
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

/** Pick the best image URL for a card: prefer small thumbnails, fall back to extracted, then raw page. */
function pickCardImage(images: FeaturedImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  // Find first image that has any usable URL
  for (const img of images) {
    const url = img.thumbnail_url || img.extracted_url || img.image_url;
    if (url) return img.thumbnail_url || img.extracted_url || img.image_url;
  }
  return undefined;
}

function CollectionCard({ col, tenantSlug, priority = false }: { col: CollectionDoc; tenantSlug?: string | null; priority?: boolean }) {
  const heroUrl = sanitizeThumbnail(pickCardImage(col.featured_images));

  return (
    <Link
      key={col.slug}
      href={tenantSlug ? `/${tenantSlug}/collections/${col.slug}` : `/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
    >
      {heroUrl ? (
        <Image
          src={heroUrl}
          alt={`Illustration from ${col.name}`}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          priority={priority}
          loading={priority ? 'eager' : 'lazy'}
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
        <p className="text-white/50 text-[11px] mb-1 hidden sm:block">
          {collectionCountLabel(col.book_count, col.artwork_count)}
          {col.children_count ? ` · ${col.children_count} sub-collections` : ''}
        </p>
        <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h2>
      </div>
    </Link>
  );
}



function CuratedCard({ col, tenantSlug, priority = false }: { col: CollectionDoc; tenantSlug?: string | null; priority?: boolean }) {
  const heroUrl = sanitizeThumbnail(pickCardImage(col.featured_images));

  return (
    <Link
      href={tenantSlug ? `/${tenantSlug}/collections/${col.slug}` : `/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-[3/2]"
    >
      {heroUrl ? (
        <Image
          src={heroUrl}
          alt={`Illustration from ${col.name}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          priority={priority}
          loading={priority ? 'eager' : 'lazy'}
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-5">
        <h3 className="font-serif text-base sm:text-lg text-white font-semibold leading-tight mb-1 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h3>
        {col.subtitle && (
          <p className="text-xs sm:text-sm text-white/60 leading-relaxed line-clamp-2">
            {col.subtitle}
          </p>
        )}
      </div>
    </Link>
  );
}

export default async function CollectionsPage() {
  const { id: tenantId, slug: tenantSlug } = getTenantContextFromRequest(await headers());

  const [categories, pathways, timeline] = await Promise.all([
    fetchCollections(tenantId),
    fetchCuratedPathways(tenantId),
    fetchTimelineDecades(),
  ]);

  const INITIAL_PATHWAYS = 12;

  // Pick a hero background from the first collection with a usable image
  const allCols = [...pathways, ...categories];
  const heroBg = sanitizeThumbnail(
    allCols.flatMap(c => c.featured_images || [])
      .find(img => img.extracted_url || img.image_url)
      ?.extracted_url || allCols.flatMap(c => c.featured_images || [])
        .find(img => img.image_url)?.image_url
  );

  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader
          title="Collections"
          subtitle="10,000+ books across three millennia of human knowledge."
          image={heroBg}
          imageAlt="Historical illustration from the collection"
        />
      }
    >

      {/* Curated pathways — the hooks, shown first */}
      {pathways.length > 0 && (
        <div>
          <div className="mb-4">
            <h2 className="font-display text-2xl text-primary">Curated Pathways</h2>
            <p className="text-stone-500 mt-1 text-sm">Thematic journeys through the collection</p>
          </div>
          <ShowMorePathways
            initialCount={INITIAL_PATHWAYS}
            totalCount={pathways.length}
          >
            {pathways.map((col, i) => (
              <CuratedCard key={col.slug} col={col} tenantSlug={tenantSlug} priority={i < 4} />
            ))}
          </ShowMorePathways>
        </div>
      )}

      {/* Core collections */}
      <div className="mt-12">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-primary">Core Collections</h2>
          <p className="text-stone-500 mt-1 text-sm">The main wings of the library</p>
        </div>
        <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {categories.map((col, i) => (
            <CollectionCard key={col.slug} col={col} tenantSlug={tenantSlug} />
          ))}
        </div>
      </div>

      {/* Era timeline — full-bleed dark section */}
      <EraTimeline decades={timeline.decades} total={timeline.total} />
    </ContentPageLayout>
  );
}
