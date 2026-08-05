'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/layout/Logo';
import { useBrowserTranslation } from '@/hooks/useBrowserTranslation';
import { getPageThumbUrl } from '@/lib/utils';
import type { Book, Page } from '@/lib/types';
import {
  ChevronLeft, ChevronRight, ChevronDown, List, Search, StickyNote, Quote,
  Pencil, Check, X,
} from 'lucide-react';
import { useReaderV2 } from './useReaderV2';
import ReaderSettingsControls from './ReaderSettingsControls';
import {
  CapsLabel, AiChip, ReaderProse, ScanImage, resolveScanUrls,
  ViewToggleGroup, onInk, SURFACE, themeAttr, bookByline,
} from './ReaderV2Bits';

// ─── Variant 2c: "Study Desk" ────────────────────────────────────────────────
// The scholarly view: scan, OCR and translation side by side, a left tool
// rail, and a filmstrip as the single page control. The page itself never
// scrolls — each text pane scrolls, scroll-synced, with overscroll containment.
// Design handoff: design_handoff_reader_page/README.md § 2c.

const INK = 'var(--bg-dark)';

interface Reader2CProps {
  initialBook: Book;
  initialPage: Page;
  initialPageList: Page[];
}

function RailButton({
  label, icon, onClick, href, active = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
}) {
  const inner = (
    <>
      {icon}
      <span className="font-sans text-[8.5px] tracking-[0.06em]">{label}</span>
    </>
  );
  const cls = 'w-12 h-[46px] flex flex-col items-center justify-center gap-1 transition-colors no-underline';
  const style: React.CSSProperties = {
    color: active ? '#fdfcf9' : onInk(0.62),
    background: active ? onInk(0.12) : 'transparent',
  };
  if (href) {
    return <a href={href} className={cls} style={style} title={label}>{inner}</a>;
  }
  return (
    <button type="button" className={cls} style={style} title={label} onClick={onClick}>
      {inner}
    </button>
  );
}

function PaneHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      className="h-[38px] shrink-0 flex items-center justify-between px-4 border-b"
      style={{ borderColor: 'var(--border-medium)' }}
    >
      <div className="flex items-center gap-2">{children}</div>
      {right}
    </div>
  );
}

