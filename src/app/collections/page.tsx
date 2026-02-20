import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Collections | Source Library',
  description: 'Browse 5,000+ historical texts organized into thematic collections — Western esotericism, classical philosophy, sacred texts, and more.',
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

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
        {collections.map((col) => {
          const hero = col.featured_images?.find(
            img => img.thumbnail_url || img.extracted_url || img.image_url
          );
          // Prefer thumbnail (smaller) for card display — extracted_url can be 2MB+
          const heroUrl = hero?.thumbnail_url || hero?.extracted_url || hero?.image_url;
          const topLangs = (col.languages || []).slice(0, 3).map(l => l.lang).join(', ');

          return (
            <Link
              key={col.slug}
              href={`/?collection=${col.slug}#library`}
              className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
            >
              {/* Hero image */}
              {heroUrl ? (
                <Image
                  src={heroUrl}
                  alt={`Illustration from ${col.name}`}
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 bg-warm" />
              )}

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.92)] via-[rgba(26,22,18,0.4)] to-transparent" />

              {/* Content */}
              <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 text-xs text-white/80 bg-white/15 backdrop-blur-sm rounded-full">
                    {col.book_count.toLocaleString()} books
                  </span>
                  {topLangs && (
                    <span className="text-xs text-white/50">
                      {topLangs}
                    </span>
                  )}
                </div>
                <h2 className="font-serif text-xl sm:text-2xl text-white font-semibold leading-tight">
                  {col.name}
                </h2>
                <p className="mt-1 text-sm text-white/70 line-clamp-2 leading-snug">
                  {col.subtitle}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </ContentPageLayout>
  );
}
