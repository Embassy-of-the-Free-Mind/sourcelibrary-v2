import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowLeft, BookOpen, Play, MessageSquare, PenLine, Heart } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { getReadDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import { bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import { tenantBookUrl } from '@/lib/slugify';

/*
 * Mycology collection page — REDESIGN (Phase 1, SSR structure).
 *
 * Dedicated route so the shared `collections/[id]` template (every other
 * collection) stays untouched while this template is iterated on. Built per
 * `.claude/docs/collection-page-redesign-spec.md`, strictly on existing Source
 * Library design tokens/components — no new primitives.
 *
 * Phase 1 = server-rendered section skeleton. Interactivity (overlay-nav blur,
 * jump-dropdown collapse, share/embed popovers, one-at-a-time slider) and the
 * final curated copy (intro per the intro-writing rules, sourced quote) land in
 * later phases. Placeholders are marked PHASE-2 / PHASE-3.
 */

export const revalidate = 86400;
export const dynamic = 'force-dynamic';

const SLUG = 'mycology';

export const metadata: Metadata = {
  title: 'Mycology & Fungi - Source Library',
  description: 'The kingdom of fungi, from Clusius to Saccardo — original source texts and first English translations on Source Library.',
  alternates: { canonical: '/collections/mycology' },
};

// ---------- Types ----------

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_translated?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
  is_first_translation?: boolean;
  ft_disposition?: string;
}

interface GalleryImg {
  book_id?: string;
  bookId?: string;
  page_id?: string;
  pageId?: string;
  detection_index?: number;
  detectionIndex?: number;
  extracted_url?: string;
  extractedUrl?: string;
  thumbnail_url?: string;
  thumbnailUrl?: string;
  image_url?: string;
  imageUrl?: string;
  description?: string;
  museum_description?: string;
  book_title?: string;
  type?: string;
}

const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
  language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  is_first_translation: 1, ft_disposition: 1, 'translation_verification.disposition': 1,
} as const;

// ---------- Data ----------

function withDisposition(b: Record<string, unknown>): BookItem {
  return {
    ...(b as unknown as BookItem),
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

  const [firstTranslationsRaw, sourceWorksRaw, ftCount, total, yearAgg, bookIdDocs] = await Promise.all([
    // First translations (chronological), full set for the slider.
    withTimeout(
      books.find({ collections: SLUG, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true },
        { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ year: 1, title: 1 }).limit(60).toArray(),
      8000, [] as Record<string, unknown>[],
    ),
    // Source texts (original-language, not first-translations), source-first for the Works grid.
    withTimeout(
      books.find({ collections: SLUG, visible: true, pages_count: { $gt: 0 }, is_first_translation: { $ne: true } },
        { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort({ year: 1, title: 1 }).limit(12).toArray() as Promise<Record<string, unknown>[]>,
      8000, [] as Record<string, unknown>[],
    ),
    withTimeout(books.countDocuments({ collections: SLUG, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true }, { maxTimeMS: 8000 }), 8000, 0),
    withTimeout(
      Promise.resolve(collection.book_count as number | undefined).then((c) =>
        c ?? books.countDocuments({ collections: SLUG, visible: true, pages_count: { $gt: 0 } }, { maxTimeMS: 8000 })),
      8000, 0,
    ),
    withTimeout(
      books.aggregate([
        { $match: { collections: SLUG, visible: true, year: { $type: 'number', $gt: 0 } } },
        { $group: { _id: null, min: { $min: '$year' }, max: { $max: '$year' } } },
      ], { maxTimeMS: 8000 }).toArray(),
      8000, [] as Record<string, unknown>[],
    ),
    withTimeout(books.find({ collections: SLUG, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).toArray(), 5000, [] as Record<string, unknown>[]),
  ]);

  const bookIds = bookIdDocs.map((d) => d.id as string);
  const galleryImages = bookIds.length
    ? await withTimeout(
      db.collection('gallery_images').find(
        {
          book_id: { $in: bookIds.slice(0, 200) },
          gallery_quality: { $gte: 0.6 },
          type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'printer_mark', 'ornament', 'border'] },
        },
        { projection: { _id: 0 }, maxTimeMS: 5000 },
      ).sort({ gallery_quality: -1 }).limit(48).toArray(),
      5000, [] as Record<string, unknown>[],
    )
    : [];

  const firstTranslations = firstTranslationsRaw.map(withDisposition);
  const sourceWorks = sourceWorksRaw.map(withDisposition);

  // Featured = the most fully-translated first-translation (Bulliard for mycology).
  const featured = [...firstTranslations].sort((a, b) => (b.pages_translated ?? 0) - (a.pages_translated ?? 0))[0] || null;
  const gallery = JSON.parse(JSON.stringify(galleryImages)) as GalleryImg[];
  const featuredPlates = featured ? gallery.filter((g) => (g.book_id || g.bookId) === featured.id).slice(0, 6) : [];

  const yr = yearAgg[0] as { min?: number; max?: number } | undefined;
  const languages = ((collection.languages as { lang: string; count: number }[] | undefined) || [])
    .filter((l) => l.count > 0).map((l) => l.lang);

  return {
    collection: JSON.parse(JSON.stringify(collection)) as Record<string, unknown>,
    firstTranslations,
    sourceWorks,
    ftCount,
    total,
    dateRange: yr && yr.min && yr.max ? { min: yr.min, max: yr.max } : null,
    languages,
    gallery,
    featured,
    featuredPlates,
  };
}

// ---------- Small building blocks ----------

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'featured', label: 'Featured' },
  { id: 'translations', label: 'First translations' },
  { id: 'illustrations', label: 'Illustrations' },
  { id: 'works', label: 'Works' },
  { id: 'involved', label: 'Get involved' },
];

