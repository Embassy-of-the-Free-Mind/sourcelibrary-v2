import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Languages | Source Library',
  description: 'Browse Source Library by language — Latin, German, French, Greek, Hebrew, Arabic, and 30+ more languages spanning 5,000 years of human thought.',
  alternates: { canonical: '/languages' },
  openGraph: {
    title: 'Languages | Source Library',
    description: 'Browse Source Library by language — Latin, German, French, Greek, Hebrew, Arabic, and 30+ more languages spanning 5,000 years of human thought.',
    type: 'website',
  },
};

interface LanguageStats {
  name: string;
  slug: string;
  bookCount: number;
  yearRange?: string;
  heroImage?: string;
}

function languageSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function fetchLanguageStats(): Promise<{ languages: LanguageStats[]; totalBooks: number }> {
  // Query books_catalog in Supabase — instant vs 10s+ MongoDB aggregation
  const { data, error } = await supabase
    .from('books_catalog')
    .select('language, published, thumbnail, thumbnail_blob')
    .eq('visible', true)
    .gt('pages_count', 0)
    .not('language', 'is', null)
    .neq('language', '');

  if (error) throw new Error(`Language stats query failed: ${error.message}`);

  // Group by language
  const langMap = new Map<string, { count: number; minYear?: string; maxYear?: string; heroImage?: string }>();
  for (const row of (data || [])) {
    const lang = row.language as string;
    const existing = langMap.get(lang) || { count: 0 };
    existing.count++;
    const pub = row.published as string | null;
    if (pub) {
      if (!existing.minYear || pub < existing.minYear) existing.minYear = pub;
      if (!existing.maxYear || pub > existing.maxYear) existing.maxYear = pub;
    }
    if (!existing.heroImage) {
      const thumb = (row.thumbnail_blob || row.thumbnail) as string | null;
      if (thumb) existing.heroImage = thumb;
    }
    langMap.set(lang, existing);
  }

  let totalBooks = 0;
  const languages: LanguageStats[] = [];
  for (const [name, stats] of langMap.entries()) {
    if (stats.count < 2) continue;
    totalBooks += stats.count;
    const yearRange = stats.minYear && stats.maxYear && stats.minYear !== stats.maxYear
      ? `${stats.minYear} - ${stats.maxYear}`
      : stats.minYear || stats.maxYear || undefined;
    languages.push({
      name,
      slug: languageSlug(name),
      bookCount: stats.count,
      yearRange,
      heroImage: stats.heroImage,
    });
  }

  languages.sort((a, b) => b.bookCount - a.bookCount);
  return { languages, totalBooks };
}

export default async function LanguagesPage() {
  const { languages, totalBooks } = await fetchLanguageStats().catch((err) => {
    console.error('Languages fetch failed:', err);
    return { languages: [] as LanguageStats[], totalBooks: 0 };
  });

  // Split into major (10+ books) and minor
  const major = languages.filter(l => l.bookCount >= 10);
  const minor = languages.filter(l => l.bookCount < 10);

  return (
    <ContentPageLayout>
      <ContentHeader
        title="Languages"
        subtitle={`${totalBooks.toLocaleString()} books across ${languages.length} languages, spanning five millennia of human thought.`}
      />

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mb-12">
        {major.map((lang) => (
          <Link
            key={lang.slug}
            href={`/languages/${lang.slug}`}
            className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
          >
            {lang.heroImage ? (
              <Image
                src={lang.heroImage}
                alt={`Illustration from ${lang.name} text`}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 bg-warm" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2.5 py-0.5 text-xs text-white/80 bg-white/15 backdrop-blur-sm rounded-full">
                  {lang.bookCount.toLocaleString()} books
                </span>
                {lang.yearRange && (
                  <span className="text-xs text-white/50">{lang.yearRange}</span>
                )}
              </div>
              <h2 className="font-serif text-xl sm:text-2xl text-white font-semibold leading-tight">
                {lang.name}
              </h2>
            </div>
          </Link>
        ))}
      </div>

      {minor.length > 0 && (
        <>
          <h2 className="text-2xl font-display text-primary mb-4">Other Languages</h2>
          <div className="flex flex-wrap gap-2">
            {minor.map((lang) => (
              <Link
                key={lang.slug}
                href={`/languages/${lang.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border-light rounded-full text-secondary hover:border-accent-rust/30 transition-colors"
              >
                {lang.name}
                <span className="text-xs text-muted">({lang.bookCount})</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </ContentPageLayout>
  );
}
