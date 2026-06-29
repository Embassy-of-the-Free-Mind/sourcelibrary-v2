import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowRight, ImageIcon } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { getReadDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import { withTimeout } from '@/lib/collections-utils';
import { getBookThumbnailUrl } from '@/lib/utils';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import MycoMasonry from '../mycology/_components/MycoMasonry';
import ParallaxImage from '@/components/ParallaxImage';
import MycoAnchorBar from '../mycology/_components/MycoAnchorBar';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

/*
 * Visions & Ecstasies collection page — REDESIGN. Dedicated route applying the
 * mycology page's design language (per .claude/docs/collection-page-redesign-spec.md)
 * to an IMAGE-FIRST collection: every member is an artwork (content_type:'artwork',
 * no readable OCR text, no first translations). So the book-centric sections
 * (first-translations slider, readable-works grid, source-quote band, featured
 * page-previews) are replaced by image-forward equivalents — the gallery and an
 * artwork grid carry the page. Reuses the live mycology components untouched;
 * existing tokens only, no new design primitives.
 */

export const revalidate = 86400;
export const dynamic = 'force-dynamic';

const SLUG = 'visions-ecstasies';
const BTN_DARK = 'inline-flex items-center gap-2 bg-dark text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity';
const RUST_LINK = 'inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity';
const BTN_OUTLINE = 'inline-flex items-center gap-2 border border-border-medium text-primary text-sm font-medium px-5 py-2.5 rounded-lg hover:border-accent-rust hover:text-accent-rust transition-colors';

const OG_TITLE = 'Visions & Ecstasies — Source Library';
const OG_DESC = 'From Hildegard of Bingen’s cosmic wheels to William Blake’s spirit portraits, from the Bamberg Apocalypse to Bernini’s swooning Teresa — the visual record of those who claimed to see what others could not.';

// Curated members that anchor the page (hero / intro figure / featured work).
const HERO_SLUG = 'aurora-consurgens-blackangel';
const INTRO_SLUG = 'gian-lorenzo-bernini-bozzetto-perlestasi-di-santa-teresa';
const FEATURED_SLUG = 'hildegard-von-bingen-werk-gottes-12-jh';

export const metadata: Metadata = {
  title: OG_TITLE,
  description: OG_DESC,
  alternates: { canonical: '/collections/visions-ecstasies' },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESC,
    url: '/collections/visions-ecstasies',
    siteName: 'Source Library',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: OG_TITLE, description: OG_DESC },
};

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'featured', label: 'Featured' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'works', label: 'Artworks' },
  { id: 'involved', label: 'Get involved' },
];

// Fields needed by CollectionBookCard + the image accessor.
const ART_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
  language: 1, content_type: 1, resource_type: 1, pages_count: 1,
  image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1,
} as const;

type ArtDoc = Record<string, unknown> & {
  id?: string; slug?: string; title?: string; resource_type?: string; content_type?: string;
};

// Force the card to treat every member as an artwork (→ links to /artwork/<slug>,
// hides the OCR/translation status line) even if resource_type isn't stored.
function toCard(b: ArtDoc): CollectionBook {
  return { ...(b as unknown as CollectionBook), resource_type: (b.resource_type as string) || b.content_type as string || 'artwork' };
}

