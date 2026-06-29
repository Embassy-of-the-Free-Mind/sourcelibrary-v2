import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, ArrowRight } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { getReadDb } from '@/lib/mongodb';
import { getPageImageUrl } from '@/lib/page-image-url';
import { notFound } from 'next/navigation';
import { bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import { tenantBookUrl } from '@/lib/slugify';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import QuoteBlock from '../mycology/_components/QuoteBlock';
import { dedupeImages, weaveBySubject, topicTermsFromName } from '@/lib/collection-image-ranking';
import MycoSlider, { type MiniBook } from '../mycology/_components/MycoSlider';
import MycoMasonry from '../mycology/_components/MycoMasonry';
import ParallaxImage from '@/components/ParallaxImage';
import MycoAnchorBar from '../mycology/_components/MycoAnchorBar';
import LibrarianSearch from '../mycology/_components/LibrarianSearch';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

/*
 * Herbalism & Botany collection page — REDESIGN. Applies the mycology page's
 * design language to a book-heavy collection (430 works, 429 readable, 205 first
 * translations, rich gallery_images). Unlike the mycology page it derives the
 * hero/intro/featured copy from the collection's OWN stored data (description,
 * featured book's display_title + description) rather than hand-written prose, so
 * it's effectively the template driven by real data. Reuses the live mycology
 * components untouched. Existing tokens only; no new design primitives. The
 * verified-quote band is omitted (it needs a per-collection get_quote curation
 * pass — fabricating source quotes is not allowed).
 */

export const revalidate = 86400;
export const dynamic = 'force-dynamic';

const SLUG = 'herbalism';
const BTN_DARK = 'inline-flex items-center gap-2 bg-dark text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity';
const RUST_LINK = 'inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity';
const BTN_OUTLINE = 'inline-flex items-center gap-2 border border-border-medium text-primary text-sm font-medium px-5 py-2.5 rounded-lg hover:border-accent-rust hover:text-accent-rust transition-colors';

const OG_TITLE = 'Herbalism & Botany — Source Library';
const OG_DESC = 'The tradition of plant knowledge from antiquity to the Enlightenment — original herbals and first English translations on Source Library.';
const HERO_TAGLINE = 'The tradition of plant knowledge, from antiquity to the Enlightenment.';

// Authored per .claude/docs/collection-intro-writing-rules.md (three-part: hook /
// works + access / what access enables). Built from the collection's own stored
// description (Theophrastus, Dioscorides, Fuchs, Gerard, Parkinson) plus the
// featured work (Mattioli). [0] is the bold hook; the rest are body paragraphs.
const INTRO = [
  'Knowing which plants could heal, feed, or kill was among the oldest forms of practical knowledge, and the people who pursued it learned to trust nothing they had not watched grow.',
  'The discipline was assembled over two thousand years of close work. Theophrastus sorted plants into kinds; Dioscorides compiled a pharmacy that physicians leaned on for fifteen centuries; the Renaissance herbalists Fuchs, Gerard, and Parkinson paired exact description with woodcuts drawn from life, while Mattioli enlarged the ancient canon with observations of his own. Much of this survives only in Latin and the early printed folios, reached until now mainly through citation, though many of the central works, Mattioli’s vast commentary on Dioscorides among them, appear in English here for the first time.',
  'The pages reward the same patient looking that made them. A plant Fuchs had painted from a living specimen can be set beside the species pressed in a modern herbarium, a remedy recorded by Dioscorides matched to the compound that explains why it worked, the slow task of telling a healing plant from its poisonous double followed leaf by leaf across the centuries.',
];

export const metadata: Metadata = {
  title: OG_TITLE,
  description: OG_DESC,
  alternates: { canonical: '/collections/herbalism' },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESC,
    url: '/collections/herbalism',
    siteName: 'Source Library',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: OG_TITLE, description: OG_DESC },
};

