import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, ArrowRight } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import HeroScrim from '@/components/HeroScrim';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { getReadDb } from '@/lib/mongodb';
import { getPageImageUrl } from '@/lib/page-image-url';
import { notFound } from 'next/navigation';
import { bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import { tenantBookUrl } from '@/lib/slugify';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import MycoSlider, { type MiniBook } from './_components/MycoSlider';
import MycoMasonry from './_components/MycoMasonry';
import ParallaxImage from '@/components/ParallaxImage';
import CollectionAnchorBar from '@/components/CollectionAnchorBar';
import QuoteBlock from './_components/QuoteBlock';
import { getImageFraming } from '@/lib/image-framing';
import LibrarianSearch from '@/components/LibrarianSearch';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

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
const RUST_LINK = 'inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity';
const BTN_OUTLINE = 'inline-flex items-center gap-2 border border-border-medium text-primary text-sm font-medium px-5 py-2.5 rounded-lg hover:border-accent-rust hover:text-accent-rust transition-colors';

const OG_TITLE = 'Fungi & Mycology — Source Library';
const OG_DESC = 'Fungi built the soil that built our world. These are the books that first studied them — original source texts and first English translations on Source Library.';

export const metadata: Metadata = {
  title: OG_TITLE,
  description: OG_DESC,
  alternates: { canonical: '/collections/mycology' },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESC,
    url: '/collections/mycology',
    siteName: 'Source Library',
    type: 'website',
    images: [{ url: '/collections/mycology/og.jpg', width: 1200, height: 800, alt: OG_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESC,
    images: ['/collections/mycology/og.jpg'],
  },
};

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'translations', label: 'First translations' },
  { id: 'featured', label: 'Featured' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'librarian', label: 'Librarian' },
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

// Small thumbnail (~12KB) for grids — prefer a stored thumb, else derive the
// `-thumb` variant from the full URL. Keep imgUrl() as the full-res fallback.
function thumbUrl(img: GalleryImg): string | undefined {
  const t = img.thumbnail_url || img.thumbnailUrl;
  if (t) return t;
  const full = img.extracted_url || img.extractedUrl || img.image_url || img.imageUrl;
  return full ? full.replace(/(\.[a-z0-9]+)(\?.*)?$/i, '-thumb$1$2') : undefined;
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
  const galleryFilter = { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } };
  // The count must mirror what /api/gallery actually serves — it also drops
  // images with no extracted crop or missing source photo — or the "view all N"
  // link promises more than the page it lands on shows.
  const galleryCountFilter = { ...galleryFilter, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } };
  const [galleryRaw, galleryCount] = bookIds.length
    ? await Promise.all([
      withTimeout(db.collection('gallery_images').find(galleryFilter, { projection: { _id: 0 }, maxTimeMS: 5000 })
        .sort({ gallery_quality: -1 }).limit(60).toArray() as Promise<Record<string, unknown>[]>, 5000, []),
      // The array above is capped at 60. Reporting its length as the plate count
      // told readers this collection had 60 plates when it has thousands.
      withTimeout(db.collection('gallery_images').countDocuments(galleryCountFilter, { maxTimeMS: 5000 }), 5000, 0),
    ])
    : [[] as Record<string, unknown>[], 0];

  const firstTranslations = firstRaw.map(toMini);
  const sourceWorks = sourceRaw.map(toMini);
  const gallery = JSON.parse(JSON.stringify(galleryRaw)) as GalleryImg[];
  const featured = [...firstTranslations].sort((a, b) => ((b.pages_translated as number) ?? 0) - ((a.pages_translated as number) ?? 0))[0] || null;
  const [featuredPages, parentDoc] = await Promise.all([
    featured ? getFeaturedPagePreviews(db, featured.id, getBookThumbnailUrl(featured)) : Promise.resolve([] as PagePreview[]),
    collection.parent ? withTimeout(db.collection('collections').findOne({ slug: collection.parent as string }, { projection: { _id: 0, slug: 1, name: 1 } }), 5000, null) : Promise.resolve(null),
  ]);
  const parent = parentDoc ? { slug: parentDoc.slug as string, name: parentDoc.name as string } : null;
  const yr = yearAgg[0] as { min?: number; max?: number } | undefined;
  const languages = ((collection.languages as { lang: string; count: number }[] | undefined) || []).filter((l) => l.count > 0).map((l) => l.lang);

  return {
    collection: JSON.parse(JSON.stringify(collection)) as Record<string, unknown>,
    firstTranslations, sourceWorks, ftCount, total, galleryCount,
    dateRange: yr && yr.min && yr.max ? { min: yr.min, max: yr.max } : null,
    languages, gallery, featured, featuredPages, parent,
  };
}

