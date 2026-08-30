'use client';

import { useState } from 'react';
import { useLocalePath } from '@/lib/i18n';
import Link from 'next/link';
import { ChevronDown, List } from 'lucide-react';
import { useEmbedHref } from '@/lib/EmbedContext';

interface Chapter {
  title: string;
  titleEn?: string;
  pageNumber: number;
  level: number;
}

export default function ChaptersDropdown({ chapters, bookSlug }: { chapters: Chapter[]; bookSlug: string }) {
  const [open, setOpen] = useState(false);
  const embedHref = useEmbedHref();
  // Chapter jumps keep the locale of the reader they were opened from.
  const localePath = useLocalePath();

  return (
    <div className="card mt-6 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
      >
        <span className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          <List className="w-4 h-4 opacity-60" />
          Chapters &amp; Sections
        </span>
        <ChevronDown className={`w-5 h-5 opacity-40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-stone-200 dark:border-stone-700">
          <nav className="mt-3 space-y-0.5">
            {chapters.map((ch) => (
              <Link
                key={`${ch.pageNumber}-${ch.title}`}
                href={localePath(embedHref(`/book/${bookSlug}/page-number/${ch.pageNumber}`))}
                className="flex items-baseline gap-2 py-1.5 px-2 -mx-2 rounded hover:bg-stone-100 dark:hover:bg-stone-800/50 transition-colors group"
                style={{ paddingLeft: `${(ch.level - 1) * 1.25 + 0.5}rem` }}
              >
                <span className="text-sm text-secondary flex-1" style={{ color: 'var(--text-primary)' }}>
                  {ch.titleEn || ch.title}
                </span>
                <span className="text-xs text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                  p.{ch.pageNumber}
                </span>
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
