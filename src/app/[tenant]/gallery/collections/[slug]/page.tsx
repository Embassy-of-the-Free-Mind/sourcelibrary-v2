import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { resolveGalleryCollectionImages } from '@/lib/gallery-collection-resolver';
import CollectionImageCard from './CollectionImageCard';

export const revalidate = 86400;

interface PageProps {
  params: Promise<{ slug: string }>;
}

const getCollectionData = cache(async (slug: string) => {
  try {
    const db = await getReadDb();
    const collection = await db.collection('gallery_collections').findOne(
      { slug },
      { projection: { title: 1, description: 1, image_ids: 1 } }
    );
    if (!collection) return null;

    const imageIds = (collection.image_ids as string[]) || [];
    const items = await resolveGalleryCollectionImages(db, imageIds);

    return {
      title: collection.title as string,
      description: collection.description as string,
      imageCount: items.length,
      items,
    };
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCollectionData(slug);

  if (!data) {
    return { title: 'Collection Not Found | Source Library' };
  }

  return {
    title: `${data.title} | Gallery | Source Library`,
    description: data.description,
    alternates: { canonical: `/gallery/collections/${slug}` },
    openGraph: {
      title: `${data.title} | Source Library Gallery`,
      description: data.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${data.title} | Source Library Gallery`,
      description: data.description,
    },
  };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getCollectionData(slug);

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
            {data.items.map((item, i) => (
              <CollectionImageCard key={item.id} item={item} priority={i < 6} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
