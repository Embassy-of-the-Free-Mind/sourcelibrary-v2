import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import { ARTISTS, ARTWORKS, getArtworksByArtist, type Artwork } from '@/lib/artwork-data';
import { ExternalLink, BookOpen } from 'lucide-react';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return Object.keys(ARTISTS).map(slug => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const artist = ARTISTS[slug];
  if (!artist) return { title: 'Not Found' };
  return {
    title: `${artist.name} — Source Library Visual Art`,
    description: artist.bio.slice(0, 200),
  };
}

function WorkCard({ artwork }: { artwork: Artwork }) {
  const isPortrait = artwork.aspectRatio < 1;
  return (
    <Link href={`/artwork/${artwork.slug}`} className="group block">
      <div className={`relative overflow-hidden rounded-sm bg-stone-100 ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'}`}>
        <Image
          src={artwork.imageUrl}
          alt={artwork.title}
          fill
          className="object-cover group-hover:scale-[1.03] transition-transform duration-700 ease-out"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      </div>
      <div className="mt-3">
        <h3 className="font-display text-base font-semibold leading-tight group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
          {artwork.title}
        </h3>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {artwork.date}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {artwork.medium} · {artwork.location}
        </p>
      </div>
    </Link>
  );
}

export default async function ArtistPage({ params }: PageProps) {
  const { slug } = await params;
  const artist = ARTISTS[slug];
  if (!artist) notFound();

  const artworks = getArtworksByArtist(slug);

  // Collect all unique related texts across this artist's works
  const relatedBooks = new Map<string, { title: string; author: string; slug: string; count: number }>();
  for (const artwork of artworks) {
    for (const text of artwork.relatedTexts) {
      if (text.hasTranslation && text.slug) {
        const existing = relatedBooks.get(text.slug);
        if (existing) {
          existing.count++;
        } else {
          relatedBooks.set(text.slug, { title: text.title, author: text.author, slug: text.slug, count: 1 });
        }
      }
    }
  }
  const sortedBooks = [...relatedBooks.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Hero with first artwork as background */}
      <div className="relative bg-stone-900 text-white overflow-hidden">
        {artworks[0] && (
          <div className="absolute inset-0 opacity-[0.08]">
            <Image src={artworks[0].imageUrl} alt="" fill className="object-cover" />
          </div>
        )}
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-14 sm:py-20">
          <nav className="flex items-center gap-2 text-xs text-stone-500 mb-8">
            <Link href="/artwork" className="hover:text-stone-300 transition-colors">Visual Art</Link>
            <span>/</span>
            <span className="text-stone-400">{artist.name}</span>
          </nav>

          <h1 className="font-display text-4xl sm:text-5xl font-bold">{artist.name}</h1>
          <div className="flex items-center gap-4 mt-3 text-sm text-stone-400">
            <span>{artist.nationality}</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>{artist.dates}</span>
            <span className="w-px h-4 bg-stone-700" />
            <span>{artworks.length} {artworks.length === 1 ? 'work' : 'works'}</span>
          </div>

          <div className="max-w-2xl mt-8">
            <p className="text-stone-300 leading-relaxed font-serif">{artist.bio}</p>
          </div>

          <a
            href={`https://www.wikidata.org/wiki/${artist.wikidata}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-6 text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Wikidata: {artist.wikidata}
          </a>
        </div>
      </div>

      <div className="h-px bg-stone-200" />

      {/* Related Source Library books */}
      {sortedBooks.length > 0 && (
        <div className="border-b" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}>
          <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-6">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-accent-rust" />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Related texts in Source Library</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {sortedBooks.map(book => (
                <Link
                  key={book.slug}
                  href={`/book/${book.slug}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border hover:border-accent-rust/30 transition-colors"
                  style={{ background: 'var(--bg-white)', borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}
                >
                  <span className="font-medium">{book.title}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{book.author}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Works grid */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        <h2 className="text-xl font-display font-semibold mb-8" style={{ color: 'var(--text-primary)' }}>
          Works ({artworks.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
          {artworks.map(artwork => (
            <WorkCard key={artwork.slug} artwork={artwork} />
          ))}
        </div>
      </div>
    </div>
  );
}
