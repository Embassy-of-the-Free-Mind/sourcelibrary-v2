import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { bookUrl } from '@/lib/slugify';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

function topicSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  thumbnail?: string;
  taxonomy?: {
    cluster?: string;
    subcluster?: string;
  };
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();

  // Find one book with this topic slug to get the cluster name
  const sample = await db.collection('books').findOne(
    { hidden: { $ne: true }, 'taxonomy.cluster': { $exists: true } },
    { projection: { 'taxonomy.cluster': 1 } },
  );

  // We need to find the actual cluster name from the slug
  const allClusters = await db.collection('books').aggregate([
    { $match: { hidden: { $ne: true }, 'taxonomy.cluster': { $exists: true, $ne: null } } },
    { $group: { _id: '$taxonomy.cluster' } },
  ]).toArray();

  const match = allClusters.find((c) => topicSlug(c._id) === slug);
  if (!match) return { title: 'Topic Not Found - Source Library' };

  return {
    title: `${match._id} | Source Library`,
    description: `Browse books in the ${match._id} topic on Source Library.`,
    alternates: { canonical: `/topics/${slug}` },
  };
}

// ---------- Data ----------

async function fetchTopicData(slug: string) {
  const db = await getDb();

  // Get all distinct cluster names and find the one matching this slug
  const allClusters = await db.collection('books').aggregate([
    { $match: { hidden: { $ne: true }, 'taxonomy.cluster': { $exists: true, $ne: null } } },
    { $group: { _id: '$taxonomy.cluster', cluster_id: { $first: '$taxonomy.cluster_id' } } },
  ]).toArray();

  const match = allClusters.find((c) => topicSlug(c._id) === slug);
  if (!match) return null;

  const clusterName = match._id;

  // Fetch all books in this cluster
  const books = await db
    .collection('books')
    .find(
      {
        hidden: { $ne: true },
        'taxonomy.cluster': clusterName,
      },
      {
        projection: {
          _id: 0,
          id: 1,
          slug: 1,
          title: 1,
          display_title: 1,
          author: 1,
          language: 1,
          pages_count: 1,
          pages_translated: 1,
          thumbnail: 1,
          'taxonomy.subcluster': 1,
        },
      },
    )
    .sort({ pages_translated: -1, title: 1 })
    .toArray();

  // Group by subcluster
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

  // Sort subclusters by size (largest first)
  const sortedSubclusters = Array.from(subclusters.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // Get languages
  const languages = new Map<string, number>();
  for (const book of books) {
    const lang = book.language || 'Unknown';
    languages.set(lang, (languages.get(lang) || 0) + 1);
  }
  const topLanguages = Array.from(languages.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return {
    clusterName,
    totalBooks: books.length,
    subclusters: sortedSubclusters,
    uncategorized,
    languages: topLanguages,
  };
}

// ---------- Components ----------

function BookCard({ book }: { book: BookItem }) {
  const title = book.display_title || book.title;
  const thumb = book.thumbnail?.startsWith('http') ? book.thumbnail : null;
  const translationPercent =
    book.pages_count && book.pages_translated
      ? Math.round((book.pages_translated / book.pages_count) * 100)
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

// ---------- Page ----------

export default async function TopicDetailPage({ params }: Props) {
  const { slug } = await params;
  const data = await fetchTopicData(slug);
  if (!data) notFound();

  const { clusterName, totalBooks, subclusters, uncategorized, languages } = data;

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#2a1f17] to-[#1a1612] text-white">
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-12">
          <Link
            href="/topics"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            All Topics
          </Link>

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
                <span>{languages.map(([l]) => l).join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Subclusters */}
        {subclusters.map(([subName, books]) => (
          <div key={subName} className="mb-10">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-xl font-display font-semibold text-primary">
                {subName}
              </h2>
              <span className="text-sm text-muted">{books.length} books</span>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          </div>
        ))}

        {/* Uncategorized (no subcluster) */}
        {uncategorized.length > 0 && (
          <div className="mb-10">
            {subclusters.length > 0 && (
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xl font-display font-semibold text-primary">
                  Other
                </h2>
                <span className="text-sm text-muted">{uncategorized.length} books</span>
              </div>
            )}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {uncategorized.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
