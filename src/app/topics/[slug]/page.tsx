import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { notFound } from 'next/navigation';
import { bookUrl } from '@/lib/slugify';
import { FACETS, facetDbField } from '@/lib/taxonomy/faceted-vocabulary';

export const revalidate = 600;

interface Props {
  params: Promise<{ slug: string }>;
}

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  language?: string;
  pages_count?: number;
  pages_translated?: number;
  pages_ocr?: number;
  pages_blank?: number;
  read_count?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
  faceted_tags?: Record<string, string[]>;
  taxonomy?: { cluster?: string; subcluster?: string };
}

// ─── Parse slug ──────────────────────────────────────────────────

function parseFacetSlug(slug: string): { facetId: string; valueId: string } | null {
  const parts = slug.split('--');
  if (parts.length !== 2) return null;
  const [facetId, valueId] = parts;
  const facet = FACETS.find((f) => f.id === facetId);
  if (!facet) return null;
  const value = facet.values.find((v) => v.id === valueId);
  if (!value) return null;
  return { facetId, valueId };
}

function topicSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Metadata ────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  // Try facet slug first
  const facetParsed = parseFacetSlug(slug);
  if (facetParsed) {
    const facet = FACETS.find((f) => f.id === facetParsed.facetId)!;
    const value = facet.values.find((v) => v.id === facetParsed.valueId)!;
    return {
      title: `${value.label} — ${facet.label} | Source Library`,
      description: `Browse Source Library books tagged "${value.label}" in the ${facet.label} facet. ${value.differentia}`,
      alternates: { canonical: `/topics/${slug}` },
      twitter: {
        card: 'summary_large_image',
        title: `${value.label} — ${facet.label} | Source Library`,
        description: `Browse Source Library books tagged "${value.label}" in the ${facet.label} facet.`,
      },
    };
  }

  // Fall back to old cluster slug
  let match;
  try {
    const db = await getDb();
    const allClusters = await db.collection('books').aggregate([
      { $match: { visible: true, 'taxonomy.cluster': { $exists: true, $ne: null } } },
      { $group: { _id: '$taxonomy.cluster' } },
    ]).toArray();
    match = allClusters.find((c) => topicSlug(c._id) === slug);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }
  if (!match) return { title: 'Topic Not Found - Source Library', robots: { index: false, follow: true } };

  return {
    title: `${match._id} | Source Library`,
    description: `Browse books in the ${match._id} topic on Source Library.`,
    alternates: { canonical: `/topics/${slug}` },
    twitter: {
      card: 'summary_large_image',
      title: `${match._id} | Source Library`,
      description: `Browse books in the ${match._id} topic on Source Library.`,
    },
  };
}

// ─── Data fetching ───────────────────────────────────────────────

async function fetchFacetData(facetId: string, valueId: string) {
  const db = await getDb();
  const facet = FACETS.find((f) => f.id === facetId)!;
  const value = facet.values.find((v) => v.id === valueId)!;

  const dbField = facetDbField(facet);
  const query = {
    visible: true,
    [`faceted_tags.${dbField}`]: valueId,
  };

  const books = await db
    .collection('books')
    .find(query, {
      projection: {
        _id: 0,
        id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1,
        pages_count: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1, read_count: 1,
        thumbnail: 1, thumbnail_blob: 1, faceted_tags: 1,
      },
    })
    .sort({ read_count: -1, pages_translated: -1, title: 1 })
    .toArray();

  // Group by the most interesting cross-facet
  // E.g., if browsing a tradition, group by domain; if browsing a domain, group by tradition
  const crossFacetId = facetId === 'tradition' ? 'domain'
    : facetId === 'domain' ? 'tradition'
    : facetId === 'sphere' ? 'tradition'
    : facetId === 'era' ? 'tradition'
    : facetId === 'form' ? 'domain'
    : facetId === 'mode' ? 'domain'
    : 'tradition';

  const crossFacet = FACETS.find((f) => f.id === crossFacetId)!;
  const crossDbField = facetDbField(crossFacet);

  const groups = new Map<string, BookItem[]>();
  const ungrouped: BookItem[] = [];

  for (const book of books) {
    const crossValues = (book as Record<string, unknown>).faceted_tags as Record<string, string[]> | undefined;
    const tags = crossValues?.[crossDbField] || [];
    if (tags.length > 0) {
      const primary = tags[0];
      if (!groups.has(primary)) groups.set(primary, []);
      groups.get(primary)!.push(book as unknown as BookItem);
    } else {
      ungrouped.push(book as unknown as BookItem);
    }
  }

  // Sort groups by size
  const sortedGroups = Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length);

  // Get languages
  const languages = new Map<string, number>();
  for (const book of books) {
    const lang = (book as Record<string, unknown>).language as string || 'Unknown';
    languages.set(lang, (languages.get(lang) || 0) + 1);
  }

  // Get other facet tag counts for the "Refine" sidebar
  const refineFacets: Array<{ facetId: string; label: string; values: Array<{ id: string; label: string; count: number }> }> = [];
  for (const f of FACETS) {
    if (f.id === facetId) continue;
    const counts = new Map<string, number>();
    for (const book of books) {
      const tags = ((book as Record<string, unknown>).faceted_tags as Record<string, string[]> | undefined)?.[facetDbField(f)] || [];
      for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => {
        const v = f.values.find((fv) => fv.id === id);
        return { id, label: v?.label || id, count };
      });
    if (sorted.length > 0) {
      refineFacets.push({ facetId: f.id, label: f.label, values: sorted });
    }
  }

  return {
    facet,
    value,
    totalBooks: books.length,
    groups: sortedGroups,
    crossFacet,
    ungrouped,
    languages: Array.from(languages.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
    refineFacets,
  };
}

