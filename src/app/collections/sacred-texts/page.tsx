import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Sacred Texts - Source Library',
  description:
    'The foundational scriptures of the world\'s spiritual traditions, from the Vedas and Upanishads to the Bible and Quran, from Sumerian hymns to Buddhist sutras and Zoroastrian texts.',
  openGraph: {
    title: 'Sacred Texts - Source Library',
    description:
      'The foundational scriptures of the world\'s spiritual traditions, from Sumerian hymns to the Vedas, Bible, Quran, and beyond.',
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
  scripture_count: number;
  order: number;
  hero_image: string | null;
}

async function getTraditions(): Promise<{ traditions: TraditionCollection[]; totalBooks: number }> {
  const db = await Promise.race([
    getDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 10000)),
  ]);

  const traditions = await db
    .collection('collections')
    .find({ parent: 'sacred-texts', visible: true })
    .sort({ order: 1 })
    .toArray();

  // For each tradition, count scripture/commentary books and find a hero image
  const enriched: TraditionCollection[] = await Promise.all(
    traditions.map(async (t) => {
      // Count books that are scripture or canonical commentary
      const scriptureCount = await db.collection('books').countDocuments({
        collections: t.slug,
        'sacred_text_type.type': { $in: ['scripture', 'canonical_commentary', 'liturgical'] },
        visible: true,
        pages_count: { $gt: 0 },
        pages_translated: { $gt: 0 },
      });

      // Find a hero image: best gallery image from this tradition's books
      let heroImage: string | null = null;

      // Try gallery images first
      const traditionBooks = await db.collection('books')
        .find({ collections: t.slug, visible: true }, { projection: { id: 1 } })
        .limit(50)
        .toArray();
      const bookIds = traditionBooks.map(b => b.id);

      if (bookIds.length > 0) {
        const galleryImg = await db.collection('gallery_images')
          .findOne(
            {
              book_id: { $in: bookIds },
              gallery_quality: { $gte: 0.7 },
              type: { $nin: ['decorative', 'symbol', 'printer_device', 'printer_mark', 'ornament', 'border'] },
            },
            { sort: { gallery_quality: -1 } },
          );
        if (galleryImg) {
          heroImage = galleryImg.extracted_url || galleryImg.thumbnail_url || galleryImg.image_url || null;
        }
      }

      // Fallback to book thumbnail
      if (!heroImage && bookIds.length > 0) {
        const bookWithThumb = await db.collection('books')
          .findOne(
            { id: { $in: bookIds }, thumbnail: { $exists: true, $ne: null, $not: /^data:/ } },
            { projection: { thumbnail: 1 } },
          );
        if (bookWithThumb) {
          heroImage = sanitizeThumbnail(bookWithThumb.thumbnail) || null;
        }
      }

      return {
        slug: t.slug,
        name: t.name,
        subtitle: t.subtitle || '',
        description: t.description || '',
        book_count: t.book_count || 0,
        scripture_count: scriptureCount,
        order: t.order || 99,
        hero_image: heroImage,
      };
    }),
  );

  // Total across all traditions (scripture + commentary only)
  const totalBooks = enriched.reduce((sum, t) => sum + t.scripture_count, 0);

  return { traditions: enriched, totalBooks };
}

function TraditionCard({ tradition }: { tradition: TraditionCollection }) {
  const heroImage = tradition.hero_image;

  return (
    <Link
      href={`/collections/${tradition.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
    >
      {heroImage ? (
        <Image
          src={heroImage}
          alt={`Illustration from ${tradition.name}`}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />

      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
        <p className="text-white/50 text-xs mb-1 hidden sm:block">
          {tradition.scripture_count > 0
            ? `${tradition.scripture_count} core texts`
            : `${tradition.book_count} texts`}
        </p>
        <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {tradition.name}
        </h2>
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
  const traditionsWithBooks = traditions
    .filter(t => t.book_count > 0)
    .sort((a, b) => b.scripture_count - a.scripture_count || b.book_count - a.book_count);

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero */}
      <div className="bg-dark">
        <div className="max-w-7xl mx-auto px-6 pt-8 pb-14 sm:pb-16">
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
            The foundational scriptures of the world&rsquo;s spiritual traditions, from Sumerian hymns to the Vedas, Bible, Quran, and beyond.
          </p>

          <div className="flex flex-wrap gap-8 text-sm text-white/40">
            <div>
              <span className="text-2xl font-semibold text-white/80 block">{totalBooks.toLocaleString()}</span>
              core texts
            </div>
            <div>
              <span className="text-2xl font-semibold text-white/80 block">{traditionsWithBooks.length}</span>
              traditions
            </div>
          </div>
        </div>
      </div>

      {/* Traditions grid */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {traditionsWithBooks.map(tradition => (
            <TraditionCard key={tradition.slug} tradition={tradition} />
          ))}
        </div>

        {/* A note on scope */}
        <div className="mt-12 max-w-2xl mx-auto text-center">
          <p className="text-sm text-muted leading-relaxed">
            Each tradition page collects its foundational scriptures and core commentaries, not
            every text produced within that tradition. Broader theological, philosophical, and
            mystical works appear in their own collections across the library.
          </p>
        </div>
      </div>

      <SignUpCTA />
    </div>
  );
}
