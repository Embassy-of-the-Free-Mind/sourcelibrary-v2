import Link from 'next/link';
import Image from 'next/image';
import { BookOpen } from 'lucide-react';
import { getBookThumbnailUrl } from '@/lib/utils';
import { bookTitle } from '@/lib/collections-utils';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import { tenantBookUrl } from '@/lib/slugify';

export interface MiniBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_translated?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
}

/**
 * Presentational book card shared by the first-translations slider and the
 * works grid. Cover with a status badge (First translation / Source text) and a
 * language tag, then serif title + author·year. Existing tokens only.
 */
export default function BookCardMini({ book, kind }: { book: MiniBook; kind: 'first' | 'source' }) {
  const thumb = getBookThumbnailUrl(book);
  return (
    <Link href={tenantBookUrl({ id: book.id, slug: book.slug }, null)} className="group block">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-white border border-border-light shadow-sm group-hover:shadow-md transition-shadow">
        {thumb ? (
          <Image src={thumb} alt={bookTitle(book)} fill className="object-cover group-hover:scale-105 transition-transform duration-300" sizes="(min-width: 1280px) 260px, (min-width: 640px) 30vw, 60vw" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-8 h-8 text-muted" /></div>
        )}
        <span className={`absolute top-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded ${kind === 'first' ? 'bg-warm/95 text-accent-rust' : 'bg-warm/95 text-muted'}`}>
          {kind === 'first' ? firstTranslationBadge(book.ft_disposition, book.language) : 'Source text'}
        </span>
        {book.language && (
          <span className="absolute bottom-2 right-2 text-[9px] uppercase tracking-wide text-white/90 bg-dark/55 px-1.5 py-0.5 rounded">{book.language}</span>
        )}
      </div>
      <h3 className="mt-2 text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug" style={{ fontFamily: 'var(--font-serif)' }}>{bookTitle(book)}</h3>
      {book.author && <p className="text-xs text-muted mt-0.5 line-clamp-1">{book.author}{book.year ? `, ${book.year}` : ''}</p>}
    </Link>
  );
}
