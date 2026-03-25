import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Paintbrush } from 'lucide-react';
import { sanitizeThumbnail } from '@/lib/collections-utils';
import { authorUrl } from '@/lib/slugify';

export interface CrossRefItem {
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

export interface AuthorCrossRefData {
  artworks?: CrossRefItem[];
  books?: CrossRefItem[];
  total_artworks?: number;
}

interface Props {
  author: string;
  crossRef?: AuthorCrossRefData;
  /** 'book' = we're on a book page, show artworks. 'artwork' = we're on artwork, show books. */
  context: 'book' | 'artwork';
}

export default function AuthorCrossReference({ author, crossRef, context }: Props) {
  if (!crossRef) return null;

  if (context === 'book') {
    const items = crossRef.artworks;
    if (!items || items.length === 0) return null;
    const totalCount = crossRef.total_artworks ?? items.length;

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

  // On an artwork page: show books by this author
  const items = crossRef.books;
  if (!items || items.length === 0) return null;

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
