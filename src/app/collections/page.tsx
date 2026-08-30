import { Suspense } from 'react';
import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import { headers } from 'next/headers';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { sortCollections, sanitizeThumbnail, collectionCountLabel, coverOverride, PINNED_COLLECTION_SLUGS } from '@/lib/collections-utils';
import { toGalleryCardUrl } from '@/lib/utils';
import EraTimeline, { type DecadeBucket } from '@/components/collections/EraTimeline';
import ShowMorePathways from '@/components/collections/ShowMorePathways';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { getLibraryStats, roundedCountLabel } from '@/lib/library-stats';
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
  total_book_count?: number;
  artwork_count?: number;
  type?: 'category' | 'curated';
  published?: boolean;
  featured_images?: FeaturedImage[];
  hero_image?: string;
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
  // 'dance-of-death' removed: no collection doc with this slug exists, so
  // fetchCuratedPathways silently dropped it (one fewer card than intended).
  // 47 books are tagged with it — if a real Dance of Death collection is
  // created later, re-add the slug here. See issue #3008.
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
  // 'indic-traditions' / 'chinese-classics' removed — their parent wings
  // (South Asia / East Asia) are now Core Collections, so they're reachable as
  // sub-collections there rather than duplicated as loose top-level pathways.
  'great-manuscripts',
  'herbalism',
  'jungs-library',
];

