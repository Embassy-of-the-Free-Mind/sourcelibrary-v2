'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from '@/components/layout/Logo';
import LikeButton from '@/components/ui/LikeButton';
import ShareButton from '@/components/ui/ShareButton';
import { useBrowserTranslation } from '@/hooks/useBrowserTranslation';
import type { Book, Page } from '@/lib/types';
import {
  ChevronLeft, ChevronRight, ChevronDown, List, Pencil,
} from 'lucide-react';
import { useReaderV2, type ReaderSettings } from './useReaderV2';
import ReaderSettingsControls from './ReaderSettingsControls';
import {
  CapsLabel, AiChip, ReaderProse, PageBreakMarker, ScanImage, resolveScanUrls,
  PaneMenu, buildTextMenuItems, ViewToggleGroup, onInk, SURFACE, themeAttr, bookByline,
} from './ReaderV2Bits';

// ─── Variant 2a: "Quiet Desk" ────────────────────────────────────────────────
// Immersive, low-chrome reading. One reading surface, one toolbar, exactly one
// scroll container (the page body). The scan pane is sticky; the text column
// is a continuous feed where the next page begins under a centred PAGE N rule.
// Design handoff: design_handoff_reader_page/README.md § 2a.

const INK = 'var(--bg-dark)';
const BAR_H = 64;

interface Reader2AProps {
  initialBook: Book;
  initialPage: Page;
  initialPageList: Page[];
}

type MobileView = 'scan' | 'ocr' | 'en' | 'both';

