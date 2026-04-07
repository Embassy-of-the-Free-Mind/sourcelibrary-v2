import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import { Library, ExternalLink, BookOpen, Globe } from 'lucide-react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import { LIBRARY_PARTNERS, getPartnerByProvider } from '@/lib/library-partners';
import type { Metadata } from 'next';

export const revalidate = 600; // ISR: rebuild every 10 minutes

export const metadata: Metadata = {
  title: 'Libraries | Source Library',
  description: 'Browse books by digital source and contributing institution — Bibliotheca Philosophica Hermetica, Internet Archive, Gallica, Bodleian Library, and more.',
  alternates: { canonical: '/libraries' },
  openGraph: {
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
      .gt('pages_translated', 0)
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

  const counts = new Map<string, number>();
  for (const row of allRows) {
    const name = (row.contributing_library as string || '').trim();
    if (!name) continue;
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
  const topLangs = languages.slice(0, 4).join(', ');
  const isHero = size === 'hero';
  const isFeatured = size === 'featured';

  return (
    <Link
      href={`/libraries/${partner.slug}`}
      className={`group relative block overflow-hidden rounded-xl ${
        isHero ? 'aspect-[21/9] md:aspect-[3/1]' :
        isFeatured ? 'aspect-[21/9]' :
        'aspect-[4/3]'
      }`}
    >
      {heroImage ? (
        <Image
          src={heroImage}
          alt={`Illustration from ${partner.name}`}
          fill
          sizes={isHero || isFeatured ? '100vw' : '(max-width: 640px) 100vw, 50vw'}
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          unoptimized
          priority={isHero || isFeatured}
        />
      ) : (
        <div className={`absolute inset-0 ${
          partner.color === 'gold' ? 'bg-gradient-to-br from-amber-900 to-amber-950' :
          partner.color === 'rust' ? 'bg-gradient-to-br from-stone-800 to-stone-900' :
          partner.color === 'violet' ? 'bg-gradient-to-br from-indigo-900 to-slate-900' :
          'bg-gradient-to-br from-emerald-900 to-stone-900'
        }`} />
      )}

      {/* Gradient overlay */}
      <div className={`absolute inset-0 ${
        isHero || isFeatured
          ? 'bg-gradient-to-r from-[rgba(26,22,18,0.92)] via-[rgba(26,22,18,0.5)] to-transparent'
          : 'bg-gradient-to-t from-[rgba(26,22,18,0.88)] via-[rgba(26,22,18,0.3)] to-transparent'
      }`} />

      {/* Content */}
      <div className={`absolute inset-0 flex flex-col ${
        isHero || isFeatured ? 'justify-center p-8 md:p-12 max-w-2xl' : 'justify-end p-5 sm:p-6'
      }`}>
        {isHero && (
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-amber-300/80 mb-3">
            Home Library
          </span>
        )}

        <h2 className={`font-serif text-white font-semibold leading-tight ${
          isHero ? 'text-3xl md:text-4xl' :
          isFeatured ? 'text-2xl md:text-3xl' :
          'text-xl sm:text-2xl'
        }`}>
          {partner.name}
        </h2>

        <p className={`mt-2 text-white/70 leading-relaxed ${
          isHero ? 'text-base md:text-lg line-clamp-3' :
          isFeatured ? 'text-sm md:text-base line-clamp-2' :
          'text-sm line-clamp-2'
        }`}>
          {partner.description}
        </p>

        <div className={`flex items-center gap-3 ${isHero || isFeatured ? 'mt-5' : 'mt-3'}`}>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white/90 bg-white/15 backdrop-blur-sm rounded-full">
            <BookOpen className="w-3 h-3" />
            {count.toLocaleString()} books
          </span>
          {topLangs && (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/50">
              <Globe className="w-3 h-3" />
              {topLangs}
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

  const partners = stats
    .map(s => {
      const partner = getPartnerByProvider(s.provider);
      if (!partner) return null;
      return { ...partner, count: s.count, languages: s.languages, heroImage: partner.heroImageOverride || s.heroImage };
    })
    .filter(Boolean) as (typeof LIBRARY_PARTNERS[string] & { count: number; languages: string[]; heroImage?: string })[];

  const totalBooks = partners.reduce((s, p) => s + p.count, 0);
  const totalInstitutions = contributingLibraries.length;

  // Separate BPH (home library) and IA (featured) from the rest
  const bph = partners.find(p => p.providerKey === 'bph');
  const ia = partners.find(p => p.providerKey === 'internet_archive');
  const rest = partners.filter(p => p.providerKey !== 'bph' && p.providerKey !== 'internet_archive');

  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero: dark gradient header */}
      <div className="relative overflow-hidden text-white py-16 md:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight mb-4">Libraries</h1>
          <p className="text-lg md:text-xl text-stone-300 max-w-2xl font-body leading-relaxed">
            {totalBooks.toLocaleString()} books sourced from {partners.length} digital platforms
            {totalInstitutions > 0 ? ` and ${totalInstitutions} contributing institutions` : ''} worldwide.
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

        {/* Internet Archive — Featured (full-width spread) */}
        {ia && (
          <section className="mb-12">
            <PartnerCard partner={ia} heroImage={ia.heroImage} count={ia.count} languages={ia.languages} size="featured" />
          </section>
        )}

        {/* Other Digital Sources — 2-column grid */}
        <section className="mb-16">
          <h2 className="text-2xl font-display text-primary mb-2">Digital Sources</h2>
          <p className="text-sm text-muted mb-6">
            Libraries and platforms whose digitized collections we import, translate, and preserve.
          </p>

          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
            {rest.map((partner) => (
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
