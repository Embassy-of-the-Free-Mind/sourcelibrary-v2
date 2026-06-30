import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ArrowRight } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { getPageImageUrl } from '@/lib/page-image-url';
import { bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import { tenantBookUrl } from '@/lib/slugify';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import MycoSlider, { type MiniBook } from '@/app/collections/mycology/_components/MycoSlider';
import MycoMasonry from '@/app/collections/mycology/_components/MycoMasonry';
import MycoAnchorBar from '@/app/collections/mycology/_components/MycoAnchorBar';
import LibrarianSearch from '@/app/collections/mycology/_components/LibrarianSearch';
import QuoteBlock, { type Quote } from '@/app/collections/mycology/_components/QuoteBlock';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import ParallaxImage from '@/components/ParallaxImage';
import { getImageFraming } from '@/lib/image-framing';
import { dedupeImages, nearDupeSignature, weaveBySubject, topicTermsFromName } from '@/lib/collection-image-ranking';

/*
 * Reusable collection-page template (the mycology redesign, generalised). Applied
 * ONLY to collections that have a config in src/lib/collection-templates.ts — the
 * approval gate. Everything is derived from the collection's own data; the config
 * supplies the authored copy (hero, intro, verified quotes) and any per-collection
 * overrides (mycology's bespoke featured block, local assets). Existing tokens only.
 */

const BTN_DARK = 'inline-flex items-center gap-2 bg-dark text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity';
const RUST_LINK = 'inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity';
const BTN_OUTLINE = 'inline-flex items-center gap-2 border border-border-medium text-primary text-sm font-medium px-5 py-2.5 rounded-lg hover:border-accent-rust hover:text-accent-rust transition-colors';

export interface CollectionTemplateConfig {
  slug: string;
  meta: { title: string; description: string; ogImage?: string };
  hero: { title: string; tagline: string };
  /** Intro paragraphs; [0] is the bold hook. Authored per collection-intro-writing-rules. */
  intro: string[];
  /** Side figure. If omitted, the top-ranked gallery plate is used. `framed: false`
   *  renders a transparent engraving with no border (mycology's intro plate). */
  introImage?: { src: string; alt: string; caption?: string; href?: string; framed?: boolean };
  /** Override the featured block's TEXT. If omitted, it's derived from the featured book. */
  featured?: { title: string; byline: string; blurb: string[]; browseLabel?: string; browseHref?: string };
  quotes?: Quote[];
  quoteBg?: string;
  quoteCredit?: { text: string; href: string };
  quoteFramingKey?: string;
  /** Background darkening behind the quote band. 'soft' for busy/light plates. */
  quoteTint?: 'soft' | 'strong';
  /** Librarian section visual — a video or a still image (custom per collection).
   *  An image should carry a credit (attribution + link to its gallery page). */
  librarian?: { videoSrc?: string; imageSrc?: string; credit?: { text: string; href: string }; placeholder: string };
  /** If omitted, derived as a gallery-crop of a top plate. */
  signup?: { bgImageUrl: string; bgAttribution: { text: string; href: string } };
  /** Override the image-ranking topic terms (defaults to the hero title). */
  topicName?: string;
}

const DEFAULT_SECTIONS = [
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
  language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, description: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  is_first_translation: 1, ft_disposition: 1, 'translation_verification.disposition': 1,
} as const;

interface GalleryImg {
  book_id?: string; page_id?: string; extracted_url?: string; extractedUrl?: string;
  thumbnail_url?: string; thumbnailUrl?: string; image_url?: string; imageUrl?: string;
  description?: string; museum_description?: string; book_title?: string;
  type?: string; gallery_quality?: number;
}

function toMini(b: Record<string, unknown>): MiniBook {
  return {
    ...(b as unknown as MiniBook),
    thumbnail: sanitizeThumbnail(b.thumbnail_blob as string) || sanitizeThumbnail(b.thumbnail as string),
    ft_disposition: (b.ft_disposition as string | undefined)
      || ((b.translation_verification as Record<string, unknown> | undefined)?.disposition as string | undefined),
  };
}

const imgUrl = (g: GalleryImg) => g.extracted_url || g.extractedUrl || g.thumbnail_url || g.thumbnailUrl || g.image_url || g.imageUrl;
function thumbUrl(g: GalleryImg) {
  const t = g.thumbnail_url || g.thumbnailUrl;
  if (t) return t;
  const full = g.extracted_url || g.extractedUrl || g.image_url || g.imageUrl;
  return full ? full.replace(/(\.[a-z0-9]+)(\?.*)?$/i, '-thumb$1$2') : undefined;
}
function galleryImageId(g: GalleryImg) {
  const u = g.extracted_url || g.extractedUrl || g.image_url || g.imageUrl || '';
  const m = u.match(/\/([a-f0-9]{24}-\d+)\.[a-z0-9]+(?:[?#]|$)/i);
  return m ? m[1] : undefined;
}

interface PagePreview { id: string; kind: 'illustration' | 'text'; url: string }
const BLANK_PAGE_TYPES = new Set(['blank', 'exlibris', 'bookplate', 'digitizer-insert']);
const VISUAL_PAGE_TYPES = new Set(['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'figure', 'plate']);
const TEXT_OCR_MIN = 700;
function imgIndexFromUrl(url?: string | null) {
  if (!url) return null;
  const m = url.match(/\/0*(\d+)(?:-[a-z]+)?\.[a-z0-9]+(?:[?#]|$)/i);
  return m ? parseInt(m[1], 10) : null;
}

async function getFeaturedPagePreviews(db: Awaited<ReturnType<typeof getReadDb>>, bookId: string, coverUrl?: string | null): Promise<PagePreview[]> {
  const proj = { _id: 0, id: 1, page_number: 1, page_type: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };
  const [pages, vis] = await Promise.all([
    withTimeout(db.collection('pages').aggregate([
      { $match: { book_id: bookId } },
      { $project: { ...proj, ocrLen: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] } } },
      { $sort: { page_number: 1 } }, { $limit: 600 },
    ], { maxTimeMS: 7000 }).toArray() as Promise<Record<string, unknown>[]>, 7000, []),
    withTimeout(db.collection('gallery_images').find({ book_id: bookId, gallery_quality: { $gte: 0.5 } }, { projection: { _id: 0, page_id: 1 }, maxTimeMS: 5000 }).toArray() as Promise<Record<string, unknown>[]>, 5000, []),
  ]);
  const visIds = new Set(vis.map((g) => g.page_id as string | undefined).filter(Boolean));
  const coverIdx = imgIndexFromUrl(coverUrl);
  const isCoverPage = (p: Record<string, unknown>) => coverIdx != null && [p.archived_photo, p.cropped_photo, p.enhanced_photo, p.photo, p.photo_original].some((f) => imgIndexFromUrl(f as string | undefined) === coverIdx);
  const usable = pages.filter((p) => !BLANK_PAGE_TYPES.has((p.page_type as string) || '') && ((p.page_number as number) ?? 0) > 1 && !isCoverPage(p));
  if (!usable.length) return [];
  const isVisual = (p: Record<string, unknown>) => visIds.has(p.id as string) || VISUAL_PAGE_TYPES.has((p.page_type as string) || '');
  const hasText = (p: Record<string, unknown>) => ((p.ocrLen as number) ?? 0) >= TEXT_OCR_MIN;
  const out: PagePreview[] = []; const seen = new Set<string>();
  const push = (p: Record<string, unknown>) => {
    const id = p.id as string;
    if (!id || seen.has(id)) return;
    const url = getPageImageUrl(p as unknown as Parameters<typeof getPageImageUrl>[0], 'thumb');
    if (!url) return;
    seen.add(id); out.push({ id, kind: isVisual(p) ? 'illustration' : 'text', url });
  };
  const textPages = usable.filter(hasText); const visualPages = usable.filter(isVisual);
  for (const p of textPages) { if (out.length >= 3) break; push(p); }
  for (const p of visualPages) { if (out.length >= 5) break; push(p); }
  for (const p of textPages) { if (out.length >= 5) break; push(p); }
  for (const p of usable) { if (out.length >= 5) break; push(p); }
  return out;
}

export async function getCollectionData(slug: string) {
  const db = await withTimeout(getReadDb(), 10000, null as unknown as Awaited<ReturnType<typeof getReadDb>>);
  if (!db) throw new Error('DB connection timeout');
  const collection = await withTimeout(db.collection('collections').findOne({ slug }), 8000, null);
  if (!collection) return null;
  const books = db.collection('books');
  const [firstRaw, sourceRaw, ftCount, total, yearAgg, bookIdDocs] = await Promise.all([
    withTimeout(books.find({ collections: slug, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true }, { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ pages_translated: -1, year: 1 }).limit(60).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.find({ collections: slug, visible: true, pages_count: { $gt: 0 }, is_first_translation: { $ne: true } }, { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ year: 1, title: 1 }).limit(12).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.countDocuments({ collections: slug, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true }, { maxTimeMS: 8000 }), 8000, 0),
    withTimeout(Promise.resolve(collection.book_count as number | undefined).then((c) => c ?? books.countDocuments({ collections: slug, visible: true, pages_count: { $gt: 0 } }, { maxTimeMS: 8000 })), 8000, 0),
    withTimeout(books.aggregate([{ $match: { collections: slug, visible: true, year: { $type: 'number', $gt: 0 } } }, { $group: { _id: null, min: { $min: '$year' }, max: { $max: '$year' } } }], { maxTimeMS: 8000 }).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.find({ collections: slug, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray() as Promise<Record<string, unknown>[]>, 5000, []),
  ]);
  const bookIds = bookIdDocs.map((d) => d.id as string);
  const galleryRaw = bookIds.length
    ? await withTimeout(db.collection('gallery_images').find({ book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } }, { projection: { _id: 0 }, maxTimeMS: 5000 }).sort({ gallery_quality: -1 }).limit(80).toArray() as Promise<Record<string, unknown>[]>, 5000, [])
    : [];
  const firstTranslations = firstRaw.map(toMini);
  const sourceWorks = sourceRaw.map(toMini);
  const gallery = JSON.parse(JSON.stringify(galleryRaw)) as GalleryImg[];
  const featured = firstRaw[0] ? toMini(firstRaw[0]) : (sourceRaw[0] ? toMini(sourceRaw[0]) : null);
  const featuredPages = featured ? await getFeaturedPagePreviews(db, featured.id, getBookThumbnailUrl(featured)) : [];
  const yr = yearAgg[0] as { min?: number; max?: number } | undefined;
  const languages = ((collection.languages as { lang: string; count: number }[] | undefined) || []).filter((l) => l.count > 0).map((l) => l.lang);
  return {
    firstTranslations, sourceWorks, ftCount, total,
    dateRange: yr && yr.min && yr.max ? { min: yr.min, max: yr.max } : null,
    languages, gallery, featured, featuredPages,
  };
}

export default async function CollectionTemplate({ config }: { config: CollectionTemplateConfig }) {
  const data = await getCollectionData(config.slug);
  if (!data) notFound();
  const { firstTranslations, sourceWorks, ftCount, total, dateRange, languages, gallery, featured, featuredPages } = data;

  const topicTerms = topicTermsFromName(config.topicName || config.hero.title);
  // Dedupe exact repeats, then content near-duplicates (same plate, two records).
  const exact = dedupeImages(gallery, (g) => galleryImageId(g) || imgUrl(g));
  const deduped = dedupeImages(exact, nearDupeSignature);
  const rankedGallery = weaveBySubject(deduped, topicTerms);
  const galleryTotal = rankedGallery.length;
  const galleryPlates = rankedGallery.filter((g) => imgUrl(g)).slice(0, 20).map((g) => {
    const imageId = galleryImageId(g);
    return { src: thumbUrl(g) as string, fallback: imgUrl(g), href: imageId ? `/gallery/image/${imageId}` : undefined, label: g.museum_description || g.description || g.book_title };
  });

  // Intro side image: config override, else the top-ranked gallery plate.
  const topPlate = rankedGallery.find((g) => imgUrl(g));
  const topPlateId = topPlate ? galleryImageId(topPlate) : undefined;
  const intro = config.introImage
    ? config.introImage
    : (topPlate ? { src: imgUrl(topPlate)!, alt: `Plate from ${config.hero.title}`, caption: (topPlate.book_title as string) || 'From the collection', href: topPlateId ? `/gallery/image/${topPlateId}` : undefined, framed: true } : null);

  const worksMore = Math.max(0, total - Math.min(sourceWorks.length, 10));
  const featuredHref = featured ? tenantBookUrl({ id: featured.id, slug: featured.slug }, null) : '#';
  const featuredDesc = (featured as unknown as { description?: string })?.description;
  const quoteFraming = config.quoteFramingKey ? await getImageFraming(config.quoteFramingKey) : null;
  const signupBgId = rankedGallery[1] ? galleryImageId(rankedGallery[1]) : topPlateId;
  const signup = config.signup
    || (signupBgId ? { bgImageUrl: `/api/gallery-crop/${signupBgId}`, bgAttribution: { text: (rankedGallery[1]?.book_title as string) ? `Image: ${rankedGallery[1]?.book_title}` : 'Image from the collection', href: `/gallery/image/${signupBgId}` } } : undefined);

  return (
    <div className="min-h-screen bg-cream">
      <ConditionalSiteHeader variant="dark" />

      {/* Hero */}
      <section className="relative bg-dark overflow-hidden min-h-[66vh] flex items-end">
        <ParallaxImage src={`/api/collections/${config.slug}/hero-collage`} loading="eager" strength={0.08} oversize={0.1} />
        <div className="absolute inset-0 md:hidden bg-gradient-to-t from-dark/85 via-dark/45 to-dark/5" />
        <div className="absolute inset-0 hidden md:block bg-gradient-to-r from-dark/90 via-dark/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 hidden md:block bg-gradient-to-t from-dark/85 via-dark/35 to-transparent" />
        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 pt-12 pb-10">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/60 mb-6">
            <Link href="/collections" className="hover:text-white/90 transition-colors">Collections</Link>
          </nav>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">{config.hero.title}</h1>
          <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-5">{config.hero.tagline}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{total.toLocaleString('en-US')} works</span>
            {ftCount > 0 && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{ftCount} first translation{ftCount === 1 ? '' : 's'}</span>}
            {dateRange && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{dateRange.min} &ndash; {dateRange.max}</span>}
            {languages.length > 0 && <span className="text-xs sm:text-sm text-white/80 border border-white/20 px-3 py-1">{languages.join(' · ')}</span>}
          </div>
        </div>
      </section>

      <MycoAnchorBar sections={DEFAULT_SECTIONS} slug={config.slug} />

      {/* Introduction */}
      <section id="introduction" className="bg-warm border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <div className="flex flex-col md:flex-row-reverse md:items-start gap-8 lg:gap-12">
            <div className="font-body flex-1 min-w-0">
              <p className="text-xl sm:text-3xl text-primary leading-snug mb-6">{config.intro[0]}</p>
              {config.intro.slice(1).map((p, i) => <p key={i} className="text-secondary leading-relaxed mb-4 max-w-2xl">{p}</p>)}
            </div>
            {intro && (
              <figure className="w-full md:w-[min(33%,53.333vh)] shrink-0 m-0 mx-auto md:mx-0">
                {intro.framed === false ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={intro.src} alt={intro.alt} loading="lazy" decoding="async" className="w-full h-auto" />
                ) : (
                  <div className="relative aspect-[3/4] overflow-hidden bg-dark/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={intro.src} alt={intro.alt} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                  </div>
                )}
                {intro.caption && (
                  <figcaption className="mt-2 text-xs text-muted text-center">
                    {intro.href ? <Link href={intro.href} className="hover:text-primary transition-colors">{intro.caption}</Link> : intro.caption}
                  </figcaption>
                )}
              </figure>
            )}
          </div>
        </div>
      </section>

      {/* First translations */}
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

      {/* Featured */}
      {featured && (
        <section id="featured" className="bg-warm border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <div className="flex flex-col md:flex-row md:items-start gap-8 lg:gap-14">
              <div className="w-full md:w-[min(33%,53.333vh)] shrink-0 flex gap-3 md:block">
                <div className="w-4/5 md:w-full relative aspect-[2/3] overflow-hidden bg-warm shadow-md">
                  {getBookThumbnailUrl(featured) ? (
                    <Image src={getBookThumbnailUrl(featured)!} alt={bookTitle(featured)} fill className="object-cover" sizes="(min-width:768px) 420px, 80vw" />
                  ) : <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-12 h-12 text-muted" /></div>}
                </div>
                {featuredPages.length > 0 && (
                  <div className="w-1/5 flex flex-col gap-2 md:hidden">
                    {featuredPages.slice(0, 4).map((p) => (
                      <Link key={p.id} href={`${featuredHref}/page/${p.id}`} title="Page from the work" className="relative aspect-[2/3] overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-rust mb-3">Featured</p>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-primary leading-[1.06] mb-3" style={{ fontFamily: 'var(--font-serif)' }}>{config.featured?.title || bookTitle(featured)}</h2>
                <p className="text-sm text-muted mb-6">
                  {config.featured ? <span className="italic">{config.featured.byline}</span> : (<>
                    {featured.author && <span className="italic">by {featured.author}</span>}
                    <span className="font-mono text-[11px] uppercase tracking-wider">{featured.year ? ` · ${featured.year}` : ''}{featured.language ? ` · ${featured.language}` : ''}</span>
                  </>)}
                </p>
                {(config.featured?.blurb || (featuredDesc ? [featuredDesc] : [])).map((p, i) => (
                  <p key={i} className="text-secondary leading-relaxed font-body mb-3 max-w-prose">{p}</p>
                ))}
                {featuredPages.length > 0 && (
                  <div className="hidden md:block mb-8 mt-5">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-gold mb-3">Inside the book</p>
                    <div className="flex gap-3">
                      {featuredPages.map((p) => (
                        <Link key={p.id} href={`${featuredHref}/page/${p.id}`} title="Page from the work" className="group relative aspect-[2/3] flex-1 overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <Link href={featuredHref} className={BTN_DARK}>Read in full <ArrowRight className="w-4 h-4" /></Link>
                  <Link href={config.featured?.browseHref || `/gallery?collection=${config.slug}`} className={BTN_OUTLINE}>{config.featured?.browseLabel || 'Browse the plates'} <ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Gallery */}
      {galleryPlates.length > 0 && (
        <section id="gallery" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-1">Gallery</h2>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Plates, figures, engravings, and other visual material from across the collection.</p>
            <div className="relative max-h-[560px] sm:max-h-[1000px] lg:max-h-[1200px] overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, #000 80%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent)' }}>
              <MycoMasonry plates={galleryPlates} />
            </div>
            <div className="mt-6 flex justify-center">
              <Link href={`/gallery?collection=${config.slug}`} className={BTN_DARK}>View all {galleryTotal.toLocaleString('en-US')} plates <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </section>
      )}

      {/* Librarian */}
      <section id="librarian" className="bg-warm border-y border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16 flex flex-col md:flex-row md:items-center gap-10 lg:gap-16">
          {(config.librarian?.videoSrc || config.librarian?.imageSrc) && (
            <figure className="w-full max-w-[520px] mx-auto md:mx-0 shrink-0 m-0 lg:w-auto lg:max-w-none">
              {config.librarian.videoSrc ? (
                <video className="w-full h-auto mix-blend-multiply lg:w-auto lg:h-[74vh]" autoPlay loop muted playsInline preload="metadata">
                  <source src={config.librarian.videoSrc} type="video/mp4" />
                </video>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.librarian.imageSrc} alt="" loading="lazy" decoding="async" className="w-full h-auto mix-blend-multiply lg:h-[74vh] lg:w-auto object-contain" />
              )}
              {config.librarian.imageSrc && config.librarian.credit && (
                <figcaption className="mt-2 text-xs text-muted text-center">
                  <Link href={config.librarian.credit.href} className="hover:text-primary transition-colors">{config.librarian.credit.text}</Link>
                </figcaption>
              )}
            </figure>
          )}
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-accent-rust mb-3">Ask the librarian</p>
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-3">Search inside every book</h2>
            <p className="text-secondary leading-relaxed font-body mb-7">The librarian reads the full transcribed text and the description of every illustration in each book that has been digitised here. Ask a question in plain language and it points you to the exact page, passage, or plate that answers it.</p>
            <LibrarianSearch placeholder={config.librarian?.placeholder || 'Ask the librarian a question…'} />
          </div>
        </div>
      </section>

      {/* Works */}
      <section id="works" className="bg-cream border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <div className="flex items-end justify-between gap-4 mb-1">
            <h2 className="text-2xl sm:text-3xl text-primary font-display">Works in this collection</h2>
            <Link href={`/catalog?collection=${config.slug}`} className={`${BTN_DARK} whitespace-nowrap`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Showing {Math.min(sourceWorks.length, 10)} of {total.toLocaleString('en-US')} · original source texts first, translations are gathered in the slider above.</p>
          {sourceWorks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {sourceWorks.slice(0, 10).map((b) => <CollectionBookCard key={b.id} book={b as unknown as CollectionBook} />)}
            </div>
          ) : <p className="text-sm text-muted">No source-text works to show.</p>}
          <div className="mt-8 border border-border-light bg-cream p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-primary font-medium font-body">{worksMore.toLocaleString('en-US')} more works in this collection</p>
              <p className="text-sm text-muted">The full catalogue lives on a dedicated, paginated browse page.</p>
            </div>
            <Link href={`/catalog?collection=${config.slug}`} className={`${BTN_DARK} self-start sm:self-auto`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
        </div>
      </section>

      {/* Quote band */}
      {config.quotes && config.quotes.length > 0 && (
        <QuoteBlock bgUrl={config.quoteBg} framing={quoteFraming} imageCredit={config.quoteCredit} quotes={config.quotes} tint={config.quoteTint} />
      )}

      {/* Get involved */}
      <section id="involved" className="bg-cream scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">Get involved</h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">Source Library is built in the open. Every contribution keeps these works free to read.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-border-light bg-white p-6 flex flex-col">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Open to all</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Leave feedback</h3>
              <p className="text-sm text-secondary mb-5 font-body flex-1">Spot an error, a missing edition, or a better translation of a passage? Tell us, corrections ship fast.</p>
              <FeedbackWidget label="Send feedback" className={`${RUST_LINK} self-start`} />
            </div>
            <div className="border border-border-light bg-white p-6 flex flex-col">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Support</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Become a patron</h3>
              <p className="text-sm text-secondary mb-5 font-body flex-1">Fund new high-resolution scans and first translations. Every work you help recover stays open to everyone.</p>
              <Link href="/support" className={`${BTN_DARK} self-start`}>Become a patron <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      {signup && <SignUpCTA bgImageUrl={signup.bgImageUrl} bgAttribution={signup.bgAttribution} />}
    </div>
  );
}