// Quote band — verified page-exact via the quote API (collection-quotes skill),
// wrapper-stripped, each linked to its exact page id. Translation-only (the
// originals are not re-paired here, to avoid mis-alignment). Spread across three
// works, languages, and eras.
const QUOTES = [
  {
    translated: 'The myrtle is under the protection of Venus because it is useful for remedies of love, as are the rose and the linden tree.',
    language: 'Latin',
    attribution: 'Della Porta, Villae, 1592',
    href: '/book/villae-porta/page/69b1c642edda7fb64e1a08c0',
  },
  {
    translated: 'The Ancients hold that there are three different movements among all plants; namely, budding, flowering, and ripening…',
    language: 'French',
    attribution: 'de Serres, Théâtre d’Agriculture, 1603',
    href: '/book/le-theatre-d-agriculture-et-mesnage-des-champs-serres/page/69a5d7f94d84314297c08078',
  },
  {
    translated: 'It flowers from May until Autumn in the same year it is sown, and it perishes upon the arrival of winter.',
    language: 'Latin',
    attribution: 'Ray, Historia Plantarum, 1688',
    href: '/book/historia-plantarum-vol-ii-ray/page/6958e0d19659a6529d5772dd',
  },
];

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
  language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, description: 1,
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

function thumbUrl(img: GalleryImg): string | undefined {
  const t = img.thumbnail_url || img.thumbnailUrl;
  if (t) return t;
  const full = img.extracted_url || img.extractedUrl || img.image_url || img.imageUrl;
  return full ? full.replace(/(\.[a-z0-9]+)(\?.*)?$/i, '-thumb$1$2') : undefined;
}