export default function Reader2C({ initialBook, initialPage, initialPageList }: Reader2CProps) {
  const r = useReaderV2('2c', initialBook, initialPage, initialPageList, { scan: true, ocr: true, en: true });
  const browserTranslated = useBrowserTranslation();

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [citeOpen, setCiteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

  // Scroll-sync the two text panes (proportional), without feedback loops.
  const ocrRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLDivElement>(null);
  const syncLock = useRef<'ocr' | 'en' | null>(null);
  const syncFrom = useCallback((from: 'ocr' | 'en') => {
    const src = from === 'ocr' ? ocrRef.current : enRef.current;
    const dst = from === 'ocr' ? enRef.current : ocrRef.current;
    if (!src || !dst) return;
    if (syncLock.current && syncLock.current !== from) return;
    syncLock.current = from;
    const srcMax = src.scrollHeight - src.clientHeight;
    const dstMax = dst.scrollHeight - dst.clientHeight;
    if (srcMax > 0 && dstMax > 0) {
      dst.scrollTop = (src.scrollTop / srcMax) * dstMax;
    }
    window.setTimeout(() => { syncLock.current = null; }, 80);
  }, []);

  // Reset pane scroll on page change
  useEffect(() => {
    ocrRef.current?.scrollTo({ top: 0 });
    enRef.current?.scrollTo({ top: 0 });
  }, [r.currentPageId]);

  // Filmstrip: keep the current page centred
  const stripRef = useRef<HTMLDivElement>(null);
  const stripMobileRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const container of [stripRef.current, stripMobileRef.current]) {
      if (!container) continue;
      const el = container.querySelector<HTMLElement>(`[data-strip-page="${r.currentPageId}"]`);
      if (el) {
        const target = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
        container.scrollTo({ left: target, behavior: 'smooth' });
      }
    }
  }, [r.currentPageId]);

  const citation = (() => {
    const title = r.book.display_title || r.book.title;
    const author = r.book.author ? `${r.book.author}. ` : '';
    const year = r.book.published ? ` (${r.book.published})` : '';
    const pn = r.currentPage?.page_number;
    return `${author}${title}${year}, p. ${pn}. Source Library. https://sourcelibrary.org/book/${r.bookPath}/page/${r.currentPageId}`;
  })();

  const copyCitation = useCallback(() => {
    navigator.clipboard?.writeText(citation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [citation]);

  const chromeHidden = r.focusMode;
  const pageNum = r.currentPage?.page_number ?? '—';
  const scan = resolveScanUrls(r.currentPage);
  const editHref = `/book/${r.bookPath}/page/${r.currentPageId}`;
  const searchHref = `/book/${r.bookPath}/search`;

  const filmstrip = (compact: boolean, ref: React.RefObject<HTMLDivElement | null>) => (
    <div
      className="flex items-center gap-1 h-full"
      style={{ background: INK, borderTop: `1px solid ${onInk(0.12)}` }}
    >
      <button type="button" aria-label="Previous page" onClick={r.goPrev}
        className="shrink-0 flex items-center justify-center mx-1.5"
        style={{ width: compact ? 34 : 30, height: compact ? 52 : 54, background: onInk(0.08), color: onInk(0.8) }}>
        <ChevronLeft size={15} />
      </button>
      <div
        ref={ref}
        className="flex-1 h-full flex items-center gap-2 overflow-x-auto px-1"
        style={{ overscrollBehavior: 'contain', scrollbarWidth: 'none' }}
      >
        {r.pageList.map((p) => {
          const isCurrent = p.id === r.currentPageId;
          const thumb = getPageThumbUrl(p as unknown as Record<string, unknown>);
          return (
            <button
              key={p.id}
              type="button"
              data-strip-page={p.id}
              onClick={() => r.goToPage(p.id)}
              className="shrink-0 flex flex-col items-center gap-1"
              title={`Page ${p.page_number}`}
              aria-current={isCurrent ? 'page' : undefined}
            >
              <span
                className="block overflow-hidden"
                style={{
                  width: compact ? 38 : 42,
                  height: compact ? 50 : 54,
                  background: isCurrent ? 'var(--bg-warm)' : 'rgba(245,240,232,0.42)',
                  outline: isCurrent ? '2px solid var(--accent-rust)' : 'none',
                  outlineOffset: 1,
                }}
              >
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" loading="lazy" decoding="async"
                    className="w-full h-full object-cover" draggable={false}
                    style={{ opacity: isCurrent ? 1 : 0.75 }} />
                )}
              </span>
              <span className="font-sans text-[9.5px] tabular-nums"
                style={{ color: isCurrent ? '#fdfcf9' : onInk(0.42) }}>
                {p.page_number}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next page" onClick={r.goNext}
        className="shrink-0 flex items-center justify-center mx-1.5"
        style={{ width: compact ? 34 : 30, height: compact ? 52 : 54, background: onInk(0.08), color: onInk(0.8) }}>
        <ChevronRight size={15} />
      </button>
    </div>
  );

  return (
    <div data-reader-theme={themeAttr(r.settings.theme)}>
      {/* ── Desktop (lg+): fixed frame, panes scroll ─────────────────────── */}
      <div
        className="hidden lg:grid h-[100dvh]"
        style={{ gridTemplateColumns: '66px 1fr', gridTemplateRows: '58px 1fr 92px' }}
      >
        {/* Tool rail (full height) */}
        <nav
          className={`row-span-3 flex flex-col items-center pt-3 pb-3 gap-1 transition-opacity ${chromeHidden ? 'opacity-0 pointer-events-none' : ''}`}
          style={{ background: INK, borderRight: `1px solid ${onInk(0.12)}` }}
          aria-label="Reader tools"
        >
          <Link href="/" className="mb-3.5 no-underline" title="Source Library" style={{ color: '#fdfcf9' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
          </Link>
          <RailButton label="Contents" active={contentsOpen} onClick={() => setContentsOpen(v => !v)} icon={<List size={17} />} />
          <RailButton label="Search" href={searchHref} icon={<Search size={17} />} />
          <RailButton label="Notes" onClick={() => { /* annotations panel — future */ }} icon={<StickyNote size={17} />} />
          <RailButton label="Cite" active={citeOpen} onClick={() => setCiteOpen(v => !v)} icon={<Quote size={17} />} />
          <div className="flex-1" />
          <RailButton
            label="Settings"
            active={r.settingsOpen}
            onClick={() => r.setSettingsOpen(!r.settingsOpen)}
            icon={<span className="font-body leading-none"><span className="text-[11px]">A</span><span className="text-[15px]">A</span></span>}
          />
        </nav>

        {/* Top bar */}
        <header
          className={`flex items-center gap-4 px-4 transition-opacity ${chromeHidden ? 'opacity-0 pointer-events-none' : ''}`}
          style={{ background: INK, color: '#fdfcf9', borderBottom: `1px solid ${onInk(0.12)}` }}
        >
          <Logo white mini />
          <span style={{ color: onInk(0.28) }}>/</span>
          <div className="min-w-0 max-w-[320px]">
            <div className="font-body text-[15.5px] leading-[1.2] truncate">{r.book.display_title || r.book.title}</div>
            <div className="font-sans text-[11px] truncate" style={{ color: onInk(0.5) }}>{bookByline(r.book)}</div>
          </div>
          <div className="flex-1" />
          <ViewToggleGroup views={r.views} onToggle={r.toggleView} compact />
          {r.chapters.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setChaptersOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-[7px] font-sans text-[13px] border max-w-[260px]"
                style={{ background: onInk(0.06), borderColor: onInk(0.14), color: onInk(0.9) }}
              >
                <span className="truncate">
                  {r.currentChapter ? (r.currentChapter.titleEn || r.currentChapter.title) : 'Contents'}
                </span>
                <ChevronDown size={13} style={{ color: onInk(0.5) }} />
              </button>
              {chaptersOpen && (
                <div
                  className="absolute top-full right-0 mt-1.5 w-[340px] max-h-[56vh] overflow-y-auto border z-50"
                  style={{ background: SURFACE.popover, borderColor: 'var(--border-medium)', boxShadow: '0 28px 60px -18px rgba(30,20,8,0.45)', overscrollBehavior: 'contain' }}
                >
                  <ChapterList
                    chapters={r.chapters}
                    currentTitle={r.currentChapter?.title}
                    onSelect={(pid) => { setChaptersOpen(false); if (pid) r.goToPage(pid); }}
                  />
                </div>
              )}
            </div>
          )}
          <a
            href={editHref}
            className="flex items-center gap-2 px-3 py-[7px] font-sans text-[13px] border no-underline"
            style={{ background: onInk(0.06), borderColor: onInk(0.14), color: onInk(0.9) }}
            title="Editing opens in the current reader"
          >
            <Pencil size={13} /> Edit
          </a>
        </header>

        {/* Panes */}
        <div
          key={browserTranslated ? `translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="relative flex min-h-0"
        >
          {r.views.scan && (
            <section
              className="flex-1 min-w-0 flex flex-col border-r"
              style={{ background: SURFACE.scanBed, borderColor: 'var(--border-medium)' }}
            >
              <PaneHeader
                right={scan.native ? (
                  <a href={scan.native} target="_blank" rel="noreferrer"
                    className="font-sans text-[12px] no-underline hover:text-[var(--text-primary)]"
                    style={{ color: 'var(--text-muted)' }}>
                    Zoom
                  </a>
                ) : undefined}
              >
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>Original scan</CapsLabel>
              </PaneHeader>
              <div className="flex-1 min-h-0 flex items-center justify-center px-6 py-[22px] overflow-hidden">
                <ScanImage page={r.currentPage} book={r.book} className="max-h-full w-auto object-contain" />
              </div>
            </section>
          )}
          {r.views.ocr && (
            <section
              className="flex-1 min-w-0 flex flex-col border-r"
              style={{ background: SURFACE.ocr, borderColor: 'var(--border-medium)' }}
            >
              <PaneHeader>
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
                  {r.book.language || 'Original'} · OCR
                </CapsLabel>
              </PaneHeader>
              <div
                ref={ocrRef}
                onScroll={() => syncFrom('ocr')}
                className="flex-1 min-h-0 overflow-y-auto px-[30px] py-[26px]"
                style={{ overscrollBehavior: 'contain' }}
              >
                <ReaderProse page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={17.5} />
              </div>
            </section>
          )}
          {r.views.en && (
            <section className="flex-1 min-w-0 flex flex-col" style={{ background: SURFACE.translation }}>
              <PaneHeader>
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>English</CapsLabel>
                <AiChip short />
              </PaneHeader>
              <div
                ref={enRef}
                onScroll={() => syncFrom('en')}
                className="flex-1 min-h-0 overflow-y-auto px-8 py-[26px]"
                style={{ overscrollBehavior: 'contain' }}
              >
                <ReaderProse page={r.currentPage} book={r.book} kind="translation" settings={r.settings} baseSize={18.5} />
              </div>
            </section>
          )}

          {/* Contents overlay (from the rail) */}
          {contentsOpen && (
            <div
              className="absolute top-0 left-0 bottom-0 w-[300px] border-r z-40 flex flex-col"
              style={{ background: SURFACE.panel, borderColor: 'var(--border-medium)', boxShadow: '24px 0 48px -28px rgba(30,20,8,0.5)' }}
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <CapsLabel style={{ color: 'var(--accent-rust)' }}>Contents</CapsLabel>
                <button type="button" aria-label="Close contents" onClick={() => setContentsOpen(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={15} /></button>
              </div>
              <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
                {r.chapters.length ? (
                  <ChapterList
                    chapters={r.chapters}
                    currentTitle={r.currentChapter?.title}
                    onSelect={(pid) => { setContentsOpen(false); if (pid) r.goToPage(pid); }}
                  />
                ) : (
                  <p className="px-4 py-3 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    No table of contents for this book yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Cite popover */}
          {citeOpen && (
            <div
              className="absolute bottom-4 left-4 w-[360px] border z-40 p-4"
              style={{ background: SURFACE.popover, borderColor: 'var(--border-medium)', boxShadow: '0 28px 60px -18px rgba(30,20,8,0.45)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <CapsLabel style={{ color: 'var(--accent-rust)' }}>Cite this page</CapsLabel>
                <button type="button" aria-label="Close citation" onClick={() => setCiteOpen(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={15} /></button>
              </div>
              <p className="font-body text-[14px] leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
                {citation}
              </p>
              <button
                type="button"
                onClick={copyCitation}
                className="flex items-center gap-2 px-3 py-1.5 font-sans text-[12.5px] border hover:bg-[var(--bg-warm)]"
                style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
              >
                {copied ? <Check size={13} /> : null}
                {copied ? 'Copied' : 'Copy citation'}
              </button>
            </div>
          )}

          {/* Settings drawer (closed by default) */}
          {r.settingsOpen && (
            <div
              className="absolute top-0 right-0 bottom-0 w-[268px] border-l z-40 p-[18px] overflow-y-auto"
              style={{
                background: SURFACE.panel, borderColor: 'var(--border-medium)',
                boxShadow: '-24px 0 48px -28px rgba(30,20,8,0.5)', overscrollBehavior: 'contain',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <CapsLabel style={{ color: 'var(--accent-rust)' }}>Reading settings</CapsLabel>
                <button type="button" aria-label="Close settings" onClick={() => r.setSettingsOpen(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={15} /></button>
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
        </div>

        {/* Filmstrip — the only page control in 2c */}
        <div className={`min-w-0 transition-opacity ${chromeHidden ? 'opacity-0 pointer-events-none' : ''}`}>
          {filmstrip(false, stripRef)}
        </div>
      </div>

      {/* ── Mobile / tablet (<lg): stacked panes, filmstrip pinned ───────── */}
      <div className="lg:hidden flex flex-col h-[100dvh]">
        <header className={`shrink-0 transition-opacity ${chromeHidden ? 'opacity-0 pointer-events-none' : ''}`} style={{ background: INK, color: '#fdfcf9' }}>
          <div className="flex items-center h-[52px] px-2.5">
            <a href={`/book/${r.bookPath}`} aria-label="Back to the book" className="w-11 h-11 -ml-1 flex items-center justify-center no-underline" style={{ color: onInk(0.85) }}>
              <ChevronLeft size={20} />
            </a>
            <div className="flex-1 min-w-0 text-center">
              <div className="font-body text-[15px] truncate">{r.book.display_title || r.book.title}</div>
              <div className="font-sans text-[10.5px] truncate" style={{ color: onInk(0.5) }}>
                {r.currentChapter ? `${r.currentChapter.titleEn || r.currentChapter.title} · ` : ''}p. {pageNum}
              </div>
            </div>
            <a href={searchHref} aria-label="Search this book" className="w-11 h-11 flex items-center justify-center no-underline" style={{ color: onInk(0.85) }}>
              <Search size={18} />
            </a>
            <button type="button" aria-label="Reading settings" onClick={() => setMobileSettingsOpen(v => !v)}
              className="w-11 h-11 flex items-center justify-center font-body" style={{ color: onInk(0.85) }}>
              <span><span className="text-[12px]">A</span><span className="text-[17px]">A</span></span>
            </button>
          </div>
          <div className="flex gap-1.5 px-3 pb-3 border-b" style={{ borderColor: onInk(0.12) }}>
            {(['scan', 'ocr', 'en'] as const).map(v => {
              const on = r.views[v];
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => r.toggleView(v)}
                  className="flex-1 h-11 font-sans text-[13px] border"
                  style={{
                    borderColor: on ? onInk(0.3) : onInk(0.16),
                    background: on ? onInk(0.14) : 'transparent',
                    color: on ? '#fdfcf9' : onInk(0.5),
                  }}
                >
                  {v === 'scan' ? 'Scan' : v === 'ocr' ? 'OCR' : 'English'}
                </button>
              );
            })}
          </div>
        </header>

        <main
          key={browserTranslated ? `m-translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="flex-1 min-h-0 overflow-y-auto"
          style={{ overscrollBehavior: 'contain', background: SURFACE.translation }}
        >
          {r.views.scan && (
            <section style={{ background: SURFACE.scanBed }}>
              <div className="h-[34px] flex items-center justify-between px-4">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>Original scan</CapsLabel>
                {scan.native && (
                  <a href={scan.native} target="_blank" rel="noreferrer"
                    className="font-sans text-[12px] no-underline" style={{ color: 'var(--text-muted)' }}>
                    Zoom
                  </a>
                )}
              </div>
              <div className="px-8 pb-6 pt-1 flex justify-center">
                <ScanImage page={r.currentPage} book={r.book} className="w-full max-w-[420px]" />
              </div>
            </section>
          )}
          {r.views.ocr && (
            <section className="border-t" style={{ background: SURFACE.ocr, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center px-4">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>{r.book.language || 'Original'} · OCR</CapsLabel>
              </div>
              <div className="px-[22px] pb-8">
                <ReaderProse page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={17} />
              </div>
            </section>
          )}
          {r.views.en && (
            <section className="border-t" style={{ background: SURFACE.translation, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center gap-2 px-4">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>English</CapsLabel>
                <AiChip short />
              </div>
              <div className="px-[22px] pb-10">
                <ReaderProse page={r.currentPage} book={r.book} kind="translation" settings={r.settings} baseSize={18.5} />
              </div>
            </section>
          )}
        </main>

        {/* Settings sheet above the filmstrip */}
        {mobileSettingsOpen && (
          <div
            className="fixed left-0 right-0 z-50 border-t p-4 pb-6"
            style={{
              bottom: 96, background: SURFACE.panel, borderColor: 'var(--border-medium)',
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

        <div className="shrink-0 h-[96px]">
          {filmstrip(true, stripMobileRef)}
        </div>
      </div>
    </div>
  );
}

function ChapterList({
  chapters, currentTitle, onSelect,
}: {
  chapters: Array<{ title: string; titleEn?: string; pageId?: string; pageNumber?: number; level?: number }>;
  currentTitle?: string;
  onSelect: (pageId?: string) => void;
}) {
  return (
    <>
      {chapters.map((ch, i) => {
        const isCurrent = currentTitle === ch.title;
        return (
          <button
            key={`${ch.pageId || i}`}
            type="button"
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
    </>
  );
}
