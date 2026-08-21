'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Logo from '@/components/layout/Logo';
import UserMenu from '@/components/layout/UserMenu';
import { AuthCheck } from '@/components/auth/AuthCheck';
import DownloadButton from '@/components/ui/DownloadButton';
import { useBrowserTranslation } from '@/hooks/useBrowserTranslation';
import { useIdentity } from '@/hooks/useIdentity';
import { getPageThumbUrl } from '@/lib/utils';
import { pages as pagesApi, likes as likesApi, books as booksApi } from '@/lib/api-client';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import type { Book, Page } from '@/lib/types';
import type { ReaderSettings } from './useReaderV2';
import {
  ChevronLeft, ChevronRight, ChevronRight as ChevronRightSmall,
  List, Search, Quote, Pencil, Check, X, Loader2, GalleryHorizontal,
  ZoomIn, ZoomOut, ScanSearch, Heart, Share2, BookOpen, MessageCircle,
  Info, Bell, MoreHorizontal, Link as LinkIcon, Columns3, Copy, Maximize2, Download, Crosshair,
} from 'lucide-react';
import { trackEvent } from '@/lib/track-event';
import TraceAlignment, { type TraceStatus } from '@/components/reader/TraceAlignment';
import { hasNonLatinScript } from '@/lib/non-latin-scripts';
import { useReaderV2 } from './useReaderV2';
import ReaderSettingsControls, { SettingsSwitch } from './ReaderSettingsControls';
import {
  CapsLabel, AiChip, ReaderProse, ScanViewer, SCAN_ZOOM_STEPS, SCAN_ZOOM_MAX,
  resolveScanUrls, ViewToggleGroup, onInk, hasBlockquote,
  SURFACE, themeAttr, bookByline,
} from './ReaderV2Bits';

// ─── Variant 2c: "Study Desk" ────────────────────────────────────────────────
// The scholarly reader: scan, OCR and translation side by side, a left tool
// rail whose panels (Contents / Search / Settings) slide out beside it, and a
// filmstrip as the single page control. One full-width top bar carries the
// identity, view toggles, actions and edit mode. The page itself never
// scrolls. Design handoff: design_handoff_reader_page/README.md § 2c.

const INK = 'var(--bg-dark)';
const STRIP_KEY = 'sl-reader-v2c-strip';
/** Mobile toolbar height — one row of four tools. */
const MOBILE_TOOLBAR_H = 52;
/** Drawer header tint — a shade deeper than the panel, so content passes under it. */
const PANEL_HEADER_BG = 'color-mix(in srgb, var(--bg-warm) 82%, var(--bg-dark) 4%)';
/** Mobile sheets that always take the full height — lists and conversations. */
const SHEET_FILLS = new Set<Exclude<LeftPanel, null>>(['contents', 'search', 'guide', 'librarian']);

type LeftPanel = 'contents' | 'search' | 'guide' | 'librarian' | 'info' | 'cite' | 'share' | 'settings' | 'views' | 'downloads' | 'more' | null;

const LEFT_PANEL_TITLES: Record<Exclude<LeftPanel, null>, string> = {
  contents: 'Contents',
  search: 'Search this book',
  guide: 'Reading guide',
  librarian: 'Ask the librarian',
  info: 'Edition & page info',
  cite: 'Cite this page',
  share: 'Save & share',
  settings: 'Reading settings',
  views: 'Scan, text & translation',
  downloads: 'Download',
  more: 'More',
};

/**
 * One line under each drawer title saying what the tool actually reads, so a
 * reader knows whether it is the book's own words or ours before they trust it.
 */
const LEFT_PANEL_BLURBS: Partial<Record<Exclude<LeftPanel, null>, string>> = {
  contents: 'The book’s own table of contents, as printed.',
  search: 'Searches the transcribed text and the descriptions of the illustrations.',
  guide: 'Our summary of the book, written by AI over the transcription. Not the printed contents.',
  librarian: 'Answers from AI, grounded in this page and the book around it.',
  info: 'What this page is, and the edition it was scanned from.',
  cite: 'A citation that points at this exact page.',
  share: 'Save this page to your library, or send it on.',
  settings: 'How the text is set. Your choices are remembered on this device.',
  views: 'Which panes are showing.',
  downloads: 'Take this page, or the whole book, away with you.',
};

/** The tools that live behind "More" on mobile, in the order they're offered. */
const MORE_TOOLS: Array<[Exclude<LeftPanel, null>, string, string]> = [
  ['contents', 'Contents', 'The book’s own table of contents, as printed'],
  ['librarian', 'Ask the librarian', 'Questions about this page or the book'],
  ['settings', 'Reading settings', 'Theme, text size, typeface, notes'],
  ['guide', 'Reading guide', 'Overview, themes, sections'],
  ['share', 'Save & share', 'Save this page, copy the link, post it'],
  ['downloads', 'Download', 'This page, or the whole book, in several formats'],
  ['info', 'Edition & page info', 'This page, and the edition it comes from'],
  ['cite', 'Cite this page', 'A citation that points at this exact page'],
];

interface Reader2CProps {
  initialBook: Book;
  initialPage: Page;
  initialPageList: Page[];
}

/** Desktop tool rail button (the rail is the desktop navigation). */
function RailButton({
  label, icon, onClick, active = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className="w-12 h-[46px] flex flex-col items-center justify-center gap-1 transition-colors no-underline"
      style={{
        color: active ? '#fdfcf9' : onInk(0.62),
        background: active ? onInk(0.12) : 'transparent',
      }}
      title={label}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span className="font-sans text-[8.5px] tracking-[0.06em]">{label}</span>
    </button>
  );
}

/** Mobile toolbar button: icon over label, sharing the row at a 52px target. */
function ToolButton({
  label, icon, onClick, active = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex-1 min-w-0 h-[52px] flex flex-col items-center justify-center gap-0.5 transition-colors"
      style={{
        color: active ? '#fdfcf9' : onInk(0.62),
        background: active ? onInk(0.14) : 'transparent',
      }}
      title={label}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span className="font-sans text-[9px] tracking-[0.04em] truncate max-w-full px-0.5">{label}</span>
    </button>
  );
}

const AaGlyph = <span className="font-body leading-none"><span className="text-[11px]">A</span><span className="text-[15px]">A</span></span>;

/**
 * Mobile toolbar: the phone's equivalent of the desktop rail. It sits at the
 * bottom (thumb reach) and its panels expand upward, so every tool the desk
 * has — contents, search, guide, librarian, info, cite, settings, pages — is
 * reachable on a phone without stealing reading width.
 */
function MobileToolbar({
  panel, onTogglePanel, stripVisible, onToggleStrip,
}: {
  panel: LeftPanel;
  onTogglePanel: (p: Exclude<LeftPanel, null>) => void;
  stripVisible: boolean;
  onToggleStrip: () => void;
}) {
  // Four slots. Pages, the pane picker and Search are what a reader reaches
  // for constantly; everything else — contents, the librarian, settings, the
  // guide — is one tap behind More, so nothing here competes for the thumb.
  const tools: Array<[Exclude<LeftPanel, null>, string, React.ReactNode]> = [
    ['views', 'Views', <Columns3 key="i" size={19} />],
    ['search', 'Search', <Search key="i" size={19} />],
  ];
  return (
    <div
      className="flex items-center w-full"
      style={{ background: INK, borderTop: `1px solid ${onInk(0.12)}`, height: MOBILE_TOOLBAR_H }}
      role="toolbar"
      aria-label="Reader tools"
    >
      <ToolButton
        label="Pages"
        icon={<GalleryHorizontal size={19} />}
        active={stripVisible}
        onClick={onToggleStrip}
      />
      {tools.map(([key, label, icon]) => (
        <ToolButton
          key={key}
          label={label}
          icon={icon}
          active={panel === key}
          onClick={() => onTogglePanel(key)}
        />
      ))}
      <ToolButton
        label="More"
        icon={<MoreHorizontal size={19} />}
        active={panel === 'more' || MORE_TOOLS.some(([k]) => k === panel)}
        onClick={() => onTogglePanel('more')}
      />
    </div>
  );
}

interface GuideSection {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  concepts?: string[];
  quotes?: Array<{ text: string; page: number; significance?: string }>;
}

interface GuideData {
  overview?: string;
  themes?: string[];
  sections?: GuideSection[];
}

/** What the guide is, shown when a book has none yet (and in brief when it does). */
const GUIDE_BLURB = 'A reading guide is our own summary layer over the book: an overview, the themes it keeps returning to, and a short summary of each section with the page it starts on.';
const GUIDE_BLURB_2 = 'It is not the printed table of contents. The contents list what the printer set down; the guide describes what the text actually covers, in modern English, and points you to where each part begins.';
const GUIDE_BLURB_3 = 'Guides come from an AI-assisted enrichment pass that runs after a book is transcribed and translated, so they appear once enough of the book has been through that pipeline.';

