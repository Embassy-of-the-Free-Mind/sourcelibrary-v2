import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, Layers } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Curated Collections | Gallery | Source Library',
  description: 'Thematic collections of illustrations from rare alchemical, Hermetic, and philosophical manuscripts: woodcuts, engravings, emblems, and diagrams spanning five centuries.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Curated Image Collections | Source Library',
    description: 'Thematic collections of illustrations from rare historical manuscripts.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Curated Image Collections | Source Library',
    description: 'Thematic collections of illustrations from rare historical manuscripts.',
  },
};

interface CollectionListItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageCount: number;
  featured: boolean;
  coverImage: { url: string; description: string } | null;
}

async function getCollections(): Promise<CollectionListItem[]> {
  try {
    const db = await getReadDb();

    const collections = await db
      .collection('gallery_collections')
      // Hide collections with no resolvable cover (their backing gallery_images
      // were deleted) — flagged `hidden: true` by backfill-gallery-collection-covers.mjs.
      .find({ hidden: { $ne: true } }, { projection: { id: 1, slug: 1, title: 1, description: 1, image_ids: 1, featured: 1, cover_image_id: 1 } })
      .sort({ sort_order: 1, created_at: -1 })
      .toArray();

    // Collect all candidate image IDs: cover_image_id + first image_id as fallback
    const allCandidateIds = new Set<string>();
    for (const c of collections) {
      if (c.cover_image_id) allCandidateIds.add(c.cover_image_id as string);
      const ids = c.image_ids as string[] | undefined;
      if (ids?.[0]) allCandidateIds.add(ids[0]);
    }

    const coverImages = await resolveCoverImages(db, [...allCandidateIds]);

    return collections.map((c) => {
      const ids = c.image_ids as string[] | undefined;
      const coverImage = coverImages.get(c.cover_image_id as string)
        || (ids?.[0] ? coverImages.get(ids[0]) : null)
        || null;
      return {
        id: c.id as string,
        slug: c.slug as string,
        title: c.title as string,
        description: c.description as string,
        imageCount: ids?.length || 0,
        featured: c.featured as boolean,
        coverImage,
      };
    });
  } catch {
    // DB unavailable (e.g. build time) — return empty list
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveCoverImages(db: any, imageIds: string[]) {
  if (imageIds.length === 0) return new Map<string, { url: string; description: string }>();

  // Resolve from gallery_images (always populated, unlike pages.detected_images)
  const docs = await db
    .collection('gallery_images')
    .find(
      { id: { $in: imageIds } },
      { projection: { id: 1, extracted_url: 1, thumbnail_url: 1, image_url: 1, description: 1 } }
    )
    .toArray();

  const result = new Map<string, { url: string; description: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of docs as any[]) {
    // Fall back to image_url (full archived page) — some gallery_images have
    // only image_url populated, which would otherwise render a blank cover.
    result.set(doc.id, {
      url: doc.extracted_url || doc.thumbnail_url || doc.image_url || '',
      description: doc.description || '',
    });
  }

  return result;
}

export default async function CollectionsPage() {
  const collections = await getCollections();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Gallery', href: '/gallery' }]} />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Intro */}
        <div className="text-center mb-10">
          <h2 className="text-2xl font-serif text-stone-800 mb-2">Curated Image Collections</h2>
          <p className="text-stone-500 max-w-2xl mx-auto">
            Thematic collections of illustrations drawn from rare alchemical, Hermetic, and philosophical manuscripts.
          </p>
        </div>

        {collections.length === 0 && (
          <div className="text-center py-20">
            <Layers className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500">No collections yet.</p>
          </div>
        )}

        {collections.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {collections.map((collection) => (
              <Link
                key={collection.id}
                href={`/gallery/collections/${collection.slug}`}
                className="group relative rounded-xl overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5 aspect-[4/3]"
              >
                {collection.coverImage?.url ? (
                  <Image
                    src={collection.coverImage.url}
                    alt={collection.coverImage.description || collection.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    unoptimized
                  />
                ) : (
                  <div className="absolute inset-0 bg-stone-200 flex items-center justify-center text-stone-400">
                    <ImageIcon className="w-12 h-12" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="font-serif text-lg text-white group-hover:text-accent-gold transition-colors">
                    {collection.title}
                  </h3>
                  <p className="text-white/70 text-sm mt-1 line-clamp-2">
                    {collection.description}
                  </p>
                  <p className="text-white/50 text-xs mt-2">
                    {collection.imageCount} {collection.imageCount === 1 ? 'image' : 'images'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