async function fetchClusterData(slug: string) {
  const db = await getDb();

  const allClusters = await db.collection('books').aggregate([
    { $match: { visible: true, 'taxonomy.cluster': { $exists: true, $ne: null } } },
    { $group: { _id: '$taxonomy.cluster', cluster_id: { $first: '$taxonomy.cluster_id' } } },
  ]).toArray();

  const match = allClusters.find((c) => topicSlug(c._id) === slug);
  if (!match) return null;

  const clusterName = match._id;

  const books = await db.collection('books')
    .find({ visible: true, 'taxonomy.cluster': clusterName }, {
      projection: {
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1,
        pages_count: 1, pages_translated: 1, read_count: 1, thumbnail: 1, 'taxonomy.subcluster': 1,
      },
    })
    .sort({ pages_translated: -1, title: 1 })
    .toArray();

  const subclusters = new Map<string, BookItem[]>();
  const uncategorized: BookItem[] = [];
  for (const book of books) {
    const sub = book.taxonomy?.subcluster;
    if (sub) {
      if (!subclusters.has(sub)) subclusters.set(sub, []);
      subclusters.get(sub)!.push(book as unknown as BookItem);
    } else {
      uncategorized.push(book as unknown as BookItem);
    }
  }

  const sortBooks = (arr: BookItem[]) =>
    arr.sort((a, b) => ((b.read_count || 0) + (b.pages_translated || 0)) - ((a.read_count || 0) + (a.pages_translated || 0)));
  for (const [, books] of subclusters) sortBooks(books);
  sortBooks(uncategorized);

  const languages = new Map<string, number>();
  for (const book of books) {
    const lang = book.language || 'Unknown';
    languages.set(lang, (languages.get(lang) || 0) + 1);
  }

  return {
    clusterName,
    totalBooks: books.length,
    subclusters: Array.from(subclusters.entries()).sort((a, b) => b[1].length - a[1].length),
    uncategorized,
    languages: Array.from(languages.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

// ─── Components ──────────────────────────────────────────────────

function BookCard({ book }: { book: BookItem }) {
  const title = book.display_title || book.title;
  const thumb = book.thumbnail_blob || (book.thumbnail?.startsWith('http') ? book.thumbnail : null);
  const pagesOcr = book.pages_ocr || book.pages_count || 0;
  const denom = Math.max(pagesOcr - (book.pages_blank || 0), 1);
  const translationPercent =
    pagesOcr && book.pages_translated
      ? Math.round((book.pages_translated / denom) * 100)
      : 0;

  return (
    <Link
      href={bookUrl({ id: book.id, slug: book.slug })}
      className="group flex gap-3 p-3 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
    >
      <div className="w-14 flex-shrink-0">
        <div className="aspect-[3/4] relative rounded overflow-hidden bg-warm">
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="56px"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-muted" />
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 py-0.5">
        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-0.5 font-display">
          {title}
        </h3>
        <p className="text-xs text-muted truncate">
          {book.author || 'Unknown author'}
          {book.language ? ` · ${book.language}` : ''}
        </p>
        {translationPercent > 0 && (
          <p className="text-[11px] text-accent-rust mt-0.5">
            {translationPercent}% translated
          </p>
        )}
      </div>
    </Link>
  );
}

// ─── Page ────────────────────────────────────────────────────────

export default async function TopicDetailPage({ params }: Props) {
  const { slug } = await params;

  // Try facet route first
  const facetParsed = parseFacetSlug(slug);

  if (facetParsed) {
    const data = await fetchFacetData(facetParsed.facetId, facetParsed.valueId);

    return (
      <div className="min-h-screen bg-cream">
        <SiteHeader variant="dark" />
        {/* Hero */}
        <div className="bg-gradient-to-b from-[#2a1f17] to-[#1a1612] text-white">
          <div className="max-w-5xl mx-auto px-6 pt-8 pb-12">
            <p className="text-sm text-white/40 mb-2">{data.facet.label}</p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl text-white font-semibold leading-tight mb-3 font-display">
              {data.value.label}
            </h1>
            <p className="text-white/60 text-sm max-w-xl mb-4">
              {data.value.differentia}
            </p>

            <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
              <span>{data.totalBooks.toLocaleString()} books</span>
              {data.languages.length > 0 && (
                <>
                  <span className="w-px h-4 bg-white/20" />
                  <span>
                    {data.languages.map(([lang]) => lang).join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Main content */}
            <div className="flex-1 min-w-0">
              {data.groups.map(([groupValue, books]) => {
                const crossValue = data.crossFacet.values.find((v) => v.id === groupValue);
                return (
                  <div key={groupValue} className="mb-10">
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-lg font-display font-semibold text-primary">
                        {crossValue?.label || groupValue}
                      </h2>
                      <span className="text-xs text-muted bg-warm px-2 py-0.5 rounded-full">
                        {books.length}
                      </span>
                    </div>
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                      {books.slice(0, 20).map((book) => (
                        <BookCard key={book.id || book.slug} book={book} />
                      ))}
                    </div>
                    {books.length > 20 && (
                      <p className="text-xs text-muted mt-3">
                        + {books.length - 20} more
                      </p>
                    )}
                  </div>
                );
              })}

              {data.ungrouped.length > 0 && (
                <div className="mb-10">
                  <h2 className="text-lg font-display font-semibold text-primary mb-4">Other</h2>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                    {data.ungrouped.slice(0, 20).map((book) => (
                      <BookCard key={book.id || book.slug} book={book} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Refine sidebar */}
            <div className="lg:w-64 flex-shrink-0">
              <div className="sticky top-8">
                <h3 className="text-sm font-semibold text-primary mb-4">Refine</h3>
                {data.refineFacets.map((rf) => (
                  <div key={rf.facetId} className="mb-6">
                    <p className="text-xs text-muted mb-2 uppercase tracking-wide">{rf.label}</p>
                    <div className="space-y-1">
                      {rf.values.map((v) => (
                        <Link
                          key={v.id}
                          href={`/topics/${rf.facetId}--${v.id}`}
                          className="flex items-center justify-between text-sm text-secondary hover:text-accent-rust transition-colors py-0.5"
                        >
                          <span className="truncate">{v.label}</span>
                          <span className="text-xs text-muted ml-2">{v.count}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fall back to old cluster view
  const clusterData = await fetchClusterData(slug);
  if (!clusterData) notFound();

  const { clusterName, totalBooks, subclusters, uncategorized, languages } = clusterData;

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />
      <div className="bg-gradient-to-b from-[#2a1f17] to-[#1a1612] text-white">
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-12">
          <h1 className="text-3xl sm:text-4xl md:text-5xl text-white font-semibold leading-tight mb-3 font-display">
            {clusterName}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{totalBooks} books</span>
            {subclusters.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{subclusters.length} subtopics</span>
              </>
            )}
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.map(([lang]) => lang).join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {subclusters.map(([name, books]) => (
          <div key={name} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-display font-semibold text-primary">{name}</h2>
              <span className="text-xs text-muted bg-warm px-2 py-0.5 rounded-full">{books.length}</span>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book) => (
                <BookCard key={book.id || book.slug} book={book} />
              ))}
            </div>
          </div>
        ))}

        {uncategorized.length > 0 && subclusters.length > 0 && (
          <div className="mb-10">
            <h2 className="text-lg font-display font-semibold text-primary mb-4">Other</h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {uncategorized.map((book) => (
                <BookCard key={book.id || book.slug} book={book} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
