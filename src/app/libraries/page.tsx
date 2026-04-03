import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import { Library } from 'lucide-react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { LIBRARY_PARTNERS, getPartnerByProvider } from '@/lib/library-partners';
import type { Metadata } from 'next';

export const revalidate = 3600; // ISR: rebuild every hour

export const metadata: Metadata = {
  title: 'Libraries | Source Library',
  description: 'Browse books by digital source and contributing institution — Internet Archive, Gallica, Bodleian Library, Getty Research Institute, and more.',
  alternates: { canonical: '/libraries' },
  openGraph: {
    title: 'Libraries | Source Library',
    description: 'Browse books by digital source and contributing institution — Internet Archive, Gallica, Bodleian Library, Getty Research Institute, and more.',
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

async function fetchProviderStats(): Promise<ProviderStats[]> {
  // Query books_catalog in Supabase — instant vs 45s MongoDB aggregation
  const excludeProviders = ['user_upload', 'other', 'library', 'iiif'];
  const { data, error } = await supabase
    .from('books_catalog')
    .select('image_source_provider, language, thumbnail, thumbnail_blob')
    .eq('visible', true)
    .gt('pages_count', 0)
    .gt('pages_translated', 0)
    .not('image_source_provider', 'is', null);

  if (error) throw new Error(`Provider stats query failed: ${error.message}`);

  // Group by provider
  const providerMap = new Map<string, { count: number; languages: Set<string>; heroImage?: string }>();
  for (const row of (data || [])) {
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
  // contributing_library is not in books_catalog, so use a simple
  // fallback — return empty until we add the field to the catalog.
  // The libraries index page still renders the Digital Sources section.
  return [];
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

  return (
    <ContentPageLayout>
      <ContentHeader
        title="Libraries"
        subtitle={`${totalBooks.toLocaleString()} books sourced from ${partners.length} digital platforms and ${totalInstitutions} contributing institutions worldwide.`}
      />

      {/* Digital Sources */}
      <h2 className="text-2xl font-display text-primary mb-4">Digital Sources</h2>
      <p className="text-sm text-muted mb-6">
        The platforms and digital libraries that host the scanned books we import.
      </p>

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 mb-16">
        {partners.map((partner) => {
          const topLangs = partner.languages.slice(0, 3).map(l => l).join(', ');

          return (
            <Link
              key={partner.slug}
              href={`/libraries/${partner.slug}`}
              className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
            >
              {/* Hero image */}
              {partner.heroImage ? (
                <Image
                  src={partner.heroImage}
                  alt={`Illustration from ${partner.name}`}
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 bg-warm" />
              )}

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />

              {/* Content */}
              <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 text-xs text-white/80 bg-white/15 backdrop-blur-sm rounded-full">
                    {partner.count.toLocaleString()} books
                  </span>
                  {topLangs && (
                    <span className="text-xs text-white/50">
                      {topLangs}
                    </span>
                  )}
                </div>
                <h2 className="font-serif text-xl sm:text-2xl text-white font-semibold leading-tight">
                  {partner.name}
                </h2>
                <p className="mt-1 text-sm text-white/70 line-clamp-2 leading-snug">
                  {partner.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Contributing Institutions */}
      {contributingLibraries.length > 0 && (
        <>
          <div className="flex items-center gap-2.5 mb-4">
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
        </>
      )}
    </ContentPageLayout>
  );
}