async function fetchCuratedPathways(tenantId: string | null): Promise<CollectionDoc[]> {
  const db = await getReadDb();
  const query: Record<string, unknown> = { slug: { $in: CURATED_PATHWAYS }, visible: { $ne: false } };
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

/** Ordered, de-duped list of candidate image URLs for a card — prefer small
 *  thumbnails, then extracted, then the raw page, across all featured images.
 *  The card renders these with a fallback chain so a single dead/slow source
 *  doesn't leave a broken thumbnail. */
function cardImageCandidates(images: FeaturedImage[] | undefined, override?: string, heroImage?: string): string[] {
  const urls: string[] = [];
  const add = (u: string | undefined | null) => {
    const s = sanitizeThumbnail(u);
    if (s && !urls.includes(s)) urls.push(s);
  };
  add(override); // curated cover wins over everything
  add(heroImage); // curated hero_image (set per-collection in Mongo) beats auto featured_images
  if (!images?.length) return urls;
  for (const img of images) {
    if (typeof img === 'string') { add(img); continue; }
    // Prefer the 600px gallery `-card.jpg` (sharp on retina); fall back to the
    // 300px thumb for crops whose card variant isn't backfilled yet (#2401).
    add(toGalleryCardUrl(img.thumbnail_url));
    add(img.thumbnail_url);
    add(img.extracted_url);
    add(img.image_url);
  }
  return urls;
}

function CollectionCard({ col, tenantSlug, priority = false }: { col: CollectionDoc; tenantSlug?: string | null; priority?: boolean }) {
  return (
    <Link
      key={col.slug}
      href={tenantSlug ? `/${tenantSlug}/collections/${col.slug}` : `/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-square animate-fade-in-up"
    >
      <CollectionCardImage
        candidates={cardImageCandidates(col.featured_images, coverOverride(col.slug), col.hero_image)}
        alt={`Illustration from ${col.name}`}
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        priority={priority}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
        <p className="text-white/50 text-[11px] mb-1 hidden sm:block">
          {collectionCountLabel(col.total_book_count ?? col.book_count, col.artwork_count)}
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
  return (
    <Link
      href={tenantSlug ? `/${tenantSlug}/collections/${col.slug}` : `/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-square animate-fade-in-up"
    >
      <CollectionCardImage
        candidates={cardImageCandidates(col.featured_images, coverOverride(col.slug), col.hero_image)}
        alt={`Illustration from ${col.name}`}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        priority={priority}
      />
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

const INITIAL_PATHWAYS = 12;

// Hero is a single pre-composited, compressed mosaic of collection covers
// (~290KB JPEG) served as a static CDN asset — one fast request, no server-side
// rendering. The dark gradient + title overlay in ContentHeader render on top.
// Rebuild with scripts/build-collections-hero.py when the cover set changes.
const COLLECTIONS_HERO = '/collections-hero.jpg';

export default async function CollectionsPage() {
  const stats = await getLibraryStats();
  const countLabel = stats ? `${roundedCountLabel(stats.books)} books` : 'Thousands of books';
  return (
    <>
    {/* Background images aren't seen by the preload scanner — hint it early. */}
    <link rel="preload" as="image" href={COLLECTIONS_HERO} fetchPriority="high" />
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader maxWidth="wide"
          title="Collections"
          subtitle={`${countLabel} across three millennia of human knowledge.`}
          image={COLLECTIONS_HERO}
          imageAlt="Mosaic of illustrations from the collection"
          imageFit="tile"
          heightClass="min-h-[260px] md:min-h-[40vh]"
        />
      }
    >
      {/* Core Collections (the major subject wings) lead; Curated Pathways
          (narrower thematic journeys + special collections) follow. Each
          section streams on its own. */}
      <Suspense fallback={<SectionSkeleton heading="Core Collections" sub="The major subject wings of the library" />}>
        <CoreCollectionsSection />
      </Suspense>

      <div className="mt-12">
        <Suspense fallback={<SectionSkeleton heading="Curated Pathways" sub="Thematic journeys drawn from across the core collections" />}>
          <CuratedPathwaysSection />
        </Suspense>
      </div>

      {/* The landing shows ~31 of 300+ collections; without this link the rest
          are reachable only through search (#4339 — real-user confusion about
          what the catalog actually contains). */}
      <Suspense fallback={null}>
        <AllCollectionsLink />
      </Suspense>

      <Suspense fallback={null}>
        <TimelineSection />
      </Suspense>
    </ContentPageLayout>
    </>
  );
}

async function CoreCollectionsSection() {
  const { id: tenantId, slug: tenantSlug } = getTenantContextFromRequest(await headers());
  const all = await fetchCollections(tenantId);
  // Core = the major subject wings only (PINNED). sortCollections already puts
  // the pinned wings first and in curated order.
  const wings = all.filter((col) => PINNED_COLLECTION_SLUGS.includes(col.slug));

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-2xl text-primary">Core Collections</h2>
        <p className="text-stone-500 mt-1 text-sm">The major subject wings of the library</p>
      </div>
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {wings.map((col) => (
          <CollectionCard key={col.slug} col={col} tenantSlug={tenantSlug} />
        ))}
      </div>
    </div>
  );
}

async function CuratedPathwaysSection() {
  const { id: tenantId, slug: tenantSlug } = getTenantContextFromRequest(await headers());
  const [pathways, all] = await Promise.all([
    fetchCuratedPathways(tenantId),
    fetchCollections(tenantId),
  ]);
  // Pathways = the hand-picked thematic journeys (sub-collections), then the
  // remaining top-level collections that aren't Core wings (special/niche
  // collections like The Sibyls, Dissenters & Prophets, An Account of the Plant).
  // Nothing top-level is orphaned: every collection is either a wing or here.
  const seen = new Set(pathways.map((p) => p.slug));
  const specials = all.filter((col) => !PINNED_COLLECTION_SLUGS.includes(col.slug) && !seen.has(col.slug));
  const items = [...pathways, ...specials];
  if (items.length === 0) return null;

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-2xl text-primary">Curated Pathways</h2>
        <p className="text-stone-500 mt-1 text-sm">Thematic journeys drawn from across the core collections</p>
      </div>
      <ShowMorePathways initialCount={INITIAL_PATHWAYS} totalCount={items.length}>
        {items.map((col, i) => (
          <CuratedCard key={col.slug} col={col} tenantSlug={tenantSlug} priority={i < 4} />
        ))}
      </ShowMorePathways>
    </div>
  );
}

async function AllCollectionsLink() {
  const { slug: tenantSlug } = getTenantContextFromRequest(await headers());
  const href = tenantSlug ? `/${tenantSlug}/collections/all` : '/collections/all';
  return (
    <div className="mt-10 text-center">
      <Link
        href={href}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border-light text-sm text-secondary hover:border-accent-gold/40 hover:text-primary transition-colors"
      >
        Browse the complete index of collections
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

async function TimelineSection() {
  const timeline = await fetchTimelineDecades();
  return <EraTimeline decades={timeline.decades} total={timeline.total} />;
}

function SectionSkeleton({ heading, sub }: { heading: string; sub: string }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-2xl text-primary">{heading}</h2>
        <p className="text-stone-500 mt-1 text-sm">{sub}</p>
      </div>
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl overflow-hidden">
            <div className="aspect-square bg-stone-200" />
            <div className="h-4 w-3/4 bg-stone-200 rounded mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
