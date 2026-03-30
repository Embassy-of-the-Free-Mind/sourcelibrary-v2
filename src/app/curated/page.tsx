import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { sanitizeThumbnail } from '@/lib/collections-utils';
import type { Metadata } from 'next';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Curated Collections | Source Library',
  description:
    'Thematic exhibitions across the library, stories that cut across traditions and centuries.',
  alternates: { canonical: '/curated' },
  openGraph: {
    title: 'Curated Collections | Source Library',
    description:
      'Thematic exhibitions across the library, stories that cut across traditions and centuries.',
    type: 'website',
  },
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

interface CuratedCollection {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  published: boolean;
  book_count: number;
  featured_images?: FeaturedImage[];
}

function getHeroImage(col: CuratedCollection): string | undefined {
  const hero = col.featured_images?.find(
    (img) => img.extracted_url || img.image_url || img.thumbnail_url,
  );
  const raw = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url;
  return sanitizeThumbnail(raw);
}

async function fetchCuratedCollections() {
  const db = await getDb();
  const docs = await db
    .collection('collections')
    .find({ type: 'curated' })
    .sort({ published: -1, book_count: -1, name: 1 })
    .toArray();

  const all = docs.map(({ _id, ...rest }) => rest) as unknown as CuratedCollection[];
  const published = all.filter((c) => c.published);
  const upcoming = all.filter((c) => !c.published);
  return { published, upcoming };
}

function PublishedCard({ col }: { col: CuratedCollection }) {
  const heroUrl = getHeroImage(col);

  return (
    <Link
      href={`/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-xl aspect-[3/2]"
    >
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
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
        <h2 className="font-serif text-xl sm:text-2xl text-white font-semibold leading-tight mb-1.5 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h2>
        {col.subtitle && (
          <p className="text-sm sm:text-base text-white/70 leading-relaxed line-clamp-2 mb-2">
            {col.subtitle}
          </p>
        )}
        {col.description && (
          <p className="text-xs sm:text-sm text-white/50 leading-relaxed line-clamp-2 hidden sm:block">
            {col.description.slice(0, 180)}
            {col.description.length > 180 ? '...' : ''}
          </p>
        )}
        {col.book_count > 0 && (
          <p className="text-xs text-white/40 mt-2">
            {col.book_count.toLocaleString()} books
          </p>
        )}
      </div>
    </Link>
  );
}

function ComingSoonCard({ col }: { col: CuratedCollection }) {
  return (
    <div className="p-4 rounded-lg border border-border-light bg-white/60 opacity-70">
      <h3 className="font-display text-base text-primary/70 leading-snug mb-1">
        {col.name}
      </h3>
      {col.subtitle && (
        <p className="text-sm text-muted leading-relaxed line-clamp-2">
          {col.subtitle}
        </p>
      )}
    </div>
  );
}

export default async function CuratedCollectionsPage() {
  const { published, upcoming } = await fetchCuratedCollections();

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />
      {/* Hero */}
      <div className="bg-warm border-b border-border-light">
        <div className="max-w-7xl mx-auto px-6 pt-8 pb-10 sm:pb-12">
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-primary font-semibold leading-tight mb-3 font-display">
            Curated Collections
          </h1>
          <p className="text-lg sm:text-xl text-secondary max-w-3xl leading-relaxed">
            Thematic exhibitions across the library, stories that cut across
            traditions and centuries.
          </p>
        </div>
      </div>

      {/* Published collections */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        {published.length > 0 && (
          <div className="mb-14">
            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2">
              {published.map((col) => (
                <PublishedCard key={col.slug} col={col} />
              ))}
            </div>
          </div>
        )}

        {/* Coming Soon */}
        {upcoming.length > 0 && (
          <div>
            <h2 className="font-display text-2xl text-primary mb-1">Coming Soon</h2>
            <p className="text-sm text-muted mb-5">
              These collections are being researched and assembled. Check back soon.
            </p>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {upcoming.map((col) => (
                <ComingSoonCard key={col.slug} col={col} />
              ))}
            </div>
          </div>
        )}
      </div>

      <SignUpCTA />
    </div>
  );
}
