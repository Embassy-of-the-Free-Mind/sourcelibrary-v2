import Link from 'next/link';
import { Book } from '@/lib/types';
import ArtworkHero from './ArtworkHero';
import { Calendar, MapPin, Ruler, Palette, ExternalLink, Heart, Share2, Quote, Download, BookOpen, ScrollText } from 'lucide-react';
import LikeButton from '@/components/ui/LikeButton';
import { BookShare } from '@/components/ui/ShareButton';
import SiteHeader from '@/components/layout/SiteHeader';
import AuthorCrossReference from '@/components/book/AuthorCrossReference';
import AiBadge from '@/components/ui/AiBadge';

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

function ProvenanceRow({ label, value, mono, provenance }: { label: string; value: string; mono?: boolean; provenance?: 'ai' | 'source' }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
        {provenance === 'ai' && <AiBadge className="ml-1" title="AI-inferred — may require verification" />}
      </span>
      <p className={`mt-0.5 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</p>
    </div>
  );
}

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

interface RelatedBookPreview {
  id: string;
  slug: string;
  title: string;
  thumbnail?: string;
  thumbnail_blob?: string;
}

interface ArtworkInfoProps {
  book: Book;
  collections: Array<{ slug: string; name: string; subtitle?: string; color?: string }>;
  prevWork?: ArtworkNavItem | null;
  nextWork?: ArtworkNavItem | null;
  /** Per-collection prev/next pairs — ArtworkHero picks the one matching ?from=<collection>. */
  navByCollection?: Record<string, { prev: ArtworkNavItem | null; next: ArtworkNavItem | null }>;
  relatedBooks?: RelatedBookPreview[];
  /** When true, hide cross-tenant widgets (AuthorCrossReference renders unfiltered global data). */
  isEmbedded?: boolean;
}

// Build a museum-record link from structured source_ids (#3838) for artworks
// that carry no source URL at all (NGA matches, Met Egyptian-art and
// Rijksmuseum KOG batches). Met/AIC routes are their documented public URLs;
// the Rijksmuseum object-number route 301s to the canonical object page; the
// NGA pattern is Wikidata P4683's formatter URL (nga.gov fingerprint-blocks
// non-browser clients, so it can't be curl-verified — browser-checked only).
function museumRecordLink(book: unknown): { url: string; label: string } | null {
  const ids = (book as { source_ids?: Record<string, string> }).source_ids || {};
  if (ids.met) return { url: `https://www.metmuseum.org/art/collection/search/${encodeURIComponent(ids.met)}`, label: 'The Metropolitan Museum of Art' };
  if (ids.rijksmuseum) return { url: `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(ids.rijksmuseum)}`, label: 'Rijksmuseum' };
  if (ids.nga) return { url: `https://www.nga.gov/collection/art-object-page.${encodeURIComponent(ids.nga)}.html`, label: 'National Gallery of Art' };
  if (ids.aic) return { url: `https://www.artic.edu/artworks/${encodeURIComponent(ids.aic)}`, label: 'Art Institute of Chicago' };
  if (ids.commons && /^File:/i.test(ids.commons)) {
    return { url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(ids.commons.replace(/ /g, '_'))}`, label: 'Wikimedia Commons' };
  }
  return null;
}

export default function ArtworkInfo({ book, collections, prevWork, nextWork, navByCollection, relatedBooks = [], isEmbedded = false }: ArtworkInfoProps) {
  const displayImage = book.thumbnail || (book as any).thumbnail_blob || '';
  const thumbImage = (book as any).thumbnail_blob || '';
  const commonsUrl = (book as any).commons_url || '';
  const sourceRecord = museumRecordLink(book);
  // One source link for the whole page: the stored source URL when we have
  // one, else a museum-record link built from source_ids.
  const sourceHref = commonsUrl || (book as any).source_url || sourceRecord?.url || '';
  const sourceName = (book.image_source as any)?.provider_name
    || (commonsUrl ? 'Wikimedia Commons' : sourceRecord?.label || 'Source record');
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

  // Enrichment data (AI-generated museum-label content)
  const enrichment = (book as any).enrichment;
  const enrichDescription = enrichment?.description || '';
  const enrichSignificance = enrichment?.significance || '';
  const enrichInscriptions = enrichment?.inscriptions || '';
  const enrichInscriptionsTranslation = enrichment?.inscriptions_translation || '';
  const enrichInscriptionsLanguage = enrichment?.inscriptions_language || '';
  const enrichCrossRefs = enrichment?.cross_references || [];
  const enrichFigures = enrichment?.figures_depicted || [];
  const enrichSymbols = enrichment?.symbols || [];
  const enrichIconclass = enrichment?.iconclass || [];
  // Derive R2 full-res URL from slug when archived_full_url isn't set but thumbnail is on R2
  const archivedFullUrlRaw = (book as any).archived_full_url || '';
  const archivedFullUrl = archivedFullUrlRaw
    || (book.slug && displayImage.includes('images.sourcelibrary.org/artwork/')
      ? `https://images.sourcelibrary.org/artwork/${book.slug.replace(/^art-/, '')}-full.jpg`
      : '');
  const fullWidth = (book as any).full_width || commonsWidth;
  const fullHeight = (book as any).full_height || commonsHeight;
  const sourceBook = (book as any).source_book as { id: string; slug: string; title: string } | undefined;

  return (
    <>
      {/* Hero image with magnifier */}
      {displayImage && (
        <ArtworkHero
          imageUrl={displayImage}
          thumbUrl={thumbImage}
          hiResUrl={archivedFullUrl || commonsFullUrl || ''}
          title={book.title}
          fullResUrl={archivedFullUrl || commonsUrl || commonsFullUrl}
          license={commonsLicense}
          isLandscape={isLandscape}
          prevWork={prevWork}
          nextWork={nextWork}
          navByCollection={navByCollection}
          institution={holdingMuseum}
          deepZoom={(book as any).deepzoom || null}
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
                {/* Show published date, but filter out Wikimedia upload timestamps
                    (ISO format like "2014-10-22 07:56:19" — not artwork creation dates) */}
                {book.published && !/^\d{4}-\d{2}-\d{2}/.test(book.published) && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-stone-500" />
                    {book.published}
                  </div>
                )}
                {/* Show enrichment period when no real published date */}
                {(!book.published || /^\d{4}-\d{2}-\d{2}/.test(book.published)) && enrichment?.period && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-stone-500" />
                    {enrichment.period}
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
                year={book.published && !/^\d{4}-\d{2}-\d{2}/.test(book.published) ? book.published : enrichment?.period || undefined}
                bookId={book.id}
                label="Share"
                className="text-stone-300 hover:text-white hover:bg-white/10"
              />
              {archivedFullUrl && (
                <a href={archivedFullUrl} download
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </a>
              )}
              {sourceHref && (
                <a href={sourceHref} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Source</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-stone-200" />

      {/* Content */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-10 space-y-8">

        {/* Description — prefer enrichment over Commons */}
        {(enrichDescription || commonsDescription) && (
          <div className="card p-6 sm:p-8">
            <h2 className="text-lg font-display font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>About This Work</h2>
            <div className="prose-content max-w-none" style={{ color: 'var(--text-secondary)' }}>
              {enrichDescription ? (
                <p className="mb-4 leading-relaxed">{enrichDescription}</p>
              ) : (
                commonsDescription.split('\n\n').map((p: string, i: number) => (
                  <p key={i} className="mb-4 last:mb-0">{p}</p>
                ))
              )}
              {enrichSignificance && (
                <p className="leading-relaxed" style={{ color: 'var(--text-primary)' }}>{enrichSignificance}</p>
              )}
            </div>

            {/* Figures & Symbols */}
            {(enrichFigures.length > 0 || enrichSymbols.length > 0 || enrichIconclass.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-5 pt-5 border-t" style={{ borderColor: 'var(--border-light)' }}>
                {enrichFigures.map((f: string) => (
                  <span key={f} className="px-2 py-0.5 text-xs rounded-full border" style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>{f}</span>
                ))}
                {enrichSymbols.map((s: string) => (
                  <span key={s} className="px-2 py-0.5 text-xs rounded-full border italic" style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)' }}>{s}</span>
                ))}
                {enrichIconclass.map((code: string) => (
                  <a
                    key={code}
                    href={`https://iconclass.org/${encodeURIComponent(code)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 text-xs rounded-full border font-mono hover:opacity-80 transition-opacity"
                    style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
                    title={`Iconclass: ${code}`}
                  >
                    {code}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Inscriptions */}
        {enrichInscriptions && (
          <div className="card p-6 sm:p-8">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <ScrollText className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
              Inscriptions
              {enrichInscriptionsLanguage && (
                <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>({enrichInscriptionsLanguage})</span>
              )}
            </h2>
            <pre className="text-sm whitespace-pre-wrap font-serif leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {enrichInscriptions}
            </pre>
            {enrichInscriptionsTranslation && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-light)' }}>
                <p className="text-xs uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Translation</p>
                <pre className="text-sm whitespace-pre-wrap font-serif leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {enrichInscriptionsTranslation}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Cross-references to texts/traditions */}
        {enrichCrossRefs.length > 0 && (
          <div className="card p-6 sm:p-8">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
              Connected Texts
            </h2>
            <div className="space-y-3">
              {enrichCrossRefs.map((ref: { text_or_author: string; relationship: string; confidence: string }, i: number) => (
                <div key={i} className="flex gap-3">
                  <div className="w-1 rounded-full flex-shrink-0" style={{ background: ref.confidence === 'high' ? 'var(--accent-rust)' : 'var(--border-light)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ref.text_or_author}</p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{ref.relationship}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Source Manuscript — links artwork to its parent codex/book */}
        {sourceBook && (
          <Link
            href={`/book/${sourceBook.slug}`}
            className="card p-6 sm:p-8 flex items-center gap-4 group hover:border-accent-rust/30 transition-colors"
            style={{ borderColor: 'var(--border-light)' }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-rust)', opacity: 0.9 }}>
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
                From this manuscript
              </p>
              <p className="text-sm font-medium mt-0.5 group-hover:text-accent-rust transition-colors truncate" style={{ color: 'var(--text-primary)' }}>
                {sourceBook.title}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Read the full text with translation →
              </p>
            </div>
          </Link>
        )}

        {/* Related books by this artist */}
        {!sourceBook && relatedBooks.length > 0 && (
          <div className="card p-6 sm:p-8">
            <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
              Books by {book.author}
            </h2>
            <div className="space-y-2">
              {relatedBooks.map(rb => (
                <Link
                  key={rb.id}
                  href={`/book/${rb.slug || rb.id}`}
                  className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-stone-50 transition-colors group"
                >
                  {(rb.thumbnail_blob || rb.thumbnail) && (
                    <div className="w-10 h-14 rounded overflow-hidden bg-stone-100 flex-shrink-0">
                      <img src={rb.thumbnail_blob || rb.thumbnail} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium group-hover:text-accent-rust transition-colors truncate" style={{ color: 'var(--text-primary)' }}>
                      {rb.title}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Read with translation →
                    </p>
                  </div>
                </Link>
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

        {/* Cross-reference: books by this author (pre-computed).
            Hidden in embed mode — author_cross_ref is computed across all tenants. */}
        {!isEmbedded && (book as any).author_cross_ref && (
          <AuthorCrossReference
            author={book.author}
            crossRef={(book as any).author_cross_ref}
            context="artwork"
          />
        )}

        {/* Provenance & Source — expanded with Getty identifiers and AI enrichment transparency */}
        <div className="card p-6 sm:p-8">
          <h2 className="text-lg font-display font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>Provenance &amp; Source</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {/* Left column: Physical object provenance */}
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-wider font-semibold pb-1 border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-light)' }}>Object</p>

              {(book.image_source as any)?.contributing_library && (
                <ProvenanceRow label="Holding Institution" value={(book.image_source as any).contributing_library} />
              )}
              {(book as any).accession_number && (
                <ProvenanceRow label="Accession Number" value={(book as any).accession_number} />
              )}
              {(book as any).department && (
                <ProvenanceRow label="Department" value={(book as any).department} />
              )}
              {medium && (
                <ProvenanceRow label="Medium" value={medium} />
              )}
              {enrichment?.aat_technique && (
                <ProvenanceRow label="Technique" value={enrichment.aat_technique} provenance="ai" />
              )}
              {enrichment?.aat_material && (
                <ProvenanceRow label="Support" value={enrichment.aat_material} provenance="ai" />
              )}
              {dimensionsDisplay && (
                <ProvenanceRow label="Dimensions" value={dimensionsDisplay} />
              )}
              {enrichment?.period && (
                <ProvenanceRow label="Period" value={enrichment.period} provenance="ai" />
              )}
              {enrichment?.culture && (
                <ProvenanceRow label="Culture" value={enrichment.culture} provenance="ai" />
              )}
              {enrichment?.genre && (
                <ProvenanceRow label="Genre" value={enrichment.genre} provenance="ai" />
              )}
            </div>

            {/* Right column: Digital provenance */}
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-wider font-semibold pb-1 border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-light)' }}>Digital Source</p>

              <div>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Source</span>
                <p className="mt-0.5">
                  {sourceHref ? (
                    <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">
                      {sourceName}
                    </a>
                  ) : (
                    (book.image_source as any)?.provider_name || 'Unknown'
                  )}
                  {commonsLicense && <span className="text-stone-400"> · {commonsLicense}</span>}
                </p>
              </div>

              {(book as any).commons_credit && (
                <ProvenanceRow label="Credit" value={(book as any).commons_credit} />
              )}
              {(book as any).commons_usage_terms && (
                <ProvenanceRow label="Usage Terms" value={(book as any).commons_usage_terms} />
              )}
              {(commonsWidth > 0 && commonsHeight > 0) && (
                <ProvenanceRow label="Original Resolution" value={`${commonsWidth} × ${commonsHeight} px`} />
              )}
              {(book as any).commons_sha1 && (
                <ProvenanceRow label="SHA-1" value={(book as any).commons_sha1} mono />
              )}
              {(book as any).commons_upload_date && (
                <ProvenanceRow label="Upload Date" value={new Date((book as any).commons_upload_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
              )}
              {(book as any).harvested_at && (
                <ProvenanceRow label="Harvested" value={new Date((book as any).harvested_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
              )}
            </div>
          </div>

          {/* Linked Data identifiers */}
          {(enrichment?.ulan_artist || enrichment?.tgn_place || enrichment?.iconclass?.length > 0) && (
            <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--border-light)' }}>
              <p className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>Linked Data</p>
              <div className="flex flex-wrap gap-2">
                {enrichment.ulan_artist && (
                  <a href={`https://www.getty.edu/vow/ULANFullDisplay?find=&role=&nation=&subjectid=${enrichment.ulan_artist}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border hover:border-accent-rust/40 transition-colors"
                    style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">Getty ULAN</span>
                    <span className="font-mono opacity-60">{enrichment.ulan_artist}</span>
                    <AiBadge />
                  </a>
                )}
                {enrichment.tgn_place && (
                  <a href={`https://www.getty.edu/vow/TGNFullDisplay?find=&place=&nation=&subjectid=${enrichment.tgn_place}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border hover:border-accent-rust/40 transition-colors"
                    style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">Getty TGN</span>
                    <span className="font-mono opacity-60">{enrichment.tgn_place}</span>
                    <AiBadge />
                  </a>
                )}
                {enrichment.aat_technique && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border"
                    style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">AAT</span>
                    <span>{enrichment.aat_technique}</span>
                    <AiBadge />
                  </span>
                )}
                {enrichment.aat_style && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border"
                    style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">AAT Style</span>
                    <span>{enrichment.aat_style}</span>
                    <AiBadge />
                  </span>
                )}
              </div>
            </div>
          )}

          {/* AI enrichment transparency */}
          {enrichment?.enriched_at && (
            <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-light)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                <AiBadge /> AI-cataloged fields generated by {enrichment.model || 'Gemini Flash'} on{' '}
                {new Date(enrichment.enriched_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
                Getty identifiers are AI-inferred and may require verification.
              </p>
            </div>
          )}

          {/* Full resolution link */}
          {(archivedFullUrl || commonsFullUrl) && (
            <p className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
              <a href={archivedFullUrl || commonsFullUrl} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline text-sm">
                View full resolution{fullWidth && fullHeight ? ` (${fullWidth} × ${fullHeight})` : ''} →
              </a>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
