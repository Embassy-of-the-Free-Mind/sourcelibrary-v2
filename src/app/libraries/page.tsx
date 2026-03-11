import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { LIBRARY_PARTNERS, getPartnerByProvider } from '@/lib/library-partners';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Library Partners | Source Library',
  description: 'Browse books by digitization source — Internet Archive, Gallica, Bodleian Library, Bavarian State Library, and more.',
  alternates: { canonical: '/libraries' },
  openGraph: {
    title: 'Library Partners | Source Library',
    description: 'Browse books by digitization source — Internet Archive, Gallica, Bodleian Library, Bavarian State Library, and more.',
    type: 'website',
  },
};

interface ProviderStats {
  provider: string;
  count: number;
  languages: string[];
  heroImage?: string;
}

async function fetchProviderStats(): Promise<ProviderStats[]> {
  const db = await getDb();

  const pipeline = [
    {
      $match: {
        'image_source.provider': { $exists: true, $nin: ['user_upload', 'other', 'library', 'iiif'] },
        status: { $ne: 'deleted' },
        pages_count: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: '$image_source.provider',
        count: { $sum: 1 },
        languages: { $addToSet: '$language' },
        bookIds: { $push: '$id' },
      },
    },
    { $sort: { count: -1 as const } },
  ];

  const results = await db.collection('books').aggregate(pipeline).toArray();

  // Fetch one hero gallery image per provider
  const allBookIds = results.flatMap(r => (r.bookIds as string[]).slice(0, 50));
  const heroImages = allBookIds.length > 0
    ? await db.collection('gallery_images')
        .find({
          book_id: { $in: allBookIds },
          gallery_quality: { $gte: 0.7 },
          type: { $nin: ['decorative', 'symbol', 'musical_score'] },
        })
        .sort({ gallery_quality: -1 })
        .limit(200)
        .toArray()
        .catch(() => [])
    : [];

  // Build a map: provider → best image URL
  const bookToProvider = new Map<string, string>();
  for (const r of results) {
    for (const bid of (r.bookIds as string[]).slice(0, 50)) {
      bookToProvider.set(bid, r._id as string);
    }
  }

  const providerHero = new Map<string, string>();
  for (const img of heroImages) {
    const provider = bookToProvider.get(img.book_id as string);
    if (provider && !providerHero.has(provider)) {
      const url = (img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url) as string;
      if (url) providerHero.set(provider, url);
    }
  }

  return results.map(r => ({
    provider: r._id as string,
    count: r.count as number,
    languages: (r.languages as string[]).filter(Boolean).sort(),
    heroImage: providerHero.get(r._id as string),
  }));
}

export default async function LibrariesPage() {
  const stats = await fetchProviderStats();

  const partners = stats
    .map(s => {
      const partner = getPartnerByProvider(s.provider);
      if (!partner) return null;
      return { ...partner, count: s.count, languages: s.languages, heroImage: partner.heroImageOverride || s.heroImage };
    })
    .filter(Boolean) as (typeof LIBRARY_PARTNERS[string] & { count: number; languages: string[]; heroImage?: string })[];

  const totalBooks = partners.reduce((s, p) => s + p.count, 0);

  return (
    <ContentPageLayout>
      <ContentHeader
        title="Library Partners"
        subtitle={`${totalBooks.toLocaleString()} books sourced from ${partners.length} digital libraries and archives worldwide.`}
      />

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
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
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.92)] via-[rgba(26,22,18,0.4)] to-transparent" />

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
    </ContentPageLayout>
  );
}
