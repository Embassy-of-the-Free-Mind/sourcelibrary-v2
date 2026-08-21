'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import BookOverview, { getThumbUrl, type OverviewPage } from './BookOverview';

interface OverviewChapter {
  title: string;
  titleEn?: string;
  pageNumber: number;
  level: number;
}

interface BookOverviewShellProps {
  bookId: string;
  bookSlug?: string;
  bookTitle?: string;
  pages: OverviewPage[];
  chapters: OverviewChapter[];
}

interface Section {
  /** Anchor id — start page number, or 'front' for pages before the first chapter */
  anchor: string;
  /** Chapter headings starting at this page (level 1 before level 2), empty for front matter */
  headings: OverviewChapter[];
  pages: OverviewPage[];
}

// Group pages into sections at chapter start pages. Several headings can share
// a start page (e.g. "Tractatus I" and its "Quaestio I") — they render stacked.
function buildSections(pages: OverviewPage[], chapters: OverviewChapter[]): Section[] {
  const chs = [...chapters].sort((a, b) => a.pageNumber - b.pageNumber || a.level - b.level);
  if (chs.length === 0) return [{ anchor: 'front', headings: [], pages }];

  const starts = [...new Set(chs.map(c => c.pageNumber))];
  const sections: Section[] = [];

  const front = pages.filter(p => p.page_number < starts[0]);
  if (front.length > 0) sections.push({ anchor: 'front', headings: [], pages: front });

  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : Infinity;
    const sectionPages = pages.filter(p => p.page_number >= start && p.page_number < end);
    if (sectionPages.length === 0) return;
    sections.push({
      anchor: String(start),
      headings: chs.filter(c => c.pageNumber === start),
      pages: sectionPages,
    });
  });

  return sections;
}

export default function BookOverviewShell({ bookId, bookSlug, bookTitle, pages, chapters }: BookOverviewShellProps) {
  const [view, setViewState] = useState<'contents' | 'wall'>('contents');
  // Body scroll persists across the swap — a wall opened mid-scroll would show
  // the site footer instead of the canvas.
  const setView = (v: 'contents' | 'wall') => {
    window.scrollTo(0, 0);
    setViewState(v);
  };
  const sections = useMemo(() => buildSections(pages, chapters), [pages, chapters]);
  const bookPath = `/book/${bookSlug || bookId}`;
  const hasChapters = sections.some(s => s.headings.length > 0);

  if (view === 'wall') {
    return (
      <BookOverview
        bookId={bookId}
        bookSlug={bookSlug}
        bookTitle={bookTitle}
        pages={pages}
        onShowContents={() => setView('contents')}
      />
    );
  }

  const jumpTo = (anchor: string) => {
    document.getElementById(`section-${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-white">
      {/* Sticky header: back link, title, chapter jump, view toggle */}
      <header className="sticky top-0 z-30 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href={bookPath}
            className="shrink-0 flex items-center gap-1.5 text-white/60 hover:text-white text-sm transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Back to book</span>
          </Link>

          <h1 className="flex-1 min-w-0 truncate text-sm sm:text-base text-white/80">
            {bookTitle}
            <span className="ml-2 text-white/40 text-xs sm:text-sm">{pages.length} pages</span>
          </h1>

          {hasChapters && (
            <select
              onChange={e => { if (e.target.value) jumpTo(e.target.value); }}
              defaultValue=""
              aria-label="Jump to chapter"
              className="shrink-0 max-w-[40vw] sm:max-w-xs bg-white/5 border border-white/15 rounded-md
                text-sm text-white/80 px-2 py-1.5 focus:outline-none focus:border-white/40"
            >
              <option value="" disabled>Jump to chapter…</option>
              {sections.filter(s => s.headings.length > 0).map(s => {
                const top = s.headings[0];
                return (
                  <option key={s.anchor} value={s.anchor}>
                    {top.level > 1 ? '  ' : ''}{top.titleEn || top.title}
                  </option>
                );
              })}
            </select>
          )}

          <button
            onClick={() => setView('wall')}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full
              border border-white/15 text-white/70 hover:text-white hover:border-white/40
              text-sm transition-colors"
            title="Zoomable wall of all pages"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="1.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="8" y="1.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="1.5" y="8" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="8" y="8" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span className="hidden sm:inline">Wall view</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 pb-16">
        {sections.map(section => (
          <section
            key={section.anchor}
            id={`section-${section.anchor}`}
            className="scroll-mt-16"
            // Off-screen sections skip layout/paint; the estimate keeps the
            // scrollbar stable for long books (up to the 2000-page fetch cap).
            style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.ceil(section.pages.length / 6) * 220 + 80}px` }}
          >
            {section.headings.length > 0 ? (
              <div className="pt-8 pb-4">
                {section.headings.map((h, i) => (
                  <div key={i}>
                    {h.titleEn && h.titleEn !== h.title ? (
                      <>
                        <span className={h.level <= 1 ? 'block text-lg sm:text-xl text-white/90' : 'block text-base text-white/80'}>
                          {h.titleEn}
                        </span>
                        <span className="block text-sm text-white/40 italic">{h.title}</span>
                      </>
                    ) : (
                      <span className={h.level <= 1 ? 'block text-lg sm:text-xl text-white/90' : 'block text-base text-white/80'}>
                        {h.title}
                      </span>
                    )}
                  </div>
                ))}
                <div className="mt-1 text-xs text-white/35 tabular-nums">
                  Pages {section.pages[0].page_number}–{section.pages[section.pages.length - 1].page_number}
                </div>
              </div>
            ) : (
              <div className="pt-8 pb-4">
                {hasChapters && <span className="block text-lg text-white/50">Front matter</span>}
              </div>
            )}

            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
              {section.pages.map(page => {
                const thumb = getThumbUrl(page);
                return (
                  <Link
                    key={page.id}
                    href={`${bookPath}/page/${page.id}`}
                    className="group block"
                  >
                    <div className="relative aspect-[3/4] bg-[#1a1a1a] border border-white/10
                      group-hover:border-white/40 transition-colors overflow-hidden">
                      {thumb && (
                        // eslint-disable-next-line @next/next/no-img-element -- pre-sized R2 thumbs; the optimizer would re-proxy them at cost
                        <img
                          src={thumb}
                          alt={`Page ${page.page_number}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain"
                        />
                      )}
                      {page.has_illustration && (
                        <span
                          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center
                            rounded-full bg-black/70 text-white/80"
                          title="Contains an illustration"
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                            <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
                            <circle cx="4.2" cy="4.2" r="1.1" fill="currentColor" />
                            <path d="M2 9l2.5-2.5L7 9l2-2 1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-center text-[11px] text-white/40 group-hover:text-white/70
                      tabular-nums transition-colors">
                      {page.page_number}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