// One page of the continuous text column. Fetches its own data through the
// shared cache; reports its page id while it straddles the viewport centre.
function FeedPage({
  pageId, book, views, settings, isFirst, fetchPage, seedPage, onActive,
}: {
  pageId: string;
  book: Book;
  views: { scan: boolean; ocr: boolean; en: boolean };
  settings: ReaderSettings;
  isFirst: boolean;
  fetchPage: (id: string) => Promise<Page | null>;
  seedPage: Page | null;
  onActive: (id: string) => void;
}) {
  const [page, setPage] = useState<Page | null>(seedPage);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (page && page.id === pageId) return;
    let cancelled = false;
    fetchPage(pageId).then(p => { if (!cancelled && p) setPage(p); });
    return () => { cancelled = true; };
  }, [pageId, page, fetchPage]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onActive(pageId);
        }
      },
      // A thin band around the viewport's vertical centre
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageId, onActive]);

  const pageNum = page?.page_number;

  return (
    <article ref={ref} data-feed-page={pageId}>
      {!isFirst && pageNum != null && <PageBreakMarker label={`Page ${pageNum}`} />}
      <div className="flex items-start">
        {views.ocr && (
          <section
            className="flex-1 min-w-0 border-r"
            style={{ background: SURFACE.ocr, borderColor: 'var(--border-light)' }}
          >
            <div className="max-w-[560px] mx-auto px-9 pt-6 pb-14">
              {isFirst && (
                <div className="flex items-center justify-between mb-6">
                  <CapsLabel style={{ color: 'var(--text-muted)' }}>
                    {book.language || 'Original'} · OCR
                  </CapsLabel>
                </div>
              )}
              {page ? (
                <ReaderProse page={page} book={book} kind="ocr" settings={settings} baseSize={18} />
              ) : (
                <div className="h-64 animate-pulse" style={{ background: 'var(--border-light)' }} />
              )}
            </div>
          </section>
        )}
        {views.en && (
          <section className="flex-1 min-w-0" style={{ background: SURFACE.translation }}>
            <div className="max-w-[640px] mx-auto px-10 pt-6 pb-14">
              {isFirst && (
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2.5">
                    <CapsLabel style={{ color: 'var(--text-muted)' }}>English</CapsLabel>
                    <AiChip />
                  </div>
                </div>
              )}
              {page ? (
                <>
                  <ReaderProse page={page} book={book} kind="translation" settings={settings} baseSize={20.5} />
                  <PageFooterActions book={book} page={page} />
                </>
              ) : (
                <div className="h-64 animate-pulse" style={{ background: 'var(--border-light)' }} />
              )}
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

function PageFooterActions({ book, page }: { book: Book; page: Page }) {
  return (
    <div
      className="flex items-center justify-between mt-10 pt-3 border-t font-sans text-[13px]"
      style={{ borderColor: 'var(--border-light)', color: 'var(--text-faint)' }}
    >
      <LikeButton key={page.id} targetType="page" targetId={page.id} bookId={book.id} size="sm" showCount label="Like this page" />
      <a
        href={`/book/${book.slug || book.id}/page/${page.id}`}
        className="hover:text-[var(--accent-rust)] no-underline"
        title="Opens the current reader, where corrections can be submitted"
      >
        Notice a translation issue?
      </a>
    </div>
  );
}

export default function Reader2A({ initialBook, initialPage, initialPageList }: Reader2AProps) {
  const r = useReaderV2('2a', initialBook, initialPage, initialPageList, { scan: true, ocr: false, en: true });
  const browserTranslated = useBrowserTranslation();

  // Continuous feed: pages render from `anchor` and extend as the reader
  // scrolls; jumping resets the anchor. Scroll-driven page sync uses
  // replaceState via the hook.
  const [anchor, setAnchor] = useState(Math.max(0, r.currentIndex));
  const [extent, setExtent] = useState(2); // pages rendered past the anchor
  const fromScrollRef = useRef(false);

  const onFeedActive = useCallback((pageId: string) => {
    fromScrollRef.current = true;
    r.syncCurrentPage(pageId);
    // release the flag after the state flush
    setTimeout(() => { fromScrollRef.current = false; }, 50);
  }, [r]);

  // Navigation (stepper / arrows / chapter): if the target page is outside the
  // rendered feed, re-anchor; if inside, scroll its article into view.
  useEffect(() => {
    if (fromScrollRef.current) return;
    const idx = r.currentIndex;
    if (idx < 0) return;
    if (idx < anchor || idx > anchor + extent) {
      setAnchor(idx);
      setExtent(2);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } else {
      const el = document.querySelector(`[data-feed-page="${r.currentPageId}"]`);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - BAR_H - 4;
        window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.currentPageId]);

  // Extend the feed as the bottom sentinel approaches
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setExtent(prev => Math.min(prev + 2, r.totalPages - 1 - anchor));
      }
    }, { rootMargin: '1200px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor, r.totalPages]);

  // Jump-to-page input in the stepper
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (jumpOpen) jumpRef.current?.focus(); }, [jumpOpen]);

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('en');
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/book/${r.bookPath}/page/${r.currentPageId}`
    : `https://sourcelibrary.org/book/${r.bookPath}/page/${r.currentPageId}`;

  const scan = resolveScanUrls(r.currentPage);
  const pageNum = r.currentPage?.page_number ?? '—';
  const lastNum = r.pageList.length ? r.pageList[r.pageList.length - 1].page_number : r.totalPages;
  const chromeHidden = r.focusMode;
  const feedIndices: number[] = [];
  for (let i = anchor; i <= Math.min(anchor + extent, r.totalPages - 1); i++) feedIndices.push(i);

  const submitJump = () => {
    const n = parseInt(jumpValue, 10);
    if (!Number.isNaN(n)) r.goToPageNumber(n);
    setJumpOpen(false);
    setJumpValue('');
  };

  const editHref = `/book/${r.bookPath}/page/${r.currentPageId}`;

  return (
    <div data-reader-theme={themeAttr(r.settings.theme)} style={{ background: SURFACE.translation }}>
      {/* ── Desktop (lg+) ────────────────────────────────────────────────── */}
      <div className="hidden lg:block">
        {/* Top bar + progress, sticky; fades out in focus mode */}
        <header
          className={`sticky top-0 z-40 transition-opacity duration-300 ${chromeHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div className="h-[2px] w-full" style={{ background: 'rgba(43,38,32,0.1)' }}>
            <div className="h-full" style={{ background: 'var(--accent-rust)', width: `${r.progress * 100}%` }} />
          </div>
          <div
            className="flex items-center gap-[18px] pl-5 pr-[18px] border-b"
            style={{ height: BAR_H, background: INK, borderColor: onInk(0.12), color: '#fdfcf9' }}
          >
            <Logo white mini />
            <span style={{ color: onInk(0.28) }}>/</span>
            <div className="min-w-0 max-w-[300px]">
              <div className="font-body text-[16.5px] leading-[1.2] truncate">{r.book.display_title || r.book.title}</div>
              <div className="font-sans text-[11.5px] truncate" style={{ color: onInk(0.5) }}>{bookByline(r.book)}</div>
            </div>
            <div className="flex-1" />
            <CapsLabel style={{ color: onInk(0.4) }}>View</CapsLabel>
            <ViewToggleGroup views={r.views} onToggle={r.toggleView} />
            <span className="w-px h-[26px]" style={{ background: onInk(0.16) }} />
            {r.chapters.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setChaptersOpen(v => !v)}
                  className="flex items-center gap-2 px-3 py-[7px] font-sans text-[13px] border max-w-[260px]"
                  style={{ background: onInk(0.06), borderColor: onInk(0.14), color: onInk(0.9) }}
                >
                  <List size={14} />
                  <span className="truncate">
                    {r.currentChapter ? (r.currentChapter.titleEn || r.currentChapter.title) : 'Contents'}
                  </span>
                  <ChevronDown size={13} style={{ color: onInk(0.5) }} />
                </button>
                {chaptersOpen && (
                  <ChapterMenu
                    chapters={r.chapters}
                    current={r.currentChapter}
                    onSelect={(pid) => { setChaptersOpen(false); if (pid) r.goToPage(pid); }}
                    onClose={() => setChaptersOpen(false)}
                  />
                )}
              </div>
            )}
            {/* Page stepper */}
            <div className="flex items-stretch border" style={{ borderColor: onInk(0.16) }}>
              <button type="button" aria-label="Previous page" onClick={r.goPrev}
                className="w-8 h-[34px] flex items-center justify-center hover:bg-[rgba(253,252,249,0.1)]"
                style={{ color: onInk(0.72) }}>
                <ChevronLeft size={16} />
              </button>
              {jumpOpen ? (
                <input
                  ref={jumpRef}
                  value={jumpValue}
                  onChange={e => setJumpValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitJump(); if (e.key === 'Escape') setJumpOpen(false); }}
                  onBlur={() => setJumpOpen(false)}
                  placeholder={String(pageNum)}
                  className="w-16 text-center font-sans text-[13px] bg-transparent outline-none"
                  style={{ color: '#fdfcf9' }}
                  inputMode="numeric"
                  aria-label="Jump to page"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setJumpOpen(true)}
                  className="px-2.5 font-sans text-[13px] tabular-nums hover:bg-[rgba(253,252,249,0.06)]"
                  title="Jump to page"
                >
                  {pageNum}<span style={{ color: onInk(0.45) }}>/{lastNum}</span>
                </button>
              )}
              <button type="button" aria-label="Next page" onClick={r.goNext}
                className="w-8 h-[34px] flex items-center justify-center hover:bg-[rgba(253,252,249,0.1)]"
                style={{ color: onInk(0.72) }}>
                <ChevronRight size={16} />
              </button>
            </div>
            <span className="w-px h-[26px]" style={{ background: onInk(0.16) }} />
            <button
              type="button"
              onClick={() => r.setSettingsOpen(!r.settingsOpen)}
              className="flex items-center gap-1.5 px-2 h-[34px] font-sans text-[13px] hover:bg-[rgba(253,252,249,0.1)]"
              style={{ color: onInk(0.85) }}
              aria-expanded={r.settingsOpen}
            >
              <span className="font-body"><span className="text-[11px]">A</span><span className="text-[15px]">A</span></span>
              Reading settings
            </button>
            <LikeButton key={r.currentPageId} targetType="page" targetId={r.currentPageId} bookId={r.book.id} size="sm" showCount />
            <ShareButton
              title={r.book.display_title || r.book.title}
              author={r.book.author}
              year={r.book.published}
              page={r.currentPage?.page_number}
              url={shareUrl}
              variant="icon"
            />
            <PaneMenu
              onInkBar
              items={[
                ...buildTextMenuItems(r.currentPage, r.book, 'translation', editHref),
                ...buildTextMenuItems(r.currentPage, r.book, 'ocr', editHref).filter(i => i.label.startsWith('Copy')),
              ]}
            />
            <a
              href={editHref}
              className="ml-2 flex items-center gap-2 px-3 py-[7px] font-sans text-[13px] border no-underline"
              style={{ background: onInk(0.06), borderColor: onInk(0.14), color: onInk(0.9) }}
              title="Editing opens in the current reader"
            >
              <Pencil size={13} /> Edit
            </a>
          </div>
        </header>

        {/* Settings popover */}
        {r.settingsOpen && (
          <div
            className="fixed z-50 w-[300px] border p-[18px] pb-3.5"
            style={{
              top: 70, right: 128, background: SURFACE.popover,
              borderColor: 'var(--border-medium)', boxShadow: '0 28px 60px -18px rgba(30,20,8,0.45)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <CapsLabel style={{ color: 'var(--accent-rust)', letterSpacing: '0.14em' }}>Reading settings</CapsLabel>
              <button type="button" aria-label="Close settings" onClick={() => r.setSettingsOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] font-sans text-[15px] leading-none">×</button>
            </div>
            <ReaderSettingsControls settings={r.settings} onChange={r.updateSettings} />
            <button
              type="button"
              onClick={() => { r.setSettingsOpen(false); r.setFocusMode(true); }}
              className="w-full flex items-center justify-between min-h-[38px] border-t font-sans text-[12px]"
              style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}
            >
              Focus mode
              <kbd className="px-1.5 py-0.5 border font-sans text-[11px]"
                style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}>F</kbd>
            </button>
          </div>
        )}

        {/* Body: sticky scan + continuous text feed — ONE scroller (the page) */}
        <div
          key={browserTranslated ? `translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="flex items-start"
        >
          {r.views.scan && (
            <aside
              className="sticky shrink-0 flex flex-col border-r"
              style={{
                top: chromeHidden ? 0 : BAR_H + 2,
                height: `calc(100vh - ${chromeHidden ? 0 : BAR_H + 2}px)`,
                width: 'min(540px, 42vw)',
                background: SURFACE.scanBed,
                borderColor: 'var(--border-medium)',
              }}
            >
              <div className="relative flex-1 min-h-0 flex items-center justify-center px-10 pt-[30px] pb-3">
                <ScanImage page={r.currentPage} book={r.book} className="h-full max-w-full" fit="height" />
                <button type="button" aria-label="Previous page" onClick={r.goPrev}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[38px] h-24 flex items-center justify-center transition-colors"
                  style={{ background: 'rgba(43,38,32,0.07)', color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(43,38,32,0.16)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(43,38,32,0.07)'; }}>
                  <ChevronLeft size={20} />
                </button>
                <button type="button" aria-label="Next page" onClick={r.goNext}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-[38px] h-24 flex items-center justify-center transition-colors"
                  style={{ background: 'rgba(43,38,32,0.07)', color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(43,38,32,0.16)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(43,38,32,0.07)'; }}>
                  <ChevronRight size={20} />
                </button>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>Original scan · p. {pageNum}</CapsLabel>
                <span className="flex gap-4 font-sans text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                  {scan.native && (
                    <a href={scan.native} target="_blank" rel="noreferrer" className="no-underline hover:text-[var(--text-primary)]">Full res</a>
                  )}
                  {scan.native && (
                    <a href={scan.native} download={`${r.bookPath}-page-${pageNum}.jpg`} className="no-underline hover:text-[var(--text-primary)]">Download</a>
                  )}
                </span>
              </div>
            </aside>
          )}

          <main className="flex-1 min-w-0">
            {feedIndices.map((i) => (
              <FeedPage
                key={r.pageList[i].id}
                pageId={r.pageList[i].id}
                book={r.book}
                views={r.views}
                settings={r.settings}
                isFirst={i === anchor}
                fetchPage={r.fetchPage}
                seedPage={r.pageList[i].id === initialPage.id ? initialPage : null}
                onActive={onFeedActive}
              />
            ))}
            <div ref={sentinelRef} className="h-px" />
            <div className="h-24" />
          </main>
        </div>
      </div>

      {/* ── Mobile / tablet (<lg) ────────────────────────────────────────── */}
      <div className="lg:hidden flex flex-col min-h-[100dvh]">
        <header className={`sticky top-0 z-40 transition-opacity ${chromeHidden ? 'opacity-0 pointer-events-none' : ''}`} style={{ background: INK, color: '#fdfcf9' }}>
          <div className="flex items-center h-[52px] px-2.5">
            <a href={`/book/${r.bookPath}`} aria-label="Back to the book" className="w-11 h-11 -ml-1 flex items-center justify-center no-underline" style={{ color: onInk(0.85) }}>
              <ChevronLeft size={20} />
            </a>
            <div className="flex-1 min-w-0 text-center">
              <div className="font-body text-[15px] truncate">{r.book.display_title || r.book.title}</div>
              <div className="font-sans text-[10.5px]" style={{ color: onInk(0.5) }}>
                Page {pageNum} of {lastNum}
              </div>
            </div>
            <button type="button" aria-label="Reading settings" onClick={() => setMobileSettingsOpen(v => !v)}
              className="w-11 h-11 flex items-center justify-center font-body" style={{ color: onInk(0.85) }}>
              <span><span className="text-[12px]">A</span><span className="text-[17px]">A</span></span>
            </button>
          </div>
          <div className="flex gap-1.5 px-3 pb-3 border-b" style={{ borderColor: onInk(0.12) }}>
            {(['scan', 'ocr', 'en', 'both'] as MobileView[]).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setMobileView(v)}
                aria-pressed={mobileView === v}
                className="flex-1 h-11 font-sans text-[13px] border"
                style={{
                  borderColor: mobileView === v ? onInk(0.3) : onInk(0.16),
                  background: mobileView === v ? onInk(0.14) : 'transparent',
                  color: mobileView === v ? '#fdfcf9' : onInk(0.5),
                }}
              >
                {v === 'scan' ? 'Scan' : v === 'ocr' ? 'OCR' : v === 'en' ? 'English' : 'Both'}
              </button>
            ))}
          </div>
        </header>

        <main
          key={browserTranslated ? `m-translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="flex-1"
        >
          {(mobileView === 'scan' || mobileView === 'both') && (
            <div className="px-[9px] py-4 flex justify-center" style={{ background: SURFACE.scanBed }}>
              <ScanImage
                page={r.currentPage}
                book={r.book}
                className={mobileView === 'both' ? 'w-[62%]' : 'w-full'}
              />
            </div>
          )}
          {mobileView === 'ocr' && (
            <div className="px-[22px] py-[26px]" style={{ background: SURFACE.ocr }}>
              <div className="flex items-center gap-2.5 mb-5">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>{r.book.language || 'Original'} · OCR</CapsLabel>
              </div>
              <ReaderProse page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={17.5} />
            </div>
          )}
          {(mobileView === 'en' || mobileView === 'both') && (
            <div className="px-[22px] pt-[26px] pb-10" style={{ background: SURFACE.translation }}>
              <div className="flex items-center gap-2.5 mb-5">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>English</CapsLabel>
                <AiChip short />
              </div>
              <ReaderProse page={r.currentPage} book={r.book} kind="translation" settings={r.settings} baseSize={19.5} />
            </div>
          )}
        </main>

        {/* Mobile settings sheet */}
        {mobileSettingsOpen && (
          <div
            className="fixed left-0 right-0 z-50 border-t p-4 pb-6"
            style={{
              bottom: 68, background: SURFACE.panel, borderColor: 'var(--border-medium)',
              boxShadow: '0 -24px 48px -28px rgba(30,20,8,0.5)',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <CapsLabel style={{ color: 'var(--accent-rust)' }}>Reading settings</CapsLabel>
              <button type="button" aria-label="Close settings" onClick={() => setMobileSettingsOpen(false)}
                className="w-11 h-11 -mr-2 flex items-center justify-center text-[var(--text-muted)]">×</button>
            </div>
            <ReaderSettingsControls settings={r.settings} onChange={r.updateSettings} compact />
          </div>
        )}

        {/* Bottom bar */}
        <nav
          className="sticky bottom-0 z-40 flex items-center justify-between px-3 h-[68px]"
          style={{ background: INK, color: '#fdfcf9' }}
          aria-label="Page navigation"
        >
          <button type="button" onClick={r.goPrev} disabled={r.currentIndex <= 0}
            className="h-11 px-3 font-sans text-[13px] disabled:opacity-30" style={{ color: onInk(0.85) }}>
            ← Page {r.currentIndex > 0 ? r.pageList[r.currentIndex - 1].page_number : '—'}
          </button>
          {jumpOpen ? (
            <input
              ref={jumpRef}
              value={jumpValue}
              onChange={e => setJumpValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitJump(); if (e.key === 'Escape') setJumpOpen(false); }}
              onBlur={() => setJumpOpen(false)}
              placeholder={String(pageNum)}
              className="w-20 h-11 text-center font-sans text-[14px] bg-transparent border outline-none"
              style={{ color: '#fdfcf9', borderColor: onInk(0.3) }}
              inputMode="numeric"
              aria-label="Jump to page"
            />
          ) : (
            <button type="button" onClick={() => setJumpOpen(true)}
              className="h-11 px-4 font-sans text-[14px] tabular-nums"
              style={{ background: onInk(0.1) }} title="Jump to page">
              {pageNum} / {lastNum}
            </button>
          )}
          <button type="button" onClick={r.goNext} disabled={r.currentIndex >= r.totalPages - 1}
            className="h-11 px-3 font-sans text-[13px] disabled:opacity-30" style={{ color: onInk(0.85) }}>
            Page {r.currentIndex < r.totalPages - 1 ? r.pageList[r.currentIndex + 1].page_number : '—'} →
          </button>
        </nav>
      </div>
    </div>
  );
}

function ChapterMenu({
  chapters, current, onSelect, onClose,
}: {
  chapters: Array<{ title: string; titleEn?: string; pageId?: string; pageNumber?: number; level?: number }>;
  current: { title: string } | null;
  onSelect: (pageId?: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1.5 w-[340px] max-h-[60vh] overflow-y-auto border z-50"
      style={{
        background: SURFACE.popover, borderColor: 'var(--border-medium)',
        boxShadow: '0 28px 60px -18px rgba(30,20,8,0.45)', overscrollBehavior: 'contain',
      }}
      role="menu"
    >
      <div className="px-4 pt-3 pb-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <CapsLabel style={{ color: 'var(--accent-rust)' }}>Contents</CapsLabel>
      </div>
      {chapters.map((ch, i) => {
        const isCurrent = current?.title === ch.title;
        return (
          <button
            key={`${ch.pageId || i}`}
            type="button"
            role="menuitem"
            onClick={() => onSelect(ch.pageId)}
            className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-warm)] border-b"
            style={{
              borderColor: 'var(--border-light)',
              paddingLeft: 16 + ((ch.level || 1) - 1) * 14,
              background: isCurrent ? 'var(--bg-warm)' : undefined,
            }}
          >
            <span className="block font-body text-[14.5px]" style={{ color: isCurrent ? 'var(--accent-rust)' : 'var(--text-primary)' }}>
              {ch.titleEn || ch.title}
            </span>
            {ch.titleEn && ch.title !== ch.titleEn && (
              <span className="block font-sans text-[11.5px] truncate" style={{ color: 'var(--text-muted)' }}>{ch.title}</span>
            )}
            {ch.pageNumber != null && (
              <span className="block font-sans text-[11px]" style={{ color: 'var(--text-faint)' }}>p. {ch.pageNumber}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
