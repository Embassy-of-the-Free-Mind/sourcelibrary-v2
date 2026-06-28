import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Check, X } from 'lucide-react';
import { getBookThumbnailUrl } from '@/lib/utils';
import { bookTitle } from '@/lib/collections-utils';
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
  pages_ocr?: number;
  pages_translated?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
}

function pct(n?: number, d?: number): number {
  if (!d || !n || n <= 0) return 0;
  return Math.min(100, Math.round((n / d) * 100));
}

// One status item: tick at 100%, cross at 0%, else the percentage. (Per source library book design.md)
function Status({ label, pctValue, doneClass }: { label: string; pctValue: number; doneClass: string }) {
  if (pctValue >= 100) return <span className={`inline-flex items-center gap-1 ${doneClass}`}><Check className="w-3 h-3" /> {label}</span>;
  if (pctValue <= 0) return <span className="inline-flex items-center gap-1 text-muted"><X className="w-3 h-3" /> {label}</span>;
  return <span className="text-muted">{pctValue}% {label}</span>;
}

/**
 * Book-cover card for the first-translations slider and the works grid (NOT the
 * featured slot). Per source library book design.md: square corners, hairline
 * border, 3:4 cover, dark-glass First Translation tag, language pill · year ·
 * pages, and a single OCR/Translated status line. Existing tokens only.
 */
export default function BookCardMini({ book }: { book: MiniBook }) {
  const thumb = getBookThumbnailUrl(book, 'thumb');
  const ocrPct = pct(book.pages_ocr, book.pages_count);
  const translatedPct = pct(book.pages_translated, book.pages_count);
  return (
    <Link href={tenantBookUrl({ id: book.id, slug: book.slug }, null)} className="group flex flex-col h-full border border-border-light bg-white hover:shadow-md transition-shadow">
      <div className="relative aspect-[3/4] overflow-hidden bg-warm">
        {thumb ? (
          <Image src={thumb} alt={bookTitle(book)} fill className="object-cover group-hover:scale-105 transition-transform duration-300" sizes="(min-width: 1280px) 240px, (min-width: 640px) 30vw, 60vw" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><BookOpen className="w-8 h-8 text-muted" /></div>
        )}
        {book.is_first_translation && (
          <span className="absolute top-2 right-2 text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(20,16,12,0.5)' }}>First Translation</span>
        )}
      </div>
      <div className="flex flex-col flex-1 p-3">
        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug" style={{ fontFamily: 'var(--font-body)' }}>{bookTitle(book)}</h3>
        {book.author && <p className="text-xs text-muted mt-0.5 line-clamp-1">{book.author}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted">
          {book.language && <span className="bg-warm px-1.5 py-0.5 text-secondary">{book.language}</span>}
          {book.year ? <span>{book.year}</span> : null}
          {book.pages_count ? <span>{book.pages_count.toLocaleString('en-US')} pages</span> : null}
        </div>
        <div className="flex items-center gap-3 mt-auto pt-3 text-[11px]">
          <Status label="OCR" pctValue={ocrPct} doneClass="text-status-info" />
          <Status label="Translated" pctValue={translatedPct} doneClass="text-status-success" />
        </div>
      </div>
    </Link>
  );
}
