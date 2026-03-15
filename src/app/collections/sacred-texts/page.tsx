import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import SignUpCTA from '@/components/auth/SignUpCTA';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Sacred Texts - Source Library',
  description:
    'The books humanity has called holy. Twenty-eight traditions, thousands of years, translated and freely accessible. From the Epic of Gilgamesh to the Guru Granth Sahib, from the Orphic Hymns to the Popol Vuh.',
  openGraph: {
    title: 'Sacred Texts - Source Library',
    description:
      'The books humanity has called holy. Twenty-eight traditions, thousands of years, translated and freely accessible.',
    type: 'website',
    url: 'https://sourcelibrary.org/collections/sacred-texts',
  },
  alternates: {
    canonical: '/collections/sacred-texts',
  },
};

interface TraditionCollection {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  book_count: number;
  order: number;
  sample_books: {
    id: string;
    title: string;
    author: string;
    year: number;
    thumbnail: string | null;
  }[];
  languages: { lang: string; count: number }[];
  featured_images?: {
    extracted_url?: string;
    thumbnail_url?: string;
    image_url?: string;
  }[];
}

function sanitizeThumbnail(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/api/image')) {
    const match = url.match(/[?&]url=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
    return undefined;
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Accept data: URLs (thumbnail_blob) and relative paths
  if (url.startsWith('data:') || url.startsWith('/')) return url;
  return undefined;
}

async function getTraditions(): Promise<{ traditions: TraditionCollection[]; totalBooks: number }> {
  const db = await getDb();

  const traditions = await db
    .collection('collections')
    .find({ parent: 'sacred-texts' })
    .sort({ order: 1 })
    .toArray();

  // Get the parent for total count
  const parent = await db.collection('collections').findOne({ slug: 'sacred-texts' });
  const totalBooks = parent?.book_count || traditions.reduce((sum, t) => sum + (t.book_count || 0), 0);

  return {
    traditions: traditions.map(t => ({
      slug: t.slug,
      name: t.name,
      subtitle: t.subtitle || '',
      description: t.description || '',
      book_count: t.book_count || 0,
      order: t.order || 99,
      sample_books: t.sample_books || [],
      languages: t.languages || [],
      featured_images: t.featured_images || [],
    })) as TraditionCollection[],
    totalBooks,
  };
}

function TraditionCard({ tradition }: { tradition: TraditionCollection }) {
  const heroThumb = tradition.sample_books
    .map(b => sanitizeThumbnail(b.thumbnail))
    .find((t): t is string => !!t);

  const heroImage = tradition.featured_images?.[0]?.extracted_url
    || tradition.featured_images?.[0]?.image_url
    || tradition.featured_images?.[0]?.thumbnail_url
    || heroThumb;

  const isDataUrl = heroImage?.startsWith('data:');

  return (
    <Link
      href={`/collections/${tradition.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
    >
      {heroImage ? (
        isDataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <Image
            src={heroImage}
            alt={`Illustration from ${tradition.name}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            unoptimized
          />
        )
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <p className="text-white/50 text-xs mb-1">
          {tradition.book_count} texts
        </p>
        <h2 className="font-serif text-base sm:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {tradition.name}
        </h2>
        {tradition.subtitle && (
          <p className="text-white/60 text-xs mt-1 line-clamp-1">
            {tradition.subtitle}
          </p>
        )}
      </div>
    </Link>
  );
}

export default async function SacredTextsPortal() {
  let data: { traditions: TraditionCollection[]; totalBooks: number };
  try {
    data = await getTraditions();
  } catch (err) {
    console.error('[Sacred Texts portal] Failed to load:', err instanceof Error ? err.message : err);
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-display text-primary mb-3">Temporarily Unavailable</h1>
          <p className="text-secondary mb-6">Please try again in a moment.</p>
          <Link href="/" className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }

  const { traditions, totalBooks } = data;
  const traditionsWithBooks = traditions.filter(t => t.book_count > 0);

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero */}
      <div className="bg-dark">
        <div className="max-w-6xl mx-auto px-6 pt-8 pb-14 sm:pb-16">
          <Link
            href="/#library"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-10"
          >
            <ArrowLeft className="w-4 h-4" />
            Library
          </Link>

          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-4 font-display">
            Sacred Texts
          </h1>

          <p className="text-lg sm:text-xl text-white/60 max-w-2xl leading-relaxed mb-8">
            The books humanity has called holy. Translated and freely accessible.
          </p>

          <div className="flex flex-wrap gap-8 text-sm text-white/40">
            <div>
              <span className="text-2xl font-semibold text-white/80 block">{totalBooks.toLocaleString()}</span>
              texts
            </div>
            <div>
              <span className="text-2xl font-semibold text-white/80 block">{traditionsWithBooks.length}</span>
              traditions
            </div>
          </div>
        </div>
      </div>

      {/* Traditions grid */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {traditionsWithBooks.map(tradition => (
            <TraditionCard key={tradition.slug} tradition={tradition} />
          ))}
        </div>

        {/* A note on non-exclusivity */}
        <div className="mt-12 max-w-2xl mx-auto text-center">
          <p className="text-sm text-muted leading-relaxed">
            Many texts belong to more than one tradition. Source Library does not claim
            exclusive ownership of any text for any single tradition — boundaries between
            traditions are porous, and always have been.
          </p>
        </div>
      </div>

      <SignUpCTA />
    </div>
  );
}
