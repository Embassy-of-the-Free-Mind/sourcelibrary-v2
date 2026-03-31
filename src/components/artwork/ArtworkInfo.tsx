import Link from 'next/link';
import { Book } from '@/lib/types';
import ArtworkHero from './ArtworkHero';
import { Calendar, MapPin, Ruler, Palette, ExternalLink, Heart, Share2, Quote } from 'lucide-react';
import LikeButton from '@/components/ui/LikeButton';
import { BookShare } from '@/components/ui/ShareButton';
import SiteHeader from '@/components/layout/SiteHeader';
import AuthorCrossReference from '@/components/book/AuthorCrossReference';

/** Medium labels for display */
const TYPE_LABELS: Record<string, string> = {
  painting: 'Painting',
  print: 'Print',
  drawing: 'Drawing',
  fresco: 'Fresco',
  emblem: 'Emblem',
  object: 'Object',
  map: 'Map',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border bg-white/10 border-white/20 text-stone-300">
      {TYPE_LABELS[type] || type}
    </span>
  );
}

interface ArtworkNavItem {
  slug: string;
  title: string;
}

interface ArtworkInfoProps {
  book: Book;
  collections: Array<{ slug: string; name: string; subtitle?: string; color?: string }>;
  prevWork?: ArtworkNavItem | null;
  nextWork?: ArtworkNavItem | null;
}

export default function ArtworkInfo({ book, collections, prevWork, nextWork }: ArtworkInfoProps) {
  const displayImage = (book as any).thumbnail_blob || book.thumbnail || '';
  const commonsUrl = (book as any).commons_url || '';
  const commonsFullUrl = (book as any).commons_full_url || '';
  const commonsLicense = (book as any).commons_license || 'Public domain';
  const medium = (book as any).medium || '';
  const dimensionsDisplay = (book as any).dimensions_display || '';
  const commonsDescription = (book as any).commons_description || '';
  const commonsWidth = (book as any).commons_width || 0;
  const commonsHeight = (book as any).commons_height || 0;
  const isLandscape = commonsWidth > commonsHeight;
  const resourceType = book.resource_type || 'print';
  const attributionNote = (book as any).attribution_note || '';
  const holdingMuseum = (book.image_source as any)?.contributing_library || '';

  return (
    <>
      {/* Hero image with magnifier */}
      {displayImage && (
        <ArtworkHero
          imageUrl={displayImage}
          title={book.title}
          fullResUrl={commonsUrl || commonsFullUrl}
          license={commonsLicense}
          isLandscape={isLandscape}
          prevWork={prevWork}
          nextWork={nextWork}
        />
      )}

      {/* Metadata header */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 sm:py-10">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <TypeBadge type={resourceType} />
                {commonsLicense && (
                  <span className="text-xs text-stone-500">{commonsLicense}</span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold leading-tight">
                {book.display_title || book.title}
              </h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 italic mt-1 text-sm">{book.title}</p>
              )}
              <p className="text-xl text-stone-300 mt-3">
                {attributionNote && (
                  <span className="text-stone-500 italic mr-1">{attributionNote} </span>
                )}
                {book.author.split(/,\s*/).map((name, i, arr) => (
                  <span key={name}>
                    <Link
                      href={`/artwork/artist/${name.trim().replace(/\s+/g, '-')}`}
                      className="hover:text-white transition-colors"
                    >
                      {name.trim()}
                    </Link>
                    {i < arr.length - 1 && <span className="text-stone-500">, </span>}
                  </span>
                ))}
              </p>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-sm text-stone-400">
                {book.published && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-stone-500" />
                    {book.published}
                  </div>
                )}
                {medium && (
                  <div className="flex items-center gap-1.5">
                    <Palette className="w-4 h-4 text-stone-500" />
                    {medium}
                  </div>
                )}
                {dimensionsDisplay && (
                  <div className="flex items-center gap-1.5">
                    <Ruler className="w-4 h-4 text-stone-500" />
                    {dimensionsDisplay}
                  </div>
                )}
                {holdingMuseum && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-stone-500" />
                    {holdingMuseum}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5 flex-shrink-0">
              <LikeButton
                targetType="book"
                targetId={book.id}
                size="sm"
                showCount={true}
                className="text-stone-300"
              />
              <BookShare
                title={book.display_title || book.title}
                author={book.author}
                year={book.published}
                bookId={book.id}
                label="Share"
                className="text-stone-300 hover:text-white hover:bg-white/10"
              />
              {commonsUrl && (
                <a href={commonsUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Commons</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-stone-200" />

      {/* Content */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-10 space-y-8">

        {/* Description from Commons */}
        {commonsDescription && (
          <div className="card p-6 sm:p-8">
            <h2 className="text-lg font-display font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>About This Work</h2>
            <div className="prose-content max-w-none">
              {commonsDescription.split('\n\n').map((p: string, i: number) => (
                <p key={i} className="mb-4 last:mb-0">{p}</p>
              ))}
            </div>
          </div>
        )}

        {/* Collections */}
        {collections.length > 0 && (
          <div className="card p-6">
            <h2 className="text-lg font-display font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Collections</h2>
            <div className="flex flex-wrap gap-2">
              {collections.map(col => (
                <Link
                  key={col.slug}
                  href={`/collections/${col.slug}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border hover:border-accent-rust/30 transition-colors"
                  style={{ background: 'var(--bg-warm)', borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}
                >
                  {col.color && <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />}
                  <span className="font-medium">{col.name}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Cross-reference: books by this author (pre-computed) */}
        {(book as any).author_cross_ref && (
          <AuthorCrossReference
            author={book.author}
            crossRef={(book as any).author_cross_ref}
            context="artwork"
          />
        )}

        {/* Provenance & Source */}
        <div className="card p-6">
          <h2 className="text-lg font-display font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Provenance &amp; Source</h2>
          <div className="text-sm space-y-3" style={{ color: 'var(--text-secondary)' }}>
            {/* Holding institution */}
            {(book.image_source as any)?.contributing_library && (
              <div>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Holding Institution</span>
                <p className="mt-0.5">{(book.image_source as any).contributing_library}</p>
              </div>
            )}

            {/* Credit */}
            {(book as any).commons_credit && (
              <div>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Credit</span>
                <p className="mt-0.5">{(book as any).commons_credit}</p>
              </div>
            )}

            {/* Digital source */}
            <div>
              <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Digital Image</span>
              <p className="mt-0.5">
                <a href={commonsUrl} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">Wikimedia Commons</a>
                {commonsLicense && <span className="text-stone-400"> · {commonsLicense}</span>}
              </p>
            </div>

            {/* License details */}
            {(book as any).commons_usage_terms && (
              <div>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Usage Terms</span>
                <p className="mt-0.5">{(book as any).commons_usage_terms}</p>
              </div>
            )}

            {/* Harvest date */}
            {(book as any).harvested_at && (
              <div>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Harvested</span>
                <p className="mt-0.5">{new Date((book as any).harvested_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
            )}

            {/* Full resolution link */}
            {commonsFullUrl && (
              <p className="pt-2">
                <a href={commonsFullUrl} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">
                  View full resolution original →
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
