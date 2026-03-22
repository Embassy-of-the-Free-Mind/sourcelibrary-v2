import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import ArtworkHero from '@/components/artwork/ArtworkHero';
import { ARTWORKS, ARTISTS, getArtworksByArtist, type Artwork, type IconographicElement, type RelatedText } from '@/lib/artwork-data';
import { Calendar, MapPin, Ruler, Palette, ExternalLink, BookOpen, Heart, Share2, Quote, ArrowLeft, ArrowRight } from 'lucide-react';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return Object.keys(ARTWORKS).map(slug => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const artwork = ARTWORKS[slug];
  if (!artwork) return { title: 'Not Found' };
  const artist = ARTISTS[artwork.artistSlug];
  return {
    title: `${artwork.title} — ${artist.name} — Source Library`,
    description: artwork.description.slice(0, 200),
    openGraph: {
      title: `${artwork.title} by ${artist.name}`,
      description: artwork.description.slice(0, 200),
      images: [artwork.imageUrl],
    },
  };
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = { painting: 'Painting', print: 'Print', drawing: 'Drawing', fresco: 'Fresco', emblem: 'Emblem' };
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border bg-white/10 border-white/20 text-stone-300">
      {labels[type] || type}
    </span>
  );
}

function IconographySection({ items }: { items: IconographicElement[] }) {
  return (
    <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
      {items.map((item, i) => (
        <div key={i} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-col sm:flex-row sm:gap-6">
            <div className="sm:w-44 flex-shrink-0 mb-1 sm:mb-0">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.element}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.significance}</p>
              {item.relatedBookSlug && (
                <Link href={`/book/${item.relatedBookSlug}`} className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-accent-rust hover:text-accent-gold-dark transition-colors">
                  <BookOpen className="w-3 h-3" />
                  Read the source text &rarr;
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RelatedTextCard({ text, index }: { text: RelatedText; index: number }) {
  return (
    <div className="flex gap-4 p-5 rounded-lg transition-colors" style={{ background: 'var(--bg-warm)' }}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-accent-rust text-white">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{text.title}</h4>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{text.author}, {text.year}</p>
          </div>
          {text.hasTranslation && text.slug && (
            <Link
              href={`/book/${text.slug}`}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Read Translation
            </Link>
          )}
        </div>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{text.relationship}</p>
        {!text.hasTranslation && (
          <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted)' }}>Not yet in Source Library</p>
        )}
      </div>
    </div>
  );
}

export default async function ArtworkPage({ params }: PageProps) {
  const { slug } = await params;
  const artwork = ARTWORKS[slug];
  if (!artwork) notFound();

  const artist = ARTISTS[artwork.artistSlug];
  const artistWorks = getArtworksByArtist(artwork.artistSlug);
  const currentIndex = artistWorks.findIndex(a => a.slug === slug);
  const prevWork = currentIndex > 0 ? artistWorks[currentIndex - 1] : null;
  const nextWork = currentIndex < artistWorks.length - 1 ? artistWorks[currentIndex + 1] : null;

  const isLandscape = artwork.aspectRatio > 1;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Breadcrumb */}
      <div className="bg-stone-900 border-b border-stone-800">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-3">
          <nav className="flex items-center gap-2 text-xs text-stone-500">
            <Link href="/artwork" className="hover:text-stone-300 transition-colors">Visual Art</Link>
            <span>/</span>
            <Link href={`/artwork/artist/${artist.slug}`} className="hover:text-stone-300 transition-colors">{artist.name}</Link>
            <span>/</span>
            <span className="text-stone-400">{artwork.title}</span>
          </nav>
        </div>
      </div>

      {/* Hero image with magnifier — the artwork IS the content */}
      <ArtworkHero
        imageUrl={artwork.imageUrl}
        title={artwork.title}
        fullResUrl={artwork.fullResUrl}
        license={artwork.license}
        isLandscape={isLandscape}
      />

      {/* Metadata header */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 sm:py-10">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <TypeBadge type={artwork.resourceType} />
              </div>
              <h1 className="text-3xl sm:text-4xl font-display font-bold leading-tight">{artwork.title}</h1>
              {artwork.originalTitle && artwork.originalTitle !== artwork.title && (
                <p className="text-stone-400 italic mt-1">{artwork.originalTitle}</p>
              )}
              <Link href={`/artwork/artist/${artist.slug}`} className="text-xl text-stone-300 mt-3 block hover:text-white transition-colors">
                {artist.name}
              </Link>
              <p className="text-xs text-stone-500 mt-0.5">{artist.dates}</p>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 text-sm text-stone-400">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-stone-500" />
                  {artwork.date}
                </div>
                <div className="flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-stone-500" />
                  {artwork.medium}
                </div>
                <div className="flex items-center gap-1.5">
                  <Ruler className="w-4 h-4 text-stone-500" />
                  {artwork.dimensions}
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-stone-500" />
                  {artwork.location}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5 flex-shrink-0">
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                <Quote className="w-4 h-4" />
                <span className="hidden sm:inline">Cite</span>
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                <Heart className="w-4 h-4" />
                <span className="hidden sm:inline">Like</span>
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                <Share2 className="w-4 h-4" />
                <span className="hidden sm:inline">Share</span>
              </button>
              {artwork.wikidata && (
                <a href={`https://www.wikidata.org/wiki/${artwork.wikidata}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Wikidata</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-stone-200" />

      {/* Content */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-10 space-y-10">

        {/* Description */}
        <section className="card p-6 sm:p-8">
          <h2 className="text-lg font-display font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>About This Work</h2>
          <div className="prose-content max-w-none">
            {artwork.description.split('\n\n').map((p, i) => (
              <p key={i} className="mb-4 last:mb-0">{p}</p>
            ))}
          </div>
        </section>

        {/* Related texts — THE KILLER FEATURE */}
        {artwork.relatedTexts.length > 0 && (
          <section className="card p-6 sm:p-8 ring-1 ring-accent-rust/15">
            <div className="flex items-center gap-2.5 mb-2">
              <BookOpen className="w-5 h-5 text-accent-rust" />
              <h2 className="text-lg font-display font-semibold" style={{ color: 'var(--text-primary)' }}>Related Texts in Source Library</h2>
            </div>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              The books that inspired, explained, or contextualize this artwork — many translated into English for the first time
            </p>
            <div className="space-y-4">
              {artwork.relatedTexts.map((text, i) => (
                <RelatedTextCard key={i} text={text} index={i} />
              ))}
            </div>
          </section>
        )}

        {/* Iconographic elements */}
        {artwork.iconography.length > 0 && (
          <section className="card p-6 sm:p-8">
            <h2 className="text-lg font-display font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Iconographic Elements</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Symbols, figures, and motifs with their significance in the philosophical tradition</p>
            <IconographySection items={artwork.iconography} />
          </section>
        )}

        {/* Provenance */}
        <section className="card p-6 sm:p-8">
          <h2 className="text-lg font-display font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Provenance</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{artwork.provenance}</p>
        </section>

        {/* Navigation: prev/next by same artist */}
        {(prevWork || nextWork) && (
          <nav className="flex items-stretch gap-4 pt-4">
            {prevWork ? (
              <Link href={`/artwork/${prevWork.slug}`} className="flex-1 group flex items-center gap-4 p-4 rounded-lg border hover:border-accent-rust/30 transition-colors" style={{ borderColor: 'var(--border-light)' }}>
                <ArrowLeft className="w-5 h-5 flex-shrink-0 text-stone-400 group-hover:text-accent-rust transition-colors" />
                <div className="min-w-0">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Previous</p>
                  <p className="text-sm font-semibold truncate group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>{prevWork.title}</p>
                </div>
              </Link>
            ) : <div className="flex-1" />}
            {nextWork ? (
              <Link href={`/artwork/${nextWork.slug}`} className="flex-1 group flex items-center justify-end gap-4 p-4 rounded-lg border hover:border-accent-rust/30 transition-colors text-right" style={{ borderColor: 'var(--border-light)' }}>
                <div className="min-w-0">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Next</p>
                  <p className="text-sm font-semibold truncate group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>{nextWork.title}</p>
                </div>
                <ArrowRight className="w-5 h-5 flex-shrink-0 text-stone-400 group-hover:text-accent-rust transition-colors" />
              </Link>
            ) : <div className="flex-1" />}
          </nav>
        )}
      </div>
    </div>
  );
}
