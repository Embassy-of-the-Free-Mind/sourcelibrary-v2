import Link from 'next/link';
import Image from 'next/image';
import { getDb } from '@/lib/mongodb';
import { BookOpen, Paintbrush } from 'lucide-react';
import { sanitizeThumbnail } from '@/lib/collections-utils';
import { authorUrl } from '@/lib/slugify';

const VISUAL_TYPES = ['painting', 'print', 'drawing', 'fresco', 'emblem', 'object', 'map'];

interface CrossRefItem {
  slug: string;
  title: string;
  display_title?: string;
  published?: string;
  resource_type?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  commons_width?: number;
  commons_height?: number;
  pages_translated?: number;
  language?: string;
}

interface Props {
  author: string;
  currentBookId: string;
  /** 'book' = we're on a book page, show artworks. 'artwork' = we're on artwork, show books. */
  context: 'book' | 'artwork';
}

export default async function AuthorCrossReference({ author, currentBookId, context }: Props) {
  const db = await getDb();

  // Escape regex special chars in author name
  const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (context === 'book') {
    // On a book page: find artworks by this author
    const artworks = await db.collection('books')
      .find(
        {
          author: { $regex: `^${escaped}$`, $options: 'i' },
          resource_type: { $in: VISUAL_TYPES },
          id: { $ne: currentBookId },
        },
        {
          projection: {
            slug: 1, title: 1, display_title: 1, published: 1,
            resource_type: 1, thumbnail: 1, thumbnail_blob: 1,
            commons_width: 1, commons_height: 1,
          },
          maxTimeMS: 3000,
        },
      )
      .sort({ published: 1 })
      .limit(12)
      .toArray()
      .catch((): never[] => []);

    if (artworks.length === 0) return null;

    const items = JSON.parse(JSON.stringify(artworks)) as CrossRefItem[];
    const totalCount = await db.collection('books').countDocuments(
      {
        author: { $regex: `^${escaped}$`, $options: 'i' },
        resource_type: { $in: VISUAL_TYPES },
      },
      { maxTimeMS: 3000 },
    ).catch(() => artworks.length);

    return (
      <div className="card p-6 sm:p-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Paintbrush className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
            Artworks by {author}
          </h2>
          {totalCount > 12 && (
            <Link
              href={`/artwork/artist/${author.replace(/\s+/g, '-')}`}
              className="text-sm hover:underline"
              style={{ color: 'var(--accent-rust)' }}
            >
              View all {totalCount} →
            </Link>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {items.map((a) => {
            const isPortrait = (a.commons_width || 1) < (a.commons_height || 1);
            const thumb = sanitizeThumbnail(a.thumbnail_blob || a.thumbnail || '');
            return (
              <Link key={a.slug} href={`/artwork/${a.slug}`} className="group block">
                <div className={`relative overflow-hidden rounded-sm bg-stone-100 ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'}`}>
                  {thumb && (
                    <Image
                      src={thumb}
                      alt={a.display_title || a.title}
                      fill
                      className="object-cover group-hover:scale-[1.03] transition-transform duration-500 ease-out"
                      sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 16vw"
                    />
                  )}
                </div>
                <p className="text-xs mt-1.5 leading-tight line-clamp-2 group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-secondary)' }}>
                  {a.display_title || a.title}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // On an artwork page: find books by this author
  const books = await db.collection('books')
    .find(
      {
        author: { $regex: `^${escaped}$`, $options: 'i' },
        resource_type: { $exists: false },
        hidden: { $ne: true },
        id: { $ne: currentBookId },
      },
      {
        projection: {
          slug: 1, title: 1, display_title: 1, published: 1,
          language: 1, thumbnail: 1, thumbnail_blob: 1,
          pages_translated: 1,
        },
        maxTimeMS: 3000,
      },
    )
    .sort({ published: 1 })
    .limit(8)
    .toArray()
    .catch((): never[] => []);

  // Also try "Surname, Firstname" format if author is "Firstname Surname"
  if (books.length === 0 && !author.includes(',')) {
    const parts = author.split(' ');
    if (parts.length >= 2) {
      const reversed = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
      const reversedEscaped = reversed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const altBooks = await db.collection('books')
        .find(
          {
            author: { $regex: `^${reversedEscaped}$`, $options: 'i' },
            resource_type: { $exists: false },
            hidden: { $ne: true },
            id: { $ne: currentBookId },
          },
          {
            projection: {
              slug: 1, title: 1, display_title: 1, published: 1,
              language: 1, thumbnail: 1, thumbnail_blob: 1,
              pages_translated: 1,
            },
            maxTimeMS: 3000,
          },
        )
        .sort({ published: 1 })
        .limit(8)
        .toArray()
        .catch((): never[] => []);

      if (altBooks.length === 0) return null;
      const items = JSON.parse(JSON.stringify(altBooks)) as CrossRefItem[];
      return <BooksSection items={items} author={author} />;
    }
    return null;
  }

  if (books.length === 0) return null;
  const items = JSON.parse(JSON.stringify(books)) as CrossRefItem[];
  return <BooksSection items={items} author={author} />;
}

function BooksSection({ items, author }: { items: CrossRefItem[]; author: string }) {
  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-display font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
          Books by {author}
        </h2>
        {authorUrl(author) && (
          <Link
            href={authorUrl(author)!}
            className="text-sm hover:underline"
            style={{ color: 'var(--accent-rust)' }}
          >
            View all →
          </Link>
        )}
      </div>
      <div className="space-y-3">
        {items.map((b) => {
          const thumb = sanitizeThumbnail(b.thumbnail_blob || b.thumbnail || '');
          return (
            <Link
              key={b.slug}
              href={`/book/${b.slug}`}
              className="flex items-start gap-4 p-3 -mx-3 rounded-lg hover:bg-stone-50 transition-colors group"
            >
              {thumb ? (
                <div className="relative w-12 h-16 flex-shrink-0 rounded-sm overflow-hidden bg-stone-100">
                  <Image src={thumb} alt="" fill className="object-cover" sizes="48px" />
                </div>
              ) : (
                <div className="w-12 h-16 flex-shrink-0 rounded-sm bg-stone-100 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-stone-300" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
                  {b.display_title || b.title}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {[b.published, b.language].filter(Boolean).join(' · ')}
                  {b.pages_translated ? ` · ${b.pages_translated} pages translated` : ''}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