function StatusBadge({ kind, language, disposition }: { kind: 'first' | 'source'; language?: string; disposition?: string }) {
  if (kind === 'first') {
    return (
      <span className="inline-block text-[10px] font-medium bg-accent-rust/10 text-accent-rust px-1.5 py-0.5 rounded">
        {firstTranslationBadge(disposition, language)}
      </span>
    );
  }
  return (
    <span className="inline-block text-[10px] font-medium bg-warm text-muted border border-border-light px-1.5 py-0.5 rounded">
      Source text
    </span>
  );
}

function CoverCard({ b, kind }: { b: BookItem; kind: 'first' | 'source' }) {
  const thumb = getBookThumbnailUrl(b);
  return (
    <Link href={tenantBookUrl({ id: b.id, slug: b.slug }, null)} className="group block">
      <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-sm group-hover:shadow-md transition-shadow mb-2">
        {thumb ? (
          <Image src={thumb} alt={bookTitle(b)} fill className="object-cover group-hover:scale-105 transition-transform duration-300" sizes="(min-width: 1280px) 280px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-8 h-8 text-muted" /></div>
        )}
        <div className="absolute top-2 left-2">
          <StatusBadge kind={kind} language={b.language} disposition={b.ft_disposition} />
        </div>
      </div>
      <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">{bookTitle(b)}</h3>
      {b.author && <p className="text-xs text-muted line-clamp-1 mt-0.5">{b.author}{b.year ? `, ${b.year}` : ''}</p>}
    </Link>
  );
}

// ---------- Page ----------

