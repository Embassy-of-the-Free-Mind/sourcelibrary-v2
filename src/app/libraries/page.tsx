import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import { Library, ExternalLink, BookOpen, Globe } from 'lucide-react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import HeroScrim from '@/components/HeroScrim';
import { LIBRARY_PARTNERS, getPartnerByProvider } from '@/lib/library-partners';
import type { Metadata } from 'next';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Libraries | Source Library',
  description: 'Browse books by digital source and contributing institution — Bibliotheca Philosophica Hermetica, Internet Archive, Gallica, Bodleian Library, and more.',
  alternates: { canonical: '/libraries' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Libraries | Source Library',
    description: 'Browse books by digital source and contributing institution — Bibliotheca Philosophica Hermetica, Internet Archive, Gallica, Bodleian Library, and more.',
    type: 'website',
  },
};

interface ProviderStats {
  provider: string;
  count: number;
  languages: string[];
  heroImage?: string;
}

interface ContributingLibrary {
  name: string;
  count: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows(
  queryFn: (offset: number, limit: number) => any
): Promise<any[]> {
  const PAGE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn(offset, PAGE);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

async function fetchProviderStats(): Promise<ProviderStats[]> {
  const excludeProviders = ['user_upload', 'other', 'library', 'iiif'];

  const allRows = await fetchAllRows((offset, limit) =>
    supabase
      .from('books_catalog')
      .select('image_source_provider, language, thumbnail, thumbnail_blob')
      .eq('visible', true)
      .gt('pages_count', 0)
      .not('image_source_provider', 'is', null)
      .range(offset, offset + limit - 1)
  );

  const providerMap = new Map<string, { count: number; languages: Set<string>; heroImage?: string }>();
  for (const row of allRows) {
    const provider = row.image_source_provider as string;
    if (excludeProviders.includes(provider)) continue;
    const existing = providerMap.get(provider) || { count: 0, languages: new Set<string>() };
    existing.count++;
    if (row.language) existing.languages.add(row.language as string);
    if (!existing.heroImage) {
      const thumb = (row.thumbnail_blob || row.thumbnail) as string | null;
      if (thumb) existing.heroImage = thumb;
    }
    providerMap.set(provider, existing);
  }

  return [...providerMap.entries()]
    .map(([provider, stats]) => ({
      provider,
      count: stats.count,
      languages: [...stats.languages].sort(),
      heroImage: stats.heroImage,
    }))
    .sort((a, b) => b.count - a.count);
}

async function fetchContributingLibraries(): Promise<ContributingLibrary[]> {
  const allRows = await fetchAllRows((offset, limit) =>
    supabase
      .from('books_catalog')
      .select('contributing_library')
      .eq('visible', true)
      .gt('pages_count', 0)
      .not('contributing_library', 'is', null)
      .range(offset, offset + limit - 1)
  );

  const excludeNames = new Set(['[object Object]', 'IIIF Source', 'null', 'undefined']);
  const counts = new Map<string, number>();
  for (const row of allRows) {
    const name = (row.contributing_library as string || '').trim();
    if (!name || excludeNames.has(name)) continue;
    // Some importers stored a serialized object instead of a name — a chip
    // reading {"name":"Internet Archive","url":…} is a data bug, not an
    // institution. Skip anything JSON-shaped; the source rows need a repair
    // sweep, but the page shouldn't render the bug meanwhile.
    if (name.startsWith('{') || name.startsWith('[')) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function PartnerCard({ partner, heroImage, count, languages, size = 'normal' }: {
  partner: typeof LIBRARY_PARTNERS[string];
  heroImage?: string;
  count: number;
  languages: string[];
  size?: 'hero' | 'featured' | 'normal';
}) {
  const isCompact = size === 'normal';
  const topLangs = languages.slice(0, isCompact ? 3 : 4).join(', ');
  const isHero = size === 'hero';
  const isFeatured = size === 'featured';

  return (
    <Link
      href={`/libraries/${partner.slug}`}
      className={`group relative block overflow-hidden rounded-xl ${
        isHero ? 'aspect-[21/9] md:aspect-[3/1]' :
        isFeatured ? 'aspect-[21/9]' :
        'aspect-[3/2]'
      }`}
    >
      {/* Warm gradient base — always rendered so tiles never flash black while the scan loads */}
      <div className={`absolute inset-0 ${
        partner.color === 'gold' ? 'bg-gradient-to-br from-amber-900 to-amber-950' :
        partner.color === 'rust' ? 'bg-gradient-to-br from-stone-800 to-stone-900' :
        partner.color === 'violet' ? 'bg-gradient-to-br from-indigo-900 to-slate-900' :
        'bg-gradient-to-br from-emerald-900 to-stone-900'
      }`} />

      {heroImage && (
        <Image
          src={heroImage}
          alt={`Illustration from ${partner.name}`}
          fill
          sizes={isHero || isFeatured ? '100vw' : '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'}
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          priority={isHero || isFeatured}
        />
      )}

      {/* Gradient overlay */}
      <div className={`absolute inset-0 ${
        isHero || isFeatured
          ? 'bg-gradient-to-r from-[rgba(26,22,18,0.92)] via-[rgba(26,22,18,0.5)] to-transparent'
          : 'bg-gradient-to-t from-[rgba(26,22,18,0.95)] via-[rgba(26,22,18,0.55)] via-40% to-transparent'
      }`} />

      {/* Content */}
      <div className={`absolute inset-0 flex flex-col ${
        isHero || isFeatured ? 'justify-center p-8 md:p-12 max-w-2xl' : 'justify-end p-3 sm:p-4'
      }`}>
        {isHero && (
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-amber-300/80 mb-3">
            Home Library
          </span>
        )}

        <h2 className={`font-serif text-white font-semibold leading-tight ${
          isHero ? 'text-3xl md:text-4xl' :
          isFeatured ? 'text-2xl md:text-3xl' :
          'text-sm sm:text-base md:text-lg'
        }`}>
          {partner.name}
        </h2>

        {/* Descriptions only on the large cards — on small tiles they overflow the
            image and land on unreadably light scan backgrounds. The tile links to
            /libraries/[slug], which carries the full description. */}
        {!isCompact && (
          <p className={`text-white/70 leading-relaxed ${
            isHero ? 'mt-2 text-base md:text-lg line-clamp-3' : 'mt-2 text-sm md:text-base line-clamp-2'
          }`}>
            {partner.description}
          </p>
        )}

        <div className={`flex items-center gap-x-3 gap-y-1 min-w-0 ${
          isCompact ? 'mt-2 flex-nowrap' : 'mt-5 flex-wrap'
        }`}>
          <span className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-medium text-white/90 bg-white/15 backdrop-blur-sm rounded-full">
            <BookOpen className="w-3 h-3" />
            {count.toLocaleString('en-US')} books
          </span>
          {topLangs && (
            <span className={`items-center gap-1.5 text-xs text-white/60 min-w-0 ${isCompact ? 'hidden md:inline-flex' : 'inline-flex'}`}>
              <Globe className="w-3 h-3 shrink-0" />
              <span className="truncate">{topLangs}</span>
            </span>
          )}
        </div>
      </div>

      {/* External link icon */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <ExternalLink className="w-4 h-4 text-white/60" />
      </div>
    </Link>
  );
}

export default async function LibrariesPage() {
  const [stats, contributingLibraries] = await Promise.all([
    fetchProviderStats().catch((err) => { console.error('Libraries provider fetch failed:', err); return [] as ProviderStats[]; }),
    fetchContributingLibraries().catch((err) => { console.error('Libraries contributing fetch failed:', err); return [] as ContributingLibrary[]; }),
  ]);

  // Group provider stats by PARTNER, not by provider key: some institutions
  // imported books under two keys over time (ndl + ndl_japan, mdz + bsb) and
  // must render as one tile with summed counts, not duplicates.
  const byPartnerSlug = new Map<string, typeof LIBRARY_PARTNERS[string] & { count: number; languageSet: Set<string>; heroImage?: string }>();
  for (const s of stats) {
    const partner = getPartnerByProvider(s.provider);
    if (!partner) continue;
    const entry = byPartnerSlug.get(partner.slug)
      || { ...partner, count: 0, languageSet: new Set<string>(), heroImage: partner.heroImageOverride };
    entry.count += s.count;
    for (const lang of s.languages) entry.languageSet.add(lang);
    if (!entry.heroImage) entry.heroImage = s.heroImage;
    byPartnerSlug.set(partner.slug, entry);
  }
  const partners = [...byPartnerSlug.values()]
    .map(({ languageSet, ...p }) => ({ ...p, languages: [...languageSet].sort() }))
    .sort((a, b) => b.count - a.count) as (typeof LIBRARY_PARTNERS[string] & { count: number; languages: string[]; heroImage?: string })[];

  const totalBooks = partners.reduce((s, p) => s + p.count, 0);
  const totalInstitutions = contributingLibraries.length;

  // The page credits two different kinds of source, in two sections: HOLDING
  // institutions (they own and digitized what we show) and digital PLATFORMS
  // (aggregators whose scans depict books physically held elsewhere — those
  // holders appear in Contributing Institutions below). BPH keeps its
  // home-library hero at the top.
  const bph = partners.find(p => p.providerKey === 'bph');
  const holdingLibraries = partners.filter(p => p.providerKey !== 'bph' && p.kind !== 'platform');
  const platforms = partners.filter(p => p.kind === 'platform');

  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero: a tiled mosaic of the partners' own scans under the shared
          HeroScrim — the same treatment as the book-page hero, so the two
          surfaces read as one design. Falls back to the dark base color if
          images are missing. */}
      <div className="relative overflow-hidden text-white" style={{ background: '#14100c' }}>
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-4 md:grid-cols-6 md:grid-rows-2">
          {partners
            .map(p => p.heroImage)
            .filter((src): src is string => !!src)
            .slice(0, 12)
            .map((src, i) => (
              <div key={src} className="relative">
                <Image src={src} alt="" fill sizes="(max-width: 768px) 34vw, 17vw" className="object-cover" priority={i < 6} />
              </div>
            ))}
        </div>
        <HeroScrim />
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6 py-20 md:py-28" style={{ textShadow: '0 1px 16px rgba(0,0,0,0.72)' }}>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight mb-4">Libraries</h1>
          <p className="text-lg md:text-xl text-stone-300 max-w-2xl font-body leading-relaxed">
            {totalBooks.toLocaleString('en-US')} books sourced from {partners.length} libraries and archives
            {totalInstitutions > 0 ? ` across ${totalInstitutions} contributing institutions` : ''} worldwide.
          </p>
        </div>
      </div>

      <main className="max-w-[var(--container-wide)] mx-auto px-6 py-12">

        {/* BPH — Home Library (full-width hero) */}
        {bph && (
          <section className="mb-12">
            <PartnerCard partner={bph} heroImage={bph.heroImage} count={bph.count} languages={bph.languages} size="hero" />
          </section>
        )}

        {/* Holding libraries — institutions that own and digitized the books */}
        <section className="mb-16">
          <h2 className="text-2xl font-display text-primary mb-2">Libraries &amp; Archives</h2>
          <p className="text-sm text-muted mb-6 max-w-3xl">
            The institutions whose collections we read from — each holds the books it digitized.
            Every card links to their holdings on Source Library.
          </p>

          <div className="grid gap-4 sm:gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {holdingLibraries.map((partner) => (
              <PartnerCard
                key={partner.slug}
                partner={partner}
                heroImage={partner.heroImage}
                count={partner.count}
                languages={partner.languages}
              />
            ))}
          </div>
        </section>

        {/* Digital platforms — aggregators; the physical holders are credited below */}
        {platforms.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-display text-primary mb-2">Digital Archives &amp; Platforms</h2>
            <p className="text-sm text-muted mb-6 max-w-3xl">
              Portals and aggregators through which we source scans. The books themselves live in
              the contributing institutions credited beneath — and on each book&apos;s own page.
            </p>

            <div className="grid gap-4 sm:gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {platforms.map((partner) => (
                <PartnerCard
                  key={partner.slug}
                  partner={partner}
                  heroImage={partner.heroImage}
                  count={partner.count}
                  languages={partner.languages}
                />
              ))}
            </div>
          </section>
        )}

        {/* Contributing Institutions */}
        {contributingLibraries.length > 0 && (
          <section>
            <div className="flex items-center gap-2.5 mb-2">
              <Library className="w-5 h-5 text-accent-rust" />
              <h2 className="text-2xl font-display text-primary">Contributing Institutions</h2>
            </div>
            <p className="text-sm text-muted mb-6 max-w-3xl">
              The physical libraries, universities, and archives whose collections were digitized and made available through the platforms above.
            </p>

            <div className="flex flex-wrap gap-2">
              {contributingLibraries.map((lib) => (
                <span
                  key={lib.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border-light rounded-full text-secondary hover:border-accent-rust/30 transition-colors"
                >
                  {lib.name}
                  <span className="text-xs text-muted">({lib.count})</span>
                </span>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
