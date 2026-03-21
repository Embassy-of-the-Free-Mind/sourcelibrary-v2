import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import { ARTISTS, ARTWORKS, getArtworksByArtist, type Artwork, type Artist } from '@/lib/artwork-data';

export const metadata: Metadata = {
  title: 'Visual Art — Source Library',
  description: 'Renaissance paintings and prints cross-referenced with the philosophical texts that inspired them. Botticelli, Raphael, Dürer, Fra Angelico — alongside Ficino, Plato, and Agrippa.',
};

function ArtworkThumb({ artwork }: { artwork: Artwork }) {
  const isPortrait = artwork.aspectRatio < 1;
  return (
    <Link
      href={`/artwork/${artwork.slug}`}
      className="group block"
    >
      <div className={`relative overflow-hidden rounded-sm bg-stone-100 ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'}`}>
        <Image
          src={artwork.imageUrl}
          alt={artwork.title}
          fill
          className="object-cover group-hover:scale-[1.03] transition-transform duration-700 ease-out"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        {/* Subtle dark gradient at bottom for text */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      </div>
      <div className="mt-3">
        <h3 className="font-display text-base font-semibold leading-tight group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
          {artwork.title}
        </h3>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {artwork.date} · {artwork.medium}
        </p>
      </div>
    </Link>
  );
}

function ArtistSection({ artist, artworks }: { artist: Artist; artworks: Artwork[] }) {
  return (
    <section className="mb-20 last:mb-0">
      {/* Artist header */}
      <div className="flex items-baseline justify-between mb-8 border-b pb-4" style={{ borderColor: 'var(--border-medium)' }}>
        <div>
          <Link
            href={`/artwork/artist/${artist.slug}`}
            className="group"
          >
            <h2 className="font-display text-2xl sm:text-3xl font-bold group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
              {artist.name}
            </h2>
          </Link>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {artist.nationality}, {artist.dates}
          </p>
        </div>
        <Link
          href={`/artwork/artist/${artist.slug}`}
          className="text-sm font-medium hidden sm:block transition-colors"
          style={{ color: 'var(--accent-rust)' }}
        >
          View all works &rarr;
        </Link>
      </div>

      {/* Artworks grid — asymmetric layout */}
      {artworks.length === 1 ? (
        // Single artwork: full width
        <div className="max-w-2xl">
          <ArtworkThumb artwork={artworks[0]} />
        </div>
      ) : artworks.length === 2 ? (
        // Two artworks: side by side
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          {artworks.map(a => <ArtworkThumb key={a.slug} artwork={a} />)}
        </div>
      ) : (
        // Three+: featured + grid
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Featured (first artwork, large) */}
          <div className="md:col-span-7">
            <Link href={`/artwork/${artworks[0].slug}`} className="group block">
              <div className="relative overflow-hidden rounded-sm bg-stone-100 aspect-[4/3]">
                <Image
                  src={artworks[0].imageUrl}
                  alt={artworks[0].title}
                  fill
                  className="object-cover group-hover:scale-[1.02] transition-transform duration-700 ease-out"
                  sizes="(max-width: 768px) 100vw, 58vw"
                  priority
                />
              </div>
              <div className="mt-3">
                <h3 className="font-display text-lg font-semibold group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
                  {artworks[0].title}
                </h3>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {artworks[0].date} · {artworks[0].medium}
                </p>
              </div>
            </Link>
          </div>
          {/* Remaining artworks */}
          <div className="md:col-span-5 grid grid-cols-2 md:grid-cols-1 gap-6">
            {artworks.slice(1).map(a => (
              <ArtworkThumb key={a.slug} artwork={a} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function ArtworkCollectionPage() {
  // Artist order: Botticelli first (most works), then chronologically
  const artistOrder = ['botticelli', 'fra-angelico', 'raphael', 'durer'];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Hero */}
      <div className="relative bg-stone-900 text-white overflow-hidden">
        {/* Background: subtle Birth of Venus crop */}
        <div className="absolute inset-0 opacity-[0.07]">
          <Image
            src="https://images.sourcelibrary.org/artwork-prototype/birth-of-venus.jpg"
            alt=""
            fill
            className="object-cover"
            priority
          />
        </div>
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-16 sm:py-24">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-500 mb-4 font-medium">Source Library</p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] max-w-3xl">
            Visual Art
          </h1>
          <p className="text-lg sm:text-xl text-stone-400 mt-6 max-w-2xl leading-relaxed font-serif">
            Renaissance paintings and prints alongside the philosophical texts that inspired them.
            The books you can read here — the art they produced there.
          </p>
          <div className="flex items-center gap-6 mt-8 text-sm text-stone-500">
            <span>{Object.keys(ARTWORKS).length} works</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>{Object.keys(ARTISTS).length} artists</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>All public domain</span>
          </div>
        </div>
      </div>

      {/* Intro text */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        <div className="max-w-2xl">
          <p className="text-lg leading-relaxed font-serif" style={{ color: 'var(--text-secondary)' }}>
            These texts were never separate from visual culture. Ficino&apos;s philosophy of beauty
            became Botticelli&apos;s paintings. Agrippa&apos;s theory of melancholy became Dürer&apos;s
            engravings. Source Library connects the texts to the art they inspired — something no
            museum or library currently does.
          </p>
        </div>
      </div>

      {/* Artist sections */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pb-20">
        {artistOrder.map(slug => {
          const artist = ARTISTS[slug];
          const artworks = getArtworksByArtist(slug);
          if (!artist || artworks.length === 0) return null;
          return <ArtistSection key={slug} artist={artist} artworks={artworks} />;
        })}
      </div>

      {/* Footer note */}
      <div className="border-t" style={{ borderColor: 'var(--border-light)' }}>
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            All images from Wikimedia Commons. Public domain.
            {' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/293" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              GitHub Issue #293
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