/** Reading guide, from book.reading_summary / index.bookSummary — fetched on open. */
function GuidePanel({ bookId, bookPath, bookTitle, pageList, onGoToPageNumber }: {
  bookId: string;
  bookPath: string;
  bookTitle: string;
  /** The reader's own nav list — section thumbnails come from it, no extra fetch */
  pageList: Page[];
  onGoToPageNumber: (n: number) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [guide, setGuide] = useState<GuideData | null>(null);
  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [openSection, setOpenSection] = useState<number | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  // Requests ride the same queue as every other reader request (translation,
  // corrections): the feedback collection, which is triaged into issues.
  const requestGuide = async () => {
    setRequesting(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Reading guide requested for "${bookTitle}" (book ${bookId})`,
          page: `/book/${bookPath}`,
        }),
      });
    } catch { /* best effort, same as the translation request */ }
    setRequesting(false);
    setRequested(true);
  };

  useEffect(() => {
    let cancelled = false;
    booksApi.get(bookId).then((b) => {
      if (cancelled) return;
      const book = b as unknown as {
        reading_summary?: { overview?: string; themes?: string[] };
        index?: { bookSummary?: { detailed?: string; abstract?: string; brief?: string }; sectionSummaries?: GuideData['sections'] };
      };
      const overview = book.reading_summary?.overview
        || book.index?.bookSummary?.detailed
        || book.index?.bookSummary?.abstract
        || book.index?.bookSummary?.brief;
      const data: GuideData = {
        overview,
        themes: book.reading_summary?.themes,
        sections: book.index?.sectionSummaries,
      };
      setGuide(overview || data.sections?.length ? data : null);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setGuide(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }
  if (!guide) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6" style={{ overscrollBehavior: 'contain' }}>
        <p className="font-body text-[14px] leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
          {GUIDE_BLURB}
        </p>
        <p className="font-body text-[14px] leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
          {GUIDE_BLURB_2}
        </p>
        <p className="font-body text-[14px] leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
          {GUIDE_BLURB_3}
        </p>
        <p className="font-sans text-[13px] mb-3" style={{ color: 'var(--text-primary)' }}>
          This book does not have one yet.
        </p>
        {requested ? (
          <p className="font-sans text-[13px]" style={{ color: 'var(--accent-sage-dark)' }} role="status">
            Thanks. This book is queued for a guide, and it will appear here once the pass runs.
          </p>
        ) : (
          <button
            type="button"
            onClick={requestGuide}
            disabled={requesting}
            className="flex items-center gap-2 px-3 py-2 font-sans text-[13px] border transition-colors hover:bg-[var(--bg-white)] disabled:opacity-60"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            {requesting ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />}
            Request a reading guide
          </button>
        )}
      </div>
    );
  }
  const overviewParas = guide.overview ? guide.overview.split('\n\n').filter(Boolean) : [];
  const hasMoreOverview = overviewParas.length > 1;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6" style={{ overscrollBehavior: 'contain' }}>
      {!!overviewParas.length && (
        <div className="mb-4">
          {(overviewOpen ? overviewParas : overviewParas.slice(0, 1)).map((p, i) => (
            <p key={i} className="font-body text-[14.5px] leading-relaxed mb-2 last:mb-0" style={{ color: 'var(--text-secondary)' }}>
              {p}
            </p>
          ))}
          {hasMoreOverview && (
            <button
              type="button"
              onClick={() => setOverviewOpen(v => !v)}
              className="mt-1.5 font-sans text-[12px] underline underline-offset-2 transition-colors hover:text-[var(--text-primary)]"
              style={{ color: 'var(--text-muted)' }}
            >
              {overviewOpen ? 'Show less' : `Read the full overview (${overviewParas.length - 1} more)`}
            </button>
          )}
        </div>
      )}
      {!!guide.themes?.length && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {guide.themes.slice(0, 8).map(t => (
            <span key={t} className="font-sans text-[11px] px-2 py-1 border"
              style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)' }}>
              {t}
            </span>
          ))}
        </div>
      )}
      {!!guide.sections?.length && (
        <>
          <CapsLabel className="block mb-2" style={{ color: 'var(--text-faint)' }}>Sections</CapsLabel>
          {guide.sections.map((s, i) => {
            const open = openSection === i;
            // Same thumbnail rule as the book page's sections list: the first
            // page in the section that has an image and isn't blank.
            const thumbPage = pageList.find(p =>
              p.page_number != null && p.page_number >= s.startPage && p.page_number <= s.endPage
              && p.page_type !== 'blank' && getPageThumbUrl(p as unknown as Record<string, unknown>));
            const thumb = thumbPage ? getPageThumbUrl(thumbPage as unknown as Record<string, unknown>) : null;
            return (
              <div key={i} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                <button
                  type="button"
                  onClick={() => setOpenSection(open ? null : i)}
                  aria-expanded={open}
                  className="w-full text-left py-3 flex items-start gap-3 transition-colors hover:bg-[var(--bg-white)]"
                >
                  <span
                    className="shrink-0 w-[38px] h-[50px] overflow-hidden border flex items-center justify-center"
                    style={{ borderColor: 'var(--border-light)', background: 'var(--bg-white)' }}
                  >
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-body text-[14px] leading-snug" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
                    <span className="block font-sans text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                      pp. {s.startPage}–{s.endPage}
                    </span>
                    {!open && (
                      <span className="block font-sans text-[12px] leading-snug mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                        {s.summary}
                      </span>
                    )}
                  </span>
                  <ChevronRightSmall
                    size={14}
                    className="shrink-0 mt-1 transition-transform"
                    style={{ color: 'var(--text-faint)', transform: open ? 'rotate(90deg)' : 'none' }}
                  />
                </button>
                {open && (
                  <div className="pb-4 pl-[50px]">
                    <p className="font-sans text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {s.summary}
                    </p>
                    {!!s.concepts?.length && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {s.concepts.map(c => (
                          <span key={c} className="font-sans text-[11px] px-2 py-1 border"
                            style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)' }}>
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    {!!s.quotes?.length && (
                      <div className="mt-3 flex flex-col gap-2.5">
                        {s.quotes.slice(0, 3).map((q, qi) => (
                          <div key={qi} className="pl-2.5" style={{ borderLeft: '2px solid var(--border-medium)' }}>
                            <p className="font-body text-[13px] italic leading-snug" style={{ color: 'var(--text-secondary)' }}>
                              &ldquo;{q.text}&rdquo;
                            </p>
                            <span className="font-sans text-[11px]" style={{ color: 'var(--text-faint)' }}>p. {q.page}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onGoToPageNumber(s.startPage)}
                      className="mt-3 px-3 py-2 border font-sans text-[12px] transition-colors hover:bg-[var(--bg-white)]"
                      style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                    >
                      Read this section →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * Save & share. Liking is the site's "save to my library" (visitor identity,
 * optimistic count), and the share targets mirror the site's ShareButton so a
 * post from the reader looks like a post from anywhere else, and reports the
 * same `share` analytics event.
 */
function SharePanel({ page, book, url }: { page: Page; book: Book; url: string }) {
  const identity = useIdentity();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!identity.id || identity.loading) return;
    let cancelled = false;
    likesApi.getStatus(JSON.stringify([{ type: 'page', id: page.id }]), identity.id)
      .then(data => {
        if (cancelled) return;
        const row = (data as { results?: Record<string, { count: number; liked: boolean }> }).results?.[`page:${page.id}`];
        if (row) { setCount(row.count); setLiked(row.liked); }
      })
      .catch(() => { /* cosmetic */ });
    return () => { cancelled = true; };
  }, [page.id, identity.id, identity.loading]);

  const toggleLike = () => {
    if (!identity.id) return;
    const next = !liked;
    setLiked(next);
    setCount(c => Math.max(0, c + (next ? 1 : -1)));
    likesApi.toggle('page', page.id, identity.id)
      .then(res => { setLiked(res.liked); setCount(res.count); })
      .catch(() => { setLiked(!next); setCount(c => Math.max(0, c + (next ? -1 : 1))); });
  };

  const title = book.display_title || book.title;
  const citation = `${book.author ? `${book.author}, ` : ''}${title}${page.page_number != null ? `, p. ${page.page_number}` : ''}`;
  const copy = (what: string, value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    });
  };
  const open = (href: string, channel: string) => {
    trackEvent('share', { channel, url, page: page.page_number });
    window.open(href, '_blank', 'width=550,height=440');
  };

  const targets: Array<[string, string]> = [
    ['X', `https://twitter.com/intent/tweet?text=${encodeURIComponent(citation)}&url=${encodeURIComponent(url)}`],
    ['Bluesky', `https://bsky.app/intent/compose?text=${encodeURIComponent(`${citation}\n\n${url}`)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`],
    ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${citation}\n${url}`)}`],
    ['Email', `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${citation}\n\n${url}`)}`],
  ];

  const rowCls = 'w-full text-left px-4 min-h-[46px] flex items-center justify-between gap-3 border-b transition-colors hover:bg-[var(--bg-white)]';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-4" style={{ overscrollBehavior: 'contain' }}>
      <button type="button" onClick={toggleLike} className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          <Heart size={16} fill={liked ? 'var(--accent-rust)' : 'none'} style={{ color: liked ? 'var(--accent-rust)' : 'var(--text-muted)' }} />
          {liked ? 'Saved to your library' : 'Save this page'}
        </span>
        {count > 0 && (
          <span className="font-sans text-[12px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
        )}
      </button>

      <button type="button" onClick={() => copy('link', url)} className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          <LinkIcon size={16} style={{ color: 'var(--text-muted)' }} />
          Copy link to this page
        </span>
        {copied === 'link' && <Check size={14} style={{ color: 'var(--accent-rust)' }} />}
      </button>

      <button type="button" onClick={() => copy('ref', `${citation}. ${url}`)} className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          <Quote size={16} style={{ color: 'var(--text-muted)' }} />
          Copy link with reference
        </span>
        {copied === 'ref' && <Check size={14} style={{ color: 'var(--accent-rust)' }} />}
      </button>

      <CapsLabel className="block px-4 pt-4 pb-2" style={{ color: 'var(--text-faint)' }}>Post to</CapsLabel>
      <div className="grid grid-cols-2 gap-1.5 px-4">
        {targets.map(([label, href]) => (
          <button
            key={label}
            type="button"
            onClick={() => open(href, label.toLowerCase())}
            className="min-h-[44px] px-3 border font-sans text-[13px] text-left transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="px-4 pt-4 font-sans text-[11.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Every link points at this exact page, so whoever opens it lands where you were reading.
      </p>
    </div>
  );
}


/**
 * Download. The whole-book formats come from the site's existing
 * DownloadButton, which owns the format list, the free/paid tiering and the
 * purchase and image-licence gates (src/lib/download-formats.ts, pinned by
 * tests). Rebuilding that list here would let the reader drift out of step
 * with what the download route actually serves, so this panel only adds the
 * one thing that is page-shaped: the scan in front of you.
 */
function DownloadsPanel({ page, book }: { page: Page; book: Book }) {
  const [full, setFull] = useState<Record<string, unknown> | null>(null);
  const scanUrl = resolveScanUrls(page).native;

  // The reader's nav projection carries no counts or licence, so the flags the
  // download gates need come from the full record, same as the Info panel.
  useEffect(() => {
    let cancelled = false;
    booksApi.get(book.id)
      .then(b => { if (!cancelled) setFull(b as unknown as Record<string, unknown>); })
      .catch(() => { /* the page-level download still works without it */ });
    return () => { cancelled = true; };
  }, [book.id]);

  const pagesCount = Number(full?.pages_count) || 0;
  const hasOcr = Number(full?.pages_ocr) > 0;
  const hasTranslations = Number(full?.pages_translated) > pagesCount / 2;
  const imgLicense = full?.image_license as string | undefined;
  const imgProvider = (full?.image_provider as string | undefined)?.toLowerCase();
  const year = Number(full?.year_published) || undefined;
  const imageAccess: 'open' | 'nc-free' | 'blocked' =
    imgProvider === 'bph' || (year && year < 1930)
      ? 'open'
      : imgLicense && /\bnc\b/i.test(imgLicense)
        ? 'nc-free'
        : (!imgLicense || imgLicense === 'unknown')
          ? 'blocked'
          : 'open';

  const rowCls = 'w-full text-left px-4 min-h-[52px] flex items-center justify-between gap-3 border-b transition-colors hover:bg-[var(--bg-white)]';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
      <CapsLabel className="block px-4 pb-2" style={{ color: 'var(--text-faint)' }}>This page</CapsLabel>
      {scanUrl ? (
        <a href={scanUrl} download="" className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
          <span className="min-w-0">
            <span className="block font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
              The scan of p. {page.page_number}
            </span>
            <span className="block font-sans text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
              JPEG, at the resolution it was archived
            </span>
          </span>
          <Download size={16} style={{ color: 'var(--text-muted)' }} />
        </a>
      ) : (
        <p className="px-4 pb-3 font-sans text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          No scan is archived for this page.
        </p>
      )}

      <CapsLabel className="block px-4 pt-5 pb-2" style={{ color: 'var(--text-faint)' }}>The whole book</CapsLabel>
      {full ? (
        <div className="px-4">
          <DownloadButton
            bookId={book.id}
            bookTitle={book.display_title || book.title}
            hasTranslations={hasTranslations}
            hasOcr={hasOcr}
            hasImages={pagesCount > 0}
            imageRestricted={imageAccess === 'blocked'}
            imageAccess={imageAccess}
          />
          <p className="mt-3 font-sans text-[11.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Transcription and translation as plain text, EPUB or PDF; facsimile and
            parallel-text editions carry the page images.
          </p>
        </div>
      ) : (
        <div className="px-4 py-2"><Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      )}
    </div>
  );
}


/** Copy an already-plain string, for panes whose text needs no unwrapping. */
function CopyPlainButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={label}
      title={copied ? 'Copied' : label}
      className="w-[30px] h-[30px] flex items-center justify-center transition-colors hover:bg-black/5"
      style={{ color: copied ? 'var(--accent-sage-dark)' : 'var(--text-faint)' }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

/**
 * Romanised transcription. Sits between the original script and the English:
 * it is the same words as the transcription, in letters a reader can sound
 * out, which is what makes it useful to read alongside rather than instead.
 */
function TranslitBody({ text, loading, error, settings, baseSize }: {
  text: string; loading: boolean; error: boolean;
  settings: ReaderSettings; baseSize: number;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={14} className="animate-spin" /> Romanising this page…
      </p>
    );
  }
  if (error) {
    return (
      <p className="font-sans text-[13px]" style={{ color: 'var(--status-error)' }} role="alert">
        The transliteration could not be generated for this page.
      </p>
    );
  }
  if (!text) {
    return (
      <p className="font-sans text-[13px] italic" style={{ color: 'var(--text-faint)' }}>
        No transliteration for this page yet.
      </p>
    );
  }
  const fontSize = Math.round(baseSize * settings.textScale * 10) / 10;
  return (
    <div
      className="prose-manuscript"
      data-reader-v2-typeface={settings.typeface}
      style={{
        ['--reader-font-size' as string]: `${fontSize}px`,
        ['--reader-line-height' as string]: settings.lineHeight,
        maxWidth: `${{ narrow: 55, comfortable: 70, wide: 86 }[settings.lineWidth]}ch`,
        marginInline: 'auto',
        color: 'var(--text-primary)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

/** Pane-level Notes toggle — inline editorial notes/glosses apply per text pane. */
function NotesToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="font-sans text-[11px] font-medium uppercase tracking-[0.1em] px-2 h-[24px] border transition-colors"
      style={{
        // Wears the notes' own colour (NOTE_TAG_STYLES.note is
        // bg-accent-gold/15 + text-accent-gold-dark), so the control and the
        // thing it controls read as the same object.
        color: on ? 'var(--accent-gold-dark)' : 'var(--text-faint)',
        background: on ? 'color-mix(in srgb, var(--accent-gold) 15%, transparent)' : 'transparent',
        borderColor: on ? 'color-mix(in srgb, var(--accent-gold) 45%, transparent)' : 'transparent',
      }}
      title={on ? 'Hide inline notes and glosses' : 'Show inline notes and glosses'}
    >
      Notes
    </button>
  );
}

/**
 * Trace: click a phrase in one pane to light up the span it came from in the
 * other. Same shape as the Notes toggle it sits beside, because they are the
 * same kind of thing — a way of reading, switched on for as long as you want it.
 */
function TraceToggle({ on, onToggle, loading, language }: {
  on: boolean; onToggle: () => void; loading: boolean; language?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex items-center gap-1 font-sans text-[11px] font-medium uppercase tracking-[0.1em] px-2 h-[24px] border transition-colors"
      style={{
        // Gold, like Notes and like the highlight the trace itself paints —
        // rust read as a warning about the text rather than a way of reading it.
        color: on ? 'var(--accent-gold-dark)' : 'var(--text-faint)',
        background: on ? 'color-mix(in srgb, var(--accent-gold) 15%, transparent)' : 'transparent',
        borderColor: on ? 'color-mix(in srgb, var(--accent-gold) 45%, transparent)' : 'transparent',
      }}
      title={on
        ? 'Turn tracing off'
        : `Trace: click any phrase to see it in the ${language || 'original'}`}
    >
      <Crosshair size={12} className={on && loading ? 'animate-pulse' : undefined} />
      Trace
    </button>
  );
}

/**
 * Copy this pane's text. It sits beside Notes as its own control rather than
 * behind a ⋯ menu: it was the only action in that menu, and a menu holding one
 * item costs a click to tell you so.
 */
function CopyTextButton({ page, kind }: { page: Page; kind: 'ocr' | 'translation' }) {
  const [copied, setCopied] = useState(false);
  const text = (kind === 'ocr' ? page.ocr?.data : page.translation?.data) || '';
  if (!text) return null;
  const label = kind === 'ocr' ? 'Copy the transcription' : 'Copy the translation';
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(stripEditorialWrappers(text).trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={label}
      title={copied ? 'Copied' : label}
      className="w-[30px] h-[30px] flex items-center justify-center transition-colors hover:bg-black/5"
      style={{ color: copied ? 'var(--accent-sage-dark)' : 'var(--text-faint)' }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

/** Extract the page summary from the translation's editorial wrapper blocks. */
function extractPageSummary(page: Page): string | null {
  const raw = page.translation?.data || '';
  const summary = raw.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1]?.trim();
  if (summary) return summary;
  const meta = raw.match(/<meta>([\s\S]*?)<\/meta>/i)?.[1]?.trim();
  return meta || null;
}

/** Edition & page info — page summary + bibliographic record, fetched on open. */
function InfoPanel({ page, book }: { page: Page; book: Book }) {
  const [fullBook, setFullBook] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    booksApi.get(book.id)
      .then(b => { if (!cancelled) setFullBook(b as unknown as Record<string, unknown>); })
      .catch(() => { /* fall back to nav fields */ });
    return () => { cancelled = true; };
  }, [book.id]);

  const summary = extractPageSummary(page);
  const b = { ...(fullBook || {}), ...book } as Record<string, unknown>;
  const rows: Array<[string, string | undefined]> = [
    ['Title', b.title as string],
    ['English', (b.display_title as string) !== (b.title as string) ? (b.display_title as string) : undefined],
    ['Author', b.author as string],
    ['Language', b.language as string],
    ['Place', (fullBook?.place_published as string) || undefined],
    ['Publisher', (fullBook?.publisher as string) || undefined],
    ['Published', b.published as string],
    ['Format', (fullBook?.format as string) || undefined],
    ['Pages', fullBook?.pages_count ? String(fullBook.pages_count) : undefined],
    ['USTC', (fullBook?.ustc_id as string) || undefined],
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6" style={{ overscrollBehavior: 'contain' }}>
      {summary && (
        <div className="mb-4 p-3 border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-white)' }}>
          <CapsLabel className="block mb-1.5" style={{ color: 'var(--accent-gold-dark)' }}>This page</CapsLabel>
          <p className="font-body text-[13.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {summary}
          </p>
        </div>
      )}
      <CapsLabel className="block mt-1 mb-2.5" style={{ color: 'var(--text-muted)' }}>This edition</CapsLabel>
      {!fullBook && (
        <div className="py-2"><Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      )}
      <dl>
        {rows.filter(([, v]) => v).map(([label, value]) => (
          <div key={label} className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
            <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>{label}</dt>
            <dd style={{ color: 'var(--text-secondary)' }}>
              {label === 'Title' ? <em className="font-body">{value}</em> : value}
            </dd>
          </div>
        ))}
      </dl>
      {typeof b.doi === 'string' && b.doi && (
        <p className="mt-3 font-sans text-[12px]">
          <a href={`https://doi.org/${b.doi}`} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent-rust)' }}>
            DOI {b.doi as string}
          </a>
        </p>
      )}

      {/* Provenance. A library that publishes machine-made text owes the
          reader the record of how it was made, in the same place as the rest
          of the bibliographic record — not tucked in a pane menu. */}
      {(page.ocr?.model || page.translation?.model) && (
        <>
          <CapsLabel className="block mt-5 mb-2" style={{ color: 'var(--text-muted)' }}>How this page was made</CapsLabel>
          <dl>
            <div className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
              <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>Scan</dt>
              <dd style={{ color: 'var(--text-secondary)' }}>
                Photographed from the printed edition
                {page.page_number != null ? `, p. ${page.page_number}` : ''}
              </dd>
            </div>
            {page.ocr?.model && (
              <div className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
                <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>Transcript</dt>
                <dd style={{ color: 'var(--text-secondary)' }}>
                  Read from the scan by {page.ocr.model}
                </dd>
              </div>
            )}
            {page.translation?.model && (
              <div className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
                <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>English</dt>
                <dd style={{ color: 'var(--text-secondary)' }}>
                  Translated from the transcript by {page.translation.model}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-2.5 font-sans text-[11.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Machine transcription and translation carry errors. The scan is the source, so read it
            alongside the text wherever a reading matters.
          </p>
        </>
      )}
    </div>
  );
}

export interface LibrarianMessage { role: 'user' | 'assistant'; content: string }

const LIBRARIAN_SUGGESTIONS = [
  'What is this page about?',
  'Who was the author?',
  'Explain the key concepts here',
];

/** Ask the librarian — questions about this page, book, author, or a concept. */
function LibrarianPanel({ page, book, messages, onMessages }: {
  page: Page;
  book: Book;
  messages: LibrarianMessage[];
  onMessages: (m: LibrarianMessage[]) => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setError(false);
    const history = messages;
    onMessages([...history, { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    try {
      const pageText = stripEditorialWrappers(page.translation?.data || page.ocr?.data || '').slice(0, 6000);
      const res = await pagesApi.ask(page.id, {
        question: q,
        history,
        pageText,
        bookTitle: book.display_title || book.title,
        bookAuthor: book.author,
        pageNumber: page.page_number,
      });
      onMessages([...history, { role: 'user', content: q }, { role: 'assistant', content: res.answer }]);
    } catch {
      setError(true);
      onMessages(history);
      setInput(q);
    } finally {
      setBusy(false);
    }
  };

  const empty = messages.length === 0;

  return (
    // Before the first question the composer follows the suggestions instead of
    // sitting at the far bottom of an empty panel, where a tall desktop drawer
    // put it below the fold and the field read as missing.
    <div className="flex flex-col min-h-0 flex-1">
      <div
        ref={scrollRef}
        className={`overflow-y-auto px-4 pt-3 pb-3 ${empty ? 'shrink-0' : 'flex-1 min-h-0'}`}
        style={{ overscrollBehavior: 'contain' }}
      >
        {empty && (
          <>
            <p className="font-sans text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
              Ask about this page, the book, its author, or any concept in the text.
            </p>
            <CapsLabel className="block mb-2" style={{ color: 'var(--text-faint)' }}>Or start here</CapsLabel>
            <div className="flex flex-col gap-1.5">
              {LIBRARIAN_SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="group flex items-center justify-between gap-2 text-left px-3 py-2.5 border font-sans text-[12.5px] hover:bg-[var(--bg-white)] transition-colors"
                  style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                  {s}
                  <ChevronRightSmall
                    size={13}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-faint)' }}
                  />
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          m.role === 'user' ? (
            <p key={i} className="font-sans text-[13px] font-medium mt-3 mb-1.5" style={{ color: 'var(--accent-rust)' }}>
              {m.content}
            </p>
          ) : (
            <p key={i} className="font-body text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
              {m.content}
            </p>
          )
        ))}
        {busy && (
          <div className="flex items-center gap-2 mt-3 font-sans text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={13} className="animate-spin" /> Consulting the text…
          </div>
        )}
        {error && (
          <p className="mt-2 font-sans text-[12px]" style={{ color: 'var(--status-error)' }} role="alert">
            The librarian couldn&apos;t answer just now — try again.
          </p>
        )}
      </div>
      <form
        className={`shrink-0 px-4 ${empty ? 'pt-3 pb-3' : 'pb-4'}`}
        onSubmit={e => { e.preventDefault(); ask(input); }}
      >
        <div className="flex items-center gap-2 px-2.5 py-2 border transition-colors focus-within:border-[var(--text-muted)]"
          style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={`Ask about p. ${page.page_number}…`}
            className="flex-1 bg-transparent outline-none focus:outline-none font-sans text-[16px] lg:text-[13px]"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Ask the librarian"
          />
          <button type="submit" disabled={busy || !input.trim()}
            className="font-sans text-[12px] disabled:opacity-40"
            style={{ color: 'var(--accent-rust)' }}>
            Ask
          </button>
        </div>
      </form>
      {/* Takes the slack an empty conversation leaves, so the composer stays
          put under the suggestions rather than being pushed to the bottom */}
      {empty && <div className="flex-1 min-h-0" />}
    </div>
  );
}

/**
 * Scan pane controls. Two distinct jobs, kept visually separate: the zoom
 * group scales the whole scan in place, and the lens is a spot magnifier you
 * switch on (it used to follow the cursor uninvited).
 */
function ScanControls({
  zoom, onZoomStep, onZoomReset, lensOn, onToggleLens, onExpand,
}: {
  zoom: number;
  onZoomStep: (dir: 1 | -1) => void;
  onZoomReset: () => void;
  lensOn: boolean;
  onToggleLens: () => void;
  /** Open the scan full screen, at the resolution it was archived at */
  onExpand?: () => void;
}) {
  const btn = 'w-[30px] h-[30px] flex items-center justify-center hover:bg-black/5 disabled:opacity-30 transition-colors';
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => onZoomStep(-1)}
        className={btn} style={{ color: 'var(--text-muted)' }}>
        <ZoomOut size={15} />
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        disabled={zoom === 1}
        className="min-w-[42px] px-1 h-[30px] font-sans text-[11.5px] tabular-nums hover:bg-black/5 disabled:cursor-default transition-colors"
        style={{ color: 'var(--text-muted)' }}
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" disabled={zoom >= SCAN_ZOOM_STEPS[SCAN_ZOOM_STEPS.length - 1]}
        onClick={() => onZoomStep(1)} className={btn} style={{ color: 'var(--text-muted)' }}>
        <ZoomIn size={15} />
      </button>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--border-medium)' }} />
      <button
        type="button"
        onClick={onToggleLens}
        aria-pressed={lensOn}
        aria-label="Reading lens"
        disabled={zoom > 1}
        className={btn}
        style={{
          color: lensOn ? 'var(--accent-rust)' : 'var(--text-muted)',
          boxShadow: lensOn ? 'inset 0 -2px 0 var(--accent-rust)' : 'none',
        }}
        title={zoom > 1 ? 'Reading lens (available at 100%)' : lensOn ? 'Turn the reading lens off' : 'Reading lens: magnify the spot under the pointer'}
      >
        <ScanSearch size={15} />
      </button>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="View the scan full screen"
          title="View the scan full screen"
          className={btn}
          style={{ color: 'var(--text-muted)' }}
        >
          <Maximize2 size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * The scan, full screen, at the resolution it was archived at. It replaced a
 * link to the bare image file: that navigated away from the library entirely
 * and left nothing to come back from.
 */
function ScanLightbox({ page, book, onClose, onPrev, onNext, hasPrev, hasNext }: {
  page: Page;
  book: Book;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  // Zoom resets per page, keyed rather than set from an effect.
  const [zoomByPage, setZoomByPage] = useState<{ id: string; zoom: number }>({ id: page.id, zoom: 1 });
  const zoom = zoomByPage.id === page.id ? zoomByPage.zoom : 1;
  const setZoom = useCallback((next: number | ((z: number) => number)) => {
    setZoomByPage(prev => {
      const current = prev.id === page.id ? prev.zoom : 1;
      return { id: page.id, zoom: typeof next === 'function' ? next(current) : next };
    });
  }, [page.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'ArrowLeft') onPrev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onPrev]);

  const navBtn = 'w-10 h-10 flex items-center justify-center transition-colors disabled:opacity-25 hover:bg-[rgba(253,252,249,0.12)]';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col rv2-pop" style={{ background: '#14110d' }} role="dialog" aria-modal="true" aria-label="Scan, full screen">
      <div className="shrink-0 flex items-center gap-2 px-3 h-[52px]" style={{ borderBottom: `1px solid ${onInk(0.12)}` }}>
        <button type="button" onClick={onClose} aria-label="Back to the reader"
          className="flex items-center gap-1.5 pl-1.5 pr-3 h-9 font-sans text-[13px] transition-colors hover:bg-[rgba(253,252,249,0.12)]"
          style={{ color: onInk(0.85) }}>
          <ChevronLeft size={17} /> Back to the reader
        </button>
        <div className="flex-1" />
        <span className="font-sans text-[12.5px] truncate max-w-[40%]" style={{ color: onInk(0.5) }}>
          {book.display_title || book.title}
        </span>
        <span className="font-sans text-[12.5px] tabular-nums" style={{ color: onInk(0.75) }}>
          p. {page.page_number}
        </span>
        <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label="Previous page"
          className={navBtn} style={{ color: onInk(0.75) }}><ChevronLeft size={17} /></button>
        <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next page"
          className={navBtn} style={{ color: onInk(0.75) }}><ChevronRight size={17} /></button>
        <button type="button" onClick={onClose} aria-label="Close"
          className={navBtn} style={{ color: onInk(0.75) }}><X size={17} /></button>
      </div>
      <div className="flex-1 min-h-0 px-3 py-3">
        <ScanViewer page={page} book={book} zoom={zoom} onZoomChange={setZoom} fullRes />
      </div>
      <div className="shrink-0 flex items-center justify-center gap-1 h-[46px]" style={{ borderTop: `1px solid ${onInk(0.12)}` }}>
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1}
          onClick={() => setZoom(z => SCAN_ZOOM_STEPS[Math.max(0, SCAN_ZOOM_STEPS.indexOf(z) - 1)] ?? 1)}
          className={navBtn} style={{ color: onInk(0.7) }}><ZoomOut size={16} /></button>
        <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}
          className="min-w-[56px] h-10 font-sans text-[12px] tabular-nums transition-colors hover:bg-[rgba(253,252,249,0.12)] disabled:cursor-default"
          style={{ color: onInk(0.7) }}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= SCAN_ZOOM_MAX}
          onClick={() => setZoom(z => SCAN_ZOOM_STEPS[Math.min(SCAN_ZOOM_STEPS.length - 1, SCAN_ZOOM_STEPS.indexOf(z) + 1)] ?? z)}
          className={navBtn} style={{ color: onInk(0.7) }}><ZoomIn size={16} /></button>
      </div>
    </div>
  );
}

function PaneHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      className="h-[38px] shrink-0 flex items-center justify-between px-4 border-b"
      style={{ borderColor: 'var(--border-medium)' }}
    >
      <div className="flex items-center gap-2 min-w-0">{children}</div>
      {right}
    </div>
  );
}

/** Case-insensitive highlight of the query inside a search snippet. */
function HighlightedSnippet({ snippet, query }: { snippet: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{snippet}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = snippet.split(new RegExp(`(${escaped})`, 'ig'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase()
          ? <mark key={i} className="sl-search-hl">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// In-book full-text search, backed by the same endpoint the current reader
// uses (/api/books/[id]/search). Result click jumps the reader to that page.
function BookSearchPanel({
  bookId, onGoTo,
}: {
  bookId: string;
  onGoTo: (pageId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ pageId: string; pageNumber: number; matches: Array<{ field: string; snippet: string }> }>>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setTotal(null); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/books/${bookId}/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
          setTotal(typeof data.total === 'number' ? data.total : (data.results || []).length);
        }
      } catch { /* transient */ }
      finally { setSearching(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, bookId]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2">
        {/* The field autofocuses, so a focus ring would flash on every open.
            Focus reads as a quiet darkening of the wrapper border instead —
            never the accent, which shouted on a panel nobody had typed in. */}
        <div
          className="flex items-center gap-2 px-2.5 py-2 border transition-colors focus-within:border-[var(--text-muted)]"
          style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)' }}
        >
          {searching
            ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
            : <Search size={14} style={{ color: 'var(--text-faint)' }} />}
          {/* 16px on phones: anything smaller makes iOS Safari zoom on focus */}
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search this book…"
            className="flex-1 bg-transparent outline-none focus:outline-none font-sans text-[16px] lg:text-[13px]"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Search this book"
          />
        </div>
        {total !== null && !searching && (
          <p className="font-sans text-[11.5px] mt-2" style={{ color: 'var(--text-muted)' }} aria-live="polite">
            {total === 0 ? 'No matches in this book' : `${total} ${total === 1 ? 'page matches' : 'pages match'}`}
          </p>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
        {results.map(r => (
          <button
            key={r.pageId}
            type="button"
            onClick={() => onGoTo(r.pageId)}
            className="group w-full text-left px-4 py-3 border-b transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-light)' }}
          >
            <span className="flex items-center justify-between gap-2 mb-1">
              <CapsLabel style={{ color: 'var(--text-faint)' }}>Page {r.pageNumber}</CapsLabel>
              <ChevronRightSmall
                size={13}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-faint)' }}
              />
            </span>
            {r.matches.slice(0, 2).map((m, i) => (
              <span key={i} className="block font-body text-[13.5px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                …<HighlightedSnippet snippet={m.snippet} query={query} />…
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}

function Filmstrip({
  pageList, currentPageId, compact, innerRef, onPrev, onNext, onGoTo,
}: {
  pageList: Page[];
  currentPageId: string;
  compact: boolean;
  innerRef: React.RefObject<HTMLDivElement | null>;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (pageId: string) => void;
}) {
  // Arrows match the thumbnail image exactly and share its top edge; the row
  // is top-aligned so the page-number line below can't push them down.
  const thumbH = compact ? 50 : 54;
  return (
    <div
      className="flex items-start gap-1 h-full pt-2 rv2-strip-in"
      style={{ background: INK, borderTop: `1px solid ${onInk(0.12)}` }}
    >
      <button type="button" aria-label="Previous page" onClick={onPrev}
        className="shrink-0 flex items-center justify-center mx-1.5 mt-1 transition-colors hover:bg-[rgba(253,252,249,0.16)]"
        style={{ width: compact ? 34 : 30, height: thumbH, background: onInk(0.08), color: onInk(0.8) }}>
        <ChevronLeft size={15} />
      </button>
      <div
        ref={innerRef}
        className="flex-1 flex items-start gap-2.5 overflow-x-auto px-2 py-1"
        style={{ overscrollBehavior: 'contain', scrollbarWidth: 'none' }}
      >
        {pageList.map((p) => {
          const isCurrent = p.id === currentPageId;
          const thumb = getPageThumbUrl(p as unknown as Record<string, unknown>);
          return (
            <button
              key={p.id}
              type="button"
              data-strip-page={p.id}
              onClick={() => onGoTo(p.id)}
              className="shrink-0 flex flex-col items-center gap-1"
              title={`Page ${p.page_number}`}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {/* A ring drawn OUTSIDE the page, in brand rust, so the current
                  page is findable at a glance in a strip of near-identical
                  grey thumbnails. The scroller carries padding to match: it
                  clips anything outside its box, which is what ate the top
                  edge of this ring when it was an outline on a flush thumb. */}
              <span
                className="block overflow-hidden"
                style={{
                  width: compact ? 38 : 42,
                  height: compact ? 50 : 54,
                  background: isCurrent ? '#fdfcf9' : 'rgba(245,240,232,0.30)',
                  boxShadow: isCurrent ? '0 0 0 3px #c2412c, 0 0 0 5px rgba(194,65,44,0.28)' : 'none',
                }}
              >
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" loading="lazy" decoding="async"
                    className="w-full h-full object-cover" draggable={false}
                    style={{
                      // The neighbours recede so the current page is the only
                      // one at full strength: the ring alone was not enough to
                      // find it in a row of near-identical grey pages.
                      opacity: isCurrent ? 1 : 0.42,
                      filter: isCurrent ? 'none' : 'grayscale(0.5)',
                    }} />
                )}
              </span>
              <span
                className="font-sans text-[9.5px] tabular-nums px-1"
                style={isCurrent
                  ? { color: '#fdfcf9', background: '#c2412c', fontWeight: 600 }
                  : { color: onInk(0.38) }}
              >
                {p.page_number}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next page" onClick={onNext}
        className="shrink-0 flex items-center justify-center mx-1.5 mt-1 transition-colors hover:bg-[rgba(253,252,249,0.16)]"
        style={{ width: compact ? 34 : 30, height: thumbH, background: onInk(0.08), color: onInk(0.8) }}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

type ReaderState = ReturnType<typeof useReaderV2>;

/**
 * The body of whichever tool panel is open. Shared verbatim between the
 * desktop panel (rises above the toolbar) and the mobile sheet, so the two
 * breakpoints can never drift apart.
 */
function PanelContent({
  panel, r, citation, copied, onCopyCitation, librarianMessages, onLibrarianMessages, onClose, onSelectPanel,
  editing, onToggleEdit, shareUrl,
}: {
  panel: Exclude<LeftPanel, null>;
  r: ReaderState;
  citation: string;
  copied: boolean;
  onCopyCitation: () => void;
  librarianMessages: LibrarianMessage[];
  onLibrarianMessages: (m: LibrarianMessage[]) => void;
  onClose: () => void;
  /** Mobile "More" menu hands off to another panel */
  onSelectPanel: (p: Exclude<LeftPanel, null>) => void;
  editing: boolean;
  onToggleEdit: () => void;
  shareUrl: string;
}) {
  if (panel === 'more') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-3" style={{ overscrollBehavior: 'contain' }}>
        {MORE_TOOLS.map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelectPanel(key)}
            className="w-full text-left px-4 min-h-[56px] py-2.5 flex items-center justify-between gap-3 border-b transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-light)' }}
          >
            <span className="min-w-0">
              <span className="block font-sans text-[14px]" style={{ color: 'var(--text-primary)' }}>{label}</span>
              <span className="block font-sans text-[11.5px] truncate" style={{ color: 'var(--text-faint)' }}>{hint}</span>
            </span>
            <ChevronRightSmall size={15} style={{ color: 'var(--text-faint)' }} />
          </button>
        ))}
        {/* Editor-and-above only, same gate as the desktop rail */}
        <AuthCheck role="inner_circle">
          <button
            type="button"
            onClick={() => { onClose(); onToggleEdit(); }}
            className="w-full text-left px-4 min-h-[56px] py-2.5 flex items-center justify-between gap-3 border-b transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-light)' }}
          >
            <span className="min-w-0">
              <span className="block font-sans text-[14px]" style={{ color: 'var(--text-primary)' }}>
                {editing ? 'Stop editing' : 'Edit this page'}
              </span>
              <span className="block font-sans text-[11.5px] truncate" style={{ color: 'var(--text-faint)' }}>
                Correct the transcription or translation
              </span>
            </span>
            <Pencil size={15} style={{ color: 'var(--text-faint)' }} />
          </button>
        </AuthCheck>
      </div>
    );
  }
  if (panel === 'contents') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pt-2" style={{ overscrollBehavior: 'contain' }}>
        {r.chapters.length ? (
          <ChapterList
            chapters={r.chapters}
            currentTitle={r.currentChapter?.title}
            onSelect={(pid) => { onClose(); if (pid) r.goToPage(pid); }}
          />
        ) : (
          <p className="px-4 py-3 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No table of contents for this book yet.
          </p>
        )}
      </div>
    );
  }
  if (panel === 'views') {
    const PANES: Array<[keyof ReaderState['views'], string, string]> = [
      ['scan', 'Original scan', 'The page as it was photographed'],
      ['ocr', `${r.book.language || 'Original'} transcription`, 'The printed text, read by machine'],
      ['en', 'English translation', 'Translated with AI assistance'],
      ...(hasNonLatinScript(r.book.language) && r.currentPage.ocr?.data
        ? [['translit', 'Romanised transcription', 'The same words in Latin letters'] as [keyof ReaderState['views'], string, string]]
        : []),
    ];
    const shown = PANES.filter(([k]) => r.views[k]).length;
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-3" style={{ overscrollBehavior: 'contain' }}>
        {PANES.map(([key, label, hint]) => {
          const on = r.views[key];
          // The reader must keep at least one pane, or the page goes blank.
          const locked = on && shown === 1;
          return (
            <div
              key={key}
              className="w-full px-4 min-h-[60px] py-2.5 flex items-center justify-between gap-3 border-b"
              style={{ borderColor: 'var(--border-light)' }}
            >
              <span className="min-w-0">
                <span className="block font-sans text-[14px]" style={{ color: 'var(--text-primary)' }}>{label}</span>
                <span className="block font-sans text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                  {locked ? 'The last pane showing' : hint}
                </span>
              </span>
              <span className={locked ? 'opacity-40' : undefined}>
                <SettingsSwitch
                  on={on}
                  onToggle={() => { if (!locked) r.toggleView(key); }}
                  label={`Show the ${label.toLowerCase()}`}
                />
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  if (panel === 'downloads') {
    return <DownloadsPanel page={r.currentPage} book={r.book} />;
  }
  if (panel === 'search') {
    return <BookSearchPanel bookId={r.book.id} onGoTo={(pid) => { onClose(); r.goToPage(pid); }} />;
  }
  if (panel === 'guide') {
    return (
      <GuidePanel
        bookId={r.book.id}
        bookPath={r.bookPath}
        bookTitle={r.book.display_title || r.book.title}
        pageList={r.pageList}
        onGoToPageNumber={(n) => { onClose(); r.goToPageNumber(n); }}
      />
    );
  }
  if (panel === 'librarian') {
    return (
      <LibrarianPanel
        page={r.currentPage}
        book={r.book}
        messages={librarianMessages}
        onMessages={onLibrarianMessages}
      />
    );
  }
  if (panel === 'info') {
    return <InfoPanel page={r.currentPage} book={r.book} />;
  }
  if (panel === 'share') {
    return <SharePanel page={r.currentPage} book={r.book} url={shareUrl} />;
  }
  if (panel === 'cite') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4" style={{ overscrollBehavior: 'contain' }}>
        <p className="font-body text-[14px] leading-relaxed mb-3 break-words" style={{ color: 'var(--text-secondary)' }}>
          {citation}
        </p>
        <button
          type="button"
          onClick={onCopyCitation}
          className="flex items-center gap-2 px-3 py-1.5 font-sans text-[12.5px] border hover:bg-[var(--bg-white)] transition-colors"
          style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
        >
          {copied ? <Check size={13} /> : null}
          {copied ? 'Copied' : 'Copy citation'}
        </button>
        <p className="mt-4 pt-3 border-t font-sans text-[12px] leading-relaxed" style={{ borderColor: 'var(--border-light)', color: 'var(--text-faint)' }}>
          The link points at this exact page, so readers land where you quoted.
        </p>
      </div>
    );
  }
  // settings
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-[18px] pt-2 pb-4" style={{ overscrollBehavior: 'contain' }}>
      <ReaderSettingsControls settings={r.settings} onChange={r.updateSettings} />
    </div>
  );
}

export default function Reader2C({ initialBook, initialPage, initialPageList }: Reader2CProps) {
  const r = useReaderV2('2c', initialBook, initialPage, initialPageList, { scan: true, ocr: true, en: true, translit: false });
  const browserTranslated = useBrowserTranslation();

  const [leftPanel, setLeftPanel] = useState<LeftPanel>(null);
  const togglePanel = useCallback((p: Exclude<LeftPanel, null>) => {
    setLeftPanel(prev => (prev === p ? null : p));
  }, []);

  const [copied, setCopied] = useState(false);

  // Which breakpoint's panel to mount. Both layouts exist in the DOM (one
  // hidden by CSS), so without this the open panel would mount TWICE and
  // double every fetch it makes. Safe to derive on the client: a panel only
  // exists after a click, so it can't differ at hydration.
  const [isDesktop, setIsDesktop] = useState(
    () => (typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1024px)').matches)
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Librarian conversation survives panel toggles and page turns
  const [librarianMessages, setLibrarianMessages] = useState<LibrarianMessage[]>([]);

  // Jump-to-page input in the top-bar stepper
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const jumpRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (jumpOpen) jumpRef.current?.focus(); }, [jumpOpen]);

  // Scan zoom + lens — controlled from the pane header, never from buttons
  // over the scan itself. The lens is off until asked for.
  const [scanZoom, setScanZoom] = useState(1);
  const [lensOn, setLensOn] = useState(false);
  useEffect(() => { setScanZoom(1); }, [r.currentPageId]);
  // Any zoom holds the pane sync off briefly: the scan's scroll is being moved
  // to keep the anchored point still, and a follower syncing back would drag
  // the page out from under the reader.
  const changeZoom = useCallback((z: number) => {
    zoomingUntil.current = Date.now() + 300;
    setScanZoom(z);
  }, []);
  const zoomStep = (dir: 1 | -1) => {
    const idx = SCAN_ZOOM_STEPS.findIndex(s => Math.abs(s - scanZoom) < 0.01);
    const next = SCAN_ZOOM_STEPS[Math.min(SCAN_ZOOM_STEPS.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + dir))];
    changeZoom(next);
  };

  // Filmstrip visibility — toggled from the bottom of the rail, persisted.
  const [stripVisible, setStripVisible] = useState(true);
  const [lightbox, setLightbox] = useState(false);
  // Tracing needs both texts on screen and a real translation to align to; an
  // English book has nothing to trace between.
  const [traceOn, setTraceOn] = useState(false);
  const [traceStatus, setTraceStatus] = useState<TraceStatus>('idle');

  // Romanisation of the transcription, for scripts most readers cannot sound
  // out. Cached on the page when it exists; generated on demand the first
  // time the pane is opened, which is why it is opt-in rather than default-on.
  const [translit, setTranslit] = useState('');
  const [translitLoading, setTranslitLoading] = useState(false);
  const [translitError, setTranslitError] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try { if (window.localStorage.getItem(STRIP_KEY) === '0') setStripVisible(false); } catch { /* private mode */ }
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const toggleStrip = useCallback(() => {
    setStripVisible(v => {
      try { window.localStorage.setItem(STRIP_KEY, v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  }, []);

  // ── Edit mode: OCR + translation become editable in place ──────────────
  const [editing, setEditing] = useState(false);
  const draftsRef = useRef<Map<string, { ocr?: string; translation?: string }>>(new Map());
  const [draft, setDraft] = useState<{ ocr: string; translation: string }>({ ocr: '', translation: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const originalOcr = r.currentPage.ocr?.data || '';
  const originalTr = r.currentPage.translation?.data || '';

  useEffect(() => {
    if (!editing) return;
    const stored = draftsRef.current.get(r.currentPageId);
    setDraft({
      ocr: stored?.ocr ?? (r.currentPage.ocr?.data || ''),
      translation: stored?.translation ?? (r.currentPage.translation?.data || ''),
    });
    setSaveError(null);
  }, [editing, r.currentPageId, r.currentPage]);

  const setDraftField = (field: 'ocr' | 'translation', value: string) => {
    setDraft(prev => {
      const next = { ...prev, [field]: value };
      draftsRef.current.set(r.currentPageId, next);
      return next;
    });
  };

  const dirty = editing && (draft.ocr !== originalOcr || draft.translation !== originalTr);

  const saveEdits = async () => {
    if (!dirty) { setEditing(false); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await pagesApi.update(r.currentPageId, {
        ocr: draft.ocr !== originalOcr
          ? { data: draft.ocr, language: r.book.language || 'Latin' }
          : undefined,
        translation: draft.translation !== originalTr
          ? { data: draft.translation, language: 'English' }
          : undefined,
      });
      if (updated) r.applyPageUpdate(updated as unknown as Page);
      draftsRef.current.delete(r.currentPageId);
      setEditing(false);
    } catch {
      setSaveError('Save failed. You need editor access; sign in on this preview.');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdits = () => {
    draftsRef.current.delete(r.currentPageId);
    setEditing(false);
    setSaveError(null);
  };

  // Escape closes panels/popovers (the hook handles settings + focus mode)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setLeftPanel(null); setJumpOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Scroll-sync the panes proportionally, without feedback loops. The zoomed
  // scan joins the group: once it scrolls, a reader travelling down the
  // facsimile keeps the translation beside the same passage.
  const ocrRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLDivElement>(null);
  const scanScrollRef = useRef<HTMLDivElement>(null);
  // The lock is time-based and refreshed on every write, because the scroll
  // events a programmatic sync provokes can land well after a fixed 80ms
  // window — long enough for a follower pane to sync back and undo the
  // leader's position (this is what dragged the zoom anchor around).
  const syncLock = useRef<{ from: string; at: number } | null>(null);
  const zoomingUntil = useRef(0);
  const syncFrom = useCallback((from: 'scan' | 'ocr' | 'en') => {
    const panes: Record<string, HTMLDivElement | null> = {
      scan: scanScrollRef.current, ocr: ocrRef.current, en: enRef.current,
    };
    const src = panes[from];
    if (!src) return;
    // A zoom moves the scan to keep its anchor; that is not a reading move.
    if (Date.now() < zoomingUntil.current) return;
    const lock = syncLock.current;
    if (lock && lock.from !== from && Date.now() - lock.at < 250) return;
    const srcMax = src.scrollHeight - src.clientHeight;
    if (srcMax <= 0) return;
    syncLock.current = { from, at: Date.now() };
    const ratio = src.scrollTop / srcMax;
    for (const [key, dst] of Object.entries(panes)) {
      if (key === from || !dst) continue;
      const dstMax = dst.scrollHeight - dst.clientHeight;
      if (dstMax > 0) dst.scrollTop = ratio * dstMax;
    }
  }, []);

  // Mobile: one scroller for the stacked panes. Reset it on a page turn so a
  // new page always starts at the top, and drive paging from a horizontal swipe.
  const mobileMainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    ocrRef.current?.scrollTo({ top: 0 });
    enRef.current?.scrollTo({ top: 0 });
    mobileMainRef.current?.scrollTo({ top: 0 });
    setBarHidden(false);
  }, [r.currentPageId]);

  /**
   * How much of the viewport the on-screen keyboard is covering. The layout
   * viewport does not shrink when the keyboard opens on iOS, so a sheet
   * anchored to the bottom ends up underneath it — which is what made the
   * mobile search panel go strange the moment the field took focus. The
   * visual viewport does shrink, and the difference is the inset.
   */
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Below ~120px it is browser chrome moving, not a keyboard.
      setKeyboardInset(inset > 120 ? Math.round(inset) : 0);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  /**
   * The mobile sheet grows and shrinks with whichever tool is open. A sheet
   * with no height of its own snaps between sizes, so measure what the content
   * wants — the header plus its scroller's full content — and animate to it.
   */
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!leftPanel || isDesktop) { setSheetHeight(null); return; }
    const cap = Math.round(window.innerHeight * (keyboardInset > 0 ? 0.58 : 0.72));
    // Lists and conversations always want the full sheet; the short, fixed
    // panels size to their own content so they don't sit in a half-empty box.
    if (SHEET_FILLS.has(leftPanel)) { setSheetHeight(cap); return; }
    const sheet = sheetRef.current;
    if (!sheet) return;
    const measure = () => {
      const header = sheet.firstElementChild as HTMLElement | null;
      const body = sheet.lastElementChild as HTMLElement | null;
      if (!header || !body) return;
      setSheetHeight(Math.min(cap, Math.ceil(header.offsetHeight + body.scrollHeight)));
    };
    measure();
    // Content can arrive after the open (a fetch, a copied-state swap), so
    // watch the subtree rather than measuring once.
    const mo = new MutationObserver(measure);
    mo.observe(sheet, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [leftPanel, keyboardInset, isDesktop]);

  // Mobile title bar yields to the reading: it slides away as you read down
  // and comes back the moment you scroll up. The threshold keeps a jittery
  // finger from flickering it, and the top of the page always shows it.
  const [barHidden, setBarHidden] = useState(false);
  const lastScrollY = useRef(0);
  const onMobileScroll = useCallback(() => {
    const el = mobileMainRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const delta = y - lastScrollY.current;
    if (y < 48) setBarHidden(false);
    else if (delta > 6) setBarHidden(true);
    else if (delta < -6) setBarHidden(false);
    lastScrollY.current = y;
  }, []);

  // Swipe to page: axis-locked so a vertical read never turns a page, and a
  // horizontal drag has to clear both a distance floor and a vertical bias.
  const swipeRef = useRef<{ x: number; y: number; axis: null | 'x' | 'y' } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { swipeRef.current = null; return; }
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    if (!s || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.axis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || s.axis !== 'x') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    if (Math.abs(dx) < 45) return;
    if (dx < 0) r.goNext(); else r.goPrev();
  };

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
  }, [r.currentPageId, stripVisible]);

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

  const pageNum = r.currentPage?.page_number ?? '—';
  const scan = resolveScanUrls(r.currentPage);
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/book/${r.bookPath}/page/${r.currentPageId}`
    : `https://sourcelibrary.org/book/${r.bookPath}/page/${r.currentPageId}`;

  const leftPanelTitle = leftPanel ? LEFT_PANEL_TITLES[leftPanel] : '';
  const leftPanelBlurb = leftPanel ? LEFT_PANEL_BLURBS[leftPanel] : undefined;
  // One width for every drawer — the widest any of them needed. A rail whose
  // panel jumps between two widths as you move down it reads as a wobble.
  const leftPanelWidth = 340;
  const prevPage = r.currentIndex > 0 ? r.pageList[r.currentIndex - 1] : null;
  const nextPage = r.currentIndex >= 0 && r.currentIndex < r.totalPages - 1 ? r.pageList[r.currentIndex + 1] : null;

  // Colour of whatever pane ends the mobile column, used to fill any leftover
  // height so a short page never shows a white band.
  const lastSurface = r.views.en ? SURFACE.translation : r.views.ocr ? SURFACE.ocr : SURFACE.scanBed;

  // Trace aligns the transcription against the English, so it needs both panes
  // showing, both texts present, and a book that isn't already in English.
  const isEnglishBook = (r.book.language || '').toLowerCase().startsWith('english');
  const traceEligible = !isEnglishBook && !editing
    && !!r.currentPage.ocr?.data && !!r.currentPage.translation?.data
    && r.views.ocr && r.views.en;
  const traceActive = traceOn && traceEligible;

  const translitEligible = hasNonLatinScript(r.book.language) && !!r.currentPage.ocr?.data;

  // Cached transliterations arrive with the page; anything else is generated
  // the first time the pane is open on that page, and only then.
  useEffect(() => {
    const cached = (r.currentPage as unknown as { transliteration?: { data?: string } }).transliteration?.data;
    setTranslitError(false);
    if (cached) { setTranslit(cached); return; }
    setTranslit('');
    if (!r.views.translit || !translitEligible) return;
    let cancelled = false;
    setTranslitLoading(true);
    pagesApi.transliterate(r.currentPageId)
      .then(res => { if (!cancelled) setTranslit(res.transliteration || ''); })
      .catch(() => { if (!cancelled) setTranslitError(true); })
      .finally(() => { if (!cancelled) setTranslitLoading(false); });
    return () => { cancelled = true; };
  }, [r.currentPageId, r.currentPage, r.views.translit, translitEligible]);

  // Quoted matter: show the block only where both passes found one. Where they
  // disagree, both panes fall back to running prose, so the two sides never
  // disagree on the page in front of the reader. Render-time only — nothing is
  // written back, and a page with only one text keeps whatever it has.
  const ocrText = r.currentPage.ocr?.data;
  const transText = r.currentPage.translation?.data;
  const quotesDisagree = !!ocrText && !!transText
    && hasBlockquote(ocrText) !== hasBlockquote(transText);

  const panelProps = {
    r, citation, copied,
    onCopyCitation: copyCitation,
    librarianMessages,
    onLibrarianMessages: setLibrarianMessages,
    onClose: () => setLeftPanel(null),
    onSelectPanel: (p: Exclude<LeftPanel, null>) => setLeftPanel(p),
    editing,
    onToggleEdit: () => setEditing(v => !v),
    shareUrl,
  };

  const editorTextarea = (field: 'ocr' | 'translation') => (
    <textarea
      value={field === 'ocr' ? draft.ocr : draft.translation}
      onChange={e => setDraftField(field, e.target.value)}
      spellCheck={false}
      className="w-full h-full resize-none outline-none font-body text-[15px] leading-[1.6] p-6"
      style={{ background: 'var(--bg-white)', color: 'var(--text-primary)', border: 'none' }}
      aria-label={field === 'ocr' ? 'Edit transcription' : 'Edit translation'}
    />
  );

  return (
    <div data-reader-v2 data-reader-theme={themeAttr(r.settings.theme)}>
      {/* ── Desktop (lg+): fixed frame, panes scroll ─────────────────────── */}
      <div
        className="hidden lg:grid h-[100dvh]"
        style={{ gridTemplateColumns: '66px 1fr', gridTemplateRows: '58px 1fr auto' }}
      >
        {/* Top bar — full width, single identity lockup top-left */}
        <header
          className="col-span-2 flex items-center gap-3 px-4"
          style={{ background: INK, color: '#fdfcf9', borderBottom: `1px solid ${onInk(0.12)}` }}
        >
          <Logo white compact />
          {/* Title and byline sit on one line rather than stacking, so the bar
              stays a single row of chrome */}
          <a
            href={`/book/${r.bookPath}`}
            className="min-w-0 max-w-[52%] no-underline group flex items-baseline gap-2.5 px-1.5 py-1 ml-1 transition-colors hover:bg-[rgba(253,252,249,0.08)]"
            title="Back to the book page"
          >
            <span className="font-body text-[15.5px] leading-none truncate shrink min-w-0" style={{ color: '#fdfcf9' }}>
              {r.book.display_title || r.book.title}
            </span>
            <span className="font-sans text-[11.5px] leading-none truncate shrink-0 max-w-[45%]" style={{ color: onInk(0.5) }}>
              {bookByline(r.book)}
            </span>
          </a>
          <div className="flex-1" />
          {saveError && (
            <span className="font-sans text-[12px] max-w-[260px] truncate" style={{ color: '#e8a793' }} role="alert">
              {saveError}
            </span>
          )}
          <ViewToggleGroup views={r.views} onToggle={r.toggleView} compact />
          <div className="flex items-stretch">
            <div className="flex items-stretch border" style={{ borderColor: onInk(0.14), background: onInk(0.06) }}>
              <button type="button" aria-label="Previous page" onClick={r.goPrev}
                className="w-8 h-[34px] flex items-center justify-center transition-colors hover:bg-[rgba(253,252,249,0.12)]"
                style={{ color: onInk(0.72) }}>
                <ChevronLeft size={15} />
              </button>
              {jumpOpen ? (
                <input
                  ref={jumpRef}
                  value={jumpValue}
                  onChange={e => setJumpValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const n = parseInt(jumpValue, 10);
                      if (!Number.isNaN(n)) r.goToPageNumber(n);
                      setJumpOpen(false); setJumpValue('');
                    }
                  }}
                  onBlur={() => setJumpOpen(false)}
                  placeholder={String(pageNum)}
                  className="w-14 text-center font-sans text-[12.5px] bg-transparent outline-none"
                  style={{ color: '#fdfcf9' }}
                  inputMode="numeric"
                  aria-label="Jump to page"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setJumpOpen(true)}
                  className="px-2 font-sans text-[12.5px] tabular-nums transition-colors hover:bg-[rgba(253,252,249,0.08)]"
                  title="Jump to page"
                  style={{ color: onInk(0.9) }}
                >
                  p. {pageNum}<span style={{ color: onInk(0.45) }}> / {r.pageList.length ? r.pageList[r.pageList.length - 1].page_number : r.totalPages}</span>
                </button>
              )}
              <button type="button" aria-label="Next page" onClick={r.goNext}
                className="w-8 h-[34px] flex items-center justify-center transition-colors hover:bg-[rgba(253,252,249,0.12)]"
                style={{ color: onInk(0.72) }}>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cancelEdits}
                className="px-3 py-[7px] font-sans text-[13px] border transition-colors hover:bg-[rgba(253,252,249,0.12)]"
                style={{ borderColor: onInk(0.14), color: onInk(0.72) }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-[7px] font-sans text-[13px] disabled:opacity-60"
                style={{ background: 'var(--accent-rust)', color: '#fdfcf9' }}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {dirty ? 'Save changes' : 'Done'}
              </button>
            </div>
          ) : null}
          <div className="ml-1 shrink-0 whitespace-nowrap">
            <UserMenu variant="hero" />
          </div>
        </header>

        {/* Tool rail */}
        <nav
          className="row-span-2 flex flex-col items-center pt-3 gap-1"
          style={{ background: INK, borderRight: `1px solid ${onInk(0.12)}` }}
          aria-label="Reader tools"
        >
          <RailButton label="Contents" active={leftPanel === 'contents'} onClick={() => togglePanel('contents')} icon={<List size={17} />} />
          <RailButton label="Search" active={leftPanel === 'search'} onClick={() => togglePanel('search')} icon={<Search size={17} />} />
          <RailButton label="Guide" active={leftPanel === 'guide'} onClick={() => togglePanel('guide')} icon={<BookOpen size={17} />} />
          <RailButton label="Librarian" active={leftPanel === 'librarian'} onClick={() => togglePanel('librarian')} icon={<MessageCircle size={17} />} />
          <RailButton label="Info" active={leftPanel === 'info'} onClick={() => togglePanel('info')} icon={<Info size={17} />} />
          <RailButton label="Cite" active={leftPanel === 'cite'} onClick={() => togglePanel('cite')} icon={<Quote size={17} />} />
          <RailButton label="Share" active={leftPanel === 'share'} onClick={() => togglePanel('share')} icon={<Share2 size={17} />} />
          <RailButton label="Download" active={leftPanel === 'downloads'} onClick={() => togglePanel('downloads')} icon={<Download size={17} />} />
          <RailButton label="Settings" active={leftPanel === 'settings'} onClick={() => togglePanel('settings')} icon={AaGlyph} />
          {/* Editing is editor-and-above only, so the affordance is gated the
              same way the current reader gates its Read/Edit toggle. */}
          <AuthCheck role="inner_circle">
            <RailButton label="Edit" active={editing} onClick={() => setEditing(v => !v)} icon={<Pencil size={17} />} />
          </AuthCheck>
          <div className="flex-1" />
          {/* Bottom slot mirrors the filmstrip's own box (92px tall, 8px top
              padding, 54px controls) so Pages lines up with the strip's
              arrows and the top edge of the page thumbnails it toggles. */}
          <div
            className="flex items-start justify-center transition-[height] duration-300"
            style={{ height: stripVisible ? 92 : 62, paddingTop: 8 }}
          >
            <button
              type="button"
              onClick={toggleStrip}
              aria-pressed={stripVisible}
              title="Pages"
              className="w-12 h-[54px] flex flex-col items-center justify-center gap-1 transition-colors"
              style={{
                color: stripVisible ? '#fdfcf9' : onInk(0.62),
                background: stripVisible ? onInk(0.12) : 'transparent',
              }}
            >
              <GalleryHorizontal size={17} />
              <span className="font-sans text-[8.5px] tracking-[0.06em]">Pages</span>
            </button>
          </div>
        </nav>

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
                right={
                  <ScanControls
                    zoom={scanZoom}
                    onZoomStep={zoomStep}
                    onZoomReset={() => changeZoom(1)}
                    lensOn={lensOn}
                    onToggleLens={() => setLensOn(v => !v)}
                    onExpand={scan.native ? () => setLightbox(true) : undefined}
                  />
                }
              >
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>Original scan</CapsLabel>
              </PaneHeader>
              <div className={`flex-1 min-h-0 overflow-hidden ${scanZoom > 1 ? '' : 'px-6 py-[22px]'}`}>
                <ScanViewer
                  page={r.currentPage}
                  book={r.book}
                  zoom={scanZoom}
                  onZoomChange={changeZoom}
                  lensOn={lensOn}
                  scrollRef={scanScrollRef}
                  onScroll={() => syncFrom('scan')}
                />
              </div>
            </section>
          )}
          {r.views.ocr && (
            <section
              data-reader-section="ocr"
              className="flex-1 min-w-0 flex flex-col border-r"
              style={{ background: SURFACE.ocr, borderColor: 'var(--border-medium)' }}
            >
              <PaneHeader right={!editing ? (
                <div className="flex items-center gap-1">
                  {traceEligible && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)}
                      loading={traceStatus === 'loading'} language={r.book.language} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  <CopyTextButton page={r.currentPage} kind="ocr" />
                </div>
              ) : undefined}>
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
                  {r.book.language || 'Original'} · OCR
                </CapsLabel>
                {editing && <CapsLabel style={{ color: 'var(--accent-rust)' }}>Editing</CapsLabel>}
              </PaneHeader>
              {editing ? (
                <div className="flex-1 min-h-0">{editorTextarea('ocr')}</div>
              ) : (
                <div
                  ref={ocrRef}
                  data-reader-panel
                  onScroll={() => syncFrom('ocr')}
                  className="flex-1 min-h-0 overflow-y-auto px-[30px] py-[26px]"
                  style={{ overscrollBehavior: 'contain' }}
                >
                  <div key={r.currentPageId} className="rv2-page-in">
                    <ReaderProse suppressBlockquote={quotesDisagree} page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={17.5} />
                  </div>
                </div>
              )}
            </section>
          )}
          {r.views.translit && translitEligible && (
            <section
              data-reader-section="transliteration"
              className="flex-1 min-w-0 flex flex-col border-r"
              style={{ background: SURFACE.popover, borderColor: 'var(--border-medium)' }}
            >
              <PaneHeader right={
                <CopyPlainButton text={translit} label="Copy the transliteration" />
              }>
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>Romanised</CapsLabel>
                <AiChip short />
              </PaneHeader>
              <div data-reader-panel className="flex-1 min-h-0 overflow-y-auto px-8 py-[26px]" style={{ overscrollBehavior: 'contain' }}>
                <TranslitBody text={translit} loading={translitLoading} error={translitError}
                  settings={r.settings} baseSize={16.5} />
              </div>
            </section>
          )}
          {r.views.en && (
            <section data-reader-section="translation" className="flex-1 min-w-0 flex flex-col" style={{ background: SURFACE.translation }}>
              <PaneHeader right={!editing ? (
                <div className="flex items-center gap-1">
                  {traceEligible && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)}
                      loading={traceStatus === 'loading'} language={r.book.language} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  <CopyTextButton page={r.currentPage} kind="translation" />
                </div>
              ) : undefined}>
                <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>English</CapsLabel>
                <AiChip short />
                {editing && <CapsLabel style={{ color: 'var(--accent-rust)' }}>Editing</CapsLabel>}
              </PaneHeader>
              {editing ? (
                <div className="flex-1 min-h-0">{editorTextarea('translation')}</div>
              ) : (
                <div
                  ref={enRef}
                  data-reader-panel
                  onScroll={() => syncFrom('en')}
                  className="flex-1 min-h-0 overflow-y-auto px-8 py-[26px]"
                  style={{ overscrollBehavior: 'contain' }}
                >
                  <div key={r.currentPageId} className="rv2-page-in">
                    <ReaderProse suppressBlockquote={quotesDisagree} page={r.currentPage} book={r.book} kind="translation" settings={r.settings} baseSize={18.5} />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Left slide-out panel (Contents / Search / Settings) */}
          {leftPanel && isDesktop && (
            <div
              className="absolute top-0 left-0 bottom-0 border-r z-40 flex flex-col rv2-slide-in-left"
              style={{
                width: leftPanelWidth,
                background: SURFACE.panel, borderColor: 'var(--border-medium)',
                boxShadow: '24px 0 48px -28px rgba(30,20,8,0.5)',
              }}
            >
              {/* Tinted so the title block reads as a header the content
                  passes under, rather than the first row of the list. */}
              <div className="shrink-0 px-4 pt-3.5 pb-3 border-b" style={{ borderColor: 'var(--border-light)', background: PANEL_HEADER_BG }}>
                <div className="flex items-start justify-between gap-3">
                  <CapsLabel style={{ color: 'var(--text-muted)' }}>{leftPanelTitle}</CapsLabel>
                  <button type="button" aria-label={`Close ${leftPanelTitle.toLowerCase()}`} onClick={() => setLeftPanel(null)}
                    className="w-7 h-7 -mt-1.5 -mr-1.5 shrink-0 flex items-center justify-center transition-colors text-[var(--text-faint)] hover:text-[var(--text-primary)]"><X size={15} /></button>
                </div>
                {leftPanelBlurb && (
                  <p className="mt-1.5 font-sans text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
                    {leftPanelBlurb}
                  </p>
                )}
              </div>
              <PanelContent panel={leftPanel} {...panelProps} />
            </div>
          )}
        </div>

        {/* Filmstrip — page control, collapses smoothly */}
        <div
          className="col-start-2 min-w-0 overflow-hidden transition-[height] duration-300 ease-out"
          style={{ height: stripVisible ? 92 : 0 }}
        >
          <div className="h-[92px]">
            <Filmstrip
              pageList={r.pageList}
              currentPageId={r.currentPageId}
              compact={false}
              innerRef={stripRef}
              onPrev={r.goPrev}
              onNext={r.goNext}
              onGoTo={r.goToPage}
            />
          </div>
        </div>
      </div>

      {/* ── Mobile / tablet (<lg): stacked panes, filmstrip pinned ───────── */}
      <div className="lg:hidden flex flex-col h-[100dvh]">
        <header
          className="shrink-0 overflow-hidden transition-[height] duration-200 ease-out"
          style={{ background: INK, color: '#fdfcf9', height: barHidden ? 0 : 52 }}
        >
          <div className="flex items-center gap-2.5 h-[52px] px-3">
            {/* Circles-only mark (the wordmark stays a desktop affordance) */}
            <Logo white mini />
            <a
              href={`/book/${r.bookPath}`}
              className="flex-1 min-w-0 no-underline"
              title="Back to the book page"
            >
              {/* Title only: the author lives on the book page, and the phone
                  bar has no room to stack two lines */}
              <div className="font-body text-[15px] truncate" style={{ color: '#fdfcf9' }}>
                {r.book.display_title || r.book.title}
              </div>
            </a>
            <UserMenu variant="hero" />
          </div>
        </header>

        <main
          ref={mobileMainRef}
          key={browserTranslated ? `m-translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="flex-1 min-h-0 overflow-y-auto flex flex-col"
          style={{ overscrollBehavior: 'contain', background: lastSurface }}
          onScroll={onMobileScroll}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {r.views.scan && (
            <section style={{ background: SURFACE.scanBed }}>
              <div className="h-[34px] flex items-center justify-between pl-4 pr-1 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <CapsLabel style={{ color: 'var(--text-muted)' }}>Original scan</CapsLabel>
                <ScanControls
                  zoom={scanZoom}
                  onZoomStep={zoomStep}
                  onZoomReset={() => changeZoom(1)}
                  lensOn={lensOn}
                  onToggleLens={() => setLensOn(v => !v)}
                  onExpand={scan.native ? () => setLightbox(true) : undefined}
                />
              </div>
              {/* Zoom/pan and the lens need the touch stream, so keep those
                  gestures from also turning the page */}
              <div
                className="px-4 py-4"
                style={{ height: 'min(66dvh, 520px)' }}
                onTouchStart={e => { if (scanZoom > 1 || lensOn) e.stopPropagation(); }}
                onTouchMove={e => { if (scanZoom > 1 || lensOn) e.stopPropagation(); }}
                onTouchEnd={e => { if (scanZoom > 1 || lensOn) e.stopPropagation(); }}
              >
                <ScanViewer page={r.currentPage} book={r.book} zoom={scanZoom} onZoomChange={changeZoom} lensOn={lensOn} />
              </div>
            </section>
          )}
          {r.views.ocr && (
            <section data-reader-section="ocr" className="border-t" style={{ background: SURFACE.ocr, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center justify-between px-4 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <CapsLabel style={{ color: 'var(--text-muted)' }}>{r.book.language || 'Original'} · OCR</CapsLabel>
                <div className="flex items-center gap-1">
                  {traceEligible && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)}
                      loading={traceStatus === 'loading'} language={r.book.language} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  <CopyTextButton page={r.currentPage} kind="ocr" />
                </div>
              </div>
              <div data-reader-panel className="px-[22px] pt-4 pb-8">
                <ReaderProse suppressBlockquote={quotesDisagree} page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={15.5} />
              </div>
            </section>
          )}
          {r.views.translit && translitEligible && (
            <section data-reader-section="transliteration" className="border-t" style={{ background: SURFACE.popover, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center justify-between px-4 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <div className="flex items-center gap-2">
                  <CapsLabel style={{ color: 'var(--text-muted)' }}>Romanised</CapsLabel>
                  <AiChip short />
                </div>
                <CopyPlainButton text={translit} label="Copy the transliteration" />
              </div>
              <div data-reader-panel className="px-[22px] pt-4 pb-6">
                <TranslitBody text={translit} loading={translitLoading} error={translitError}
                  settings={r.settings} baseSize={15.5} />
              </div>
            </section>
          )}
          {r.views.en && (
            <section data-reader-section="translation" className="border-t" style={{ background: SURFACE.translation, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center justify-between px-4 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <div className="flex items-center gap-2">
                  <CapsLabel style={{ color: 'var(--text-muted)' }}>English</CapsLabel>
                  <AiChip short />
                </div>
                <div className="flex items-center gap-1">
                  {traceEligible && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)}
                      loading={traceStatus === 'loading'} language={r.book.language} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  <CopyTextButton page={r.currentPage} kind="translation" />
                </div>
              </div>
              <div data-reader-panel className="px-[22px] pt-4 pb-6">
                <ReaderProse suppressBlockquote={quotesDisagree} page={r.currentPage} book={r.book} kind="translation" settings={r.settings} baseSize={16.5} />
              </div>
            </section>
          )}

          {/* Fills whatever is left when the page is short, in the last
              visible pane's colour, so no white band shows above the pager */}
          <div className="flex-1" style={{ background: lastSurface }} />

          {/* End of the scroll: page turn where the reading actually ends
              (swiping left/right anywhere in this scroller does the same).
              The spacer above keeps it flush with the toolbar. */}
          <div
            className="shrink-0 flex items-center justify-between border-t px-2"
            style={{ borderColor: 'var(--border-medium)', background: SURFACE.panel }}
          >
            <button
              type="button"
              onClick={r.goPrev}
              disabled={!prevPage}
              aria-label="Previous page"
              className="min-h-[56px] px-4 flex items-center gap-1.5 font-sans text-[13px] disabled:opacity-30"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={16} /> Previous
            </button>
            {r.currentPage?.page_number != null && (
              <span className="font-sans text-[12.5px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
                p. {r.currentPage.page_number}
              </span>
            )}
            <button
              type="button"
              onClick={r.goNext}
              disabled={!nextPage}
              aria-label="Next page"
              className="min-h-[56px] px-4 flex items-center gap-1.5 font-sans text-[13px] disabled:opacity-30"
              style={{ color: 'var(--accent-rust)' }}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </main>

        {/* Tool panel — rises from the toolbar, clearing the filmstrip. While
            the keyboard is up it sits directly on the keyboard instead (the
            toolbar and strip are behind it), so the field being typed in and
            its results stay on screen. */}
        {leftPanel && !isDesktop && (
          <div
            ref={sheetRef}
            className="fixed left-0 right-0 z-50 border-t flex flex-col rv2-slide-up transition-[height,bottom] duration-200 ease-out"
            style={{
              bottom: keyboardInset > 0
                ? keyboardInset
                : MOBILE_TOOLBAR_H + (stripVisible ? 96 : 0),
              height: sheetHeight ?? undefined,
              maxHeight: keyboardInset > 0 ? '58dvh' : '72dvh',
              background: SURFACE.panel, borderColor: 'var(--border-medium)',
              boxShadow: '0 -24px 48px -28px rgba(30,20,8,0.5)',
            }}
          >
            <div className="shrink-0 px-4 pt-3 pb-2.5 border-b" style={{ borderColor: 'var(--border-light)', background: PANEL_HEADER_BG }}>
              {/* Back out of a tool opened from More. It was a bare chevron the
                  size of an icon; on a phone it needs a label and an edge. */}
              {MORE_TOOLS.some(([k]) => k === leftPanel) && (
                <button
                  type="button"
                  onClick={() => setLeftPanel('more')}
                  className="mb-2 -ml-1 inline-flex items-center gap-1 pl-1 pr-2.5 h-8 border font-sans text-[12px] transition-colors active:bg-[var(--bg-white)]"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                >
                  <ChevronLeft size={15} /> More
                </button>
              )}
              <div className="flex items-start justify-between gap-2">
                <CapsLabel style={{ color: 'var(--text-muted)' }}>{leftPanelTitle}</CapsLabel>
                <button type="button" aria-label={`Close ${leftPanelTitle.toLowerCase()}`} onClick={() => setLeftPanel(null)}
                  className="w-9 h-9 -mt-2 -mr-2 shrink-0 flex items-center justify-center text-[var(--text-muted)]"><X size={16} /></button>
              </div>
              {leftPanelBlurb && (
                <p className="mt-1 font-sans text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
                  {leftPanelBlurb}
                </p>
              )}
            </div>
            <PanelContent panel={leftPanel} {...panelProps} />
          </div>
        )}

        {/* Kept mounted and collapsed by height. Unmounting it meant rebuilding
            a thumbnail for every page in the book on each tap of Pages, which
            is where the delay came from — the toggle now animates instead. */}
        <div
          className="shrink-0 overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: stripVisible && keyboardInset === 0 ? 96 : 0 }}
          aria-hidden={!stripVisible}
        >
          <div className="h-[96px]">
            <Filmstrip
              pageList={r.pageList}
              currentPageId={r.currentPageId}
              compact
              innerRef={stripMobileRef}
              onPrev={r.goPrev}
              onNext={r.goNext}
              onGoTo={r.goToPage}
            />
          </div>
        </div>

        <div className="shrink-0">
          <MobileToolbar
            panel={leftPanel}
            onTogglePanel={togglePanel}
            stripVisible={stripVisible}
            onToggleStrip={toggleStrip}
          />
        </div>
      </div>

      {/* Trace mode: transcription↔translation span highlighting (#3091) */}
      <TraceAlignment
        bookId={r.book.id}
        pageId={r.currentPageId}
        active={traceActive}
        onStatusChange={setTraceStatus}
      />

      {lightbox && (
        <ScanLightbox
          page={r.currentPage}
          book={r.book}
          onClose={() => setLightbox(false)}
          onPrev={r.goPrev}
          onNext={r.goNext}
          hasPrev={!!prevPage}
          hasNext={!!nextPage}
        />
      )}
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
            className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-warm)] border-b transition-colors"
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
