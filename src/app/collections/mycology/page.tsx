import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, Play, ArrowRight } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { getReadDb } from '@/lib/mongodb';
import { getPageImageUrl } from '@/lib/page-image-url';
import { notFound } from 'next/navigation';
import { bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import { tenantBookUrl } from '@/lib/slugify';
import BookCardMini, { MiniBook } from './_components/BookCardMini';
import MycoSlider from './_components/MycoSlider';
import MycoAnchorBar from './_components/MycoAnchorBar';
import QuoteBlock from './_components/QuoteBlock';

/*
 * Mycology collection page — REDESIGN. Dedicated route so the shared
 * collections/[id] template (every other collection) stays untouched. Built per
 * .claude/docs/collection-page-redesign-spec.md + the supplied mock, strictly on
 * existing Source Library tokens/components (no new design primitives).
 */

export const revalidate = 86400;
export const dynamic = 'force-dynamic';

const SLUG = 'mycology';
// Primary action = dark button (existing --bg-dark token), never the violet btn-primary.
const BTN_DARK = 'inline-flex items-center gap-2 bg-dark text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity';
const RUST_LINK = 'inline-flex items-center gap-1 text-sm text-accent-rust hover:underline';

export const metadata: Metadata = {
  title: 'Mycology & Fungi - Source Library',
  description: 'The Kingdom of Fungi, from Clusius to Saccardo — original source texts and first English translations on Source Library.',
  alternates: { canonical: '/collections/mycology' },
};

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'featured', label: 'Featured' },
  { id: 'translations', label: 'First translations' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'works', label: 'Works' },
  { id: 'involved', label: 'Get involved' },
];

const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
  language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  is_first_translation: 1, ft_disposition: 1, 'translation_verification.disposition': 1,
} as const;

interface GalleryImg {
  book_id?: string; bookId?: string; page_id?: string; pageId?: string;
  extracted_url?: string; extractedUrl?: string; thumbnail_url?: string; thumbnailUrl?: string;
  image_url?: string; imageUrl?: string; description?: string; museum_description?: string; book_title?: string; type?: string;
}

function toMini(b: Record<string, unknown>): MiniBook {
  return {
    ...(b as unknown as MiniBook),
    thumbnail: sanitizeThumbnail(b.thumbnail_blob as string) || sanitizeThumbnail(b.thumbnail as string),
    ft_disposition: (b.ft_disposition as string | undefined)
      || ((b.translation_verification as Record<string, unknown> | undefined)?.disposition as string | undefined),
  };
}

function imgUrl(img: GalleryImg): string | undefined {
  return img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.image_url || img.imageUrl;
}

