import Link from 'next/link';
import Image from 'next/image';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const revalidate = 86400;

export const metadata = {
  title: 'Collection Areas — Bibliotheca Philosophica Hermetica',
  robots: { index: false, follow: false },
};

interface FeaturedImage {
  id: string;
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
}

interface CollectionDoc {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  featured_images?: FeaturedImage[];
  bph_count: number;
}

/**
 * Fetch collections that contain at least one BPH book.
 */
async function fetchBPHCollections(): Promise<CollectionDoc[]> {
  const db = await getReadDb();

  const collections = await db.collection('collections').find({
    parent: { $exists: false },
    type: { $ne: 'curated' },
    collection_type: { $ne: 'visual_art' },
    visible: true,
  }).toArray();

  // Count BPH books in each collection
  const books = db.collection('books');
  const withCounts: CollectionDoc[] = [];

  for (const col of collections) {
    const count = await books.countDocuments({
      held_by: 'bph',
      visible: true,
      pages_count: { $gt: 0 },
      categories: col.slug,
    });
    if (count > 0) {
      withCounts.push({
        slug: col.slug as string,
        name: col.name as string,
        subtitle: col.subtitle as string,
        description: col.description as string,
        featured_images: col.featured_images as FeaturedImage[] | undefined,
        bph_count: count,
      });
    }
  }

  // Sort by count descending
  return withCounts.sort((a, b) => b.bph_count - a.bph_count);
}

/**
 * BPH embed collections — same design as the main collections page,
 * but filtered to only show collections containing BPH books.
 * Links point to /embed/bph/collections/[slug] to stay in embed namespace.
 */
export default async function EmbedCollectionsPage() {
  const collections = await fetchBPHCollections();

  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader
          title="Collection Areas"
          subtitle="Browse the Bibliotheca Philosophica Hermetica by subject area"
        />
      }
    >
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {collections.map((col, i) => {
          const hero = col.featured_images?.find(
            img => img.thumbnail_url || img.extracted_url
          ) || col.featured_images?.find(
            img => img.image_url
          );
          const raw = hero?.extracted_url || hero?.thumbnail_url || hero?.image_url;
          const heroUrl = sanitizeThumbnail(raw);

          return (
            <Link
              key={col.slug}
              href={`/embed/bph/collections/${col.slug}`}
              className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
            >
              {heroUrl ? (
                <Image
                  src={heroUrl}
                  alt={`Illustration from ${col.name}`}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  unoptimized
                  priority={i < 10}
                  loading={i < 10 ? 'eager' : 'lazy'}
                />
              ) : (
                <div className="absolute inset-0 bg-warm" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
                <p className="text-white/50 text-[11px] mb-1 hidden sm:block">
                  {col.bph_count.toLocaleString()} books
                </p>
                <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
                  {col.name}
                </h2>
              </div>
            </Link>
          );
        })}
      </div>
    </ContentPageLayout>
  );
}
