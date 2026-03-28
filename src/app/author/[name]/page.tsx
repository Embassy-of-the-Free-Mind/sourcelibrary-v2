import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Book as BookIcon } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import { bookUrl, authorSlug } from '@/lib/slugify';
import { ObjectId } from 'mongodb';

interface Book {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  thumbnail?: string;
  pages_count?: number;
  pages_translated?: number;
  translation_percent?: number;
  summary?: { data: string } | string;
}

interface AuthorEntity {
  _id: ObjectId;
  name: string;
  canonical_name?: string;
  description?: string;
  viaf_id?: string;
  wikidata_id?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

// ISR: author pages are mostly static — revalidate weekly.
// Use POST /api/admin/revalidate-authors to force refresh after changes.
export const revalidate = 604800;
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface AuthorPageProps {
  params: Promise<{ name: string }>;
}

/**
 * Resolve an author slug to an entity + canonical name.
 * Strategy:
 *   1. Find a book matching the slug pattern
 *   2. If that book has author_entity_id, load the entity (gets all variants)
 *   3. Otherwise fall back to raw author string matching
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Load author page data in a single pass.
 * Queries system_config for a pre-built author slug→name map (built by sync-worker),
 * then fetches books by exact author match (indexed) and entity by _id (indexed).
 * Zero regex, zero collection scans.
 */
async function loadAuthorData(db: any, slug: string): Promise<{
  authorName: string;
  entity: AuthorEntity | null;
  books: Book[];
} | null> {
  // Look up author slug→name from system_config cache
  const config = await db.collection('system_config').findOne(
    { _id: 'author_slugs' },
    { projection: { slugs: 1 } }
  );

  let authorName: string | undefined;
  if (config?.slugs?.[slug]) {
    authorName = config.slugs[slug];
  } else {
    // Fallback: title-case from slug (handles uncached authors until next sync)
    const guess = slug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    // Verify this author exists with an exact match
    const check = await db.collection('books').findOne(
      { author: guess, hidden: { $ne: true } },
      { projection: { _id: 1 } }
    );
    if (check) authorName = guess;
  }

  if (!authorName) return null;

  // Fetch books + entity in parallel
  const booksPromise = db.collection('books').find(
    { author: authorName, hidden: { $ne: true } },
    {
      projection: {
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
        author_entity_id: 1, language: 1, published: 1, thumbnail: 1,
        pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, year: 1,
        summary: 1,
      }
    }
  ).sort({ year: 1, title: 1 }).toArray();

  const books = await booksPromise;
  if (books.length === 0) return null;

  // Resolve entity from first book with author_entity_id
  let entity: AuthorEntity | null = null;
  const entityBookId = books.find((b: any) => b.author_entity_id)?.author_entity_id;
  if (entityBookId) {
    try {
      entity = await db.collection('entities').findOne(
        { _id: new ObjectId(entityBookId) },
        { projection: { name: 1, canonical_name: 1, description: 1, viaf_id: 1, wikidata_id: 1, wikidata_birth_date: 1, wikidata_death_date: 1 } }
      ) as AuthorEntity | null;
    } catch { /* invalid ObjectId */ }
  }

  const displayName = entity?.canonical_name || entity?.name || authorName;

  return {
    authorName: displayName,
    entity,
    books: books.map((b: any) => ({
      ...b,
      pages_count: b.pages_count || 0,
      pages_translated: b.pages_translated || 0,
      translation_percent: b.pages_ocr > 0
        ? Math.round((b.pages_translated || 0) / Math.max((b.pages_ocr || 0) - (b.pages_blank || 0), 1) * 100)
        : 0,
    })),
  };
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { name } = await params;
  // Derive display name from slug — no DB call needed for metadata.
  // The page component does the real resolve; metadata just needs a title.
  const decoded = decodeURIComponent(name);
  const authorName = decoded !== name
    ? decoded
    : name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return {
    title: `${authorName} — Source Library`,
    description: `Browse works by ${authorName} in Source Library's collection of rare historical texts, digitized and translated with AI.`,
    openGraph: {
      title: `${authorName} — Source Library`,
      description: `Works by ${authorName} in Source Library`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${authorName} — Source Library`,
      description: `Works by ${authorName} in Source Library`,
    },
  };
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  // Redirect old %20-style URLs to hyphenated slugs
  if (decoded !== name) {
    redirect(`/author/${authorSlug(decoded)}`);
  }

  const db = await getDb();
  const data = await loadAuthorData(db, name);
  if (!data) notFound();

  const { authorName, entity, books } = data;

  // Year range
  const years = books.map(b => b.published).filter(Boolean).map(p => parseInt(p)).filter(y => !isNaN(y));
  const yearRange = years.length > 0
    ? years.length === 1 || Math.min(...years) === Math.max(...years)
      ? `${Math.min(...years)}`
      : `${Math.min(...years)}–${Math.max(...years)}`
    : null;

  // Life dates from entity
  const birthYear = entity?.wikidata_birth_date?.split('-')[0];
  const deathYear = entity?.wikidata_death_date?.split('-')[0];
  const lifeDates = birthYear ? `${birthYear}–${deathYear || '?'}` : null;

  // Encyclopedia entry: use entity directly if we have one, otherwise regex fallback
  const encyclopediaEntity = entity || await db.collection('entities').findOne(
    { type: 'person', $or: [
      { name: { $regex: new RegExp(`^${authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      { aliases: { $regex: new RegExp(`^${authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
    ]},
    { projection: { name: 1 } }
  );

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Library
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold">
            {authorName}
          </h1>
          <div className="flex flex-wrap items-center gap-4 mt-3">
            <p className="text-accent-gold font-medium">
              {books.length} work{books.length !== 1 ? 's' : ''}
            </p>
            {lifeDates && (
              <p className="text-stone-400">{lifeDates}</p>
            )}
            {!lifeDates && yearRange && (
              <p className="text-stone-400">{yearRange}</p>
            )}
          </div>
          {entity?.description && (
            <p className="text-stone-300 mt-2 text-sm max-w-2xl">
              {entity.description}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            {encyclopediaEntity && (
              <Link
                href={`/encyclopedia/${encodeURIComponent(encyclopediaEntity.name)}`}
                className="inline-block px-3 py-1.5 text-sm bg-accent-rust/20 text-accent-gold hover:bg-accent-rust/30 rounded-full transition-colors"
              >
                View encyclopedia entry
              </Link>
            )}
            {entity?.viaf_id && (
              <a
                href={`https://viaf.org/viaf/${entity.viaf_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 text-sm bg-stone-700/50 text-stone-300 hover:bg-stone-700 rounded-full transition-colors"
              >
                VIAF
              </a>
            )}
            {entity?.wikidata_id && (
              <a
                href={`https://www.wikidata.org/wiki/${entity.wikidata_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 text-sm bg-stone-700/50 text-stone-300 hover:bg-stone-700 rounded-full transition-colors"
              >
                Wikidata
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {books.map(book => {
            const summaryText = typeof book.summary === 'string'
              ? book.summary
              : book.summary?.data;

            return (
              <Link
                key={book.id}
                href={bookUrl(book)}
                className="group bg-white rounded-xl border border-stone-200 overflow-hidden hover:border-accent-gold/20 hover:shadow-lg transition-all"
              >
                {/* Thumbnail */}
                <div className="aspect-[3/2] bg-stone-100 relative overflow-hidden">
                  {book.thumbnail ? (
                    <Image
                      src={book.thumbnail}
                      alt={book.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BookIcon className="w-12 h-12 text-stone-300" />
                    </div>
                  )}
                  {/* Translation badge */}
                  {book.translation_percent !== undefined && (
                    <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium ${
                      (book.translation_percent ?? 0) >= 95
                        ? 'bg-status-success text-white'
                        : (book.translation_percent ?? 0) > 0
                          ? 'bg-accent-gold/80 text-white'
                          : 'bg-stone-500 text-white'
                    }`}>
                      {(book.translation_percent ?? 0) >= 95
                        ? 'Translated'
                        : `${book.translation_percent}%`}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-serif font-semibold text-stone-900 group-hover:text-accent-rust transition-colors line-clamp-2">
                    {book.display_title || book.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-2 text-xs text-stone-500">
                    <span className="px-2 py-0.5 bg-stone-100 rounded">{book.language}</span>
                    {book.published && <span>{book.published}</span>}
                  </div>
                  {summaryText && (
                    <p className="text-sm text-stone-600 mt-3 line-clamp-2">
                      {summaryText}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
