import Link from 'next/link';
import Image from 'next/image';

interface FeaturedImage {
  id: string;
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
}

export interface CollectionSummary {
  slug: string;
  name: string;
  subtitle: string;
  book_count: number;
  featured_images?: FeaturedImage[];
  languages?: { lang: string; count: number }[];
}

function CollectionCard({ col, size }: { col: CollectionSummary; size: 'large' | 'small' }) {
  const hero = col.featured_images?.find(
    img => img.extracted_url || img.thumbnail_url || img.image_url
  );
  const heroUrl = hero?.extracted_url || hero?.thumbnail_url || hero?.image_url;
  const topLangs = (col.languages || []).slice(0, 3).map(l => l.lang).join(', ');

  return (
    <Link
      href={`/?collection=${col.slug}#library`}
      className={`group relative block overflow-hidden rounded-lg ${
        size === 'large' ? 'aspect-[4/3]' : 'aspect-[3/2]'
      }`}
    >
      {heroUrl ? (
        <Image
          src={heroUrl}
          alt={`Illustration from ${col.name}`}
          fill
          sizes={size === 'large' ? '(max-width: 640px) 100vw, 50vw' : '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'}
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
        <h3 className={`font-serif text-white font-semibold leading-tight ${
          size === 'large' ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
        }`}>
          {col.name}
        </h3>
        {col.subtitle && (
          <p className={`mt-1 text-white/70 line-clamp-2 leading-snug ${
            size === 'large' ? 'text-sm' : 'text-xs sm:text-sm'
          }`}>
            {col.subtitle}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function CollectionsShowcase({ collections }: { collections: CollectionSummary[] }) {
  // Top 6 as large cards, rest as smaller
  const topCollections = collections.slice(0, 6);
  const moreCollections = collections.slice(6);

  return (
    <div>
      {/* Top collections — 2-col grid */}
      <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2">
        {topCollections.map((col) => (
          <CollectionCard key={col.slug} col={col} size="large" />
        ))}
      </div>

      {/* Remaining collections — 3-col grid */}
      {moreCollections.length > 0 && (
        <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-4 sm:mt-5">
          {moreCollections.map((col) => (
            <CollectionCard key={col.slug} col={col} size="small" />
          ))}
        </div>
      )}

      {/* Browse all link */}
      <div className="mt-6 text-center">
        <Link
          href="/collections"
          className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          View all collections
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
