import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Image as ImageIcon, Layers } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { getDb } from '@/lib/mongodb';
import CollectionImageCard, { CollectionImageProps } from './CollectionImageCard';

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const collection = await db.collection('gallery_collections').findOne({ slug });

  if (!collection) {
    return { title: 'Collection Not Found | Source Library' };
  }

  return {
    title: `${collection.title} | Gallery | Source Library`,
    description: collection.description as string,
    openGraph: {
      title: `${collection.title} | Source Library Gallery`,
      description: collection.description as string,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${collection.title} | Source Library Gallery`,
      description: collection.description as string,
    },
  };
}

async function getCollection(slug: string) {
  try {
    const db = await getDb();
    const collection = await db.collection('gallery_collections').findOne({ slug });
    if (!collection) return null;

    const imageIds = (collection.image_ids as string[]) || [];
    const items = await resolveImages(db, imageIds);

    return {
      title: collection.title as string,
      description: collection.description as string,
      imageCount: items.length,
      items,
    };
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveImages(db: any, imageIds: string[]): Promise<CollectionImageProps[]> {
  if (imageIds.length === 0) return [];

  const docs = await db
    .collection('gallery_images')
    .find({ id: { $in: imageIds } })
    .toArray();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docMap = new Map<string, any>(docs.map((d: any) => [d.id, d]));

  // Batch-fetch like counts for all images
  const likeDocs = await db.collection('likes').aggregate([
    { $match: { target_type: 'image', target_id: { $in: imageIds } } },
    { $group: { _id: '$target_id', count: { $sum: 1 } } },
  ]).toArray();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const likesMap = new Map<string, number>(likeDocs.map((ld: any) => [ld._id as string, ld.count as number]));

  const results: CollectionImageProps[] = [];
  for (const id of imageIds) {
    const doc = docMap.get(id);
    if (!doc) continue;
    results.push({
      id: doc.id,
      imageUrl: doc.extracted_url || doc.thumbnail_url || doc.image_url,
      bookTitle: doc.book_title || 'Unknown',
      description: doc.description || '',
      type: doc.type,
      thumbnailUrl: doc.thumbnail_url,
      extractedUrl: doc.extracted_url,
      galleryQuality: doc.gallery_quality,
      likeCount: likesMap.get(doc.id) ?? 0,
    });
  }
  return results;
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getCollection(slug);

  if (!data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <SiteHeader variant="dark" breadcrumbs={[{ label: 'Gallery', href: '/gallery' }]} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Collection description */}
        <div className="mb-8">
          <p className="text-stone-600 max-w-3xl">{data.description}</p>
        </div>

        {/* Image grid */}
        {data.items.length === 0 ? (
          <div className="text-center py-20">
            <ImageIcon className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500">This collection is empty.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.items.map((item) => (
              <CollectionImageCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
