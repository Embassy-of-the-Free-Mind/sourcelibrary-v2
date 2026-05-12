import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getReadDb } from '@/lib/mongodb';
import SiteHeader from '@/components/layout/SiteHeader';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const metadata: Metadata = {
  title: 'Visual Art — Source Library',
  description: 'Over 23,000 works of art cross-referenced with the texts that inspired them — from Egyptian papyri and Tibetan thangka to Renaissance prints and Edo-period woodcuts.',
};

export const revalidate = false;

interface ArtCollection {
  slug: string;
  name: string;
  subtitle?: string;
  color?: string;
  book_count: number;
  featured_images?: ({ extracted_url?: string; thumbnail_url?: string; image_url?: string } | string)[];
}

function pickArtCardImage(images: ArtCollection['featured_images']): string | undefined {
  if (!images?.length) return undefined;
  const first = images[0];
  if (typeof first === 'string') return first;
  return first.thumbnail_url || first.extracted_url || first.image_url;
}

async function getData() {
  const db = await getReadDb();

  const collections = await db.collection('collections')
    .find({ collection_type: 'visual_art', visible: true })
    .sort({ order: 1 })
    .project({ _id: 0, slug: 1, name: 1, subtitle: 1, color: 1, book_count: 1, featured_images: 1 })
    .toArray() as ArtCollection[];

  const totalCount = collections.reduce((sum, c) => sum + (c.book_count || 0), 0);

  return { collections, totalCount };
}

export default async function ArtworkLandingPage() {
  const { collections, totalCount } = await getData();

  // Split into featured (first 3 with images) and the rest
  const featured = collections.filter(c => c.featured_images?.[0]).slice(0, 3);
  const remaining = collections.filter(c => !featured.includes(c));

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Hero */}
      <div className="relative bg-stone-900 text-white overflow-hidden">
        {/* Subtle background mosaic from first collection images */}
        <div className="absolute inset-0 opacity-[0.06]">
          <div className="grid grid-cols-4 h-full">
            {collections.slice(0, 4).map((col) => {
              const img = sanitizeThumbnail(pickArtCardImage(col.featured_images) || '');
              return img ? (
                <div key={col.slug} className="relative">
                  <Image src={img as string} alt="" fill className="object-cover" sizes="25vw" />
                </div>
              ) : <div key={col.slug} />;
            })}
          </div>
        </div>

        <div className="relative max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-20 sm:py-32">
          <p className="text-xs uppercase tracking-[0.25em] text-accent-gold/70 mb-6 font-medium">Source Library</p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] max-w-3xl">
            Visual Art
          </h1>
          <p className="text-lg sm:text-xl text-stone-400 mt-6 max-w-2xl leading-relaxed font-serif">
            Paintings, prints, sculptures, and manuscripts from antiquity to the nineteenth century — cross-referenced with the texts that inspired them.
          </p>
          <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-stone-500">
            <span className="font-medium text-stone-400">{totalCount.toLocaleString('en-US')} works</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>{collections.length} collections</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>All public domain</span>
          </div>
        </div>
      </div>

      {/* Featured collections — large cards */}
      {featured.length > 0 && (
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pt-16 pb-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {featured.map((col, i) => {
              const img = sanitizeThumbnail(pickArtCardImage(col.featured_images) || '');
              return (
                <Link
                  key={col.slug}
                  href={`/collections/${col.slug}`}
                  className={`group relative overflow-hidden rounded-lg bg-stone-200 ${i === 0 ? 'lg:col-span-2 aspect-[16/9]' : 'aspect-[4/3]'}`}
                >
                  {img && (
                    <Image
                      src={img as string}
                      alt=""
                      fill
                      className="object-cover group-hover:scale-[1.03] transition-transform duration-700"
                      sizes={i === 0 ? '(max-width: 1024px) 100vw, 66vw' : '(max-width: 1024px) 100vw, 33vw'}
                      priority
                     
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <div className="absolute bottom-0 inset-x-0 p-6">
                    <p className="text-white/50 text-xs uppercase tracking-wider mb-2">{col.book_count} works</p>
                    <h2 className="text-white font-display font-semibold text-2xl leading-tight group-hover:text-accent-gold transition-colors">
                      {col.name}
                    </h2>
                    {col.subtitle && <p className="text-white/70 text-sm mt-2 font-serif">{col.subtitle}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* All collections grid */}
      {remaining.length > 0 && (
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {remaining.map((col) => {
              const img = sanitizeThumbnail(pickArtCardImage(col.featured_images) || '');
              return (
                <Link
                  key={col.slug}
                  href={`/collections/${col.slug}`}
                  className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-stone-200"
                >
                  {img && (
                    <Image
                      src={img as string}
                      alt=""
                      fill
                      className="object-cover group-hover:scale-[1.03] transition-transform duration-700"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                     
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 inset-x-0 p-4">
                    <p className="text-white/50 text-xs mb-1">{col.book_count} works</p>
                    <h3 className="text-white font-display font-semibold text-base leading-tight group-hover:text-accent-gold transition-colors">
                      {col.name}
                    </h3>
                    {col.subtitle && <p className="text-white/60 text-xs mt-1 line-clamp-1">{col.subtitle}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer attribution */}
      <div className="border-t" style={{ borderColor: 'var(--border-light)' }}>
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Images from the Metropolitan Museum of Art, Rijksmuseum, Wikimedia Commons, and other public collections. All works are in the public domain.
          </p>
        </div>
      </div>
    </div>
  );
}
