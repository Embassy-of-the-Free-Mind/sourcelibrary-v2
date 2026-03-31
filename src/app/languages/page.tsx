import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const revalidate = 600;
export const maxDuration = 30;

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
  const db = await getDb();

  // Aggregate book counts by language
  const langAgg = await db.collection('books').aggregate([
    {
      $match: {
        status: { $ne: 'deleted' },
        visible: true,
        pages_count: { $gt: 0 },
        language: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: '$language',
        count: { $sum: 1 },
        minYear: { $min: '$published' },
        maxYear: { $max: '$published' },
        sampleIds: { $push: '$id' },
      },
    },
    { $match: { count: { $gte: 2 } } },
    { $sort: { count: -1 as const } },
    { $project: { count: 1, minYear: 1, maxYear: 1, sampleIds: { $slice: ['$sampleIds', 5] } } },
  ], { maxTimeMS: 10000 }).toArray();

  // Fetch hero images for top languages
  const allSampleIds = langAgg.flatMap(r => (r.sampleIds as string[]));
  const heroImages = allSampleIds.length > 0
    ? await db.collection('gallery_images')
        .find({
          book_id: { $in: allSampleIds },
          gallery_quality: { $gte: 0.7 },
          type: { $nin: ['decorative', 'symbol', 'musical_score'] },
        }, { maxTimeMS: 5000 })
        .sort({ gallery_quality: -1 })
        .limit(50)
        .toArray()
        .catch(() => [])
    : [];

  // Map book IDs to languages
  const bookToLang = new Map<string, string>();
  for (const r of langAgg) {
    for (const bid of (r.sampleIds as string[])) {
      bookToLang.set(bid, r._id as string);
    }
  }

  // Best image per language
  const langHero = new Map<string, string>();
  for (const img of heroImages) {
    const lang = bookToLang.get(img.book_id as string);
    if (lang && !langHero.has(lang)) {
      const url = (img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url) as string;
      if (url) langHero.set(lang, url);
    }
  }

  const totalBooks = langAgg.reduce((sum, r) => sum + (r.count as number), 0);

  const languages: LanguageStats[] = langAgg.map(r => {
    const name = r._id as string;
    const minYear = r.minYear as string | undefined;
    const maxYear = r.maxYear as string | undefined;
    const yearRange = minYear && maxYear && minYear !== maxYear
      ? `${minYear} - ${maxYear}`
      : minYear || maxYear || undefined;

    return {
      name,
      slug: languageSlug(name),
      bookCount: r.count as number,
      yearRange,
      heroImage: langHero.get(name),
    };
  });

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
