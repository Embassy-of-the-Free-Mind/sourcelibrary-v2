import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Collections | Source Library',
  description: 'Browse thousands of historical texts organized into thematic collections — Western esotericism, classical philosophy, sacred texts, and more.',
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
  featured_images?: FeaturedImage[];
  languages: { lang: string; count: number }[];
}

async function fetchCollections(): Promise<CollectionDoc[]> {
  const db = await getDb();
  const docs = await db.collection('collections').find({}).sort({ order: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => rest) as unknown as CollectionDoc[];
}

export default async function CollectionsPage() {
  const collections = await fetchCollections();
  const totalBooks = collections.reduce((s, c) => s + c.book_count, 0);

  return (
    <ContentPageLayout>
      <ContentHeader
        title="Collections"
        subtitle={`${totalBooks.toLocaleString()} books organized into ${collections.length} thematic collections spanning three millennia of human knowledge.`}
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {collections.map((col) => {
          const hero = col.featured_images?.find(
            img => img.extracted_url || img.image_url || img.thumbnail_url
          );
          const heroUrl = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url;
          const topLangs = (col.languages || []).slice(0, 3).map(l => l.lang).join(', ');

          return (
            <Link
              key={col.slug}
              href={`/collections/${col.slug}`}
              className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
            >
              {/* Hero image */}
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

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Content */}
              <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
                <p className="text-white/50 text-xs mb-1 hidden sm:block">
                  {col.book_count.toLocaleString()} books
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
