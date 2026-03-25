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

// ISR: rebuild at most every hour
export const revalidate = 3600;
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
async function resolveAuthor(db: any, slug: string): Promise<{
  authorName: string;
  entity: AuthorEntity | null;
  entityId: string | null;
} | null> {
  const pattern = slug.split('-').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9]+');
  const book = await db.collection('books').findOne(
    { author: { $regex: new RegExp(`^${pattern}$`, 'i') }, hidden: { $ne: true } },
    { projection: { author: 1, author_entity_id: 1 } }
  );

  if (!book) {
    // Try matching against entity aliases/canonical names
    const entity = await db.collection('entities').findOne({
      type: 'person',
      canonical_name: { $exists: true },
      $or: [
        { canonical_name: { $regex: new RegExp(`^${pattern}$`, 'i') } },
        { aliases: { $regex: new RegExp(`^${pattern}$`, 'i') } },
      ]
    }, { projection: { name: 1, canonical_name: 1, description: 1, viaf_id: 1, wikidata_id: 1, wikidata_birth_date: 1, wikidata_death_date: 1 } });

    if (entity) {
      return {
        authorName: entity.canonical_name || entity.name,
        entity: entity as AuthorEntity,
        entityId: entity._id.toString(),
      };
    }
    return null;
  }

  // If book has entity link, use that for canonical name
  if (book.author_entity_id) {
    try {
      const entity = await db.collection('entities').findOne(
        { _id: new ObjectId(book.author_entity_id) },
        { projection: { name: 1, canonical_name: 1, description: 1, viaf_id: 1, wikidata_id: 1, wikidata_birth_date: 1, wikidata_death_date: 1 } }
      );
      if (entity) {
        return {
          authorName: entity.canonical_name || entity.name,
          entity: entity as AuthorEntity,
          entityId: book.author_entity_id,
        };
      }
    } catch {
      // Invalid ObjectId — fall through
    }
  }

  return {
    authorName: book.author as string,
    entity: null,
    entityId: null,
  };
}

/**
 * Get all books by an author.
 * When entityId is available, queries by author_entity_id (catches all name variants).
 * Falls back to regex matching on the raw author string.
 */
async function getAuthorBooks(authorName: string, entityId: string | null): Promise<Book[]> {
  const db = await getDb();

  // Build match condition: prefer entity-based lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchCondition: any = entityId
    ? { author_entity_id: entityId, hidden: { $ne: true } }
    : { author: { $regex: new RegExp(`^${authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, hidden: { $ne: true } };

  return db.collection('books').aggregate([
    { $match: matchCondition },
    {
      $lookup: {
        from: 'pages',
        let: { book_id: '$id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$book_id', '$$book_id'] } } },
          { $project: { _id: 0, page_type: 1, translation: 1 } },
        ],
        as: 'pages_array'
      }
    },
    {
      $addFields: {
        pages_count: { $size: '$pages_array' },
        pages_translated: {
          $size: {
            $filter: {
              input: '$pages_array',
              as: 'page',
              cond: {
                $or: [
                  { $and: [
                    { $ne: ['$$page.translation', null] },
                    { $ne: ['$$page.translation.data', null] },
                    { $gt: [{ $strLenCP: { $ifNull: ['$$page.translation.data', ''] } }, 50] }
                  ]},
                  { $eq: [{ $ifNull: ['$$page.page_type', ''] }, 'blank'] }
                ]
              }
            }
          }
        }
      }
    },
    {
      $addFields: {
        translation_percent: {
          $cond: {
            if: { $gt: [{ $ifNull: ['$pages_ocr', 0] }, 0] },
            then: { $round: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_ocr', 0] }] }, 100] }] },
            else: 0
          }
        }
      }
    },
    { $project: { pages_array: 0, _id: 0 } },
    { $sort: { year: 1, title: 1 } }
  ]).toArray() as unknown as Book[];
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { name } = await params;
  let authorName: string;
  try {
    const decoded = decodeURIComponent(name);
    const isOldFormat = decoded !== name;
    const db = await getDb();
    const resolved = isOldFormat
      ? { authorName: decoded, entity: null, entityId: null }
      : await resolveAuthor(db, name);
    authorName = resolved?.authorName || name.replace(/-/g, ' ');
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

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
  const resolved = await resolveAuthor(db, name);
  if (!resolved) notFound();

  const { authorName, entity, entityId } = resolved;
  const books = await getAuthorBooks(authorName, entityId);
  if (books.length === 0) notFound();

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