interface PagePreview { id: string; page_number?: number; kind: 'illustration' | 'text'; url: string }

// Two clearly-DIFFERENT interior illustration pages of the featured work.
// Derived from gallery_images (never blank), deduped by page, then chosen from
// well-separated points in the book (≈35% and ≈80% through the high-quality
// plates) so the two previews are distinct — not the cover, not a colour/plain
// pair of the same plate sitting on adjacent leaves.
// Preview rule: the first 3 pages with ACTUAL TEXT (substantial OCR — skips the
// cover, marbled endpapers, blanks, library stamps, and bare title pages) PLUS at
// least 2 pages with visual art (figures/plates). Never the cover. If the book has
// no visuals, just the first 5 text pages. Filled to 5 where possible. The OCR-
// length gate works because junk pages OCR to a short AI description (≤~320 chars)
// while real text pages run 1,000+; the 700-char threshold sits in that gap.
const BLANK_PAGE_TYPES = new Set(['blank', 'exlibris', 'bookplate', 'digitizer-insert']);
const VISUAL_PAGE_TYPES = new Set(['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'figure', 'plate']);
const TEXT_OCR_MIN = 700;

// Page sequence number from an image URL like .../43.jpg or .../0043-thumb.jpg.
function imgIndexFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/0*(\d+)(?:-[a-z]+)?\.[a-z0-9]+(?:[?#]|$)/i);
  return m ? parseInt(m[1], 10) : null;
}

async function getFeaturedPagePreviews(
  db: Awaited<ReturnType<typeof getReadDb>>, bookId: string, coverUrl?: string | null,
): Promise<PagePreview[]> {
  const proj = { _id: 0, id: 1, page_number: 1, page_type: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };
  const [pages, vis] = await Promise.all([
    withTimeout(
      db.collection('pages').aggregate([
        { $match: { book_id: bookId } },
        { $project: { ...proj, ocrLen: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] } } },
        { $sort: { page_number: 1 } },
        { $limit: 600 },
      ], { maxTimeMS: 7000 }).toArray() as Promise<Record<string, unknown>[]>,
      7000, [],
    ),
    withTimeout(
      db.collection('gallery_images').find({ book_id: bookId, gallery_quality: { $gte: 0.5 } }, { projection: { _id: 0, page_id: 1 }, maxTimeMS: 5000 }).toArray() as Promise<Record<string, unknown>[]>,
      5000, [],
    ),
  ]);
  const visIds = new Set(vis.map((g) => g.page_id as string | undefined).filter(Boolean));
  // The page used as the book cover (so it's never repeated in the previews).
  const coverIdx = imgIndexFromUrl(coverUrl);
  const isCoverPage = (p: Record<string, unknown>) => coverIdx != null && [
    p.archived_photo, p.cropped_photo, p.enhanced_photo, p.photo, p.photo_original,
  ].some((f) => imgIndexFromUrl(f as string | undefined) === coverIdx);
  // Non-blank, not page 1, not the cover plate.
  const usable = pages.filter((p) => !BLANK_PAGE_TYPES.has((p.page_type as string) || '') && ((p.page_number as number) ?? 0) > 1 && !isCoverPage(p));
  if (!usable.length) return [];

  const isVisual = (p: Record<string, unknown>) => visIds.has(p.id as string) || VISUAL_PAGE_TYPES.has((p.page_type as string) || '');
  const hasText = (p: Record<string, unknown>) => ((p.ocrLen as number) ?? 0) >= TEXT_OCR_MIN;
  const out: PagePreview[] = [];
  const seen = new Set<string>();
  const push = (p: Record<string, unknown>) => {
    const id = p.id as string;
    if (!id || seen.has(id)) return;
    const url = getPageImageUrl(p as unknown as Parameters<typeof getPageImageUrl>[0], 'thumb');
    if (!url) return;
    seen.add(id);
    out.push({ id, page_number: p.page_number as number | undefined, kind: isVisual(p) ? 'illustration' : 'text', url });
  };

  const textPages = usable.filter(hasText);
  const visualPages = usable.filter(isVisual);

  for (const p of textPages) { if (out.length >= 3) break; push(p); }    // first 3 with real text
  for (const p of visualPages) { if (out.length >= 5) break; push(p); }  // at least 2 visuals
  for (const p of textPages) { if (out.length >= 5) break; push(p); }    // top up with more text
  for (const p of usable) { if (out.length >= 5) break; push(p); }       // last resort: any usable
  return out;
}

export default async function MycologyCollectionPage() {
  let data;
  try { data = await getMycologyData(); } catch (err) {
    console.error('[Mycology page] data fetch failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  if (!data) notFound();

  const { collection, firstTranslations, sourceWorks, ftCount, total, galleryCount, dateRange, languages, gallery, featured, featuredPages, parent } = data;
  const parentHref = parent ? `/collections/${parent.slug}` : '/collections';
  const quoteFraming = await getImageFraming('mycology-quote-bg');

  // Quote background: the Battarra title-page engraving (lynx, owl, mushrooms),
  // cropped to the illustration with the Greek-motto banner removed.
  const quoteBg = '/collections/mycology/quote-bg.webp';
  const galleryTotal = galleryCount;
  const galleryPlates = gallery
    .filter((g) => imgUrl(g))
    .slice(0, 20)
    .map((g) => {
      // Gallery-image id is "<pageId>-<detectionIndex>", embedded in the file URL.
      const u = g.extracted_url || g.extractedUrl || g.image_url || g.imageUrl || '';
      const m = u.match(/\/([a-f0-9]{24}-\d+)\.[a-z0-9]+(?:[?#]|$)/i);
      const imageId = m ? m[1] : undefined;
      return {
        src: thumbUrl(g) as string,
        fallback: imgUrl(g),
        href: imageId ? `/gallery/image/${imageId}` : undefined,
        label: g.museum_description || g.description || g.book_title,
      };
    });
  const worksMore = Math.max(0, total - Math.min(sourceWorks.length, 10));
  const featuredHref = featured ? tenantBookUrl({ id: featured.id, slug: featured.slug }, null) : '#';

  return (
    <div className="min-h-screen bg-cream">
      {/* Dark navbar variant of the global header. Breadcrumbs live in the hero. */}
      <ConditionalSiteHeader variant="dark" />
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden min-h-[66vh] flex items-end" style={{ background: '#14100c' }}>
        {/* One composited collage image (2:3 tiles) — single optimized load, subtle parallax. */}
        <ParallaxImage src={`/api/collections/${SLUG}/hero-collage`} loading="eager" strength={0.08} oversize={0.1} />
        {/* Mobile: vertical tint — strongest at the bottom (text), light at top. */}
        <div className="absolute inset-0 md:hidden bg-gradient-to-t from-dark/85 via-dark/45 to-dark/5" />
        {/* Desktop: the book hero's tint, so the two read as one system —
            see src/components/HeroScrim.tsx. The previous stack was a
            left-weighted gradient plus a bottom fade with no flat base scrim,
            which left the collage bright and cool where the book hero is evenly
            darkened and warm. */}
        <div className="absolute inset-0 hidden md:block">
          <HeroScrim />
        </div>

        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 pt-12 pb-10">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/60 mb-6">
            <Link href="/collections" className="hover:text-white/90 transition-colors">Collections</Link>
            {parent && (
              <>
                <span className="text-white/30">/</span>
                <Link href={parentHref} className="hover:text-white/90 transition-colors">{parent.name}</Link>
              </>
            )}
          </nav>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">Fungi &amp; Mycology</h1>
          <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-5">Fungi built the soil that built our world. These are the books that first studied them.</p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Stat chips borrow the book hero's colour language so the two read as
                one system: soft blue for scope, green for language coverage, gold
                for the first-translation claim. Same tones as book/[id] page.tsx. */}
            <span className="text-xs sm:text-sm px-3 py-1 border" style={{ color: '#e8e2d6', borderColor: 'rgba(232,226,214,0.3)' }}>{total.toLocaleString('en-US')} works</span>
            {ftCount > 0 && (
              <span className="text-xs sm:text-sm px-3 py-1 border" style={{ color: '#e0b46a', borderColor: 'rgba(224,180,106,0.42)' }}>{ftCount} first translation{ftCount === 1 ? '' : 's'}</span>
            )}
            {dateRange && (
              <span className="text-xs sm:text-sm px-3 py-1 border" style={{ color: '#8fbfe6', borderColor: 'rgba(143,191,230,0.4)' }}>{dateRange.min} – {dateRange.max}</span>
            )}
            {languages.length > 0 && (
              <span className="text-xs sm:text-sm px-3 py-1 border" style={{ color: '#86c98f', borderColor: 'rgba(134,201,143,0.4)' }}>{languages.join(' · ')}</span>
            )}
          </div>
        </div>
      </section>

      {/* ===== Anchor row (client: jump collapse + Share/Embed popovers) ===== */}
      <CollectionAnchorBar sections={SECTIONS} slug={SLUG} />

      {/* ===== Introduction ===== */}
      <section id="introduction" className="bg-warm border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <div className="flex flex-col md:flex-row-reverse md:items-start gap-8 lg:gap-12">
            <div className="font-body flex-1 min-w-0">
              {/* Lead — larger; fills the available width beside the video. */}
              <p className="text-xl sm:text-3xl text-primary leading-snug mb-6">
                Fungi feed forests and ferment bread, heal and poison, and break the dead back down into the soil that feeds the living. People gathered and used them for centuries before anyone could say what they even were: not quite plant, not quite animal, but a kingdom of their own.
              </p>
              <p className="text-secondary leading-relaxed mb-4 max-w-2xl">
                The books that worked this out run from pocket field guides to vast scientific surveys. Sterbeeck wrote the first work devoted entirely to mushrooms; Bulliard had each species painted from life, in plates still prized for their accuracy; Persoon and Fries built the orderings the whole field still rests on. Much of this writing survives only in Latin, French, and German, reachable until now mainly through citation while the pages themselves sat unread.
              </p>
              <p className="text-secondary leading-relaxed max-w-2xl">
                Read directly, these works show a science built from close looking. A plate Bulliard coloured by hand can be set beside the mushroom in your hand, a poisoning described in an old treatise matched to the species that caused it, the long work of separating the edible from the deadly followed across two centuries of patient observation.
              </p>
            </div>
            {/* Intro plate — Tulasne frontispiece engraving (transparent ground, no frame). */}
            <figure className="w-full md:w-[min(33%,53.333vh)] shrink-0 m-0 mx-auto md:mx-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/collections/mycology/intro-plate.webp" alt="A microscope amid fungi, plants, and books — frontispiece engraving" loading="lazy" decoding="async" className="w-full h-auto" />
              <figcaption className="mt-2 text-xs text-muted text-center">
                <Link href="/gallery/image/69d8ca9ea09828f83ddcbbbe-0" className="hover:text-primary transition-colors">
                  Selecta Fungorum Carpologia — L.-R. &amp; C. Tulasne, 1863
                </Link>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ===== First translations — slider ===== */}
      {firstTranslations.length > 0 && (
        <section id="translations" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <div className="flex items-end justify-between gap-4 mb-1">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">First translations</h2>
              <span className="text-sm text-muted whitespace-nowrap">{firstTranslations.length} {firstTranslations.length === 1 ? 'title' : 'titles'}</span>
            </div>
            <p className="text-sm text-muted mb-2 max-w-2xl leading-relaxed">Works appearing in a modern, readable translation for the first time.</p>
            <MycoSlider books={firstTranslations} />
          </div>
        </section>
      )}

      {/* ===== Featured work ===== */}
      {featured && (
        <section id="featured" className="bg-warm border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <div className="flex flex-col md:flex-row md:items-start gap-8 lg:gap-14">
              {/* Cover (desktop: left, 33% of section width, max 80vh tall, 2:3 — matches
                  the intro video). On mobile it comes first and takes 80%, with the page
                  previews stacked in the remaining 20%. */}
              <div className="w-full md:w-[min(33%,53.333vh)] shrink-0 flex gap-3 md:block">
                <div className="w-4/5 md:w-full relative aspect-[2/3] overflow-hidden bg-warm shadow-md">
                  {getBookThumbnailUrl(featured) ? (
                    <Image src={getBookThumbnailUrl(featured)!} alt={bookTitle(featured)} fill className="object-cover" sizes="(min-width:768px) 420px, 80vw" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-12 h-12 text-muted" /></div>
                  )}
                </div>
                {featuredPages.length > 0 && (
                  <div className="w-1/5 flex flex-col gap-2 md:hidden">
                    {featuredPages.slice(0, 4).map((p) => (
                      <Link key={p.id} href={`${featuredHref}/page/${p.id}`} title="Page from the work"
                        className="relative aspect-[2/3] overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Content (desktop: right column) */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-rust mb-3">Featured</p>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-primary leading-[1.06] mb-3" style={{ fontFamily: 'var(--font-serif)' }}>Histoire des Champignons de la France</h2>
                <p className="text-sm text-muted mb-6">
                  <span className="italic">by Pierre Bulliard</span>
                  <span className="font-mono text-[11px] uppercase tracking-wider"> · 1780&ndash;1791{featured.language ? ` · ${featured.language}` : ''}</span>
                </p>
                <p className="text-secondary leading-relaxed font-body mb-3 max-w-prose">An illustrated flora of the fungi of France, issued in parts from 1780 and gathered into volumes in 1791, with more than six hundred plates engraved and coloured by hand from living specimens.</p>
                <p className="text-secondary leading-relaxed font-body mb-8 max-w-prose">Among the first works to render fungi in full, accurate colour, it remained a standard reference for identification well into the following century.</p>

                {/* Inside the book — horizontal preview row (desktop; on mobile the
                    previews sit beside the cover above). */}
                {featuredPages.length > 0 && (
                  <div className="hidden md:block mb-8">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-gold mb-3">Inside the book</p>
                    <div className="flex gap-3">
                      {featuredPages.map((p) => (
                        <Link key={p.id} href={`${featuredHref}/page/${p.id}`} title="Page from the work"
                          className="group relative aspect-[2/3] flex-1 overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Link href={featuredHref} className={BTN_DARK}>Read in full <ArrowRight className="w-4 h-4" /></Link>
                  <Link href={`/gallery?collection=${SLUG}&maxPerBook=999`} className={BTN_OUTLINE}>Browse all {galleryTotal.toLocaleString('en-US')} plates <ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== Gallery — all visual material ===== */}
      {gallery.length > 0 && (
        <section id="gallery" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-1">Gallery</h2>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Plates, figures, engravings, and other visual material from across the collection.</p>
            {/* Balanced masonry (true heights, no crop), capped + faded into the page
                so the ragged bottom is hidden. Cap is static (server-rendered). */}
            <div
              className="relative max-h-[560px] sm:max-h-[1000px] lg:max-h-[1200px] overflow-hidden"
              style={{
                maskImage: 'linear-gradient(to bottom, #000 80%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent)',
              }}
            >
              <MycoMasonry plates={galleryPlates} />
            </div>
            <div className="mt-6 flex justify-center">
              <Link href={`/gallery?collection=${SLUG}&maxPerBook=999`} className={BTN_DARK}>View all {galleryTotal.toLocaleString('en-US')} plates <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </section>
      )}

      {/* ===== Ask the librarian ===== */}
      <section id="librarian" className="bg-warm border-y border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16 flex flex-col md:flex-row md:items-center gap-10 lg:gap-16">
          {/* Video left, multiply-blended so its light backdrop melts into the section bg. */}
          <div className="w-full max-w-[520px] mx-auto md:mx-0 shrink-0 lg:w-auto lg:max-w-none">
            <video className="w-full h-auto mix-blend-multiply lg:w-auto lg:h-[74vh]" autoPlay loop muted playsInline preload="metadata">
              <source src="/collections/mycology/librarian.mp4" type="video/mp4" />
            </video>
          </div>
          {/* Text right, left-aligned. */}
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-accent-rust mb-3">Ask the librarian</p>
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-3">Search inside every book</h2>
            <p className="text-secondary leading-relaxed font-body mb-7">
              The librarian reads the full transcribed text and the description of every illustration in each book that has been digitised here. Ask a question in plain language and it points you to the exact page, passage, or plate that answers it.
            </p>
            <LibrarianSearch placeholder="Ask a question about mycology…" />
          </div>
        </div>
      </section>

      {/* ===== Works in this collection — bounded grid + handoff ===== */}
      <section id="works" className="bg-cream border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <div className="flex items-end justify-between gap-4 mb-1">
            <h2 className="text-2xl sm:text-3xl text-primary font-display">Works in this collection</h2>
            <Link href={`/catalog?collection=${SLUG}`} className={`${BTN_DARK} whitespace-nowrap`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Showing {Math.min(sourceWorks.length, 10)} of {total.toLocaleString('en-US')} · original source texts first, translations are gathered in the slider above.</p>
          {sourceWorks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {sourceWorks.slice(0, 10).map((b) => <CollectionBookCard key={b.id} book={b as unknown as CollectionBook} />)}
            </div>
          ) : (
            <p className="text-sm text-muted">No source-text works to show.</p>
          )}
          <div className="mt-8 border border-border-light bg-cream p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-primary font-medium font-body">{worksMore.toLocaleString('en-US')} more works in mycology</p>
              <p className="text-sm text-muted">The full catalogue lives on a dedicated, paginated browse page.</p>
            </div>
            <Link href={`/catalog?collection=${SLUG}`} className={`${BTN_DARK} self-start sm:self-auto`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
        </div>
      </section>

      {/* ===== Quote band — cycles through sourced passages from the collection.
          Text pulled from the books' own OCR + translations (per-book search API). */}
      <QuoteBlock
        bgUrl={quoteBg}
        framing={quoteFraming}
        imageCredit={{
          text: 'Image: Battarra, Fungorum Agri Ariminensis Historia, 1755.',
          href: '/gallery/image/69d8ca06a09828f83ddc973f-0',
        }}
        quotes={[
          {
            translated: 'There is diverse sort: their water is the rain, their mother the oak-tree, the nurse. … Here comes this clear star, that parts the evil from the good: the life from the death, the poison from the medicine, the darkness from the light.',
            original: "Daer is diverse soort: hun waeder is den reghen; hun moeder, Eycken-boom, de voester. … Hier comt dees clare STER, die scheydt het quaet uyt goet: het leven uyt de doodt, 't vergif uyt medecyn, het duyster uyt het licht.",
            language: 'Dutch',
            attribution: 'Sterbeeck, Theatrum Fungorum, 1675',
            href: '/book/theatrum-fungorum-oft-het-toonsel-der-campernoelien-9371',
          },
          {
            translated: 'Who does not see how thin the seed of fungi must be, that it can readily fly through the air, as the seeds of capillary plants are wont to do?',
            original: 'Quis enim non videt quam tenue esse debeat Fungorum semen, ut facili negotio concipi possit per aerem volitare, ut Capillarium plantarum semina solent?',
            language: 'Latin',
            attribution: 'Battarra, Fungorum Agri Ariminensis Historia, 1755',
            href: '/book/fungorum-agri-ariminensis-historia-973a',
          },
          {
            translated: 'If those who claim that all mushrooms are engendered only by corruption, that they have no seeds, no constant characters by which one can distinguish them, had taken the trouble to study their organization, to follow them in their growth, and to compare them, they would undoubtedly blush at their error.',
            original: "Si ceux qui prétendent que tous les champignons ne sont engendrés que par la corruption, qu'ils n'ont point de semences, point de caractères constans auxquels on puisse les distinguer, eussent pris la peine d'en étudier l'organisation, de les suivre dans leur accroissement, de les comparer, ils rougiroient sans doute de leur erreur.",
            language: 'French',
            attribution: 'Bulliard, Histoire des Champignons de la France, 1791',
            href: '/book/histoire-des-champignons-de-la-france-vol-1-9a51',
          },
          {
            translated: 'This mushroom produces almost the same effect among these peoples as opium among the Turks: at the dose of one, a delirium sometimes cheerful; at two, a sort of drunkenness or furious delirium; and finally at three or four, death, or a state that approaches it.',
            original: "Ce champignon produit à peu-près le même effet chez ces peuples, que l'opium chez les Turcs, c'est-à-dire, qu'à la dose d'un seul, il produit un délire quelquefois gai; à la dose de deux, une sorte d'ivresse ou de délire furieux; et enfin à la dose de trois ou quatre, la mort ou un état qui en approche.",
            language: 'French',
            attribution: 'Paulet, Treatise on Mushrooms, 1793',
            href: '/book/trait-des-champignons-9e05',
          },
          {
            translated: 'When will one begin to have a just idea of the utility of mushrooms? It will only be when a certain number of people spread across the various regions of the earth have cultivated this part of natural history, which is still in its cradle.',
            original: "Quand est-ce que l'on commencera à se faire une idée juste sur l'utilité des champignons? Ce ne sera que lorsqu'un certain nombre de personnes répandues dans les diverses contrées de la terre auront cultivé cette partie de l'histoire naturelle encore au berceau.",
            language: 'French',
            attribution: 'Bulliard, Histoire des Champignons de la France, 1791',
            href: '/book/histoire-des-champignons-de-la-france-vol-1-9a51',
          },
          {
            translated: 'If one still sees only very few people giving themselves to the study of mushrooms, it is because, to make the study of plants easy, already so attractive in itself, much has been done, while nothing has yet been done to smooth out the difficulties with which the study of mushrooms is bristling.',
            original: "Si l'on ne voit encore que très-peu de personnes se livrer à l'étude des champignons, c'est que pour rendre facile l'étude des plantes, déjà si attrayante par elle-même, on a fait beaucoup, tandis qu'on n'a rien fait encore pour applanir les difficultés dont l'étude des champignons est hérissée.",
            language: 'French',
            attribution: 'Bulliard, Histoire des Champignons de la France, 1791',
            href: '/book/histoire-des-champignons-de-la-france-vol-1-9a51',
          },
          {
            translated: 'I in no way approve of cooks using fungi to season the pies they call Pasticci, into which butter, Parmesan, and spices enter; for it often happens, even at Rimini, that guests are badly sickened by food of this kind.',
            original: 'Denique nulla ratione probamus Coquos uti Fungis ad Offas, quas Pasticci vocant, condiendas, in quibus Butyrum, Caseum parmense, & Aromata ingrediuntur; saepe enim accidit etiam Arimini, ut hujusmodi cibis male convivae vexati sint.',
            language: 'Latin',
            attribution: 'Battarra, Fungorum Agri Ariminensis Historia, 1755',
            href: '/book/fungorum-agri-ariminensis-historia-973a',
          },
        ]}
      />

      {/* ===== Get involved ===== */}
      <section id="involved" className="bg-cream scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">Get involved</h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">Source Library is built in the open. Every contribution keeps these works free to read.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Feedback — opens the global feedback modal (same one used across the site). */}
            <div className="border border-border-light bg-white p-6 flex flex-col">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Open to all</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Leave feedback</h3>
              <p className="text-sm text-secondary mb-5 font-body flex-1">Spot an error, a missing edition, or a better translation of a passage? Tell us, corrections ship fast.</p>
              <FeedbackWidget label="Send feedback" className={`${RUST_LINK} self-start`} />
            </div>
            {/* Patron */}
            <div className="border border-border-light bg-white p-6 flex flex-col">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Support</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Become a patron</h3>
              <p className="text-sm text-secondary mb-5 font-body flex-1">Fund new high-resolution scans and first translations. Every work you help recover stays open to everyone.</p>
              <Link href="/support" className={`${BTN_DARK} self-start`}>Become a patron <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      <SignUpCTA
        bgImageUrl="/api/gallery-crop/6955d43628a09ca65928002a-0"
        bgAttribution={{
          text: 'Image: Flamsteed, Historia Coelestis Britannica, Vol. 3, 1725.',
          href: '/gallery/image/6955d43628a09ca65928002a-0',
        }}
      />
    </div>
  );
}