export default async function MycologyCollectionPage() {
  let data;
  try {
    data = await getMycologyData();
  } catch (err) {
    console.error('[Mycology page] data fetch failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  if (!data) notFound();

  const { collection, firstTranslations, sourceWorks, ftCount, total, dateRange, languages, gallery, featured, featuredPlates } = data;

  const title = (collection.name as string) || 'Mycology & Fungi';
  const tagline = (collection.subtitle as string) || 'The kingdom of fungi, from the first illustrated mushroom books to modern systematics.';
  const introText = (collection.expanded_description as string) || (collection.description as string) || '';
  const introParas = introText.split('\n\n').map((p) => p.trim()).filter(Boolean).slice(0, 3);

  // Hero collage: 7 × 3 tiles from real plate imagery.
  const collageTiles = gallery.map(imgUrl).filter(Boolean).slice(0, 21) as string[];
  // Quote-band background: an illustration plate (no title pages).
  const quotePlate = gallery.find((g) => g.type && !['page', 'title_page', 'text'].includes(g.type)) || gallery[0];
  const quoteBg = quotePlate ? imgUrl(quotePlate) : undefined;

  const galleryTotal = gallery.length; // PHASE-2: replace with true illustration count
  const worksMore = Math.max(0, total - sourceWorks.length);

  return (
    <div className="min-h-screen bg-cream">
      {/* ===== Hero ===== */}
      <section className="relative bg-dark overflow-hidden min-h-[40vh] md:min-h-[60vh] flex items-end">
        {collageTiles.length > 0 && (
          <div className="absolute inset-0 grid grid-cols-4 sm:grid-cols-7 grid-rows-3 opacity-40">
            {collageTiles.map((src, i) => (
              <div key={i} className="relative overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}
        {/* Legibility gradients (existing dark surface token) */}
        <div className="absolute inset-0 bg-gradient-to-r from-dark via-dark/80 to-dark/30" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-cream to-transparent" />

        {/* Overlay nav (transparent variant — PHASE-2: dedicated blurred overlay-dark variant) */}
        <div className="absolute top-0 inset-x-0 z-20">
          <ConditionalSiteHeader variant="transparent" />
        </div>

        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 pt-24 pb-10">
          <Link href="/#library" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" /> Medicine & Natural History
          </Link>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">{title}</h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-3xl leading-relaxed mb-5">{tagline}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm text-white/90 border border-white/25 rounded-full px-3 py-1">{total.toLocaleString('en-US')} works</span>
            {ftCount > 0 && <span className="text-xs sm:text-sm text-white/90 border border-white/25 rounded-full px-3 py-1">{ftCount} first translation{ftCount === 1 ? '' : 's'}</span>}
            {dateRange && <span className="text-xs sm:text-sm text-white/90 border border-white/25 rounded-full px-3 py-1">{dateRange.min}–{dateRange.max}</span>}
            {languages.map((l) => (
              <span key={l} className="text-xs sm:text-sm text-white/80 border border-white/20 rounded-full px-3 py-1">{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== "On this page" anchor row + actions (non-sticky) ===== */}
      <nav aria-label="On this page" className="border-y border-border-light bg-cream">
        <div className="max-w-[1500px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">On this page</span>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="text-secondary hover:text-accent-rust transition-colors">{s.label}</a>
            ))}
          </div>
          {/* PHASE-2: Share/Embed open popovers; rendered as buttons for now */}
          <div className="flex items-center gap-2">
            <button className="btn-secondary" type="button">Share</button>
            <button className="btn-secondary" type="button">Embed</button>
          </div>
        </div>
      </nav>

      {/* ===== Introduction ===== */}
      <section id="introduction" className="bg-warm border-b border-border-light">
        <div className="max-w-[1500px] mx-auto px-6 py-12 grid gap-8 md:grid-cols-[1fr_320px] md:items-start">
          <div className="max-w-2xl">
            {introParas.length > 0 ? (
              introParas.map((p, i) => (
                <p key={i} className={`leading-relaxed mb-4 last:mb-0 font-body ${i === 0 ? 'text-lg text-primary' : 'text-secondary'}`}>{p}</p>
              ))
            ) : (
              <p className="text-secondary font-body">{/* PHASE-3: curated three-part intro per collection-intro-writing-rules.md */}Introduction to the collection.</p>
            )}
          </div>
          {/* Walkthrough video placeholder (9:16) — PHASE-3: wire real video */}
          <div className="mx-auto w-full max-w-[280px]">
            <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-dark border border-border-light flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-6 h-6 text-white" />
              </div>
            </div>
            <p className="text-xs text-muted mt-2 text-center">Watch · walkthrough coming soon</p>
          </div>
        </div>
      </section>

      {/* ===== Featured work ===== */}
      {featured && (
        <section id="featured" className="bg-cream border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-12 grid gap-8 md:grid-cols-2 md:items-start">
            {/* Left: cover + plate strip */}
            <div>
              <div className="w-48 sm:w-56">
                <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-lg">
                  {getBookThumbnailUrl(featured) ? (
                    <Image src={getBookThumbnailUrl(featured)!} alt={bookTitle(featured)} fill className="object-cover" sizes="224px" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-12 h-12 text-muted" /></div>
                  )}
                </div>
              </div>
              {featuredPlates.length > 0 && (
                <>
                  <div className="flex gap-2 mt-4">
                    {featuredPlates.map((g, i) => {
                      const src = imgUrl(g);
                      if (!src) return null;
                      return (
                        <div key={i} className="relative w-14 h-14 rounded overflow-hidden border border-border-light">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted mt-2">A few of the plates in this work</p>
                </>
              )}
            </div>
            {/* Right: detail */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge kind="first" language={featured.language} disposition={featured.ft_disposition} />
                {featured.language && <span className="text-xs text-muted">{featured.language}</span>}
              </div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-primary leading-tight mb-1 font-display">{bookTitle(featured)}</h2>
              <p className="text-base text-muted mb-4">{featured.author}{featured.year ? `, ${featured.year}` : ''}</p>
              <div className="flex flex-wrap gap-2 mb-4 text-xs text-muted">
                {featured.pages_count ? <span className="bg-warm border border-border-light rounded px-2 py-1">{featured.pages_count} pages</span> : null}
                {featured.pages_translated ? <span className="bg-warm border border-border-light rounded px-2 py-1">{featured.pages_translated} translated</span> : null}
              </div>
              {/* PHASE-3: curator's note (do not fabricate a historical quotation) */}
              <p className="text-secondary leading-relaxed font-body mb-3 max-w-prose">One of the most important illustrated works in the collection, now readable in English for the first time.</p>
              <p className="border-l-2 border-accent-rust/40 pl-3 text-secondary italic font-body mb-5 max-w-prose">
                Curator&rsquo;s note — placeholder. PHASE-3: a short editorial note on why this work matters.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link href={tenantBookUrl({ id: featured.id, slug: featured.slug }, null)} className="btn-primary">Read in full</Link>
                <Link href={`/gallery?collection=${SLUG}`} className="text-sm text-accent-rust hover:underline">Browse all plates →</Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== First translations ===== */}
      {firstTranslations.length > 0 && (
        <section id="translations" className="bg-warm border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-12">
            <div className="flex items-end justify-between gap-4 mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">First translations</h2>
              <span className="text-sm text-muted whitespace-nowrap">{firstTranslations.length} {firstTranslations.length === 1 ? 'title' : 'titles'}</span>
            </div>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Works appearing in a modern, readable translation for the first time — read them in full here.</p>
            {/* PHASE-2: one-at-a-time slider w/ arrows + mobile scroll-snap. Static 5-up grid for now. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {firstTranslations.map((b) => <CoverCard key={b.id} b={b} kind="first" />)}
            </div>
          </div>
        </section>
      )}

      {/* ===== Illustrations — masonry ===== */}
      {gallery.length > 0 && (
        <section id="illustrations" className="bg-cream border-b border-border-light">
          <div className="max-w-[1500px] mx-auto px-6 py-12">
            <div className="flex items-end justify-between gap-4 mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">Illustrations</h2>
              <Link href={`/gallery?collection=${SLUG}`} className="text-sm text-accent-rust hover:underline whitespace-nowrap">View all {galleryTotal.toLocaleString('en-US')} →</Link>
            </div>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Hand-coloured plates and figures from the works in this collection.</p>
            <div className="columns-3 lg:columns-5 gap-4 [column-fill:_balance]">
              {gallery.slice(0, 24).map((g, i) => {
                const src = imgUrl(g);
                const bookId = g.book_id || g.bookId;
                const pageId = g.page_id || g.pageId;
                const label = g.museum_description || g.description || g.book_title;
                if (!src) return null;
                const inner = (
                  <div className="mb-4 break-inside-avoid rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={label || 'Illustration'} className="w-full h-auto block" loading="lazy" />
                  </div>
                );
                return bookId && pageId
                  ? <Link key={i} href={`${tenantBookUrl({ id: String(bookId) }, null)}/page/${pageId}`} title={label}>{inner}</Link>
                  : <div key={i}>{inner}</div>;
              })}
            </div>
          </div>
        </section>
      )}

      {/* ===== Works in this collection — bounded grid + handoff ===== */}
      <section id="works" className="bg-warm border-b border-border-light">
        <div className="max-w-[1500px] mx-auto px-6 py-12">
          <div className="flex items-end justify-between gap-4 mb-2">
            <h2 className="text-2xl sm:text-3xl text-primary font-display">Works in this collection</h2>
            <Link href={`/browse?collection=${SLUG}`} className="text-sm text-accent-rust hover:underline whitespace-nowrap">Browse all {total.toLocaleString('en-US')} →</Link>
          </div>
          <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Showing {Math.min(sourceWorks.length, 10)} of {total.toLocaleString('en-US')} · original source texts first — translations are in the slider above.</p>
          {sourceWorks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {sourceWorks.slice(0, 10).map((b) => <CoverCard key={b.id} b={b} kind="source" />)}
            </div>
          ) : (
            <p className="text-sm text-muted">No source-text works to show.</p>
          )}
          {/* Handoff card — crawlable link to the full paginated browse */}
          <div className="mt-8 rounded-xl border border-border-light bg-cream p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-secondary font-body">{worksMore.toLocaleString('en-US')} more works in mycology.</p>
            <Link href={`/browse?collection=${SLUG}`} className="btn-primary self-start sm:self-auto">Browse all {total.toLocaleString('en-US')} →</Link>
          </div>
        </div>
      </section>

      {/* ===== Quote band ===== */}
      <section className="relative bg-dark overflow-hidden">
        {quoteBg && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={quoteBg} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        )}
        <div className="absolute inset-0 bg-dark/70" />
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-20 text-center">
          {/* PHASE-3: real sourced passage + attribution from a work in this collection */}
          <p className="text-2xl sm:text-3xl text-white font-display leading-snug">
            &ldquo;A sourced passage from one of the collection&rsquo;s works will go here.&rdquo;
          </p>
          <p className="text-sm text-white/60 mt-4">Work, author, year — placeholder (PHASE-3)</p>
        </div>
      </section>

      {/* ===== Get involved ===== */}
      <section id="involved" className="bg-cream">
        <div className="max-w-[1500px] mx-auto px-6 py-12">
          <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">Get involved</h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">Help make these works readable and reach more people.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-border-light bg-white p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted mb-3"><MessageSquare className="w-4 h-4" /> Feedback</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Leave feedback</h3>
              <p className="text-sm text-secondary mb-4 font-body">Report errors, missing editions, or better translations.</p>
              <Link href="/feedback" className="text-sm text-accent-rust hover:underline">Send feedback →</Link>
            </div>
            <div className="rounded-xl border border-border-light bg-white p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted mb-3"><PenLine className="w-4 h-4" /> Curate</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Become a curator</h3>
              <p className="text-sm text-secondary mb-4 font-body">Help select, sequence, and annotate the works.</p>
              <Link href="/welcome" className="text-sm text-accent-rust hover:underline">Apply to curate →</Link>
            </div>
            <div className="rounded-xl border border-border-light bg-white p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted mb-3"><Heart className="w-4 h-4" /> Support</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Become a patron</h3>
              <p className="text-sm text-secondary mb-4 font-body">Fund scans and first translations.</p>
              <Link href="/support" className="btn-primary">Become a patron →</Link>
            </div>
          </div>
        </div>
      </section>

      <SignUpCTA />
    </div>
  );
}
