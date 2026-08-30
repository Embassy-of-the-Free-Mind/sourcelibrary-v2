import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { collectionCountLabel, coverOverride } from '@/lib/collections-utils';
import type { Metadata } from 'next';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'All Collections | Source Library',
  description: 'Browse every collection and sub-collection in Source Library, organized by wing.',
  alternates: { canonical: '/collections/all' },
};

interface FeaturedImage {
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
}

interface SubCollection {
  slug: string;
  tenant_slug?: string | null;
  name: string;
  book_count: number;
  total_book_count?: number;
  artwork_count?: number;
  collection_type?: string;
  visible: boolean;
  type?: string;
  image?: string;
}

interface Wing {
  slug: string;
  tenant_slug?: string | null;
  name: string;
  book_count: number;
  total_book_count?: number;
  artwork_count?: number;
  image?: string;
  children: SubCollection[];
}

function pickImage(images?: FeaturedImage[]): string | undefined {
  if (!images?.length) return undefined;
  const img = images[0];
  return img.extracted_url || img.thumbnail_url || img.image_url;
}

async function fetchWings(): Promise<Wing[]> {
  const db = await getReadDb();

  // Get the 18 top-level wings
  const wings = await db.collection('collections').find({
    parent: { $exists: false },
    type: { $ne: 'curated' },
    collection_type: { $ne: 'visual_art' },
    visible: true,
  }).project({ slug: 1, tenantId: 1, name: 1, book_count: 1, total_book_count: 1, artwork_count: 1, hero_image: 1, featured_images: { $slice: 1 }, _id: 0 }).sort({ name: 1 }).toArray();

  // Get all subcollections with their first featured image. Only explicit
  // visible:false is excluded — hidden collections (e.g. takedowns) must not
  // be listed at all, even dimmed; missing/undefined stays public.
  const subs = await db.collection('collections').find({
    parent: { $exists: true },
    visible: { $ne: false },
  }).project({
    slug: 1, tenantId: 1, name: 1, book_count: 1, total_book_count: 1, artwork_count: 1, collection_type: 1, parent: 1, visible: 1, type: 1,
    hero_image: 1, featured_images: { $slice: 1 }, _id: 0,
  }).toArray();

  const tenantIds = [...new Set([
    ...wings.map((w: any) => w.tenantId).filter(Boolean),
    ...subs.map((s: any) => s.tenantId).filter(Boolean),
  ])];
  const tenants = tenantIds.length > 0
    ? await db.collection('tenants').find(
      { id: { $in: tenantIds }, status: { $ne: 'deleted' } },
      { projection: { _id: 0, id: 1, slug: 1 }, maxTimeMS: 5000 }
    ).toArray()
    : [];
  const tenantSlugById = new Map(tenants.map((t: any) => [t.id, t.slug]));

  // Build parent → children map
  const childMap = new Map<string, SubCollection[]>();
  for (const sub of subs) {
    const parents = Array.isArray(sub.parent) ? sub.parent : [sub.parent];
    for (const p of parents) {
      if (!childMap.has(p)) childMap.set(p, []);
      childMap.get(p)!.push({
        slug: sub.slug,
        tenant_slug: sub.tenantId ? tenantSlugById.get(sub.tenantId) || null : null,
        name: sub.name || sub.slug,
        book_count: sub.book_count || 0,
        total_book_count: sub.total_book_count,
        artwork_count: sub.artwork_count || 0,
        collection_type: sub.collection_type,
        visible: sub.visible !== false,
        type: sub.type,
        image: coverOverride(sub.slug) || sub.hero_image || pickImage(sub.featured_images),
      });
    }
  }

  // Sort children by the count their card actually shows — an art child's
  // book_count is meaningless (see collectionCountLabel), so sorting on it buried
  // 1,600-artwork collections below 20-text ones.
  const displayCount = (c: SubCollection) =>
    c.collection_type === 'visual_art' ? (c.artwork_count ?? 0) : (c.total_book_count ?? c.book_count);
  for (const kids of childMap.values()) {
    kids.sort((a, b) => displayCount(b) - displayCount(a));
  }

  return wings.map(w => ({
    slug: w.slug,
    tenant_slug: w.tenantId ? tenantSlugById.get(w.tenantId) || null : null,
    name: w.name,
    book_count: w.book_count || 0,
    total_book_count: w.total_book_count,
    artwork_count: w.artwork_count || 0,
    image: coverOverride(w.slug) || w.hero_image || pickImage(w.featured_images),
    children: childMap.get(w.slug) || [],
  }));
}

function CollectionCard({ col }: { col: SubCollection }) {
  return (
    <Link
      href={`/collections/${col.slug}`}
      className={`group relative block overflow-hidden rounded-lg aspect-[4/3] ${!col.visible ? 'opacity-40' : ''
        }`}
    >
      {col.image ? (
        <Image
          src={col.image}
          alt={col.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3">
        <p className="text-white/50 text-[10px] mb-0.5">
          {collectionCountLabel(col.total_book_count ?? col.book_count, col.artwork_count, col.collection_type) || 'Empty'}
        </p>
        <h3 className="font-serif text-xs sm:text-sm text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h3>
      </div>
    </Link>
  );
}

export default async function AllCollectionsPage() {
  const wings = await fetchWings();

  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader maxWidth="wide"
          title="All Collections"
          subtitle="Every wing and sub-collection in the library."
          image={wings.find(w => w.image)?.image}
          imageAlt="Illustration from the collection"
        />
      }
    >
      <div className="mb-6">
        <Link
          href="/collections"
          className="text-sm text-accent-rust hover:text-accent-rust/80 transition-colors"
        >
          &larr; Back to collections
        </Link>
      </div>

      <div className="space-y-12">
        {wings.map(wing => (
          <section key={wing.slug}>
            {/* Wing header */}
            <Link
              href={`/collections/${wing.slug}`}
              className="group relative block overflow-hidden rounded-xl h-36 sm:h-44 mb-4"
            >
              {wing.image ? (
                <Image
                  src={wing.image}
                  alt={wing.name}
                  fill
                  sizes="100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-r from-[#2a1f17] to-[#3d2e22]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.9)] via-[rgba(26,22,18,0.35)] to-[rgba(26,22,18,0.15)]" />
              <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
                <h2 className="font-serif text-2xl sm:text-3xl text-white font-semibold group-hover:text-accent-gold transition-colors">
                  {wing.name}
                </h2>
                <p className="text-white/50 text-sm mt-1">
                  {collectionCountLabel(wing.total_book_count ?? wing.book_count, wing.artwork_count)} · {wing.children.length} sub-collections
                </p>
              </div>
            </Link>

            {/* Subcollection cards grid */}
            {wing.children.length > 0 ? (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {wing.children.map(sub => (
                  <CollectionCard key={sub.slug} col={sub} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400 italic">No sub-collections yet</p>
            )}
          </section>
        ))}
      </div>
    </ContentPageLayout>
  );
}