function galleryImageId(img: GalleryImg): string | undefined {
  const u = img.extracted_url || img.extractedUrl || img.image_url || img.imageUrl || '';
  const m = u.match(/\/([a-f0-9]{24}-\d+)\.[a-z0-9]+(?:[?#]|$)/i);
  return m ? m[1] : undefined;
}

async function getHerbalismData() {
  const db = await withTimeout(getReadDb(), 10000, null as unknown as Awaited<ReturnType<typeof getReadDb>>);
  if (!db) throw new Error('DB connection timeout');

  const collection = await withTimeout(db.collection('collections').findOne({ slug: SLUG }), 8000, null);
  if (!collection) return null;
  const books = db.collection('books');

  const [firstRaw, sourceRaw, ftCount, total, yearAgg, bookIdDocs] = await Promise.all([
    withTimeout(books.find({ collections: SLUG, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true }, { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ pages_translated: -1, year: 1 }).limit(60).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
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
  const featured = firstRaw[0] ? toMini(firstRaw[0]) : (sourceRaw[0] ? toMini(sourceRaw[0]) : null);
  const featuredPages = featured ? await getFeaturedPagePreviews(db, featured.id, getBookThumbnailUrl(featured)) : [];
  const yr = yearAgg[0] as { min?: number; max?: number } | undefined;
  const languages = ((collection.languages as { lang: string; count: number }[] | undefined) || []).filter((l) => l.count > 0).map((l) => l.lang);

  return {
    collection: JSON.parse(JSON.stringify(collection)) as Record<string, unknown>,
    firstTranslations, sourceWorks, ftCount, total,
    dateRange: yr && yr.min && yr.max ? { min: yr.min, max: yr.max } : null,
    languages, gallery, featured, featuredPages,
  };
}

interface PagePreview { id: string; page_number?: number; kind: 'illustration' | 'text'; url: string }

const BLANK_PAGE_TYPES = new Set(['blank', 'exlibris', 'bookplate', 'digitizer-insert']);
const VISUAL_PAGE_TYPES = new Set(['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'figure', 'plate']);
const TEXT_OCR_MIN = 700;

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
  const coverIdx = imgIndexFromUrl(coverUrl);
  const isCoverPage = (p: Record<string, unknown>) => coverIdx != null && [
    p.archived_photo, p.cropped_photo, p.enhanced_photo, p.photo, p.photo_original,
  ].some((f) => imgIndexFromUrl(f as string | undefined) === coverIdx);
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
  for (const p of textPages) { if (out.length >= 3) break; push(p); }
  for (const p of visualPages) { if (out.length >= 5) break; push(p); }
  for (const p of textPages) { if (out.length >= 5) break; push(p); }
  for (const p of usable) { if (out.length >= 5) break; push(p); }
  return out;
}

export default async function HerbalismCollectionPage() {
  let data;
  try { data = await getHerbalismData(); } catch (err) {
    console.error('[Herbalism page] data fetch failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  if (!data) notFound();

  const { firstTranslations, sourceWorks, ftCount, total, dateRange, languages, gallery, featured, featuredPages } = data;

  // Dedupe exact repeats, then weight toward botanical subject matter while
  // keeping a RANGE (some portraits/decoration), see collection-image-ranking.
  const deduped = dedupeImages(gallery as GalleryImg[], (g) => galleryImageId(g) || imgUrl(g));
  const rankedGallery = weaveBySubject(deduped, topicTermsFromName('Herbalism & Botany'));
  const galleryTotal = rankedGallery.length;
  const galleryPlates = rankedGallery
    .filter((g) => imgUrl(g))
    .slice(0, 20)
    .map((g) => {
      const imageId = galleryImageId(g);
      return {
        src: thumbUrl(g) as string,
        fallback: imgUrl(g),
        href: imageId ? `/gallery/image/${imageId}` : undefined,
        label: g.museum_description || g.description || g.book_title,
      };
    });
  // Intro side image: the highest-quality plate in the collection.
  const introPlate = rankedGallery.find((g) => imgUrl(g));
  const introImg = introPlate ? imgUrl(introPlate) : null;
  const introImgId = introPlate ? galleryImageId(introPlate) : undefined;
  const signupBgId = rankedGallery[1] ? galleryImageId(rankedGallery[1]) : (introPlate ? introImgId : undefined);

  const worksMore = Math.max(0, total - Math.min(sourceWorks.length, 10));
  const featuredHref = featured ? tenantBookUrl({ id: featured.id, slug: featured.slug }, null) : '#';
  const featuredDesc = (featured as unknown as { description?: string })?.description;

  return (
    <div className="min-h-screen bg-cream">
      <ConditionalSiteHeader variant="dark" />

      {/* ===== Hero ===== */}
      <section className="relative bg-dark overflow-hidden min-h-[66vh] flex items-end">
        <ParallaxImage src={`/api/collections/${SLUG}/hero-collage`} loading="eager" strength={0.08} oversize={0.1} />
        <div className="absolute inset-0 md:hidden bg-gradient-to-t from-dark/85 via-dark/45 to-dark/5" />
        <div className="absolute inset-0 hidden md:block bg-gradient-to-r from-dark/90 via-dark/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 hidden md:block bg-gradient-to-t from-dark/85 via-dark/35 to-transparent" />

        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 pt-12 pb-10">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/60 mb-6">
            <Link href="/collections" className="hover:text-white/90 transition-colors">Collections</Link>
          </nav>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">Herbalism &amp; Botany</h1>
          <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-5">{HERO_TAGLINE}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{total.toLocaleString('en-US')} works</span>
            {ftCount > 0 && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{ftCount} first translation{ftCount === 1 ? '' : 's'}</span>}
            {dateRange && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{dateRange.min} &ndash; {dateRange.max}</span>}
            {languages.length > 0 && <span className="text-xs sm:text-sm text-white/80 border border-white/20 px-3 py-1">{languages.join(' · ')}</span>}
          </div>
        </div>
      </section>

      {/* ===== Anchor row ===== */}
      <MycoAnchorBar sections={SECTIONS} slug={SLUG} />

      {/* ===== Introduction ===== */}
      <section id="introduction" className="bg-warm border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <div className="flex flex-col md:flex-row-reverse md:items-start gap-8 lg:gap-12">
            <div className="font-body flex-1 min-w-0">
              <p className="text-xl sm:text-3xl text-primary leading-snug mb-6">{INTRO[0]}</p>
              {INTRO.slice(1).map((p, i) => (
                <p key={i} className="text-secondary leading-relaxed mb-4 max-w-2xl">{p}</p>
              ))}
            </div>
            {introImg && (
              <figure className="w-full md:w-[min(33%,53.333vh)] shrink-0 m-0 mx-auto md:mx-0">
                <div className="relative aspect-[3/4] overflow-hidden bg-dark/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={introImg} alt="Botanical plate from the collection" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                </div>
                {introImgId && (
                  <figcaption className="mt-2 text-xs text-muted text-center">
                    <Link href={`/gallery/image/${introImgId}`} className="hover:text-primary transition-colors">
                      {(introPlate?.book_title as string) || 'Botanical plate'}
                    </Link>
                  </figcaption>
                )}
              </figure>
            )}
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

      {/* ===== Featured work — real data ===== */}
      {featured && (
        <section id="featured" className="bg-warm border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <div className="flex flex-col md:flex-row md:items-start gap-8 lg:gap-14">
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

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-rust mb-3">Featured</p>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-primary leading-[1.06] mb-3" style={{ fontFamily: 'var(--font-serif)' }}>{bookTitle(featured)}</h2>
                <p className="text-sm text-muted mb-6">
                  {featured.author && <span className="italic">by {featured.author}</span>}
                  <span className="font-mono text-[11px] uppercase tracking-wider">{featured.year ? ` · ${featured.year}` : ''}{featured.language ? ` · ${featured.language}` : ''}</span>
                </p>
                {featuredDesc && <p className="text-secondary leading-relaxed font-body mb-8 max-w-prose">{featuredDesc}</p>}

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
                  <Link href={`/gallery?collection=${SLUG}`} className={BTN_OUTLINE}>Browse the plates <ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== Gallery ===== */}
      {galleryPlates.length > 0 && (
        <section id="gallery" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-1">Gallery</h2>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Plates, figures, engravings, and other visual material from across the collection.</p>
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
              <Link href={`/gallery?collection=${SLUG}`} className={BTN_DARK}>View all {galleryTotal.toLocaleString('en-US')} plates <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </section>
      )}

      {/* ===== Ask the librarian ===== */}
      <section id="librarian" className="bg-warm border-y border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16 flex flex-col md:flex-row md:items-center gap-10 lg:gap-16">
          <div className="w-full max-w-[520px] mx-auto md:mx-0 shrink-0 lg:w-auto lg:max-w-none">
            <video className="w-full h-auto mix-blend-multiply lg:w-auto lg:h-[74vh]" autoPlay loop muted playsInline preload="metadata">
              <source src="/collections/mycology/librarian.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-accent-rust mb-3">Ask the librarian</p>
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-3">Search inside every book</h2>
            <p className="text-secondary leading-relaxed font-body mb-7">
              The librarian reads the full transcribed text and the description of every illustration in each book that has been digitised here. Ask a question in plain language and it points you to the exact page, passage, or plate that answers it.
            </p>
            <LibrarianSearch placeholder="Ask a question about herbs and plants…" />
          </div>
        </div>
      </section>

      {/* ===== Works in this collection ===== */}
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
              <p className="text-primary font-medium font-body">{worksMore.toLocaleString('en-US')} more works in this collection</p>
              <p className="text-sm text-muted">The full catalogue lives on a dedicated, paginated browse page.</p>
            </div>
            <Link href={`/catalog?collection=${SLUG}`} className={`${BTN_DARK} self-start sm:self-auto`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
        </div>
      </section>

      {/* ===== Quote band — verified passages from the collection's own books ===== */}
      <QuoteBlock
        bgUrl="/api/gallery-crop/6953ccb477f38f6761be3223-0"
        imageCredit={{ text: 'Image: Voynich Manuscript, a botanical folio (15th c.).', href: '/gallery/image/6953ccb477f38f6761be3223-0' }}
        quotes={QUOTES}
      />

      {/* ===== Get involved ===== */}
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

      <SignUpCTA
        bgImageUrl={signupBgId ? `/api/gallery-crop/${signupBgId}` : undefined}
        bgAttribution={signupBgId ? { text: (gallery[1]?.book_title as string) ? `Image: ${gallery[1]?.book_title}` : 'Image from the collection', href: `/gallery/image/${signupBgId}` } : undefined}
      />
    </div>
  );
}