async function getMycologyData() {
  const db = await withTimeout(getReadDb(), 10000, null as unknown as Awaited<ReturnType<typeof getReadDb>>);
  if (!db) throw new Error('DB connection timeout');

  const collection = await withTimeout(db.collection('collections').findOne({ slug: SLUG }), 8000, null);
  if (!collection) return null;
  const books = db.collection('books');

  const [firstRaw, sourceRaw, ftCount, total, yearAgg, bookIdDocs] = await Promise.all([
    withTimeout(books.find({ collections: SLUG, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true }, { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ year: 1, title: 1 }).limit(60).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.find({ collections: SLUG, visible: true, pages_count: { $gt: 0 }, is_first_translation: { $ne: true } }, { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ year: 1, title: 1 }).limit(12).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.countDocuments({ collections: SLUG, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true }, { maxTimeMS: 8000 }), 8000, 0),
    withTimeout(Promise.resolve(collection.book_count as number | undefined).then((c) => c ?? books.countDocuments({ collections: SLUG, visible: true, pages_count: { $gt: 0 } }, { maxTimeMS: 8000 })), 8000, 0),
    withTimeout(books.aggregate([{ $match: { collections: SLUG, visible: true, year: { $type: 'number', $gt: 0 } } }, { $group: { _id: null, min: { $min: '$year' }, max: { $max: '$year' } } }], { maxTimeMS: 8000 }).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.find({ collections: SLUG, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray() as Promise<Record<string, unknown>[]>, 5000, []),
  ]);

  const bookIds = bookIdDocs.map((d) => d.id as string);
  const galleryRaw = bookIds.length
    ? await withTimeout(db.collection('gallery_images').find(
      { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } },
      { projection: { _id: 0 }, maxTimeMS: 5000 },
    ).sort({ gallery_quality: -1 }).limit(60).toArray() as Promise<Record<string, unknown>[]>, 5000, [])
    : [];

  const firstTranslations = firstRaw.map(toMini);
  const sourceWorks = sourceRaw.map(toMini);
  const gallery = JSON.parse(JSON.stringify(galleryRaw)) as GalleryImg[];
  const featured = [...firstTranslations].sort((a, b) => ((b.pages_translated as number) ?? 0) - ((a.pages_translated as number) ?? 0))[0] || null;
  const [featuredPages, parentDoc] = await Promise.all([
    featured ? getFeaturedPagePreviews(db, featured.id) : Promise.resolve([] as PagePreview[]),
    collection.parent ? withTimeout(db.collection('collections').findOne({ slug: collection.parent as string }, { projection: { _id: 0, slug: 1, name: 1 } }), 5000, null) : Promise.resolve(null),
  ]);
  const parent = parentDoc ? { slug: parentDoc.slug as string, name: parentDoc.name as string } : null;
  const yr = yearAgg[0] as { min?: number; max?: number } | undefined;
  const languages = ((collection.languages as { lang: string; count: number }[] | undefined) || []).filter((l) => l.count > 0).map((l) => l.lang);

  return {
    collection: JSON.parse(JSON.stringify(collection)) as Record<string, unknown>,
    firstTranslations, sourceWorks, ftCount, total,
    dateRange: yr && yr.min && yr.max ? { min: yr.min, max: yr.max } : null,
    languages, gallery, featured, featuredPages, parent,
  };
}

interface PagePreview { id: string; page_number?: number; kind: 'illustration' | 'text'; url: string }

// Sample-page previews for the featured work: at least one illustration page and
// one text page, as small thumbnails that deep-link into the reader.
async function getFeaturedPagePreviews(
  db: Awaited<ReturnType<typeof getReadDb>>, bookId: string,
): Promise<PagePreview[]> {
  const proj = { _id: 0, id: 1, page_number: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };
  const [illus, text] = await Promise.all([
    withTimeout(db.collection('pages').find({ book_id: bookId, detected_images: { $exists: true, $ne: [] } }, { projection: proj, maxTimeMS: 5000 }).sort({ page_number: 1 }).limit(2).toArray() as Promise<Record<string, unknown>[]>, 5000, []),
    withTimeout(db.collection('pages').find({ book_id: bookId, photo: { $exists: true }, $or: [{ detected_images: { $exists: false } }, { detected_images: { $size: 0 } }] }, { projection: proj, maxTimeMS: 5000 }).sort({ page_number: 1 }).limit(2).toArray() as Promise<Record<string, unknown>[]>, 5000, []),
  ]);
  const make = (p: Record<string, unknown>, kind: 'illustration' | 'text'): PagePreview | null => {
    const url = getPageImageUrl(p as unknown as Parameters<typeof getPageImageUrl>[0], 'thumb');
    return url ? { id: p.id as string, page_number: p.page_number as number | undefined, kind, url } : null;
  };
  // Order so at least one of each kind shows: illustration, text, illustration.
  const out = [illus[0] && make(illus[0], 'illustration'), text[0] && make(text[0], 'text'), (illus[1] && make(illus[1], 'illustration')) || (text[1] && make(text[1], 'text'))];
  return out.filter(Boolean).slice(0, 3) as PagePreview[];
}

export default async function MycologyCollectionPage() {
  let data;
  try { data = await getMycologyData(); } catch (err) {
    console.error('[Mycology page] data fetch failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  if (!data) notFound();

  const { collection, firstTranslations, sourceWorks, ftCount, total, dateRange, languages, gallery, featured, featuredPages, parent } = data;
  const title = (collection.name as string) || 'Mycology & Fungi';
  const tagline = (collection.subtitle as string) || 'The Kingdom of Fungi, from Clusius to Saccardo.';
  const parentHref = parent ? `/collections/${parent.slug}` : '/collections';

  // Quote background per the quote-background-image skill: a figural plate with
  // a calm zone, no printed text. If nothing qualifies, fall back to the plain
  // tonal background (quoteBg undefined → QuoteBlock shows the dark surface).
  const PLATE_TYPES = ['illustration', 'engraving', 'woodcut', 'emblem'];
  const quotePlate = gallery.find((g) => g.type && PLATE_TYPES.includes(g.type))
    || gallery.find((g) => g.type && !['page', 'title_page', 'text', 'portrait', 'frontispiece', 'map', 'table', 'chart', 'symbol', 'decorative', 'musical_score', 'exlibris', 'bookplate'].includes(g.type));
  const quoteBg = quotePlate ? imgUrl(quotePlate) : undefined;
  const galleryTotal = gallery.length;
  const worksMore = Math.max(0, total - Math.min(sourceWorks.length, 10));
  const featuredHref = featured ? tenantBookUrl({ id: featured.id, slug: featured.slug }, null) : '#';

  return (
    <div className="min-h-screen bg-cream">
      {/* Normal light navbar, in document flow (breadcrumbs live in the hero). */}
      <ConditionalSiteHeader variant="light" />
      {/* ===== Hero ===== */}
      <section className="relative bg-dark overflow-hidden min-h-[40vh] md:min-h-[60vh] flex items-end">
        {/* One composited collage image (2:3 tiles) — a single optimized load. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/collections/${SLUG}/hero-collage`} alt="" className="absolute inset-0 w-full h-full object-cover" fetchPriority="high" />
        {/* Lighter, left-weighted legibility gradient — no bottom fade. */}
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-dark/45 to-transparent" />

        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 pt-12 pb-10">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/60 mb-6">
            <Link href="/collections" className="hover:text-white/90 hover:underline transition-colors">Collections</Link>
            {parent && (
              <>
                <span className="text-white/30">/</span>
                <Link href={parentHref} className="hover:text-white/90 hover:underline transition-colors">{parent.name}</Link>
              </>
            )}
          </nav>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">{title}</h1>
          <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-5">{tagline}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{total.toLocaleString('en-US')} works</span>
            {ftCount > 0 && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{ftCount} first translation{ftCount === 1 ? '' : 's'}</span>}
            {dateRange && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{dateRange.min} – {dateRange.max}</span>}
            {languages.length > 0 && <span className="text-xs sm:text-sm text-white/80 border border-white/20 px-3 py-1">{languages.join(' · ')}</span>}
          </div>
        </div>
      </section>

      {/* ===== Anchor row (client: jump collapse + Share/Embed popovers) ===== */}
      <MycoAnchorBar sections={SECTIONS} slug={SLUG} />

      {/* ===== Introduction ===== */}
      <section id="introduction" className="bg-warm border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 py-12 flex flex-col md:flex-row-reverse md:items-start gap-12 lg:gap-24">
          <div className="max-w-2xl font-body">
            <p className="text-xl text-primary leading-relaxed mb-4">
              Fungi feed forests and ferment bread, heal and poison, and break the dead back down into the soil that feeds the living. People gathered and used them for centuries before anyone could say what they even were: not quite plant, not quite animal, but a kingdom of their own.
            </p>
            <p className="text-secondary leading-relaxed mb-4">
              The books that worked this out run from pocket field guides to vast scientific surveys. Sterbeeck wrote the first work devoted entirely to mushrooms; Bulliard had each species painted from life, in plates still prized for their accuracy; Persoon and Fries built the orderings the whole field still rests on. Much of this writing survives only in Latin, French, and German, reachable until now mainly through citation while the pages themselves sat unread.
            </p>
            <p className="text-secondary leading-relaxed">
              Read directly, these works show a science built from close looking. A plate Bulliard coloured by hand can be set beside the mushroom in your hand, a poisoning described in an old treatise matched to the species that caused it, the long work of separating the edible from the deadly followed across two centuries of patient observation.
            </p>
          </div>
          {/* Walkthrough video placeholder (9:16) — left on desktop via row-reverse */}
          <div className="w-full max-w-[300px] mx-auto md:mx-0 shrink-0">
            <div className="relative aspect-[9/16] overflow-hidden bg-dark border border-border-light flex items-center justify-center">
              <div className="w-14 h-14 bg-white/15 flex items-center justify-center">
                <Play className="w-6 h-6 text-white" fill="currentColor" />
              </div>
              <span className="absolute bottom-2 left-3 text-xs text-white/80">Watch · 4 min</span>
            </div>
            <p className="text-xs text-muted mt-2 text-center">A guided tour of the mycology collection</p>
          </div>
        </div>
      </section>

      {/* ===== Featured work ===== */}
      {featured && (
        <section id="featured" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 py-12">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-accent-rust mb-4">Featured work</p>
            <div className="border border-border-light bg-white p-6 sm:p-8 grid gap-8 md:grid-cols-[280px_1fr] md:items-start">
              {/* Left: cover + plate strip */}
              <div>
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-warm shadow-md">
                  {getBookThumbnailUrl(featured) ? (
                    <Image src={getBookThumbnailUrl(featured)!} alt={bookTitle(featured)} fill className="object-cover" sizes="280px" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-12 h-12 text-muted" /></div>
                  )}
                  {featured.language && <span className="absolute bottom-3 right-3 text-[10px] uppercase tracking-wide text-white/90 bg-dark/55 px-2 py-0.5">{featured.language}</span>}
                </div>
                {featuredPages.length > 0 && (
                  <>
                    <div className="flex gap-2 mt-3">
                      {featuredPages.map((p) => (
                        <Link key={p.id} href={`${featuredHref}/page/${p.id}`} title={p.kind === 'illustration' ? 'Illustrated page' : 'Text page'}
                          className="group relative aspect-[3/4] flex-1 overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          <span className="absolute bottom-1 left-1 text-[8px] uppercase tracking-wide text-white/90 bg-dark/55 px-1 py-0.5 leading-none">{p.kind}</span>
                        </Link>
                      ))}
                    </div>
                    <p className="text-xs text-muted mt-2">A look inside: illustration plates and text pages</p>
                  </>
                )}
              </div>
              {/* Right: detail */}
              <div className="min-w-0">
                <h2 className="text-3xl sm:text-4xl font-semibold text-primary leading-tight mb-2" style={{ fontFamily: 'var(--font-serif)' }}>Histoire des Champignons de la France</h2>
                <p className="text-base text-muted mb-4">Pierre Bulliard · 1780&ndash;1791</p>
                <div className="flex flex-wrap gap-2 mb-5">
                  {['2 volumes', '612 hand-coloured plates', 'Folio'].map((m) => (
                    <span key={m} className="text-xs text-secondary bg-warm border border-border-light px-3 py-1">{m}</span>
                  ))}
                </div>
                <p className="text-secondary leading-relaxed font-body mb-3 max-w-prose">An illustrated flora of the fungi of France, issued in parts from 1780 and gathered into volumes in 1791, with more than six hundred plates engraved and coloured by hand from living specimens.</p>
                <p className="text-secondary leading-relaxed font-body mb-5 max-w-prose">Among the first works to render fungi in full, accurate colour, it remained a standard reference for identification well into the following century.</p>
                <figure className="mb-6 max-w-prose">
                  <blockquote className="relative pl-6 text-lg text-primary italic font-body leading-snug">
                    <span className="absolute left-0 top-0 text-3xl text-accent-rust/50 leading-none" style={{ fontFamily: 'var(--font-serif)' }}>&ldquo;</span>
                    The plates are so exact that mycologists still use them to confirm identifications, two centuries on.
                  </blockquote>
                  <figcaption className="text-[11px] uppercase tracking-wider text-muted mt-2">Curator&rsquo;s note</figcaption>
                </figure>
                <div className="flex flex-wrap items-center gap-5">
                  <Link href={featuredHref} className={BTN_DARK}>Read in full <ArrowRight className="w-4 h-4" /></Link>
                  <Link href={`/gallery?collection=${SLUG}`} className={RUST_LINK}>Browse all 612 plates <ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== First translations — slider ===== */}
      {firstTranslations.length > 0 && (
        <section id="translations" className="bg-warm border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 py-12">
            <div className="flex items-end justify-between gap-4 mb-1">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">First translations</h2>
              <span className="text-sm text-muted whitespace-nowrap">{firstTranslations.length} {firstTranslations.length === 1 ? 'title' : 'titles'}</span>
            </div>
            <p className="text-sm text-muted mb-5 max-w-2xl leading-relaxed">Works appearing in a modern, readable translation for the first time.</p>
            <MycoSlider books={firstTranslations} />
          </div>
        </section>
      )}

      {/* ===== Gallery — all visual material, masonry ===== */}
      {gallery.length > 0 && (
        <section id="gallery" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 pt-12 pb-6">
            <div className="flex items-end justify-between gap-4 mb-1">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">Gallery</h2>
              <Link href={`/gallery?collection=${SLUG}`} className={`${RUST_LINK} whitespace-nowrap`}>View all {galleryTotal.toLocaleString('en-US')} <ArrowRight className="w-3.5 h-3.5" /></Link>
            </div>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Plates, figures, engravings, and other visual material from across the collection.</p>
            <div className="columns-3 lg:columns-5 gap-4">
              {gallery.slice(0, 18).map((g, i) => {
                const src = imgUrl(g);
                const bookId = g.book_id || g.bookId;
                const pageId = g.page_id || g.pageId;
                const label = g.museum_description || g.description || g.book_title;
                if (!src) return null;
                const inner = (
                  <div className="mb-4 break-inside-avoid overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={label || 'Illustration'} className="w-full h-auto block" loading="lazy" />
                  </div>
                );
                return bookId && pageId
                  ? <Link key={i} href={`${tenantBookUrl({ id: String(bookId) }, null)}/page/${pageId}`} title={label}>{inner}</Link>
                  : <div key={i} title={label}>{inner}</div>;
              })}
            </div>
          </div>
        </section>
      )}

      {/* ===== Works in this collection — bounded grid + handoff ===== */}
      <section id="works" className="bg-warm border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 py-12">
          <div className="flex items-end justify-between gap-4 mb-1">
            <h2 className="text-2xl sm:text-3xl text-primary font-display">Works in this collection</h2>
            <Link href={`/browse?collection=${SLUG}`} className={`${RUST_LINK} whitespace-nowrap`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Showing {Math.min(sourceWorks.length, 10)} of {total.toLocaleString('en-US')} · original source texts first, translations are gathered in the slider above.</p>
          {sourceWorks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {sourceWorks.slice(0, 10).map((b) => <BookCardMini key={b.id} book={b} />)}
            </div>
          ) : (
            <p className="text-sm text-muted">No source-text works to show.</p>
          )}
          <div className="mt-8 border border-border-light bg-cream p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-primary font-medium font-body">{worksMore.toLocaleString('en-US')} more works in mycology</p>
              <p className="text-sm text-muted">The full catalogue lives on a dedicated, paginated browse page.</p>
            </div>
            <Link href={`/browse?collection=${SLUG}`} className={`${BTN_DARK} self-start sm:self-auto`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
        </div>
      </section>

      {/* ===== Quote band (lighter tint + Translated/Original toggle) =====
          NOTE: verify the French original against the source before prod. */}
      <QuoteBlock
        translated="Of all the productions of nature, none have been more neglected, nor more worthy of study, than the mushrooms."
        original="De toutes les productions de la nature, il n'en est aucune qui ait été plus négligée, ni qui soit cependant plus digne de nos recherches, que les champignons."
        originalLanguage="French"
        attribution="Pierre Bulliard · Histoire des Champignons de la France · 1791"
        attributionHref={featuredHref}
        bgUrl={quoteBg}
      />

      {/* ===== Get involved ===== */}
      <section id="involved" className="bg-cream scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 py-12">
          <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">Get involved</h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">Source Library is built in the open. Every contribution keeps these works free to read.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { kicker: 'Open to all', title: 'Leave feedback', body: 'Spot an error, a missing edition, or a better translation of a passage? Tell us, corrections ship fast.', cta: 'Send feedback', href: '/feedback', primary: false },
              { kicker: 'Volunteer', title: 'Become a curator', body: 'Help select, sequence, and annotate the works in a collection. Lend your scholarship to the catalogue.', cta: 'Apply to curate', href: '/welcome', primary: false },
              { kicker: 'Support', title: 'Become a patron', body: 'Fund new high-resolution scans and first translations. Every work you help recover stays open to everyone.', cta: 'Become a patron', href: '/support', primary: true },
            ].map((c) => (
              <div key={c.title} className="border border-border-light bg-white p-6 flex flex-col">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-3">{c.kicker}</div>
                <h3 className="text-lg font-semibold text-primary mb-2 font-display">{c.title}</h3>
                <p className="text-sm text-secondary mb-5 font-body flex-1">{c.body}</p>
                {c.primary ? (
                  <Link href={c.href} className={`${BTN_DARK} self-start`}>{c.cta} <ArrowRight className="w-4 h-4" /></Link>
                ) : (
                  <Link href={c.href} className={`${RUST_LINK} self-start`}>{c.cta} <ArrowRight className="w-3.5 h-3.5" /></Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <SignUpCTA />
    </div>
  );
}