async function getVisionsData() {
  const db = await withTimeout(getReadDb(), 10000, null as unknown as Awaited<ReturnType<typeof getReadDb>>);
  if (!db) throw new Error('DB connection timeout');

  const collection = await withTimeout(db.collection('collections').findOne({ slug: SLUG }), 8000, null);
  if (!collection) return null;
  const books = db.collection('books');

  const [members, total, yearAgg, anchors] = await Promise.all([
    withTimeout(books.find({ collections: SLUG, visible: true }, { projection: ART_PROJECTION, maxTimeMS: 8000 }).sort({ year: 1, title: 1 }).limit(80).toArray() as Promise<ArtDoc[]>, 8000, []),
    withTimeout(books.countDocuments({ collections: SLUG, visible: true }, { maxTimeMS: 8000 }), 8000, 0),
    withTimeout(books.aggregate([{ $match: { collections: SLUG, visible: true, year: { $type: 'number', $gt: 0 } } }, { $group: { _id: null, min: { $min: '$year' }, max: { $max: '$year' } } }], { maxTimeMS: 8000 }).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(books.find({ slug: { $in: [HERO_SLUG, INTRO_SLUG, FEATURED_SLUG] } }, { projection: ART_PROJECTION, maxTimeMS: 6000 }).toArray() as Promise<ArtDoc[]>, 6000, []),
  ]);

  const bySlug = (s: string) => anchors.find((a) => a.slug === s) || null;
  const yr = yearAgg[0] as { min?: number; max?: number } | undefined;

  return {
    collection: JSON.parse(JSON.stringify(collection)) as Record<string, unknown>,
    members: JSON.parse(JSON.stringify(members)) as ArtDoc[],
    total,
    dateRange: yr && yr.min && yr.max ? { min: yr.min, max: yr.max } : null,
    hero: bySlug(HERO_SLUG), intro: bySlug(INTRO_SLUG), featured: bySlug(FEATURED_SLUG),
  };
}

export default async function VisionsEcstasiesPage() {
  let data;
  try { data = await getVisionsData(); } catch (err) {
    console.error('[Visions & Ecstasies page] data fetch failed:', err instanceof Error ? err.message : err);
    throw err;
  }
  if (!data) notFound();

  const { collection, members, total, dateRange, hero, intro, featured } = data;

  // Hero background: a dramatic member image (collage API needs gallery_images,
  // which an artwork collection has none of). Fall back to the first member.
  const heroUrl = (hero && getBookThumbnailUrl(toCard(hero), 'display'))
    || (members.length ? getBookThumbnailUrl(toCard(members[0]), 'display') : null);
  const introUrl = intro ? getBookThumbnailUrl(toCard(intro), 'display') : null;
  const featuredUrl = featured ? getBookThumbnailUrl(toCard(featured), 'display') : null;
  const featuredHref = featured?.slug ? `/artwork/${featured.slug}` : '#';

  // Gallery + grid both draw from the artworks' own images. Skip the curated
  // anchors so they aren't shown twice.
  const anchorSlugs = new Set([HERO_SLUG, INTRO_SLUG, FEATURED_SLUG]);
  const withImg = members
    .filter((b) => !anchorSlugs.has(b.slug || ''))
    .map((b) => ({ b, thumb: getBookThumbnailUrl(toCard(b), 'thumb'), full: getBookThumbnailUrl(toCard(b), 'display') }))
    .filter((x) => x.thumb);

  const galleryPlates = withImg.slice(0, 44).map(({ b, thumb, full }) => ({
    src: thumb as string,
    fallback: full || undefined,
    href: b.slug ? `/artwork/${b.slug}` : undefined,
    label: (b.display_title as string) || b.title,
  }));
  const gridBooks = withImg.slice(0, 15).map(({ b }) => toCard(b));

  // One evocative line from the collection's OWN introduction (editorial voice,
  // NOT a source quote — this is an artwork collection with no quotable OCR text).
  const bandLine = 'Images made by people who believed they were recording real experiences of the divine, the angelic, and the apocalyptic.';

  return (
    <div className="min-h-screen bg-cream">
      <ConditionalSiteHeader variant="dark" />

      {/* ===== Hero ===== */}
      <section className="relative bg-dark overflow-hidden min-h-[66vh] flex items-end">
        {heroUrl && <ParallaxImage src={heroUrl} loading="eager" strength={0.08} oversize={0.1} objectPosition="50% 30%" />}
        <div className="absolute inset-0 md:hidden bg-gradient-to-t from-dark/85 via-dark/45 to-dark/5" />
        <div className="absolute inset-0 hidden md:block bg-gradient-to-r from-dark/90 via-dark/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 hidden md:block bg-gradient-to-t from-dark/85 via-dark/35 to-transparent" />

        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 pt-12 pb-10">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/60 mb-6">
            <Link href="/collections" className="hover:text-white/90 transition-colors">Collections</Link>
          </nav>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">Visions &amp; Ecstasies</h1>
          <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-5">The visual record of those who claimed to see what others could not.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{total.toLocaleString('en-US')} works</span>
            {dateRange && <span className="text-xs sm:text-sm text-white/90 border border-white/25 px-3 py-1">{dateRange.min} &ndash; {dateRange.max}</span>}
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
              <p className="text-xl sm:text-3xl text-primary leading-snug mb-6">
                Hildegard of Bingen painted her visions as cosmic wheels of fire. Bernini carved Saint Teresa&rsquo;s ecstasy in marble so convincing that the boundary between spiritual and physical rapture dissolves. William Blake engraved an entire mythology of contraries that he claimed to see as clearly as the material world.
              </p>
              <p className="text-secondary leading-relaxed mb-4 max-w-2xl">
                This collection follows the Western tradition of visionary art: images made by people who believed they were recording real experiences of the divine, the angelic, and the apocalyptic, from illuminated apocalypses and alchemical dream-books to the spirit portraits of the Romantics.
              </p>
              <p className="text-secondary leading-relaxed max-w-2xl">
                Whether the visions were &ldquo;real&rdquo; matters less than the extraordinary visual culture they produced. Seen together, these works trace how a thousand years of seers, mystics, and artists tried to give a fixed shape to what they swore they had witnessed.
              </p>
            </div>
            {introUrl && (
              <figure className="w-full md:w-[min(33%,53.333vh)] shrink-0 m-0 mx-auto md:mx-0">
                <div className="relative aspect-[3/4] overflow-hidden bg-dark/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={introUrl} alt={(intro?.title as string) || 'Visionary artwork'} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                </div>
                <figcaption className="mt-2 text-xs text-muted text-center">
                  {intro?.slug ? (
                    <Link href={`/artwork/${intro.slug}`} className="hover:text-primary transition-colors">
                      Ecstasy of Saint Teresa (bozzetto) &mdash; Gian Lorenzo Bernini
                    </Link>
                  ) : 'Ecstasy of Saint Teresa — Gian Lorenzo Bernini'}
                </figcaption>
              </figure>
            )}
          </div>
        </div>
      </section>

      {/* ===== Featured work ===== */}
      {featured && (
        <section id="featured" className="bg-cream border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <div className="flex flex-col md:flex-row md:items-start gap-8 lg:gap-14">
              <div className="w-full md:w-[min(33%,53.333vh)] shrink-0">
                <div className="relative aspect-[3/4] overflow-hidden bg-warm shadow-md">
                  {featuredUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={featuredUrl} alt="Hildegard of Bingen, The Work of God" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center"><ImageIcon className="w-12 h-12 text-muted" /></div>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-rust mb-3">Featured</p>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-primary leading-[1.06] mb-3" style={{ fontFamily: 'var(--font-serif)' }}>The Work of God</h2>
                <p className="text-sm text-muted mb-6">
                  <span className="italic">Hildegard of Bingen</span>
                  <span className="font-mono text-[11px] uppercase tracking-wider"> &middot; c. 1163 &middot; Liber Divinorum Operum</span>
                </p>
                <p className="text-secondary leading-relaxed font-body mb-3 max-w-prose">Around 1163 the abbess Hildegard of Bingen set down the visions she said reached her as &ldquo;the reflection of the living Light&rdquo; &mdash; among them this figure of cosmic man held inside concentric wheels of fire and wind, the human body mapped onto the elements of the universe.</p>
                <p className="text-secondary leading-relaxed font-body mb-8 max-w-prose">She described each scene in detail and had it painted under her direction, leaving one of the earliest sustained bodies of visionary art credited to a named woman.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={featuredHref} className={BTN_DARK}>View the work <ArrowRight className="w-4 h-4" /></Link>
                  <Link href={`/catalog?collection=${SLUG}`} className={BTN_OUTLINE}>Browse all {total.toLocaleString('en-US')} works <ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== Gallery — the centerpiece ===== */}
      {galleryPlates.length > 0 && (
        <section id="gallery" className="bg-warm border-b border-border-light scroll-mt-4">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
            <h2 className="text-2xl sm:text-3xl text-primary font-display mb-1">Gallery</h2>
            <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Illuminations, engravings, paintings, and prints from across the collection. Click any image to see it full size.</p>
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
              <Link href={`/catalog?collection=${SLUG}`} className={BTN_DARK}>View all {total.toLocaleString('en-US')} works <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </section>
      )}

      {/* ===== Atmospheric band — the collection's OWN editorial line (no source quote) ===== */}
      {heroUrl && (
        <section className="relative bg-dark overflow-hidden">
          <ParallaxImage src={heroUrl} className="opacity-40" strength={0.08} oversize={0.1} objectPosition="50% 35%" />
          <div className="absolute inset-0 bg-dark/55" />
          <div className="relative z-10 max-w-[1500px] mx-auto px-6 md:px-12 py-20 md:py-28 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/55 mb-5">From the collection</p>
            <p className="font-display text-2xl sm:text-3xl md:text-4xl text-white/95 leading-snug max-w-4xl mx-auto" style={{ textShadow: '0 1px 14px rgba(0,0,0,0.5)' }}>
              {bandLine}
            </p>
          </div>
        </section>
      )}

      {/* ===== Artworks — bounded grid + handoff ===== */}
      <section id="works" className="bg-cream border-b border-border-light scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <div className="flex items-end justify-between gap-4 mb-1">
            <h2 className="text-2xl sm:text-3xl text-primary font-display">Artworks in this collection</h2>
            <Link href={`/catalog?collection=${SLUG}`} className={`${BTN_DARK} whitespace-nowrap`}>Browse all {total.toLocaleString('en-US')} <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">Showing {gridBooks.length} of {total.toLocaleString('en-US')} single-image works &mdash; the full collection lives on a paginated browse page.</p>
          {gridBooks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {gridBooks.map((b) => <CollectionBookCard key={b.id || b.slug} book={b} />)}
            </div>
          ) : (
            <p className="text-sm text-muted">No works to show.</p>
          )}
        </div>
      </section>

      {/* ===== Get involved ===== */}
      <section id="involved" className="bg-cream scroll-mt-4">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16">
          <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">Get involved</h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">Source Library is built in the open. Every contribution keeps these works free to see.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-border-light bg-white p-6 flex flex-col">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Open to all</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Leave feedback</h3>
              <p className="text-sm text-secondary mb-5 font-body flex-1">Spot a mislabelled image, a missing artist, or a work that belongs here? Tell us, corrections ship fast.</p>
              <FeedbackWidget label="Send feedback" className={`${RUST_LINK} self-start`} />
            </div>
            <div className="border border-border-light bg-white p-6 flex flex-col">
              <div className="text-[11px] uppercase tracking-wider text-muted mb-3">Support</div>
              <h3 className="text-lg font-semibold text-primary mb-2 font-display">Become a patron</h3>
              <p className="text-sm text-secondary mb-5 font-body flex-1">Fund new high-resolution scans of rare visionary works. Every image you help recover stays open to everyone.</p>
              <Link href="/support" className={`${BTN_DARK} self-start`}>Become a patron <ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      {featuredUrl && (
        <SignUpCTA
          bgImageUrl={featuredUrl}
          bgAttribution={featured?.slug ? { text: 'Image: Hildegard of Bingen, Liber Divinorum Operum, c. 1163.', href: `/artwork/${featured.slug}` } : undefined}
        />
      )}
    </div>
  );
}
