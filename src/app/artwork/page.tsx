import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getDb } from '@/lib/mongodb';
import SiteHeader from '@/components/layout/SiteHeader';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const metadata: Metadata = {
  title: 'Visual Art — Source Library',
  description: 'Renaissance paintings and prints cross-referenced with the philosophical texts that inspired them.',
};

export const dynamic = 'force-dynamic';

interface ArtCollection {
  slug: string;
  name: string;
  subtitle?: string;
  color?: string;
  book_count: number;
  featured_images?: { extracted_url?: string; thumbnail_url?: string; image_url?: string }[];
}

interface ArtistSummary {
  name: string;
  count: number;
  sampleThumb?: string;
  sampleSlug?: string;
}

async function getData() {
  const db = await getDb();

  const [collections, artistsRaw, totalCount] = await Promise.all([
    // Art collections (visible ones)
    db.collection('collections')
      .find({ collection_type: 'visual_art', hidden: { $ne: true } })
      .sort({ order: 1 })
      .project({ _id: 0, slug: 1, name: 1, subtitle: 1, color: 1, book_count: 1, featured_images: 1 })
      .toArray() as Promise<ArtCollection[]>,

    // Top artists by count
    db.collection('books').aggregate([
      { $match: { resource_type: { $exists: true }, hidden: { $ne: true } } },
      { $group: {
        _id: '$author',
        count: { $sum: 1 },
        sampleThumb: { $first: '$thumbnail' },
        sampleSlug: { $first: '$slug' },
      }},
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]).toArray(),

    // Total visible artworks
    db.collection('books').countDocuments({ resource_type: { $exists: true }, hidden: { $ne: true } }),
  ]);

  const artists: ArtistSummary[] = artistsRaw.map(a => ({
    name: a._id as string,
    count: a.count as number,
    sampleThumb: a.sampleThumb as string | undefined,
    sampleSlug: a.sampleSlug as string | undefined,
  }));

  return { collections, artists, totalCount };
}

export default async function ArtworkLandingPage() {
  const { collections, artists, totalCount } = await getData();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Hero */}
      <div className="relative bg-stone-900 text-white overflow-hidden">
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-16 sm:py-24">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-500 mb-4 font-medium">Source Library</p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] max-w-3xl">
            Visual Art
          </h1>
          <p className="text-lg sm:text-xl text-stone-400 mt-6 max-w-2xl leading-relaxed font-serif">
            Renaissance paintings and prints alongside the philosophical texts that inspired them.
          </p>
          <div className="flex items-center gap-6 mt-8 text-sm text-stone-500">
            <span>{totalCount.toLocaleString()} works</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>{artists.length} artists</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>{collections.length} collections</span>
          </div>
        </div>
      </div>

      {/* Collections */}
      {collections.length > 0 && (
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
          <h2 className="text-2xl font-display font-semibold mb-8" style={{ color: 'var(--text-primary)' }}>Collections</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {collections.map(col => (
              <Link
                key={col.slug}
                href={`/collections/${col.slug}`}
                className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-stone-200"
              >
                {col.featured_images?.[0] && sanitizeThumbnail(col.featured_images[0].extracted_url || col.featured_images[0].thumbnail_url || col.featured_images[0].image_url || '') && (
                  <Image
                    src={sanitizeThumbnail(col.featured_images[0].extracted_url || col.featured_images[0].thumbnail_url || col.featured_images[0].image_url || '') as string}
                    alt=""
                    fill
                    className="object-cover group-hover:scale-[1.03] transition-transform duration-700"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-4">
                  <p className="text-white/60 text-xs mb-1">{col.book_count} works</p>
                  <h3 className="text-white font-display font-semibold text-lg leading-tight group-hover:text-accent-gold transition-colors">
                    {col.name}
                  </h3>
                  {col.subtitle && <p className="text-white/70 text-sm mt-1">{col.subtitle}</p>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Artists */}
      {artists.length > 0 && (
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
          <h2 className="text-2xl font-display font-semibold mb-8" style={{ color: 'var(--text-primary)' }}>Artists</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {artists.map(artist => (
              <Link
                key={artist.name}
                href={`/artwork/artist/${artist.name.replace(/\s+/g, '-')}`}
                className="group flex items-center gap-3 p-3 rounded-lg border hover:border-accent-rust/30 transition-colors"
                style={{ borderColor: 'var(--border-light)' }}
              >
                {artist.sampleThumb && sanitizeThumbnail(artist.sampleThumb) && (
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-stone-200 flex-shrink-0">
                    <Image
                      src={sanitizeThumbnail(artist.sampleThumb) as string}
                      alt=""
                      width={40}
                      height={40}
                      className="object-cover w-full h-full"
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
                    {artist.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{artist.count} works</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t" style={{ borderColor: 'var(--border-light)' }}>
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Images from Wikimedia Commons. Public domain.
          </p>
        </div>
      </div>
    </div>
  );
}
