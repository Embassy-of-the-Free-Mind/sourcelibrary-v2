'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { localeHref, useLocale } from '@/lib/i18n';
import { getReaderStrings, type ReaderStrings } from '@/lib/reader-strings';
import { useSession, signOut } from 'next-auth/react';
import Logo from '@/components/layout/Logo';
import { AuthCheck } from '@/components/auth/AuthCheck';
import DownloadButton from '@/components/ui/DownloadButton';
import { FeedbackPanel } from './FeedbackPanel';
import PageDeepZoomButton from '@/components/reader/PageDeepZoomButton';
import type { DeepZoomManifest } from '@/lib/types/book';
import { useBrowserTranslation } from '@/hooks/useBrowserTranslation';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { useEmbedHref } from '@/lib/EmbedContext';
import { getPageThumbUrl } from '@/lib/utils';
import { pages as pagesApi, books as booksApi, analytics } from '@/lib/api-client';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import NotesRenderer from '@/components/reader/NotesRenderer';
import type { Book, Page } from '@/lib/types';
import { resolveHoldingCopy } from '@/lib/holding-library';
import type { ReaderSettings } from './useReaderV2';
import {
  ChevronLeft, ChevronRight, ChevronRight as ChevronRightSmall,
  List, Search, Quote, Pencil, Check, X, Loader2, GalleryHorizontal,
  ZoomIn, ZoomOut, ScanSearch, Heart, Share2, BookOpen, MessageCircle,
  Info, Bell, MoreHorizontal, Link as LinkIcon, Columns3, Copy, Maximize2, Download, Menu, LogOut, LifeBuoy, MessageSquare, User,
  History, Settings2,
} from 'lucide-react';
import { trackEvent } from '@/lib/track-event';
import TraceAlignment, { type TraceStatus } from '@/components/reader/TraceAlignment';
import { hasNonLatinScript } from '@/lib/non-latin-scripts';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import { useReaderV2 } from './useReaderV2';
import ReaderSettingsControls, { SettingsSwitch } from './ReaderSettingsControls';
import RevisionHistoryPanel from './RevisionHistoryPanel';
import SavePanel from './SavePanel';
import PinnedVersionBanner from './PinnedVersion';
import { spanishEligible, SpanishProse, TranslationLanguageHeader, CopySpanishButton } from './ReaderSpanishToggle';
import { usePairedEdition, PairedBadgeRow, PairedTranscriptionProse, PairedTranslationProse } from './PairedEdition';
import {
  CapsLabel, AiChip, CorpusChip, WitnessCaption, ReaderProse, ScanViewer, SCAN_ZOOM_STEPS, SCAN_ZOOM_MAX,
  resolveScanUrls, ViewToggleGroup, onInk, hasBlockquote, BAR_CONTROL, barControlStyle, useDialogFocus,
  SURFACE, themeAttr, bookByline,
} from './ReaderV2Bits';
import { pageTextCorpus, translationCorpus } from '@/lib/text-provenance';
import type { CdliWitness } from '@/lib/types/book';

// ─── Variant 2c: "Study Desk" ────────────────────────────────────────────────
// The scholarly reader: scan, OCR and translation side by side, a left tool
// rail whose panels (Contents / Search / Settings) slide out beside it, and a
// filmstrip as the single page control. One full-width top bar carries the
// identity, view toggles, actions and edit mode. The page itself never
// scrolls. Design handoff: design_handoff_reader_page/README.md § 2c.

const INK = 'var(--bg-dark)';
/** Height of the floating mobile title bar, and of the lead-in the column
 *  keeps for it. One number: the bar covers the top of the column, so
 *  anything that scrolls a pane to the top has to clear it. */
const BAR_H = 52;
/** How long a scroll up has to have been meant before the bar comes back. */
const BAR_SHOW_DELAY_MS = 280;
const STRIP_KEY = 'sl-reader-v2c-strip';
/** Mobile toolbar height — one row of four tools. */
const MOBILE_TOOLBAR_H = 52;
/** Breathing room kept above a mobile sheet, so it never meets the top edge. */
const SHEET_TOP_GAP = 24;
/** How far the sheet has to be pulled down before letting go puts it away. */
const SHEET_DISMISS_PULL = 90;
/** Drawer header tint — a shade deeper than the panel, so content passes under it. */
const PANEL_HEADER_BG = 'color-mix(in srgb, var(--bg-warm) 92%, var(--bg-dark) 5%)';
/** Mobile sheets that always take the full height — lists and conversations. */
const SHEET_FILLS = new Set<Exclude<LeftPanel, null>>(['contents', 'search', 'guide', 'librarian']);

type LeftPanel = 'contents' | 'search' | 'guide' | 'librarian' | 'info' | 'cite' | 'share' | 'settings' | 'views' | 'downloads' | 'history' | 'save' | 'feedback' | 'more' | null;

/**
 * Drawer titles and the one line under each — saying what the tool actually
 * reads, so a reader knows whether it is the book's own words or ours before
 * they trust it — both live in the string catalogue, keyed by panel:
 * `t.panels.titles[panel]` and `t.panels.blurbs[panel]` (the blurb map is
 * deliberately partial — Save, Menu and More explain themselves).
 */
function panelBlurb(t: ReaderStrings, panel: Exclude<LeftPanel, null>): string | undefined {
  return (t.panels.blurbs as Record<string, string | undefined>)[panel];
}

/**
 * The tools that live behind "More" on mobile, in the order they're offered:
 * the same three groups as the desktop rail, in the same order — find your way
 * through the book, ask something of it, then do something with this page.
 * Views, Pages, Share and Save are not here: they hold toolbar slots. Nor is
 * the site menu, which is about leaving this book rather than reading it and
 * opens full-screen from the bar instead. Labels come from `t.moreMenu`,
 * which is keyed by exactly these names.
 */
// The More sheet, grouped the way a reader thinks (#4385 follow-up: it was a
// flat ten-row wall with citation first): ways INTO the text, then things
// about THIS page, then the reader itself. Feedback sits last, in rust, as
// the one row that talks back to us.
const MORE_GROUPS = [
  { key: 'groupRead', tools: ['contents', 'guide', 'search', 'librarian'] },
  { key: 'groupPage', tools: ['cite', 'downloads', 'info', 'history'] },
  { key: 'groupReader', tools: ['settings', 'feedback'] },
] as const;
const MORE_TOOLS = [
  'contents', 'guide', 'search', 'librarian',
  'cite', 'downloads', 'info', 'history',
  'settings', 'feedback',
] as const;
const MORE_ICONS: Record<(typeof MORE_TOOLS)[number], typeof List> = {
  contents: List, guide: BookOpen, search: Search, librarian: MessageCircle,
  cite: Quote, downloads: Download, info: Info, history: History,
  settings: Settings2, feedback: MessageSquare,
};

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
  const t = getReaderStrings(useLocale()).toolbar;
  // Four slots. Pages, the pane picker and Search are what a reader reaches
  // for constantly; everything else — contents, the librarian, settings, the
  // guide — is one tap behind More, so nothing here competes for the thumb.
  const tools: Array<[Exclude<LeftPanel, null>, string, React.ReactNode]> = [
    ['views', t.views, <Columns3 key="i" size={19} />],
    ['share', t.share, <Share2 key="i" size={19} />],
    ['save', t.save, <Heart key="i" size={19} />],
  ];
  return (
    <div
      className="flex items-center w-full"
      style={{ background: INK, borderTop: `1px solid ${onInk(0.12)}`, height: MOBILE_TOOLBAR_H }}
      role="toolbar"
      aria-label={t.readerToolsAria}
    >
      <ToolButton
        label={t.pages}
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
        label={t.more}
        icon={<MoreHorizontal size={19} />}
        active={panel === 'more' || MORE_TOOLS.some(k => k === panel)}
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
  const [requestFailed, setRequestFailed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [openSection, setOpenSection] = useState<number | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const t = getReaderStrings(useLocale()).guide;

  // Requests ride the same queue as every other reader request (translation,
  // corrections): the feedback collection, which is triaged into issues.
  const requestGuide = async () => {
    setRequesting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Reading guide requested for "${bookTitle}" (book ${bookId})`,
          page: `/book/${bookPath}`,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setRequested(true);
    } catch {
      // Telling a reader "thanks, we'll prioritise this" when the POST failed
      // means the request was never queued and nobody will ever know.
      setRequestFailed(true);
    }
    setRequesting(false);
  };

  useEffect(() => {
    let cancelled = false;
    booksApi.get(bookId, { pages: 'nav' }).then((b) => {
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
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-6" style={{ overscrollBehavior: 'contain' }}>
        <p className="font-sans text-[13px] leading-relaxed mb-4" style={{ color: 'var(--text-primary)' }}>
          {t.noGuideYet}
        </p>
        {requested ? (
          <p className="font-sans text-[13px]" style={{ color: 'var(--accent-sage-dark)' }} role="status">
            {t.requestGuideThanks}
          </p>
        ) : (
          <button
            type="button"
            onClick={requestGuide}
            disabled={requesting}
            className={`${PANEL_BTN} disabled:opacity-60`}
            style={PANEL_BTN_STYLE}
          >
            {requesting ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />}
            {t.requestGuide}
          </button>
        )}
        {requestFailed && (
          <p className="font-sans text-[12.5px] mt-2" style={{ color: 'var(--status-error)' }} role="alert">
            {t.requestFailed}
          </p>
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
              {overviewOpen ? t.showLess : t.readFullOverview(overviewParas.length - 1)}
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
          <CapsLabel className="block mb-2" style={{ color: 'var(--text-faint)' }}>{t.sections}</CapsLabel>
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
                  {/* Bounded box, true proportions, no crop — a wide manuscript
                      would otherwise show a blank sliver of leaf. */}
                  <span
                    className="shrink-0 w-[46px] flex items-start justify-center"
                  >
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" decoding="async"
                        className="max-w-[46px] max-h-[62px] w-auto h-auto object-contain border"
                        style={{ borderColor: 'var(--border-light)', background: 'var(--bg-white)' }} />
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
                      className={`mt-3 ${PANEL_BTN}`}
                      style={PANEL_BTN_STYLE}
                    >
                      {t.readThisSection}
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
 * Share. Copy a link, or post it.
 * Sharing only. Saving moved to its own panel, so this one is links and
 * posts; the share targets mirror the site's ShareButton, so a post from the
 * reader looks like a post from anywhere else and reports the same `share`
 * analytics event.
 */
function SharePanel({ page, book, url }: { page: Page; book: Book; url: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const t = getReaderStrings(useLocale()).share;

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

  // [analytics channel, visible label, href]. The channel is a fixed English
  // key so the `share` event means the same thing on every locale; only the
  // label follows the reader, and only one of these is a word rather than a
  // brand name.
  const targets: Array<[string, string, string]> = [
    // Email first: it is how a page from a library actually gets sent to a
    // colleague. X was first only because it happened to be written first.
    ['email', t.email, `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${citation}\n\n${url}`)}`],
    ['whatsapp', 'WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${citation}\n${url}`)}`],
    ['bluesky', 'Bluesky', `https://bsky.app/intent/compose?text=${encodeURIComponent(`${citation}\n\n${url}`)}`],
    ['linkedin', 'LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`],
    ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`],
    ['x', 'X', `https://twitter.com/intent/tweet?text=${encodeURIComponent(citation)}&url=${encodeURIComponent(url)}`],
  ];

  const rowCls = PANEL_ROW;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-4" style={{ overscrollBehavior: 'contain' }}>

      <button type="button" onClick={() => copy('link', url)} className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          <LinkIcon size={16} style={{ color: 'var(--text-muted)' }} />
          {t.copyLink}
        </span>
        {copied === 'link' && <Check size={14} style={{ color: 'var(--accent-rust)' }} />}
      </button>

      <button type="button" onClick={() => copy('ref', `${citation}. ${url}`)} className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          <Quote size={16} style={{ color: 'var(--text-muted)' }} />
          {t.copyLinkWithReference}
        </span>
        {copied === 'ref' && <Check size={14} style={{ color: 'var(--accent-rust)' }} />}
      </button>

      <CapsLabel className="block px-4 pt-4 pb-2" style={{ color: 'var(--text-faint)' }}>{t.postTo}</CapsLabel>
      <div className="grid grid-cols-2 gap-1.5 px-4">
        {targets.map(([channel, label, href]) => (
          <button
            key={channel}
            type="button"
            onClick={() => open(href, channel)}
            className="min-h-[44px] px-3 border font-sans text-[13px] text-left transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            {label}
          </button>
        ))}
      </div>
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
  const t = getReaderStrings(useLocale()).downloads;
  const [full, setFull] = useState<Record<string, unknown> | null>(null);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const scanUrl = resolveScanUrls(page).native;

  // The reader's nav projection carries no counts or licence, so the flags the
  // download gates need come from the full record, same as the Info panel.
  useEffect(() => {
    let cancelled = false;
    booksApi.get(book.id, { pages: 'nav' })
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

  const rowCls = PANEL_ROW;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
      <CapsLabel className="block px-4 pb-2" style={{ color: 'var(--text-faint)' }}>{t.thisPage}</CapsLabel>
      {scanUrl ? (
        <a href={scanUrl} download="" className={rowCls} style={{ borderColor: 'var(--border-light)' }}>
          <span className="min-w-0">
            <span className="block font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
              {t.scanOfPage(page.page_number)}
            </span>
            <span className="block font-sans text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
              {t.scanFormatNote}
            </span>
          </span>
          <Download size={16} style={{ color: 'var(--text-muted)' }} />
        </a>
      ) : (
        <p className="px-4 pb-3 font-sans text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          {t.noScanArchived}
        </p>
      )}

      {/* The page as a whole, rather than one file from it. */}
      <button
        type="button"
        onClick={async () => {
          setPkgError(null);
          setPkgBusy(true);
          try {
            const res = await fetch(`/api/books/${book.id}/pages/${page.id}/package`);
            if (!res.ok) {
              const body = await res.json().catch(() => null);
              setPkgError(res.status === 429
                ? (body?.error || t.dailyLimitReached)
                : res.status === 401
                  ? t.signInToDownload
                  : t.downloadFailed);
              return;
            }
            const blob = await res.blob();
            const name = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
              || `page-${page.page_number}.zip`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            a.remove(); URL.revokeObjectURL(url);
          } catch {
            setPkgError(t.downloadFailed);
          } finally {
            setPkgBusy(false);
          }
        }}
        disabled={pkgBusy}
        className={rowCls}
        style={{ borderColor: 'var(--border-light)' }}
      >
        <span className="min-w-0 text-left">
          <span className="block font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
            {t.thisPageComplete}
          </span>
          <span className="block font-sans text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            {pkgError || t.thisPageCompleteNote}
          </span>
        </span>
        {pkgBusy
          ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          : <Download size={16} style={{ color: 'var(--text-muted)' }} />}
      </button>

      <CapsLabel className="block px-4 pt-5 pb-2" style={{ color: 'var(--text-faint)' }}>{t.wholeBook}</CapsLabel>
      {full ? (
        <div>
          <DownloadButton
            inline
            bookId={book.id}
            bookTitle={book.display_title || book.title}
            hasTranslations={hasTranslations}
            hasOcr={hasOcr}
            hasImages={pagesCount > 0}
            imageRestricted={imageAccess === 'blocked'}
            imageAccess={imageAccess}
          />
        </div>
      ) : (
        <div className="px-4 py-2"><Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      )}
    </div>
  );
}


/**
 * Marks and scrolls to the term you searched for when you arrive from a
 * search result (?highlight=). Reads the query string, so it needs Suspense.
 */
function SearchHighlighter() {
  useSearchHighlight({ delay: 800 });
  return null;
}


/**
 * The way out of the book: everywhere else in Source Library, plus the
 * account, support and feedback.
 *
 * Two shapes, one component. On a phone it takes the whole screen, because
 * there is no room to show a menu and the page at once and full-screen says
 * plainly that this is about leaving. On a desktop the bar is right there
 * above it, so it is a panel hanging off the hamburger and the reader stays
 * visible behind it. It is the only menu on the reader either way, which is
 * why the desktop bar has a hamburger where the avatar used to be.
 *
 * It is set in the SITE's surface rather than the reader's ink. Everything
 * dark on this page is the book; the moment you are looking at the library
 * instead, the ground should be the library's. The tokens are the reader's
 * own, so a night-mode reader gets a dark menu without a cream flash. The
 * phone's own header stays ink, so opening the menu does not flash the one
 * dark band on the screen to cream and back.
 *
 * The full-screen shape is pinned to `100svh`, not `100vh`, so a phone's
 * collapsing address bar cannot push the last row under the fold, and only
 * the middle column scrolls.
 */
function ReaderSiteMenu({ onClose, spanishAvailable }: {
  onClose: () => void;
  /** Whether THIS page has Spanish text, not merely a Spanish interface. */
  spanishAvailable: boolean;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const strings = getReaderStrings(useLocale());
  const t = strings.accountMenu;
  const isSpanishSite = !!pathname?.startsWith('/es');
  const signedIn = !!session?.user;
  const [imgError, setImgError] = useState(false);

  // Escape, focus trap and focus return all live in useDialogFocus.
  const menuRef = useRef<HTMLDivElement>(null);
  useDialogFocus(menuRef, onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const destinations: Array<[string, string]> = [
    [t.collections, '/collections'],
    [t.gallery, '/gallery'],
    [t.browse, '/browse'],
    [t.catalogue, '/catalog'],
    [t.works, '/works'],
    [t.explore, '/explore'],
    [t.librarian, '/librarian'],
  ];

  // Every link is written through localeHref, so the menu keeps you on the
  // language you are reading in. Hard-coding '/collections' here is how a
  // Spanish reader gets silently dropped back onto the English site.
  const href = (path: string) => localeHref(isSpanishSite ? 'es' : 'en', path);

  const initials = session?.user?.name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    || session?.user?.email?.[0]?.toUpperCase() || '?';

  // py-2.5 rather than leading-none alone: these were 13px-tall touch targets.
  const minorLink = 'no-underline font-sans text-[12.5px] leading-none py-2.5 transition-colors hover:text-[var(--text-primary)]';

  return (
    <>
      {/* Desktop only: the reader is still there behind the panel, so a click
          anywhere on it closes rather than doing something to the page. */}
      <div
        className="hidden lg:block fixed inset-0 z-[69]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={menuRef}
        className={'rv2-menu-ground z-[70] flex flex-col overflow-hidden fixed inset-0 h-[100svh] '
          + 'lg:inset-auto lg:h-auto lg:top-[62px] lg:right-3 lg:w-[380px] lg:max-h-[calc(100svh-74px)] '
          + 'lg:border lg:shadow-[0_18px_48px_-16px_rgba(20,16,12,0.55)]'}
        style={{
          background: 'var(--bg-cream)',
          color: 'var(--text-primary)',
          borderColor: 'var(--border-medium)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t.library}
      >
        {/* Phone header only. It stays ink so the bar it replaces does not
            flash from dark to cream while the menu opens; on desktop the real
            bar is untouched above the panel and this would duplicate it. */}
        <div
          className="lg:hidden shrink-0 flex items-center justify-between h-[52px] pl-3 pr-1.5"
          style={{ background: INK, color: '#fdfcf9' }}
        >
          <Logo white compact alwaysWordmark />
          <button
            type="button"
            onClick={onClose}
            aria-label={strings.toolbar.close}
            className="w-10 h-10 flex items-center justify-center transition-colors hover:bg-[rgba(253,252,249,0.12)]"
            style={{ color: onInk(0.85) }}
          >
            <X size={20} />
          </button>
        </div>

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
        <div className="w-full max-w-[44rem] mx-auto px-5 lg:px-5 pt-6 lg:pt-5 pb-10 lg:pb-6">
          <CapsLabel className="block pb-1" style={{ color: 'var(--text-faint)' }}>{t.library}</CapsLabel>
          {/* Two columns above sm. Hairlines rather than gaps, which is how
              every other list on the site separates its rows. */}
          <nav className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-1">
            {destinations.map(([label, path], i) => (
              <Link
                key={path}
                href={href(path)}
                onClick={onClose}
                className="rv2-menu-item no-underline font-body text-[19px] lg:text-[21px] leading-none py-3.5 transition-colors hover:text-[var(--accent-rust)]"
                style={{
                  color: 'var(--text-primary)',
                  borderBottom: '1px solid var(--border-light)',
                  animationDelay: `${50 + i * 26}ms`,
                }}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* The account is one row with a face on it, not a sub-menu. The
              three pages behind it (saved, history, settings) are the account
              page's own business and were only listed here because this used
              to be the account dropdown. */}
          <div className="rv2-menu-item pt-7" style={{ animationDelay: '250ms' }}>
            <CapsLabel className="block pb-2.5" style={{ color: 'var(--text-faint)' }}>{t.you}</CapsLabel>
            <Link
              href={href(signedIn ? '/account' : '/auth/signin')}
              onClick={onClose}
              className="no-underline flex items-center gap-3 p-2.5 border transition-colors hover:bg-[var(--bg-white)]"
              style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
            >
              {signedIn && session?.user?.image && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt=""
                  className="w-10 h-10 rounded-full border-2 shrink-0"
                  style={{ borderColor: 'var(--border-light)' }}
                  onError={() => setImgError(true)}
                />
              ) : (
                <span
                  className="w-10 h-10 rounded-full border-2 shrink-0 flex items-center justify-center font-sans text-[13px] font-medium"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--bg-cream)', color: 'var(--text-secondary)' }}
                >
                  {signedIn ? initials : <User size={17} />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-body text-[16px] leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                  {signedIn ? (session?.user?.name || session?.user?.email) : t.signIn}
                </span>
                <span className="block font-sans text-[12px] leading-tight pt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>
                  {signedIn ? t.yourAccount : t.savedPages}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-faint)' }} />
            </Link>

            {/* Support, feedback and sign-out on one line: three small errands
                that do not each deserve a row of their own. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3.5" style={{ color: 'var(--text-secondary)' }}>
              <Link href={href('/support')} onClick={onClose} className={`${minorLink} flex items-center gap-1.5`} style={{ color: 'var(--text-secondary)' }}>
                <LifeBuoy size={13} />{t.supportSourceLibrary}
              </Link>
              <Link href={href('/feedback')} onClick={onClose} className={`${minorLink} flex items-center gap-1.5`} style={{ color: 'var(--text-secondary)' }}>
                <MessageSquare size={13} />{t.sendFeedback}
              </Link>
              {signedIn && (
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className={`${minorLink} flex items-center gap-1.5`}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <LogOut size={13} />{t.signOut}
                </button>
              )}
            </div>
          </div>

          {/* Offered only where this page actually exists in Spanish.
              "If it isn't Spanish, it's not /es" is the site's rule, and it is
              the right one: a Spanish URL wrapping English text is a duplicate
              of the English page for a crawler and a broken promise for a
              reader. Hiding the control is what makes the rule painless —
              nothing bounces, because nothing is offered that cannot be kept.
              109 books of 22,073 have Spanish text today; the control appears
              on those, and on the rest the site stays in one language. */}
          {(spanishAvailable || isSpanishSite) && (
          <div className="rv2-menu-item pt-7" style={{ animationDelay: '290ms' }}>
            <CapsLabel className="block pb-2.5" style={{ color: 'var(--text-faint)' }}>{t.siteLanguage}</CapsLabel>
            <div className="flex gap-2">
              {([['English', localeHref('en', pathname)], ['Español', localeHref('es', pathname)]] as Array<[string, string]>).map(([label, target]) => {
                const active = (label === 'Español') === isSpanishSite;
                return (
                  <Link
                    key={target}
                    href={target}
                    onClick={onClose}
                    className="h-9 px-5 flex items-center justify-center border font-sans text-[12.5px] no-underline transition-colors"
                    style={active
                      ? { background: 'var(--text-primary)', color: 'var(--bg-cream)', borderColor: 'var(--text-primary)' }
                      : { borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

/** Copy an already-plain string, for panes whose text needs no unwrapping. */
function CopyPlainButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const t = getReaderStrings(useLocale()).panes;
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
      title={copied ? t.copied : label}
      className={PANE_ICON_CHIP}
      style={{ color: copied ? 'var(--accent-sage-dark)' : 'var(--text-faint)' }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}


/**
 * How long romanising takes, drawn honestly.
 *
 * Measured over cold calls across seven scripts: duration tracks OCR length
 * almost linearly (r = 0.985) at roughly twelve seconds plus 5.6 seconds per
 * thousand characters — 4s for a short page, over two minutes for a dense one.
 * So the ring is an ESTIMATE, not progress: it fills toward 90% and waits
 * there rather than promising a finish it cannot know. The elapsed count is
 * the honest number, and it keeps running past the estimate.
 */
function TranslitProgress({ ocrLength }: { ocrLength: number }) {
  const t = getReaderStrings(useLocale()).panes;
  const estimateMs = Math.max(5000, 12000 + 5.6 * ocrLength);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const t = window.setInterval(() => setElapsed(performance.now() - started), 200);
    return () => window.clearInterval(t);
  }, []);

  const pct = Math.min(0.9, elapsed / estimateMs);
  const R = 13;
  const C = 2 * Math.PI * R;
  const overrun = elapsed > estimateMs;

  return (
    <div className="flex items-start gap-3">
      <svg width="32" height="32" viewBox="0 0 32 32" className="shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="16" cy="16" r={R} fill="none" strokeWidth="2.5" style={{ stroke: 'var(--border-light)' }} />
        <circle
          cx="16" cy="16" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
          style={{
            stroke: 'var(--accent-gold-dark)',
            strokeDasharray: C,
            strokeDashoffset: C * (1 - pct),
            transition: 'stroke-dashoffset 200ms linear',
          }}
        />
      </svg>
      <span className="min-w-0">
        {/* Only the label is live. The counter beside it changes five times a
            second for up to two minutes, and the whole block used to sit
            inside one polite region — about six hundred interruptions per
            page, which makes a screen reader unusable for exactly as long as
            the reader is waiting. The seconds are for eyes; the announcement
            is "Romanising", once. */}
        <span className="block font-sans text-[13px]" style={{ color: 'var(--text-secondary)' }} role="status" aria-live="polite">
          {t.romanising}
        </span>
        <span
          className="block font-sans text-[11.5px] tabular-nums"
          style={{ color: 'var(--text-faint)' }}
          aria-hidden="true"
        >
          {Math.round(elapsed / 1000)}s
          {' · '}
          {overrun
            ? t.romanisingLonger
            : t.romanisingEstimate(Math.round(estimateMs / 1000))}
        </span>
      </span>
    </div>
  );
}

/**
 * Romanised transcription. Sits between the original script and the English:
 * it is the same words as the transcription, in letters a reader can sound
 * out, which is what makes it useful to read alongside rather than instead.
 */
function TranslitBody({ text, loading, error, settings, baseSize, ocrLength }: {
  text: string; loading: boolean; error: boolean;
  settings: ReaderSettings; baseSize: number;
  /** Drives the wait estimate — the call scales with how much text there is. */
  ocrLength: number;
}) {
  const t = getReaderStrings(useLocale()).panes;
  if (loading) return <TranslitProgress ocrLength={ocrLength} />;
  if (error) {
    return (
      <p className="font-sans text-[13px]" style={{ color: 'var(--status-error)' }} role="alert">
        {t.translitFailed}
      </p>
    );
  }
  if (!text) {
    return (
      <p className="font-sans text-[13px] italic" style={{ color: 'var(--text-faint)' }}>
        {t.translitNone}
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
      }}
    >
      {/* Through the same renderer as the other panes: the romanisation comes
          back carrying the transcription's editorial tags (<unclear>, page
          numbers), which read as markup if you print the string raw. */}
      <NotesRenderer
        text={text}
        showMetadata={false}
        showNotes={settings.glosses}
        language="Transliteration"
      />
    </div>
  );
}

/** What each coloured mark in the text means — the colours here, the words in
 *  the string catalogue under the matching `mark*` keys. */
const MARK_LEGEND: Array<{
  label: 'markGlossOrTerm' | 'markOnThePage' | 'markOurNote';
  desc: 'markGlossOrTermDesc' | 'markOnThePageDesc' | 'markOurNoteDesc';
  fg: string;
  bg: string;
}> = [
  {
    label: 'markGlossOrTerm', desc: 'markGlossOrTermDesc',
    // The -dark variant, like every other swatch here. The raw hue is the
    // only one never lightened for night, where it measured 3.00:1.
    fg: 'var(--accent-violet-dark)', bg: 'color-mix(in srgb, var(--accent-violet-dark) 10%, transparent)',
  },
  {
    label: 'markOnThePage', desc: 'markOnThePageDesc',
    fg: 'var(--accent-sage-dark)', bg: 'color-mix(in srgb, var(--accent-sage) 14%, transparent)',
  },
  {
    label: 'markOurNote', desc: 'markOurNoteDesc',
    fg: 'var(--accent-gold-dark)', bg: 'color-mix(in srgb, var(--accent-gold) 16%, transparent)',
  },
];

/**
 * The key to the marks, opened from the control that turns them on. It lived
 * in Edition & page info, which is nowhere near the thing it explains — a
 * reader looking at a violet phrase does not go hunting through panels.
 */
function MarksKey() {
  const [open, setOpen] = useState(false);
  const t = getReaderStrings(useLocale()).panes;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={t.marksMeaning}
        title={t.marksMeaningShort}
        className={PANE_ICON_CHIP}
        style={{ color: 'var(--accent-gold-dark)' }}
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-[264px] border z-50 p-3 rv2-pop"
          style={{
            background: SURFACE.popover, borderColor: 'var(--border-medium)',
            boxShadow: '0 28px 60px -18px rgba(30,20,8,0.45)',
          }}
          role="dialog"
          aria-label={t.marksMeaningShort}
        >
          <CapsLabel className="block mb-2" style={{ color: 'var(--text-faint)' }}>{t.marksInText}</CapsLabel>
          <dl className="flex flex-col gap-2">
            {MARK_LEGEND.map(mark => (
              <div key={mark.label}>
                <dt>
                  <span className="font-sans text-[11.5px] px-1.5 py-0.5" style={{ color: mark.fg, background: mark.bg }}>{t[mark.label]}</span>
                </dt>
                <dd className="mt-1 font-sans text-[11.5px] leading-snug" style={{ color: 'var(--text-muted)' }}>{t[mark.desc]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 pt-2 border-t font-sans text-[11px]" style={{ borderColor: 'var(--border-light)', color: 'var(--text-faint)' }}>
            {t.marksHiddenByNotes}
          </p>
        </div>
      )}
    </div>
  );
}

/** Pane-level Notes toggle — inline editorial notes/glosses apply per text pane. */
function NotesToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const t = getReaderStrings(useLocale()).panes;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={PANE_CHIP}
      style={{
        // Wears the notes' own colour (NOTE_TAG_STYLES.note is
        // bg-accent-gold/15 + text-accent-gold-dark), so the control and the
        // thing it controls read as the same object.
        color: on ? 'var(--accent-gold-dark)' : 'var(--text-faint)',
        background: on ? 'color-mix(in srgb, var(--accent-gold) 15%, transparent)' : 'transparent',
        borderColor: on ? 'color-mix(in srgb, var(--accent-gold) 45%, transparent)' : 'transparent',
      }}
      title={on ? t.hideNotes : t.showNotes}
    >
      {t.notes}
    </button>
  );
}

/**
 * Two shapes for everything inside a drawer, so a panel reads as one list and
 * one kind of button rather than six near-misses.
 *
 * PANEL_ROW  — a full-width row in a list (More, Save & share, Download, Views).
 * PANEL_BTN  — a discrete action (copy a citation, read a section, ask a question).
 */
const PANEL_ROW = 'w-full text-left px-4 min-h-[56px] py-2.5 flex items-center justify-between gap-3 border-b transition-colors hover:bg-[var(--bg-white)]';
const PANEL_BTN = 'inline-flex items-center gap-2 h-9 px-3 border font-sans text-[12.5px] transition-opacity hover:opacity-85';
/** Filled, like a selected chip in Reading settings — a panel action is a
 *  positive act, and an outlined button in a panel of outlined rows vanished. */
const PANEL_BTN_STYLE = {
  background: 'var(--text-primary)',
  color: 'var(--bg-cream)',
  borderColor: 'var(--text-primary)',
} as const;

/** The trace colour, shared by the toggle, its status line and its highlight. */
// Themed, not a literal: a single hex cannot clear light, sepia and night,
// because night flips which direction more contrast points. Measured.
const TRACE_BLUE = 'var(--trace-blue)';
/** Set once the reader has traced something, so the hint stops repeating. */
const TRACE_LEARNED_KEY = 'sl-reader-v2-traced';

/**
 * Every control in a pane header is the same object: same height, same border
 * box, same hover. Only the colour changes with what the control does. The
 * scan's zoom and lens were bare icons next to bordered chips, which read as
 * two different kinds of thing sitting in the same row.
 */
const PANE_CHIP = 'h-[26px] px-2 flex items-center gap-1 border font-sans text-[11px] font-medium uppercase tracking-[0.1em] transition-colors';
const PANE_ICON_CHIP = 'h-[26px] w-[28px] flex items-center justify-center transition-colors hover:bg-black/[0.05]';

/** What tracing is doing right now, said plainly under the pane header. */
function TraceStatusLine({ status, showHint }: { status: TraceStatus; showHint: boolean }) {
  const t = getReaderStrings(useLocale()).panes;
  // The "click any phrase" hint is teaching, not status: it shows until the
  // reader has actually traced something once, then never again on this
  // device. The other three are conditions they may need to act on.
  const text = status === 'loading'
    ? t.traceAligning
    : status === 'unavailable'
      ? t.traceUnavailable
      : status === 'rate_limited'
        ? t.traceRateLimited
        : status === 'ready' && showHint
          ? t.traceClickHint
          : null;
  if (!text) return null;
  return (
    // Absolutely placed: as a block element it pushed the whole page of text
    // down when it appeared and back up when it went, which on a facsimile is
    // the text moving under your eye for a status message.
    <div
      className="absolute left-0 right-0 top-0 z-20 px-4 py-1.5 flex items-center gap-2 border-b font-sans text-[11.5px] rv2-pop"
      style={{
        borderColor: 'var(--border-light)',
        background: 'color-mix(in srgb, #4a6fa5 10%, var(--bg-cream))',
        color: TRACE_BLUE,
      }}
      role="status"
    >
      {status === 'loading' && <Loader2 size={12} className="animate-spin" />}
      {text}
    </div>
  );
}

/**
 * Trace: click a phrase in one pane to light up the span it came from in the
 * other. Same shape as the Notes toggle it sits beside, because they are the
 * same kind of thing — a way of reading, switched on for as long as you want it.
 */
function TraceToggle({ on, onToggle, language, disabledReason }: {
  on: boolean; onToggle: () => void; language?: string;
  /**
   * Shown instead of the hint when the control cannot work here. The chip
   * stays rendered: it used to vanish on switching to Spanish, which reads as
   * the feature breaking rather than as it not applying.
   */
  disabledReason?: string;
}) {
  const t = getReaderStrings(useLocale()).panes;
  const disabled = !!disabledReason;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      disabled={disabled}
      className={`${PANE_CHIP} disabled:cursor-default disabled:opacity-45`}
      style={{
        // The colour of the highlight it paints. It was gold, which is the
        // editorial-note colour — so Trace and Notes were the same chip, and a
        // traced span looked like an annotation.
        color: on ? TRACE_BLUE : 'var(--text-faint)',
        background: on ? 'rgba(74, 111, 165, 0.12)' : 'transparent',
        borderColor: on ? 'rgba(74, 111, 165, 0.45)' : 'transparent',
      }}
      title={disabledReason
        ?? (on ? t.turnTracingOff : t.traceHint(language || t.traceFallbackLanguage))}
    >
      {t.trace}
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
  const t = getReaderStrings(useLocale()).panes;
  const text = (kind === 'ocr' ? page.ocr?.data : page.translation?.data) || '';
  if (!text) return null;
  const label = kind === 'ocr' ? t.copyTranscription : t.copyTranslation;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(stripEditorialWrappers(text).trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={label}
      title={copied ? t.copied : label}
      className={PANE_ICON_CHIP}
      style={{ color: copied ? 'var(--accent-sage-dark)' : 'var(--text-faint)' }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
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
/**
 * Everything this panel can answer from what the reader already has is drawn
 * at once. The fetch only adds the imprint, format, page count and USTC id, so
 * it fills in behind an already-readable panel rather than holding the whole
 * thing behind a spinner while it waits.
 */
function InfoPanel({ page, book }: { page: Page; book: Book }) {
  const t = getReaderStrings(useLocale()).info;
  const [fullBook, setFullBook] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    booksApi.get(book.id, { pages: 'nav' })
      .then(b => { if (!cancelled) setFullBook(b as unknown as Record<string, unknown>); })
      .catch(() => { /* fall back to nav fields */ });
    return () => { cancelled = true; };
  }, [book.id]);

  const summary = extractPageSummary(page);
  const b = { ...(fullBook || {}), ...book } as Record<string, unknown>;
  // `isTitle` rather than a label comparison: the label is translated, so
  // matching on the word would set the wrong row in italics on /es.
  const rows: Array<{ label: string; value: string | undefined; isTitle?: boolean }> = [
    { label: t.fieldTitle, value: b.title as string, isTitle: true },
    { label: t.fieldEnglish, value: (b.display_title as string) !== (b.title as string) ? (b.display_title as string) : undefined },
    { label: t.fieldAuthor, value: b.author as string },
    { label: t.fieldLanguage, value: b.language as string },
    { label: t.fieldPlace, value: (fullBook?.place_published as string) || undefined },
    { label: t.fieldPublisher, value: (fullBook?.publisher as string) || undefined },
    { label: t.fieldPublished, value: b.published as string },
    { label: t.fieldFormat, value: (fullBook?.format as string) || undefined },
    { label: t.fieldPages, value: fullBook?.pages_count ? String(fullBook.pages_count) : undefined },
    // A catalogue identifier, not a word — the same in every language.
    { label: 'USTC', value: (fullBook?.ustc_id as string) || undefined },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6" style={{ overscrollBehavior: 'contain' }}>
      {summary && (
        <div className="mb-4 p-3 border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-white)' }}>
          <CapsLabel className="block mb-1.5" style={{ color: 'var(--accent-gold-dark)' }}>{t.thisPage}</CapsLabel>
          <p className="font-body text-[13.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {summary}
          </p>
        </div>
      )}
      <CapsLabel className="block mt-1 mb-2.5" style={{ color: 'var(--text-muted)' }}>{t.thisEdition}</CapsLabel>
      <dl>
        {rows.filter(row => row.value).map(row => (
          <div key={row.label} className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
            <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>{row.label}</dt>
            <dd style={{ color: 'var(--text-secondary)' }}>
              {row.isTitle ? <em className="font-body">{row.value}</em> : row.value}
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
          of the bibliographic record — not tucked in a pane menu. Corpus
          editions (#4350) branch on every row: there is no scan behind them,
          and an ETCSL translation is the corpus editors' scholarly work — the
          default wording was false in both directions. */}
      {(page.ocr?.model || page.translation?.model) && (() => {
        const ocrCorpus = pageTextCorpus(page);
        const trCorpus = translationCorpus(page);
        const witnessCount = (book.cdli_witnesses || []).length;
        return (
        <>
          <CapsLabel className="block mt-5 mb-2" style={{ color: 'var(--text-muted)' }}>{t.howPageWasMade}</CapsLabel>
          <dl>
            <div className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
              <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>{t.fieldScan}</dt>
              <dd style={{ color: 'var(--text-secondary)' }}>
                {ocrCorpus ? t.corpusNoScan(witnessCount) : t.scannedFrom(page.page_number ?? undefined)}
              </dd>
            </div>
            {page.ocr?.model && (
              <div className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
                <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>{t.fieldTranscript}</dt>
                <dd style={{ color: 'var(--text-secondary)' }}>
                  {ocrCorpus ? t.corpusTranscript(ocrCorpus.name, ocrCorpus.org) : t.transcribedBy(page.ocr.model)}
                </dd>
              </div>
            )}
            {page.translation?.model && (
              <div className="flex gap-3 py-1.5 border-t font-sans text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
                <dt className="w-[72px] shrink-0" style={{ color: 'var(--text-faint)' }}>{t.fieldEnglish}</dt>
                <dd style={{ color: 'var(--text-secondary)' }}>
                  {trCorpus ? t.corpusTranslation(trCorpus.name) : t.translatedBy(page.translation.model)}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-2.5 font-sans text-[11.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            {trCorpus ? t.corpusNotice : ocrCorpus ? t.corpusAiNotice(ocrCorpus.name) : t.machineNotice}
          </p>
        </>
        );
      })()}
    </div>
  );
}

export interface LibrarianMessage { role: 'user' | 'assistant'; content: string }

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
  const t = getReaderStrings(useLocale()).librarian;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Land on the START of the newest answer. Scrolling to the bottom of the
  // thread dropped the reader at the end of a long reply, mid-sentence.
  const lastAnswerRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (busy) { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); return; }
    const el = lastAnswerRef.current;
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
    }
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
    // Empty thread: the field comes first and the suggestions sit under it, so
    // the thing you type in is the first thing you meet.
    <div className={`flex min-h-0 flex-1 ${empty ? 'flex-col-reverse justify-end' : 'flex-col'}`}>
      <div
        ref={scrollRef}
        className={`overflow-y-auto px-4 pt-3 pb-3 ${empty ? 'shrink-0' : 'flex-1 min-h-0'}`}
        style={{ overscrollBehavior: 'contain' }}
      >
        {empty && (
          <>
            <CapsLabel className="block mb-2" style={{ color: 'var(--text-faint)' }}>{t.orStartHere}</CapsLabel>
            <div className="flex flex-col gap-1.5">
              {t.suggestions.map(s => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className={`group justify-between w-full ${PANEL_BTN}`}
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
            <p
              key={i}
              ref={i === messages.length - 1 ? lastAnswerRef : undefined}
              className="font-body text-[14px] leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--text-secondary)' }}
            >
              {m.content}
            </p>
          )
        ))}
        {busy && (
          <div className="flex items-center gap-2 mt-3 font-sans text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={13} className="animate-spin" /> {t.consulting}
          </div>
        )}
        {error && (
          <p className="mt-2 font-sans text-[12px]" style={{ color: 'var(--status-error)' }} role="alert">
            {t.askErrorInline}
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
            placeholder={t.askAboutPage(page.page_number)}
            className="flex-1 bg-transparent outline-none focus:outline-none font-sans text-[16px] lg:text-[13px]"
            style={{ color: 'var(--text-primary)' }}
            aria-label={t.inputAria}
          />
          <button type="submit" disabled={busy || !input.trim()}
            className="font-sans text-[12px] disabled:opacity-40"
            style={{ color: 'var(--accent-rust)' }}>
            {t.ask}
          </button>
        </div>
      </form>

    </div>
  );
}

/**
 * Scan pane controls. Two distinct jobs, kept visually separate: the zoom
 * group scales the whole scan in place, and the lens is a spot magnifier you
 * switch on (it used to follow the cursor uninvited).
 */
function ScanControls({
  zoom, onZoomStep, onZoomReset, lensOn, onToggleLens, onExpand, compact = false,
}: {
  zoom: number;
  onZoomStep: (dir: 1 | -1) => void;
  onZoomReset: () => void;
  lensOn: boolean;
  onToggleLens: () => void;
  /** Open the scan full screen, at the resolution it was archived at */
  onExpand?: () => void;
  /** Touch layout: the fingers ARE the zoom control (pinch, double-tap), so
   *  the ± steppers and the lens would only crowd a 34px header. Renders the
   *  fullscreen button alone, plus a tap-to-reset % chip while pinched in. */
  compact?: boolean;
}) {
  const strings = getReaderStrings(useLocale());
  const t = strings.panes;
  const tb = strings.toolbar;
  // Same chip as Trace / Notes / Copy in the text panes, so one row of pane
  // controls reads as one family rather than icons beside buttons.
  // The scan bed is the darkest surface in the reader, so an outlined chip
  // drew a pale box around every control. These carry a faint fill and no
  // border instead — same size and spacing as the text panes' chips, so the
  // family holds without the outline fighting the ground.
  const btn = `${PANE_ICON_CHIP} disabled:opacity-30`;
  const btnStyle = { color: 'var(--text-muted)' } as const;
  if (compact) {
    return (
      <div className="flex items-center gap-0.5">
        {zoom > 1 && (
          <button
            type="button"
            onClick={onZoomReset}
            className="min-w-[46px] px-1 h-[26px] font-sans text-[11px] tabular-nums transition-colors hover:bg-black/[0.06]"
            style={{ color: 'var(--text-muted)' }}
            title={t.resetZoom}
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
        {onExpand && (
          <button type="button" onClick={onExpand} aria-label={tb.viewScanFullScreen} title={tb.viewScanFullScreen} className={btn} style={btnStyle}>
            <Maximize2 size={14} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" aria-label={t.zoomOut} disabled={zoom <= 1} onClick={() => onZoomStep(-1)}
        className={btn} style={btnStyle}>
        <ZoomOut size={14} />
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        disabled={zoom === 1}
        className="min-w-[46px] px-1 h-[26px] font-sans text-[11px] tabular-nums transition-colors disabled:cursor-default hover:bg-black/[0.06]"
        style={{ color: 'var(--text-muted)' }}
        title={t.resetZoom}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label={t.zoomIn} disabled={zoom >= SCAN_ZOOM_STEPS[SCAN_ZOOM_STEPS.length - 1]}
        onClick={() => onZoomStep(1)} className={btn} style={btnStyle}>
        <ZoomIn size={14} />
      </button>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--border-medium)' }} />
      <button
        type="button"
        onClick={onToggleLens}
        aria-pressed={lensOn}
        aria-label={t.readingLens}
        disabled={zoom > 1}
        className={btn}
        style={lensOn
          ? { color: 'var(--accent-sage-dark)', background: 'color-mix(in srgb, var(--accent-sage) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-sage) 45%, transparent)' }
          : btnStyle}
        title={zoom > 1 ? t.readingLensUnavailable : lensOn ? t.readingLensOff : t.readingLens}
      >
        <ScanSearch size={14} />
      </button>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={tb.viewScanFullScreen}
          title={tb.viewScanFullScreen}
          className={btn}
          style={btnStyle}
        >
          <Maximize2 size={14} />
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
function ScanLightbox({ page, book, onClose, onPrev, onNext, hasPrev, hasNext, srcOverride, altOverride }: {
  page: Page;
  book: Book;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** Witness photo stand-in (#4350) — fullRes, so hand it the 4000px tier. */
  srcOverride?: string;
  altOverride?: string;
}) {
  const strings = getReaderStrings(useLocale());
  const t = strings.toolbar;
  // Zoom resets per page, keyed rather than set from an effect.
  const [zoomByPage, setZoomByPage] = useState<{ id: string; zoom: number }>({ id: page.id, zoom: 1 });
  const zoom = zoomByPage.id === page.id ? zoomByPage.zoom : 1;
  const setZoom = useCallback((next: number | ((z: number) => number)) => {
    setZoomByPage(prev => {
      const current = prev.id === page.id ? prev.zoom : 1;
      return { id: page.id, zoom: typeof next === 'function' ? next(current) : next };
    });
  }, [page.id]);

  const boxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(boxRef, onClose);
  useEffect(() => {
    // Arrows only. Escape belongs to useDialogFocus, and stopPropagation never
    // worked here anyway: the hook's handler is on the same window node, so
    // both fired and every arrow press wrote two history entries.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'ArrowLeft') onPrev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onPrev]);

  const navBtn = 'w-10 h-10 flex items-center justify-center transition-colors disabled:opacity-25 hover:bg-[rgba(253,252,249,0.12)]';

  // The full-screen view had buttons and arrow keys but no touch at all — on
  // a phone that reads as "you can no longer swipe to the next page" (#4385).
  // At fit, a plain axis-locked swipe turns the page; zoomed, ScanViewer owns
  // the touches and its edge-turn (onEdgePageTurn below) takes over.
  const lightboxSwipe = useRef<{ x: number; y: number } | null>(null);
  const onLbTouchStart = (e: React.TouchEvent) => {
    lightboxSwipe.current = e.touches.length === 1 && zoom <= 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : null;
  };
  const onLbTouchEnd = (e: React.TouchEvent) => {
    const s = lightboxSwipe.current;
    lightboxSwipe.current = null;
    if (!s || zoom > 1) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext(); else onPrev();
  };

  return (
    <div ref={boxRef} className="fixed inset-0 z-[100] flex flex-col rv2-pop" style={{ background: '#14110d' }} role="dialog" aria-modal="true" aria-label={t.scanFullScreen}>
      <div className="shrink-0 flex items-center gap-2 px-3 h-[52px]" style={{ borderBottom: `1px solid ${onInk(0.12)}` }}>
        <button type="button" onClick={onClose} aria-label={t.backToTheReader}
          className="flex items-center gap-1.5 pl-1.5 pr-3 h-9 font-sans text-[13px] transition-colors hover:bg-[rgba(253,252,249,0.12)]"
          style={{ color: onInk(0.85) }}>
          <ChevronLeft size={17} /> {t.backToTheReader}
        </button>
        <div className="flex-1" />
        <span className="font-sans text-[12.5px] truncate max-w-[40%]" style={{ color: onInk(0.5) }}>
          {book.display_title || book.title}
        </span>
        <span className="font-sans text-[12.5px] tabular-nums" style={{ color: onInk(0.75) }}>
          p. {page.page_number}
        </span>
        <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label={t.previousPage}
          className={navBtn} style={{ color: onInk(0.75) }}><ChevronLeft size={17} /></button>
        <button type="button" onClick={onNext} disabled={!hasNext} aria-label={t.nextPage}
          className={navBtn} style={{ color: onInk(0.75) }}><ChevronRight size={17} /></button>
        <button type="button" onClick={onClose} aria-label={t.close}
          className={navBtn} style={{ color: onInk(0.75) }}><X size={17} /></button>
      </div>
      <div className="flex-1 min-h-0 px-3 py-3" onTouchStart={onLbTouchStart} onTouchEnd={onLbTouchEnd}>
        <ScanViewer
          page={page} book={book} zoom={zoom} onZoomChange={setZoom} fullRes
          srcOverride={srcOverride} altOverride={altOverride}
          onEdgePageTurn={dir => { if (dir === 'next') { if (hasNext) onNext(); } else if (hasPrev) onPrev(); }}
        />
      </div>
      <div className="shrink-0 flex items-center justify-center gap-1 h-[46px]" style={{ borderTop: `1px solid ${onInk(0.12)}` }}>
        <button type="button" aria-label={strings.panes.zoomOut} disabled={zoom <= 1}
          onClick={() => setZoom(z => SCAN_ZOOM_STEPS[Math.max(0, SCAN_ZOOM_STEPS.indexOf(z) - 1)] ?? 1)}
          className={navBtn} style={{ color: onInk(0.7) }}><ZoomOut size={16} /></button>
        <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}
          className="min-w-[56px] h-10 font-sans text-[12px] tabular-nums transition-colors hover:bg-[rgba(253,252,249,0.12)] disabled:cursor-default"
          style={{ color: onInk(0.7) }}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label={strings.panes.zoomIn} disabled={zoom >= SCAN_ZOOM_MAX}
          onClick={() => setZoom(z => SCAN_ZOOM_STEPS[Math.min(SCAN_ZOOM_STEPS.length - 1, SCAN_ZOOM_STEPS.indexOf(z) + 1)] ?? z)}
          className={navBtn} style={{ color: onInk(0.7) }}><ZoomIn size={16} /></button>
      </div>
    </div>
  );
}

function PaneHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      className="h-[38px] shrink-0 flex items-center justify-between gap-2 px-4 border-b"
      style={{ borderColor: 'var(--border-medium)' }}
    >
      {/* The label truncates and the controls never shrink. Without both, the
          two groups met and overprinted between 1024 and ~1150, so the header
          read "TRANSLATION ETRACEnglish". */}
      <div className="flex items-center gap-2 min-w-0 [&>*]:truncate">{children}</div>
      <div className="shrink-0 flex items-center">{right}</div>
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
  onGoTo: (pageId: string, query?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ pageId: string; pageNumber: number; matches: Array<{ field: string; snippet: string }> }>>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = getReaderStrings(useLocale()).search;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setTotal(null); return; }
    // The timer was cancelled on every keystroke but the request it had
    // already fired was not, so two queries could be in flight and the slower
    // one won. The list then showed results for a prefix while the field said
    // something else, and the highlight matched neither.
    const ac = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setFailed(false);
      try {
        const res = await fetch(
          `/api/books/${bookId}/search?q=${encodeURIComponent(query.trim())}`,
          { signal: ac.signal },
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
          setTotal(typeof data.total === 'number' ? data.total : (data.results || []).length);
        } else {
          // Rate limited or down. Saying nothing left stale results on screen
          // and no count, which reads as the panel ignoring you.
          setResults([]); setTotal(null); setFailed(true);
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') { setResults([]); setTotal(null); setFailed(true); }
      }
      finally { if (!ac.signal.aborted) setSearching(false); }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ac.abort();
    };
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
            placeholder={t.placeholder}
            className="flex-1 bg-transparent outline-none focus:outline-none font-sans text-[16px] lg:text-[13px]"
            style={{ color: 'var(--text-primary)' }}
            aria-label={t.inputAria}
          />
        </div>
        {/* Rendered always, empty while idle. A live region created and filled
            in the same commit is announced unreliably by screen readers. */}
        <p
          className="font-sans text-[11.5px] mt-2 empty:mt-0"
          style={{ color: failed ? 'var(--status-error)' : 'var(--text-muted)' }}
          aria-live="polite"
          role="status"
        >
          {failed ? t.failed : (total !== null && !searching ? (total === 0 ? t.noMatches : t.pagesMatch(total)) : '')}
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
        {results.map(r => (
          <button
            key={r.pageId}
            type="button"
            onClick={() => onGoTo(r.pageId, query.trim())}
            className="group w-full text-left px-4 py-3 border-b transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-light)' }}
          >
            <span className="flex items-center justify-between gap-2 mb-1">
              <CapsLabel style={{ color: 'var(--text-faint)' }}>{t.pageLabel(r.pageNumber)}</CapsLabel>
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
  const strings = getReaderStrings(useLocale());
  // Arrows match the thumbnail image exactly and share its top edge; the row
  // is top-aligned so the page-number line below can't push them down.
  const thumbH = compact ? 50 : 54;

  // Slots keep one height and take their width from the page's real
  // proportions, measured once off a loaded thumbnail. A palm-leaf manuscript
  // is 150x34, and forcing that into a portrait box cropped it to a blank
  // sliver — every page in the book looked identical and empty. Wide books now
  // show fewer, wider pages in the same bar. Clamped so one freak scan can't
  // make a slot the width of the screen.
  const [aspect, setAspect] = useState(0.78);
  const onThumbLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    const a = Math.min(6, Math.max(0.25, w / h));
    setAspect(prev => (Math.abs(prev - a) > 0.02 ? a : prev));
  }, []);
  const thumbW = Math.round(thumbH * aspect);
  const thumbs = useMemo(
    () => pageList.map(p => ({ p, thumb: getPageThumbUrl(p as unknown as Record<string, unknown>) })),
    [pageList],
  );
  return (
    <div
      className="flex items-start gap-1 h-full pt-2 rv2-strip-in"
      style={{ background: INK, borderTop: `1px solid ${onInk(0.12)}` }}
    >
      <button type="button" aria-label={strings.toolbar.previousPage} onClick={onPrev}
        className="shrink-0 flex items-center justify-center mx-1.5 mt-1 transition-colors hover:bg-[rgba(253,252,249,0.16)]"
        style={{ width: compact ? 34 : 30, height: thumbH, background: onInk(0.08), color: onInk(0.8) }}>
        <ChevronLeft size={15} />
      </button>
      <div
        ref={innerRef}
        className="flex-1 flex items-start gap-2.5 overflow-x-auto px-2 py-1"
        style={{ overscrollBehavior: 'contain', scrollbarWidth: 'none' }}
      >
        {/* Thumbnail URLs are resolved once per page list rather than on
            every render. Reader2C re-renders on every panel toggle, every
            settings change and every scroll that flips the bar, and this map
            ran getPageThumbUrl for all 4,198 pages of the largest book each
            time. */}
        {thumbs.map(({ p, thumb }) => {
          const isCurrent = p.id === currentPageId;
          return (
            <button
              key={p.id}
              type="button"
              data-strip-page={p.id}
              onClick={() => onGoTo(p.id)}
              className="shrink-0 flex flex-col items-center gap-1"
              title={strings.search.pageLabel(p.page_number)}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {/* A diffuse rust halo rather than a ring. Most pages are pale
                  on a dark bar, so a cream or white edge vanishes into the
                  page itself; a glow reads against both. The scroller carries
                  padding to match, since it clips anything drawn outside it. */}
              <span
                className="block overflow-hidden transition-[box-shadow] duration-200"
                style={{
                  width: thumbW,
                  height: thumbH,
                  background: isCurrent ? '#fdfcf9' : 'rgba(245,240,232,0.30)',
                  boxShadow: isCurrent
                    ? '0 0 0 1px rgba(194,65,44,0.65), 0 0 18px 4px rgba(194,65,44,0.45)'
                    : 'none',
                }}
              >
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" loading="lazy" decoding="async"
                    onLoad={onThumbLoad}
                    className="w-full h-full object-cover transition-opacity duration-200" draggable={false}
                    style={{ opacity: isCurrent ? 1 : 0.72 }} />
                )}
              </span>
              <span
                className="font-sans text-[9.5px] tabular-nums px-1"
                style={isCurrent
                  ? { color: '#fdfcf9', background: '#c2412c', fontWeight: 600 }
                  : { color: onInk(0.58) }}
              >
                {p.page_number}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label={strings.toolbar.nextPage} onClick={onNext}
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
  panel, r, citationParts, copied, onCopyCitation, librarianMessages, onLibrarianMessages, onClose, onSelectPanel,
  shareUrl,
}: {
  panel: Exclude<LeftPanel, null>;
  r: ReaderState;
  citationParts: { author: string; title: string; year: string; locator: string; copy: string; source: string; url: string };
  copied: boolean;
  onCopyCitation: () => void;
  librarianMessages: LibrarianMessage[];
  onLibrarianMessages: (m: LibrarianMessage[]) => void;
  onClose: () => void;
  /** Mobile "More" menu hands off to another panel */
  onSelectPanel: (p: Exclude<LeftPanel, null>) => void;
  shareUrl: string;
}) {
  const t = getReaderStrings(useLocale());
  if (panel === 'more') {
    // A quiet list, not a wall of boxes. Ten bordered white tiles on a warm
    // ground read as ten competing buttons; a single hairline-separated column
    // reads as a menu, which is what it is. Rows are full-width tap targets
    // and arrive in sequence so opening More is one movement. Grouped with
    // caps headers and a leading icon per row (#4385 follow-up — the flat
    // list read as "a disorganized wall of options").
    const row = 'w-full text-left flex items-center gap-3 h-[46px] font-sans text-[14px] transition-colors active:bg-[var(--bg-white)]';
    let rowIndex = 0;
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-5" style={{ overscrollBehavior: 'contain' }}>
        <div className="flex flex-col">
          {MORE_GROUPS.map((group) => (
            <div key={group.key} className="flex flex-col">
              <CapsLabel className="pt-4 pb-1.5" style={{ color: 'var(--text-faint)' }}>
                {t.moreMenu[group.key]}
              </CapsLabel>
              {group.tools.map((key) => {
                const IconFor = MORE_ICONS[key];
                const rust = key === 'feedback';
                const i = rowIndex++;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectPanel(key)}
                    className={`${row} rv2-tile-in border-b`}
                    style={{
                      borderColor: 'var(--border-light)',
                      color: rust ? 'var(--accent-rust)' : 'var(--text-primary)',
                      animationDelay: `${i * 18}ms`,
                    }}
                  >
                    <IconFor size={16} className="shrink-0" style={{ color: rust ? 'var(--accent-rust)' : 'var(--text-muted)' }} />
                    <span className="flex-1">{t.moreMenu[key]}</span>
                    <ChevronRightSmall size={15} className="shrink-0" style={{ color: 'var(--text-faint)' }} />
                  </button>
                );
              })}
            </div>
          ))}
          {/* The edit row is gone. This sheet is the mobile More menu, and the
              editor textarea and the Cancel/Save bar exist only in the desktop
              tree — so on a phone the row set `editing` and nothing appeared:
              no editor, no save, just a pane header reading "Editing" and the
              Trace chip gone, with no way back except finding the row again.
              Desktop editors reach the same toggle from the rail. */}
        </div>
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
          <p className="px-4 py-3 font-sans text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {/* A book with no printed contents and a book whose contents nobody
                has keyed in yet are different facts, and the reader should not
                have to guess which one it is looking at. */}
            {r.currentPage.page_number != null && r.totalPages > 0
              ? t.contents.noContentsTranscribed
              : t.contents.noContentsAtAll}
          </p>
        )}
      </div>
    );
  }
  if (panel === 'views') {
    const PANES: Array<[keyof ReaderState['views'], string, string]> = [
      ['scan', t.panes.originalScan, t.panes.originalScanHint],
      ['ocr', t.panes.transcriptionOf(r.book.language || t.panes.originalFallback), t.panes.transcriptionHint],
      ['en', t.panes.englishTranslation, t.panes.englishTranslationHint],
      ...(hasNonLatinScript(r.book.language) && r.currentPage.ocr?.data
        ? [['translit', t.panes.romanisedTranscription, t.panes.romanisedTranscriptionHint] as [keyof ReaderState['views'], string, string]]
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
              className={`${PANEL_ROW} hover:bg-transparent`}
              style={{ borderColor: 'var(--border-light)' }}
            >
              <span className="min-w-0">
                <span className="block font-sans text-[14px]" style={{ color: 'var(--text-primary)' }}>{label}</span>
                <span className="block font-sans text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                  {locked ? t.panes.lastPaneShowing : hint}
                </span>
              </span>
              <span className={locked ? 'opacity-40' : undefined}>
                <SettingsSwitch
                  on={on}
                  onToggle={() => { if (!locked) r.toggleView(key); }}
                  label={t.panes.showPane(label)}
                />
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  if (panel === 'save') {
    return <SavePanel page={r.currentPage} book={r.book} url={shareUrl} />;
  }
  if (panel === 'history') {
    return <RevisionHistoryPanel page={r.currentPage} book={r.book} />;
  }
  if (panel === 'downloads') {
    return <DownloadsPanel page={r.currentPage} book={r.book} />;
  }
  if (panel === 'search') {
    // ?highlight= is what marks the term and scrolls to it on arrival. Without
    // it a search result dropped you on the right page with nothing indicating
    // why, which is most of what an in-book search is for.
    return (
      <BookSearchPanel
        bookId={r.book.id}
        onGoTo={(pid, q) => { onClose(); r.goToPage(pid, q ? { highlight: q } : undefined); }}
      />
    );
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
  if (panel === 'feedback') {
    return <FeedbackPanel page={r.currentPage} book={r.book} url={shareUrl} />;
  }
  if (panel === 'share') {
    return <SharePanel page={r.currentPage} book={r.book} url={shareUrl} />;
  }
  if (panel === 'cite') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4" style={{ overscrollBehavior: 'contain' }}>
        <div className="mb-3 pl-3 border-l-2" style={{ borderColor: 'var(--border-medium)' }}>
          {citationParts.author && (
            <p className="font-body text-[14px] leading-snug" style={{ color: 'var(--text-primary)' }}>
              {citationParts.author}
            </p>
          )}
          <p className="font-body text-[14.5px] leading-snug" style={{ color: 'var(--text-primary)' }}>
            <em>{citationParts.title}</em>
            {citationParts.year && <span style={{ color: 'var(--text-muted)' }}> {citationParts.year}</span>}
          </p>
          <p className="font-sans text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            {[citationParts.locator, citationParts.copy.replace(/\.$/, ''), citationParts.source].filter(Boolean).join(' · ')}
          </p>
          <p className="font-sans text-[11.5px] mt-1.5 break-all" style={{ color: 'var(--text-faint)' }}>
            {citationParts.url}
          </p>
        </div>
        <button
          type="button"
          onClick={onCopyCitation}
          className={PANEL_BTN}
          style={PANEL_BTN_STYLE}
        >
          {copied ? <Check size={13} /> : null}
          {copied ? t.cite.copied : t.cite.copyCitation}
        </button>
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
  const t = getReaderStrings(useLocale());

  const [leftPanel, setLeftPanel] = useState<LeftPanel>(null);
  const togglePanel = useCallback((p: Exclude<LeftPanel, null>) => {
    setLeftPanel(prev => (prev === p ? null : p));
  }, []);

  // The site menu is not a reader panel. The panels answer questions about
  // this book; this one is how you leave it, so it takes the whole screen
  // instead of sharing the frame with the page you are reading.
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);

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
  /**
   * Whether the client has taken over from the server render. The server has
   * no viewport to measure, so isDesktop guesses true there — which meant the
   * server sent every phone the DESKTOP filmstrip: a button and a thumbnail
   * URL for every page of the book, a quarter of the HTML on a 101-page book
   * and far worse on the 4,198-page one, and React then threw the whole
   * subtree away as a hydration mismatch and rendered the mobile strip in its
   * place. Neither strip is rendered until the viewport is known.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  const isEmbedded = useIsEmbedded();
  // Back-to-the-book must stay inside an embedded reading room.
  const embedHref = useEmbedHref();

  // A citation can pin a published edition (?v=). When one is pinned the
  // translation pane must show the text AS CITED, not the current text —
  // silently serving the live translation under a pinned URL is the reader
  // lying about what it is showing.
  const [pinnedTranslation, setPinnedTranslation] = useState<string | null>(null);
  const displayPage = pinnedTranslation != null
    ? { ...r.currentPage, translation: { ...(r.currentPage.translation ?? {}), data: pinnedTranslation } } as Page
    : r.currentPage;

  // page_read feeds analytics_events, which the admin book-insights and
  // metrics dashboards read for reading depth. Swapping the reader dropped it,
  // and a dashboard quietly going to zero is not a failure anyone sees.
  useEffect(() => {
    analytics.track({ event: 'page_read', book_id: r.book.id, page_id: r.currentPageId })
      .catch(() => { /* fire and forget */ });
  }, [r.book.id, r.currentPageId]);
  // Tracing needs both texts on screen and a real translation to align to; an
  // English book has nothing to trace between.
  const [traceOn, setTraceOn] = useState(false);
  const [traceStatus, setTraceStatus] = useState<TraceStatus>('idle');
  const [tracedOnce, setTracedOnce] = useState(true); // assume learned until storage says otherwise
  useEffect(() => {
    try { setTracedOnce(window.localStorage.getItem(TRACE_LEARNED_KEY) === '1'); } catch { /* private mode */ }
  }, []);
  // A trace highlight appearing is the proof the reader worked it out.
  useEffect(() => {
    if (!traceOn || tracedOnce || typeof CSS === 'undefined' || !CSS.highlights) return;
    const check = window.setInterval(() => {
      const live = [...CSS.highlights.keys()].some(k => k.startsWith('sl-trace'));
      if (!live) return;
      setTracedOnce(true);
      try { window.localStorage.setItem(TRACE_LEARNED_KEY, '1'); } catch { /* private mode */ }
    }, 700);
    return () => window.clearInterval(check);
  }, [traceOn, tracedOnce]);

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
  const translitRef = useRef<HTMLDivElement>(null);
  const scanScrollRef = useRef<HTMLDivElement>(null);
  // The lock is time-based and refreshed on every write, because the scroll
  // events a programmatic sync provokes can land well after a fixed 80ms
  // window — long enough for a follower pane to sync back and undo the
  // leader's position (this is what dragged the zoom anchor around).
  const syncLock = useRef<{ from: string; at: number } | null>(null);
  const zoomingUntil = useRef(0);
  const syncFrom = useCallback((from: 'scan' | 'ocr' | 'en' | 'translit') => {
    const panes: Record<string, HTMLDivElement | null> = {
      scan: scanScrollRef.current, ocr: ocrRef.current,
      translit: translitRef.current, en: enRef.current,
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

  // Mobile: one scroller for the stacked panes, and paging driven from a
  // horizontal swipe.
  const mobileMainRef = useRef<HTMLElement>(null);

  /**
   * Which stacked pane you were reading when the page turned. Resetting the
   * column to the top on every turn meant a swipe taken halfway down a
   * translation landed you back on the next page's scan, so reading a
   * translation across a page break cost a scroll past the facsimile every
   * time. Turning a page from inside a pane now keeps you in that pane.
   */
  const mobileAnchor = useRef<string | null>(null);
  // A swipe is "carry on reading" and keeps your pane. Every other way of
  // changing page — the pager, the filmstrip, Contents, a typed page number —
  // is a deliberate move, and lands at the top of the reader.
  const keepPaneOnTurn = useRef(false);
  // Which way the last turn went, so the new page can arrive from that side.
  // Taken from the index rather than from the swipe, so the pager, the
  // filmstrip and a jump all animate the same way a swipe does.
  const lastIndex = useRef(r.currentIndex);
  // Restoring the anchor scrolls the column, and that scroll must not be read
  // back as a reading move — on a short page the restore clamps at the foot,
  // which would re-read the anchor as the scan and lose the pane on the next
  // turn. Same idea as the zoom guard on the scan sync above.
  const anchorLock = useRef(0);

  const readMobileAnchor = useCallback(() => {
    const el = mobileMainRef.current;
    if (!el) return null;
    // You haven't moved: there is no pane to hold, and a turn starts at the top.
    if (el.scrollTop < 24) return null;
    const box = el.getBoundingClientRect();
    // The deepest pane you have brought up the screen — NOT the pane at the top
    // edge. Plenty of pages are too short for the translation to ever reach the
    // top, and reading one meant no anchor at all: the pane sat at the foot of
    // the screen, which is exactly the case a turn used to throw away.
    const reached = box.bottom - box.height * 0.25;
    let anchor: string | null = null;
    for (const section of el.querySelectorAll<HTMLElement>('[data-reader-section]')) {
      if (section.getBoundingClientRect().top <= reached) anchor = section.dataset.readerSection ?? null;
    }
    return anchor;
  }, []);

  useEffect(() => {
    ocrRef.current?.scrollTo({ top: 0 });
    enRef.current?.scrollTo({ top: 0 });
    setBarHidden(false);
  }, [r.currentPageId]);

  // Keyed on the page that is actually RENDERED, not the one being navigated
  // to: an uncached turn changes the id first and the content a fetch later,
  // and anchoring against the outgoing page's layout puts you nowhere.
  useLayoutEffect(() => {
    const el = mobileMainRef.current;
    if (!el) return;
    // Read once: the two passes below must place the SAME pane.
    const anchor = keepPaneOnTurn.current ? mobileAnchor.current : null;
    keepPaneOnTurn.current = false;
    anchorLock.current = Date.now() + 250;
    const place = () => {
      // No anchor, or the new page hasn't got that pane (plenty have no
      // translation): start at the top, as before.
      const target = anchor
        ? el.querySelector<HTMLElement>(`[data-reader-section="${anchor}"]`)
        : null;
      if (target) {
        // Under the bar, not under the top edge of the column: the bar floats
        // over the column and is always back on screen for a new page, so
        // aligning to the edge would put the first line behind it.
        const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top - BAR_H;
        el.scrollTop = Math.max(0, el.scrollTop + delta);
      } else {
        el.scrollTop = 0;
      }
      lastScrollY.current = el.scrollTop;
      barIntent.current = 0;
    };
    place();

    // Slide the panes in from the side the turn came from. Restarting the
    // animation by hand rather than keying the elements: a new key would
    // remount the column, and the scan would be re-fetched and re-decoded on
    // every page turn.
    const back = r.currentIndex < lastIndex.current;
    lastIndex.current = r.currentIndex;
    for (const pane of Array.from(el.querySelectorAll<HTMLElement>(':scope > section'))) {
      // The CONTENTS of the pane, not the pane. Sliding the pane itself moved
      // its background with it and left a strip of the column showing down the
      // side of the screen — a white gap running past the edge of the page.
      // The pane holds still and its text and facsimile arrive inside it.
      const inner = pane.lastElementChild;
      if (!(inner instanceof HTMLElement)) continue;
      // The drag-follow writes an inline transform on this same element; leave
      // it in place and the pane starts its arrival wherever the finger left it.
      inner.style.transition = '';
      inner.style.transform = '';
      inner.classList.remove('rv2-turn-next', 'rv2-turn-prev');
      void inner.offsetWidth; // reflow, or the class swap is coalesced and nothing plays
      inner.classList.add(back ? 'rv2-turn-prev' : 'rv2-turn-next');
    }

    // The title bar comes back on a turn and the new text settles a beat
    // later; both change how far the column can scroll, so a position taken
    // in this pass alone lands short of where it was asked to go.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
    // The RENDERED page only. On an uncached turn the index moves a fetch
    // ahead of the content, and keying on it too would play the animation
    // over the outgoing page and then again over the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.currentPage.id]);

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
  const sheetOpen = !!leftPanel && !isDesktop;
  const sheetRef = useRef<HTMLDivElement>(null);
  /**
   * Pull the sheet down to put it away. It opened with one way out: a 16px
   * glyph tucked under the site header, at the far end of a panel you had just
   * scrolled to the bottom of. A sheet you can push away with the thumb that
   * opened it is the whole point of a sheet.
   */
  const sheetDrag = useRef<{ y: number; dy: number } | null>(null);
  const onSheetDragStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { sheetDrag.current = null; return; }
    sheetDrag.current = { y: e.touches[0].clientY, dy: 0 };
    const el = sheetRef.current;
    if (el) el.style.transition = 'none';
  };
  const onSheetDragMove = (e: React.TouchEvent) => {
    const s = sheetDrag.current;
    const el = sheetRef.current;
    if (!s || !el || e.touches.length !== 1) return;
    // Downward only: dragging up would tear the sheet off its own bottom edge.
    s.dy = Math.max(0, e.touches[0].clientY - s.y);
    el.style.transform = `translateY(${s.dy}px)`;
  };
  const onSheetDragEnd = () => {
    const s = sheetDrag.current;
    const el = sheetRef.current;
    sheetDrag.current = null;
    if (!s || !el) return;
    el.style.transition = 'transform 200ms ease-out';
    if (s.dy > SHEET_DISMISS_PULL) {
      el.style.transform = `translateY(${el.offsetHeight}px)`;
      window.setTimeout(() => setLeftPanel(null), 170);
    } else {
      el.style.transform = '';
    }
  };
  // A sheet that closed mid-pull would open again already pushed down.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
  }, [leftPanel]);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!leftPanel || isDesktop) { setSheetHeight(null); return; }
    // With the keyboard up the usable viewport is what is LEFT above it, not
    // the window — sizing against the window made the sheet climb the screen.
    // The cap is the room the sheet actually has: everything above whatever it
    // rises from, less a margin so it never reaches the top edge. A flat 72% of
    // the window left the More menu 400px for 480px of rows, so the last two
    // items — Reading settings and Send feedback — sat below the fold on every
    // phone, and under 8 of 10 on a small one.
    const bottom = keyboardInset > 0 ? keyboardInset : MOBILE_TOOLBAR_H;
    const cap = Math.max(200, window.innerHeight - bottom - SHEET_TOP_GAP);
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
  // and comes back when you scroll up. Height, contents and visibility all
  // move on this one curve and duration — they used to run at 200ms, 150ms
  // and instantly, so the bar arrived in pieces and left in one cut.
  const BAR_MS = 240;
  const BAR_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  const [barHidden, setBarHidden] = useState(false);
  const lastScrollY = useRef(0);
  /**
   * Scrolling that has kept going the same way, in pixels: up is negative.
   * Six pixels of movement used to be enough to throw the whole bar back on
   * screen, and momentum alone can produce that, so it appeared out of
   * nothing. Turning it takes a deliberate stretch of scrolling now, and
   * changing direction starts the count again.
   */
  const barIntent = useRef(0);
  /**
   * The bar waits before coming back. Meeting the threshold mid-scroll and
   * appearing on the spot put it on screen while the reader was still moving,
   * which is what made it feel like it jumped out. Leaving is not delayed:
   * getting out of the way should be immediate.
   */
  const barShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelBarShow = useCallback(() => {
    if (barShowTimer.current !== null) {
      clearTimeout(barShowTimer.current);
      barShowTimer.current = null;
    }
  }, []);
  const showBarSoon = useCallback(() => {
    if (barShowTimer.current !== null) return; // already on its way
    barShowTimer.current = setTimeout(() => {
      barShowTimer.current = null;
      setBarHidden(false);
    }, BAR_SHOW_DELAY_MS);
  }, []);
  useEffect(() => cancelBarShow, [cancelBarShow]);

  const onMobileScroll = useCallback(() => {
    const el = mobileMainRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const delta = y - lastScrollY.current;
    lastScrollY.current = y;
    if (Date.now() > anchorLock.current) mobileAnchor.current = readMobileAnchor();
    if (delta === 0) return;
    if ((delta > 0) !== (barIntent.current > 0)) barIntent.current = 0;
    barIntent.current += delta;
    // At the foot of the page the pager appears, and that is exactly when a
    // reader wants the whole set of ways out — next, previous, or back to the
    // book — so the bar comes back with it rather than staying hidden.
    const atFoot = el.scrollHeight - (y + el.clientHeight) < 80;
    // The top of a page is where the bar lives: no wait there, it is the
    // resting state rather than something arriving.
    if (y < 48) { cancelBarShow(); setBarHidden(false); barIntent.current = 0; }
    else if (barIntent.current > 16) { cancelBarShow(); setBarHidden(true); }
    else if (barIntent.current < -28 || atFoot) showBarSoon();
  }, [readMobileAnchor, cancelBarShow, showBarSoon]);

  // Swipe to page: axis-locked so a vertical read never turns a page, and a
  // horizontal drag has to clear both a distance floor and a vertical bias.
  // Carried by both layouts — a tablet in landscape gets the desktop grid, and
  // for a while that meant a touch device with no gesture at all.
  const swipeRef = useRef<{ x: number; y: number; axis: null | 'x' | 'y' } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      // A second finger means a pinch, not a page turn — abandon the swipe
      // AND any drag-follow offset already applied, or the column sits
      // shifted sideways for the whole zoom gesture.
      swipeRef.current = null;
      dragFollow(null);
      return;
    }
    // Anything with its own use for a horizontal drag opts out by marking
    // itself: a zoomed scan is being panned, and a slide-out panel is not the
    // page you are reading.
    if ((e.target as HTMLElement | null)?.closest('[data-no-page-swipe]')) {
      swipeRef.current = null;
      return;
    }
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    // A finger that lands in live selected text is working the selection, not
    // turning a page — dragging a handle sideways across the 45px floor used
    // to throw the selection away and jump to the next page. The pad covers
    // the handles, which sit a little outside the text they belong to.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const PAD = 24;
      for (const rect of Array.from(selection.getRangeAt(0).getClientRects())) {
        if (x >= rect.left - PAD && x <= rect.right + PAD && y >= rect.top - PAD && y <= rect.bottom + PAD) {
          swipeRef.current = null;
          return;
        }
      }
    }
    swipeRef.current = { x, y, axis: null };
  };
  // Nothing moved under the finger during a drag, so the gesture read as
  // absent (#4385). A locked horizontal drag now pulls the whole column a
  // little (with resistance) and a released drag snaps back; the arrival of
  // the new page is animated separately (#4384's slide-in, direction taken
  // from the page index). Direct style writes, not state — a re-render per
  // touchmove is exactly the jank the scan viewer's compositing comments
  // warn about.
  const dragFollow = (dx: number | null) => {
    const el = mobileMainRef.current;
    if (!el) return;
    // The pane CONTENTS move under the finger, not the column. Moving the
    // column moved its backgrounds with it, and the gap it opened showed the
    // bare page behind: a pale band down the side of the screen for the length
    // of every swipe, against a facsimile that is nowhere near that colour.
    // The panes hold still and their text and scan slide inside them, which is
    // the same gesture with nothing behind it to see. (Same reasoning as the
    // turn animation, which moves these very elements.)
    for (const pane of Array.from(el.querySelectorAll<HTMLElement>(':scope > section'))) {
      const inner = pane.lastElementChild;
      if (!(inner instanceof HTMLElement)) continue;
      if (dx === null) {
        inner.style.transition = 'transform 180ms ease-out';
        inner.style.transform = '';
      } else {
        inner.style.transition = 'none';
        inner.style.transform = `translateX(${Math.max(-90, Math.min(90, dx * 0.35))}px)`;
      }
    }
    // A column left translated by an older build would sit off-centre forever.
    if (el.style.transform) { el.style.transition = ''; el.style.transform = ''; }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    if (!s || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.axis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
    }
    if (s.axis === 'x') dragFollow(dx);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || s.axis !== 'x') return;
    dragFollow(null);
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    if (Math.abs(dx) < 45) return;
    if (dx < 0) {
      if (!nextPage) return;
      keepPaneOnTurn.current = true;
      r.goNext();
    } else {
      if (!prevPage) return;
      keepPaneOnTurn.current = true;
      r.goPrev();
    }
  };
  const onTouchCancel = () => {
    swipeRef.current = null;
    dragFollow(null);
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

  // One string to copy, and its parts to show. A citation read as a wall of
  // text on screen while being perfectly correct on the clipboard; setting the
  // title, the locator and the URL apart makes it checkable at a glance
  // without changing a character of what gets pasted.
  // The copy clause (#4360): the scan shows one library's physical object, and
  // a citation of the image is a claim about that copy — marginalia and
  // provenance marks exist nowhere else. Null when no genuine holder is known
  // (aggregators like Internet Archive are filtered), and then the citation
  // reads as before.
  const holdingCopy = resolveHoldingCopy(r.book);
  const citationParts = {
    author: r.book.author ? `${r.book.author}.` : '',
    title: r.book.display_title || r.book.title,
    year: r.book.published ? `(${r.book.published})` : '',
    locator: r.currentPage?.page_number != null ? `p. ${r.currentPage.page_number}` : '',
    copy: holdingCopy ? `${holdingCopy.statement}.` : '',
    source: 'Source Library',
    url: `https://sourcelibrary.org/book/${r.bookPath}/page/${r.currentPageId}`,
  };
  const citation = [
    citationParts.author,
    `${citationParts.title}${citationParts.year ? ` ${citationParts.year}` : ''},`,
    `${citationParts.locator}.`,
    citationParts.copy,
    `${citationParts.source}.`,
    citationParts.url,
  ].filter(Boolean).join(' ');

  const copyCitation = useCallback(() => {
    navigator.clipboard?.writeText(citation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [citation]);

  const pageNum = r.currentPage?.page_number ?? '—';
  const scan = resolveScanUrls(r.currentPage);
  // Corpus editions (#4350): no scan exists, so a CDLI tablet-witness
  // photograph stands in — clearly captioned as a witness, not the source of
  // the text. The index survives page turns on purpose: the witnesses belong
  // to the composition, not to any one of our page divisions.
  const witnessPhotos = useMemo(
    () => ((r.book.cdli_witnesses || []) as CdliWitness[]).filter(w => w.has_photo && w.photo_url),
    [r.book.cdli_witnesses],
  );
  const [witnessIndex, setWitnessIndex] = useState(0);
  const witness = !scan.display && witnessPhotos.length > 0
    ? witnessPhotos[((witnessIndex % witnessPhotos.length) + witnessPhotos.length) % witnessPhotos.length]
    : null;
  // Through the sharp resizer, not raw: CDLI originals run to ~24MB. Two
  // tiers, same contract as display vs native — 1600px at rest, 4000px once
  // the reader zooms past 1.5× or goes fullscreen. The caption's CDLI link
  // remains the road to the untouched original.
  const witnessSrc = witness?.photo_url
    ? `/api/image?url=${encodeURIComponent(witness.photo_url)}&w=1600&q=80`
    : undefined;
  const witnessNativeSrc = witness?.photo_url
    ? `/api/image?url=${encodeURIComponent(witness.photo_url)}&w=4000&q=85`
    : undefined;
  // The mobile scan pane is sized by the page's own shape (full-bleed width,
  // height from the aspect ratio) instead of a fixed 66dvh box. The ratio is
  // only known once an image loads, so keep the last seen one across page
  // turns — pages of one book share a shape — and open on a typical page
  // proportion before the first load.
  const [scanRatio, setScanRatio] = useState(0.72);
  const onScanNaturalSize = useCallback((size: { w: number; h: number }) => {
    if (!size.w || !size.h) return;
    const ratio = size.w / size.h;
    setScanRatio(prev => (Math.abs(prev - ratio) > 0.005 ? ratio : prev));
  }, []);
  const ocrCorpusInfo = pageTextCorpus(r.currentPage);
  const translationCorpusInfo = translationCorpus(r.currentPage);
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/book/${r.bookPath}/page/${r.currentPageId}`
    : `https://sourcelibrary.org/book/${r.bookPath}/page/${r.currentPageId}`;

  const leftPanelTitle = leftPanel ? t.panels.titles[leftPanel] : '';
  const leftPanelBlurb = leftPanel ? panelBlurb(t, leftPanel) : undefined;
  // One width for every drawer — the widest any of them needed. A rail whose
  // panel jumps between two widths as you move down it reads as a wobble.
  const leftPanelWidth = 340;
  const prevPage = r.currentIndex > 0 ? r.pageList[r.currentIndex - 1] : null;
  const nextPage = r.currentIndex >= 0 && r.currentIndex < r.totalPages - 1 ? r.pageList[r.currentIndex + 1] : null;
  // A zoomed pan that runs past the scan's left/right edge turns the page
  // (ScanViewer's onEdgePageTurn) — without it a zoomed-in reader has no way
  // forward short of zooming out first (#4385). It is a swipe-like move, so
  // it holds your pane like one (#4383).
  const onScanEdgeTurn = (dir: 'next' | 'prev') => {
    if (dir === 'next') {
      if (!nextPage) return;
      keepPaneOnTurn.current = true;
      r.goNext();
    } else {
      if (!prevPage) return;
      keepPaneOnTurn.current = true;
      r.goPrev();
    }
  };

  // Colour of whatever pane ends the mobile column, used to fill any leftover
  // height so a short page never shows a white band.
  const lastSurface = r.views.en ? SURFACE.translation : r.views.ocr ? SURFACE.ocr : SURFACE.scanBed;

  // Trace aligns the transcription against the English, so it needs both panes
  // showing, both texts present, and a book that isn't already in English.
  const isEnglishBook = (r.book.language || '').toLowerCase().startsWith('english');
  // Spanish is another rendering of the same pane, not a fifth column: nobody
  // reads one page in two translations at once. Never offered while a citation
  // pins a version — the pin is on a specific English text.
  // Marcianus gr. Z. 299 only: on folios a concordance can align, Berthelot &
  // Ruelle's 1887 critical edition is the text of record and the manuscript's
  // own OCR is demoted. That OCR self-agrees at about 0.62 run to run with
  // documented hallucinations on this hand, so showing it as the transcription
  // is not a missing feature, it is the reader asserting something false.
  const paired = usePairedEdition(r.book.id, r.currentPage.id, r.currentPage.page_number);

  const spanishAvailable = pinnedTranslation == null && !paired && spanishEligible(r.currentPage);
  const showingSpanish = r.settings.translationLang === 'es' && spanishAvailable;

  // Trace aligns the transcription against the ENGLISH translation, so it has
  // nothing to align while the pane is showing Spanish.
  // Two gates, because they mean different things. `traceShown` is whether
  // the control belongs on this page at all; `traceEligible` is whether it can
  // do anything right now. Spanish separates them: the alignment record holds
  // verbatim English spans, so there is nothing to find in a Spanish pane, but
  // hiding the chip made a working feature look broken.
  const traceShown = !isEnglishBook && !editing && !paired
    && !!r.currentPage.ocr?.data && !!r.currentPage.translation?.data
    && r.views.ocr && r.views.en;
  const traceEligible = traceShown && !showingSpanish;
  const traceActive = traceOn && traceEligible;
  const traceDisabledReason = traceShown && showingSpanish ? t.panes.traceEnglishOnly : undefined;

  const translitEligible = hasNonLatinScript(r.book.language) && !!r.currentPage.ocr?.data;
  const deepzoomManifest = (r.currentPage as unknown as { deepzoom?: DeepZoomManifest }).deepzoom;


  // The text of a neighbouring page is already prefetched, but its scan is
  // not, so a page turn showed the words instantly and then waited on the
  // image. Warm the next few scans (and the one behind) into the browser
  // cache while the reader is reading.
  useEffect(() => {
    if (!r.views.scan) return;
    const around = [1, 2, -1]
      .map(d => r.pageList[r.currentIndex + d])
      .filter(Boolean);
    const imgs = around.map(p => {
      const url = resolveScanUrls(p).display;
      if (!url) return null;
      const img = new window.Image();
      img.decoding = 'async';
      img.src = url;
      return img;
    }).filter(Boolean) as HTMLImageElement[];
    return () => { imgs.forEach(i => { i.src = ''; }); };
  }, [r.currentIndex, r.pageList, r.views.scan]);

  // Cached transliterations arrive with the page; anything else is generated
  // the first time the pane is open on that page, and only then.
  useEffect(() => {
    // Keyed on the loaded page, and bailing until it agrees with the id we are
    // navigating to. The effect used to read the cache off the STALE page
    // while requesting the NEW one, so a single page turn could fire two paid
    // transliterations for the same page, and the client-side cancel flag
    // stopped neither of them costing money.
    const page = r.currentPage;
    if (page.id !== r.currentPageId) return;
    const cached = (page as unknown as { transliteration?: { data?: string } }).transliteration?.data;
    setTranslitError(false);
    if (cached) { setTranslit(cached); return; }
    setTranslit('');
    if (!r.views.translit || !translitEligible) return;
    let cancelled = false;
    setTranslitLoading(true);
    pagesApi.transliterate(page.id)
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
    r, citationParts, copied,
    onCopyCitation: copyCitation,
    librarianMessages,
    onLibrarianMessages: setLibrarianMessages,
    onClose: () => setLeftPanel(null),
    onSelectPanel: (p: Exclude<LeftPanel, null>) => setLeftPanel(p),
    editing,
    onToggleEdit: () => setEditing(v => !v),
    shareUrl,
  };

  /**
   * The editor honours the reading settings. It used to hard-code its own
   * face, size and leading, so an editor who had set the text how they wanted
   * to READ it lost all of that the moment they started correcting it — and
   * they are checking their edit against the scan in the pane beside it.
   */
  const editorTextarea = (field: 'ocr' | 'translation') => (
    <textarea
      value={field === 'ocr' ? draft.ocr : draft.translation}
      onChange={e => setDraftField(field, e.target.value)}
      spellCheck={false}
      className={`w-full h-full resize-none outline-none p-6 ${r.settings.typeface === 'sans' ? 'font-sans' : 'font-body'}`}
      style={{
        background: 'var(--bg-white)',
        color: 'var(--text-primary)',
        border: 'none',
        fontSize: `${Math.round((field === 'ocr' ? 17.5 : 18.5) * r.settings.textScale * 10) / 10}px`,
        lineHeight: r.settings.lineHeight,
        maxWidth: `${{ narrow: 55, comfortable: 70, wide: 86 }[r.settings.lineWidth]}ch`,
      }}
      data-reader-editor
      aria-label={field === 'ocr' ? 'Edit transcription' : 'Edit translation'}
    />
  );

  return (
    <div data-reader-v2 data-reader-theme={themeAttr(r.settings.theme)} className="flex flex-col h-[100dvh]">
      {/* Never in an embed or on a tenant subdomain. A partner reading room
          exists to hold one collection; a menu offering Explore, Works and
          Support sends the reader to URLs the tenant host 404s, and out of the
          room entirely. The old reader had no site chrome here at all. */}
      {siteMenuOpen && !isEmbedded && (
        <ReaderSiteMenu
          onClose={() => setSiteMenuOpen(false)}
          spanishAvailable={spanishEligible(r.currentPage)}
        />
      )}
      <Suspense fallback={null}>
        <SearchHighlighter />
      </Suspense>
      {/* shrink-0, and the frames below take the remainder. As an in-flow
          sibling of two h-[100dvh] blocks it pushed the reader down by its own
          height, so on a phone the entire bottom toolbar sat below the fold of
          a document that cannot scroll. */}
      <div className="shrink-0">
        <Suspense fallback={null}>
          <PinnedVersionBanner
            bookId={r.book.id}
            pageId={r.currentPageId}
            onPinnedTranslation={setPinnedTranslation}
          />
        </Suspense>
      </div>
      {/* ── Desktop (lg+): fixed frame, panes scroll ─────────────────────── */}
      <div
        className="hidden lg:grid flex-1 min-h-0"
        /* minmax(0, 1fr), not 1fr: a bare fr track floors at min-content, so a
           single wide table in a text pane (star tables in the Arabic corpus)
           stretched the track to 700px a pane and pushed the header, the view
           toggles, the pager and the whole translation pane past the right
           edge — with html overflow hidden, unreachable. */
        style={{ gridTemplateColumns: '66px minmax(0, 1fr)', gridTemplateRows: '58px minmax(0, 1fr) auto' }}
      >
        {/* Top bar — full width, single identity lockup top-left */}
        <header
          className="col-span-2 flex items-center gap-3 px-4"
          style={{ background: INK, color: '#fdfcf9', borderBottom: `1px solid ${onInk(0.12)}` }}
        >
          {!isEmbedded && <Logo white compact />}
          {/* Left to right: the book you are in and, while editing it, the
              two buttons that end the edit. Everything on the right end is
              about the page rather than the book. Cancel and Save sit beside
              the title because that is where the edit began, and because a
              save button next to the view toggles reads as saving a view. */}
          <a
            href={embedHref(`/book/${r.bookPath}`)}
            className={`${BAR_CONTROL} min-w-0 max-w-[46%] no-underline group !justify-start gap-2 pl-1.5 pr-3`}
            style={barControlStyle()}
            title={t.toolbar.backToTheBook}
          >
            <ChevronLeft size={15} className="shrink-0" style={{ color: onInk(0.72) }} />
            <span className="min-w-0 flex-1 flex items-baseline gap-2.5">
              <span
                className="font-body text-[15.5px] leading-none truncate shrink min-w-0 group-hover:underline"
                style={{ color: '#fdfcf9', textUnderlineOffset: '3px', textDecorationColor: onInk(0.45) }}
              >
                {r.book.display_title || r.book.title}
              </span>
              {/* Hidden below xl rather than truncated: at 1024 a long title
                  left it exactly one character wide, which reads as a bug. */}
              <span className="hidden xl:inline font-sans text-[11.5px] leading-none truncate min-w-0" style={{ color: onInk(0.5) }}>
                {bookByline(r.book)}
              </span>
            </span>
          </a>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cancelEdits}
                className={`${BAR_CONTROL} px-3`}
                style={barControlStyle()}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={saving}
                className={`${BAR_CONTROL} gap-2 px-3 disabled:opacity-60 hover:!bg-[var(--accent-rust)] hover:brightness-110`}
                style={{ background: 'var(--accent-rust)', color: '#fdfcf9', borderColor: 'var(--accent-rust)' }}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {/* Always "Save": a button labelled Done beside an unsaved
                    edit invites you to leave without saving it. */}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : null}
          <div className="flex-1" />
          {saveError && (
            <span className="font-sans text-[12px] max-w-[260px] truncate" style={{ color: '#e8a793' }} role="alert">
              {saveError}
            </span>
          )}
          {/* Right end: what you are looking at, then where you are, set apart
              from each other so they read as two controls rather than one. */}
          <ViewToggleGroup views={r.views} onToggle={r.toggleView} compact showTranslit={translitEligible} />
          <div className="flex items-stretch ml-2 shrink-0">
            <div className="flex items-stretch">
              <button type="button" aria-label={t.toolbar.previousPage} onClick={r.goPrev}
                className={`${BAR_CONTROL} w-8`} style={barControlStyle()}>
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
                  /* 16px until lg: 1024 is iPad-portrait width, which is a
                     touch device on the desktop layout, and iOS zooms the
                     viewport for any control under 16px. */
                  className={`${BAR_CONTROL} w-16 text-center tabular-nums -mx-px text-[16px] lg:text-[13px]`}
                  style={{ ...barControlStyle(true), color: '#fdfcf9' }}
                  inputMode="numeric"
                  aria-label={t.toolbar.jumpToPage}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setJumpOpen(true)}
                  className={`${BAR_CONTROL} px-2.5 tabular-nums -mx-px`}
                  title={t.toolbar.jumpToPage}
                  style={{ ...barControlStyle(), color: '#fdfcf9' }}
                >
                  p. {pageNum}<span style={{ color: onInk(0.55) }}> / {r.pageList.length ? r.pageList[r.pageList.length - 1].page_number : r.totalPages}</span>
                </button>
              )}
              <button type="button" aria-label={t.toolbar.nextPage} onClick={r.goNext}
                className={`${BAR_CONTROL} w-8`} style={barControlStyle()}>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          {/* One menu, not two. The avatar used to open a second, smaller
              menu here while the phone had the hamburger, so the account sat
              somewhere different depending on the width of the window. */}
          {!isEmbedded && (
          <button
            type="button"
            onClick={() => setSiteMenuOpen(true)}
            aria-label={t.toolbar.menu}
            className={`${BAR_CONTROL} ml-2 w-9 shrink-0`}
            style={barControlStyle()}
          >
            <Menu size={19} />
          </button>
          )}
        </header>

        {/* Tool rail */}
        <nav
          className="row-span-2 flex flex-col items-center pt-3 gap-1"
          style={{ background: INK, borderRight: `1px solid ${onInk(0.12)}` }}
          aria-label={t.toolbar.readerToolsAria}
        >
          {/* Three groups. What you do with the page you are on comes first,
              because it is what a reader reaches for while reading and it is
              nearest the top of the rail. Then the ways through the book,
              which you use to arrive rather than to work. Settings is last
              because you set it once. */}
          <RailButton label={t.toolbar.save} active={leftPanel === 'save'} onClick={() => togglePanel('save')} icon={<Heart size={17} />} />
          <RailButton label={t.toolbar.share} active={leftPanel === 'share'} onClick={() => togglePanel('share')} icon={<Share2 size={17} />} />
          <RailButton label={t.toolbar.cite} active={leftPanel === 'cite'} onClick={() => togglePanel('cite')} icon={<Quote size={17} />} />
          <RailButton label={t.toolbar.download} active={leftPanel === 'downloads'} onClick={() => togglePanel('downloads')} icon={<Download size={17} />} />
          <RailButton label={t.toolbar.info} active={leftPanel === 'info'} onClick={() => togglePanel('info')} icon={<Info size={17} />} />

          <span className="w-6 my-1.5 shrink-0" style={{ borderTop: `1px solid ${onInk(0.14)}` }} aria-hidden="true" />

          <RailButton label={t.toolbar.contents} active={leftPanel === 'contents'} onClick={() => togglePanel('contents')} icon={<List size={17} />} />
          <RailButton label={t.toolbar.guide} active={leftPanel === 'guide'} onClick={() => togglePanel('guide')} icon={<BookOpen size={17} />} />
          <RailButton label={t.toolbar.search} active={leftPanel === 'search'} onClick={() => togglePanel('search')} icon={<Search size={17} />} />
          <RailButton label={t.toolbar.librarian} active={leftPanel === 'librarian'} onClick={() => togglePanel('librarian')} icon={<MessageCircle size={17} />} />

          <span className="w-6 my-1.5 shrink-0" style={{ borderTop: `1px solid ${onInk(0.14)}` }} aria-hidden="true" />

          <RailButton label={t.toolbar.settings} active={leftPanel === 'settings'} onClick={() => togglePanel('settings')} icon={AaGlyph} />
          <RailButton label={t.toolbar.feedback} active={leftPanel === 'feedback'} onClick={() => togglePanel('feedback')} icon={<MessageSquare size={17} />} />
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
              title={t.toolbar.pages}
              className="w-12 h-[54px] flex flex-col items-center justify-center gap-1 transition-colors"
              style={{
                color: stripVisible ? '#fdfcf9' : onInk(0.62),
                background: stripVisible ? onInk(0.12) : 'transparent',
              }}
            >
              <GalleryHorizontal size={17} />
              <span className="font-sans text-[8.5px] tracking-[0.06em]">{t.toolbar.pages}</span>
            </button>
          </div>
        </nav>

        {/* Panes. A <main> because the root layout's skip link targets the
            reader as a whole, which meant "skip to main content" skipped
            nothing — the mobile column already had one, the desktop grid did
            not. */}
        <main
          key={browserTranslated ? `translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="relative flex min-h-0"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
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
                    onExpand={scan.native || witness ? () => setLightbox(true) : undefined}
                  />
                }
              >
                <CapsLabel as="h2" style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>{witness ? t.panes.tabletWitness : t.panes.originalScan}</CapsLabel>
              </PaneHeader>
              {/* `relative` because PageDeepZoomButton positions its control
                  and its inline viewer against the nearest positioned parent:
                  the tiled canvas fills this box, over the scan, while the
                  translation stays readable beside it. */}
              <div
                className={`relative flex-1 min-h-0 overflow-hidden ${scanZoom > 1 ? '' : 'px-6 py-[22px]'}`}
                data-no-page-swipe={scanZoom > 1 || lensOn ? '' : undefined}
              >
                <ScanViewer
                  page={r.currentPage}
                  book={r.book}
                  zoom={scanZoom}
                  onZoomChange={changeZoom}
                  lensOn={lensOn}
                  scrollRef={scanScrollRef}
                  onScroll={() => syncFrom('scan')}
                  srcOverride={witnessSrc}
                  nativeSrcOverride={witnessNativeSrc}
                  altOverride={witness ? t.panes.witnessAlt(witness.designation) : undefined}
                  onEdgePageTurn={onScanEdgeTurn}
                />
                {witness && (
                  <WitnessCaption
                    witness={witness}
                    index={((witnessIndex % witnessPhotos.length) + witnessPhotos.length) % witnessPhotos.length}
                    total={witnessPhotos.length}
                    onPrev={() => setWitnessIndex(i => i - 1)}
                    onNext={() => setWitnessIndex(i => i + 1)}
                    corpus={ocrCorpusInfo}
                  />
                )}
                {/* Tiled deep zoom, where the page has a tile pyramid. The
                    lightbox tops out at a 4000px render; this serves tiles, so
                    a reader can go to the native resolution of the scan and
                    only download the region they are looking at. 2,562 pages
                    across 180 books have a manifest. */}
                {deepzoomManifest && (
                  <PageDeepZoomButton
                    manifest={deepzoomManifest}
                    title={`${r.book.display_title || r.book.title} — ${t.search.pageLabel(r.currentPage.page_number)}`}
                  />
                )}
              </div>
            </section>
          )}
          {r.views.ocr && (
            <section
              data-reader-section="ocr"
              className="relative flex-1 min-w-0 flex flex-col border-r"
              style={{ background: SURFACE.ocr, borderColor: 'var(--border-medium)' }}
            >
              <PaneHeader right={!editing ? (
                <div className="flex items-center gap-1">
                  {traceShown && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)} language={r.book.language} disabledReason={traceDisabledReason} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  {r.settings.glosses && <MarksKey />}
                  <CopyTextButton page={r.currentPage} kind="ocr" />
                </div>
              ) : undefined}>
                <CapsLabel as="h2" style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
                  {paired ? 'Greek · Berthelot' : `${r.book.language || t.panes.originalFallback} · ${t.panes.viewOcr}`}
                </CapsLabel>
                {paired && <PairedBadgeRow paired={paired} />}
                {editing && <CapsLabel style={{ color: 'var(--accent-rust)' }}>Editing</CapsLabel>}
              </PaneHeader>
              {traceActive && <TraceStatusLine status={traceStatus} showHint={!tracedOnce} />}
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
                    {paired
                      ? <PairedTranscriptionProse paired={paired} page={r.currentPage} settings={r.settings} baseSize={17.5} />
                      : <ReaderProse suppressBlockquote={quotesDisagree} page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={17.5} />}
                  </div>
                </div>
              )}
            </section>
          )}
          {r.views.translit && translitEligible && (
            <section
              data-reader-section="transliteration"
              className="relative flex-1 min-w-0 flex flex-col border-r"
              style={{ background: SURFACE.popover, borderColor: 'var(--border-medium)' }}
            >
              <PaneHeader right={
                <div className="flex items-center gap-1">
                  {traceShown && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)} language={r.book.language} disabledReason={traceDisabledReason} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  {r.settings.glosses && <MarksKey />}
                  <CopyPlainButton text={translit} label={t.panes.copyTransliteration} />
                </div>
              }>
                <CapsLabel as="h2" style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>{t.panes.romanisedHeader}</CapsLabel>
                <AiChip short />
              </PaneHeader>
              {traceActive && <TraceStatusLine status={traceStatus} showHint={!tracedOnce} />}
              <div
                ref={translitRef}
                data-reader-panel
                onScroll={() => syncFrom('translit')}
                className="flex-1 min-h-0 overflow-y-auto px-8 py-[26px]"
                style={{ overscrollBehavior: 'contain' }}
              >
                <div key={r.currentPageId} className="rv2-page-in">
                  <TranslitBody text={translit} loading={translitLoading} error={translitError}
                    settings={r.settings} baseSize={16.5}
                    ocrLength={r.currentPage.ocr?.data?.length ?? 0} />
                </div>
              </div>
            </section>
          )}
          {r.views.en && (
            <section data-reader-section="translation" className="relative flex-1 min-w-0 flex flex-col" style={{ background: SURFACE.translation }}>
              <PaneHeader right={!editing ? (
                <div className="flex items-center gap-1">
                  {traceShown && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)} language={r.book.language} disabledReason={traceDisabledReason} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  {r.settings.glosses && <MarksKey />}
                  {showingSpanish
                    ? <CopySpanishButton page={r.currentPage} />
                    : <CopyTextButton page={r.currentPage} kind="translation" />}
                </div>
              ) : undefined}>
                {paired ? (
                  <CapsLabel as="h2" style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>English · Berthelot</CapsLabel>
                ) : (
                  <TranslationLanguageHeader
                    lang={r.settings.translationLang}
                    onChange={(l) => r.updateSettings({ translationLang: l })}
                    spanishAvailable={spanishAvailable}
                    editing={editing}
                  />
                )}
                {/* A corpus translation is the corpus editors' work, not AI's —
                    say so where the reader is looking (#4350). */}
                {translationCorpusInfo && !paired && !showingSpanish && <CorpusChip corpus={translationCorpusInfo} />}
                {editing && <CapsLabel style={{ color: 'var(--accent-rust)' }}>Editing</CapsLabel>}
              </PaneHeader>
              {traceActive && <TraceStatusLine status={traceStatus} showHint={!tracedOnce} />}
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
                    {paired
                      ? <PairedTranslationProse paired={paired} page={r.currentPage} settings={r.settings} baseSize={18.5} />
                      : showingSpanish
                      ? <SpanishProse page={r.currentPage} settings={r.settings} baseSize={18.5} suppressBlockquote={quotesDisagree} />
                      : <ReaderProse suppressBlockquote={quotesDisagree} page={displayPage} book={r.book} kind="translation" settings={r.settings} baseSize={18.5} />}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Left slide-out panel (Contents / Search / Settings) */}
          {leftPanel && isDesktop && (
            <div
              role="dialog"
              aria-labelledby="rv2-panel-title"
              data-no-page-swipe=""
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
                  <CapsLabel as="h2" id="rv2-panel-title" style={{ color: 'var(--text-muted)' }}>{leftPanelTitle}</CapsLabel>
                  <button type="button" aria-label={t.panels.closeAria(leftPanelTitle)} onClick={() => setLeftPanel(null)}
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
        </main>

        {/* Filmstrip — page control, collapses smoothly */}
        <div
          className="col-start-2 min-w-0 overflow-hidden transition-[height] duration-300 ease-out"
          /* visibility, not just height: a zero-height overflow-hidden box
             still holds focusable children, so a collapsed strip left every
             page in the book in the tab order — hundreds of invisible stops.
             visibility still animates, so the collapse is unchanged. */
          style={{ height: stripVisible ? 92 : 0, visibility: stripVisible ? 'visible' : 'hidden' }}
        >
          <div className="h-[92px]">
            {/* isDesktop, not CSS. Both layouts live in the DOM with one
                hidden by `hidden lg:grid` / `lg:hidden`, and display:none
                hides a subtree without unmounting it — so the strip rendered
                EVERY page of the book twice, thumbnail URLs and all, and
                re-rendered both copies on every panel toggle and every scroll
                that flipped the bar. 463 public books exceed 1,000 pages and
                the largest is 4,198, which is ~8,400 buttons and images for
                one reader. And `mounted`, because on the server isDesktop is
                a guess: see where it is declared. */}
            {mounted && isDesktop && (
            <Filmstrip
              pageList={r.pageList}
              currentPageId={r.currentPageId}
              compact={false}
              innerRef={stripRef}
              onPrev={r.goPrev}
              onNext={r.goNext}
              onGoTo={r.goToPage}
            />
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile / tablet (<lg): stacked panes, filmstrip pinned ───────── */}
      {/* overflowX clip: the drag-follow translates the column, and a
          transformed element's bounds extend the PAGE's scrollable overflow —
          iOS then natively panned the whole document sideways (title bar,
          filmstrip, toolbar and all) and could leave it stuck there. Clipped
          here, only the column can ever move. `clip`, not `hidden`: hidden
          would quietly turn this box into a scroll container. */}
      <div className="lg:hidden relative flex flex-col flex-1 min-h-0" style={{ overflowX: 'clip' }}>
        {/* The bar floats over the column rather than sitting above it in the
            flow. It used to animate its own height, which resized the scroller
            under the reader and shoved the text down the screen every time it
            came back. The column carries a permanent lead-in of the same
            height instead, so at the top of a page nothing looks different and
            nothing ever moves. */}
        <header
          className="absolute top-0 left-0 right-0 z-[60]"
          style={{
            height: BAR_H,
            background: INK,
            color: '#fdfcf9',
            // Also away while a sheet is open. The sheet is a modal with its
            // own title and its own way out, and it is tall enough to reach
            // the top of the screen — where it slid UNDER this bar, taking the
            // grab handle with it and clipping the close button into a flat
            // white square. Nothing to collide with, and the sheet gets the
            // height back.
            transform: barHidden || sheetOpen ? 'translateY(-100%)' : 'none',
            // Same reason as the filmstrips: a bar off the top of the screen
            // still held a focusable back-link and menu button, and aria-hidden
            // over them made that worse rather than better.
            visibility: barHidden || sheetOpen ? 'hidden' : 'visible',
            // visibility is in the transition on purpose. It is a discrete
            // property, so transitioning it holds the old value for the whole
            // duration instead of applying at once — without that the contents
            // were cut off the screen while the bar was still leaving.
            transition: `transform ${BAR_MS}ms ${BAR_EASE}, visibility ${BAR_MS}ms ${BAR_EASE}`,
          }}
        >
          {/* The row fades with the bar rather than being revealed by it.
              Animating only the height meant the contents were already painted
              at full strength in a 4px-tall box, so the avatar — the tallest
              thing in the row — appeared first and the rest caught up. */}
          <div
            className="flex items-center gap-2.5 h-[52px] px-3"
            style={{
              opacity: barHidden ? 0 : 1,
              transition: `opacity ${BAR_MS}ms ${BAR_EASE}`,
            }}
          >
            {/* Circles-only mark (the wordmark stays a desktop affordance) */}
            {/* Sized to match the account avatar beside it — the two circles
                sit at opposite ends of the same bar and read as a pair. */}
            {!isEmbedded && (
              <span className="shrink-0 flex items-center justify-center [&_svg]:w-8 [&_svg]:h-8">
                <Logo white mini />
              </span>
            )}
            <a
              href={embedHref(`/book/${r.bookPath}`)}
              className="flex-1 min-w-0 no-underline"
              title={t.toolbar.backToTheBookPage}
            >
              {/* Title only: the author lives on the book page, and the phone
                  bar has no room to stack two lines */}
              <div className="font-body text-[15px] truncate" style={{ color: '#fdfcf9' }}>
                {r.book.display_title || r.book.title}
              </div>
            </a>
            {/* One button rather than a bare avatar: the account, Support and
                Feedback all live behind it, which is where a phone expects
                them and where they stop competing with the reading controls. */}
            {!isEmbedded && (
              <button
                type="button"
                onClick={() => setSiteMenuOpen(true)}
                aria-label={t.toolbar.menu}
                className="w-11 h-11 -mr-1 shrink-0 flex items-center justify-center transition-colors"
                style={{ color: onInk(0.85) }}
              >
                <Menu size={19} />
              </button>
            )}
          </div>
        </header>

        <main
          ref={mobileMainRef}
          key={browserTranslated ? `m-translated-${r.currentPageId}` : undefined}
          data-reader-panels-container
          className="flex-1 min-h-0 overflow-y-auto flex flex-col"
          style={{
            overscrollBehavior: 'contain',
            // The turn animation slides the panes in from the side, and a pane
            // sitting 14px to the right is 14px of scrollable width the browser
            // will scroll sideways to reach — the turn jiggled and could be
            // left horizontally scrolled if you touched it mid-flight.
            overflowX: 'hidden',
            background: lastSurface,
            // No scroll-snap here. A proximity snap on the pager made the
            // scroller grab at the finger near the foot of every page, which
            // reads as sticking — worse than the overshoot it was meant to fix.
            WebkitOverflowScrolling: 'touch',
          }}
          onScroll={onMobileScroll}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          {/* The floating bar's share of the column. Fixed, so the reading
              area never changes size and the text never shifts. */}
          <div className="shrink-0" style={{ height: BAR_H }} aria-hidden="true" />
          {r.views.scan && !scan.display && !witness && (
            /* No facsimile: one quiet line instead of a scan-sized empty bed.
               The full-height placeholder read as an image that failed to
               load — "the shimmer of empty pages" (#4385). */
            <section className="border-b" style={{ background: SURFACE.scanBed, borderColor: 'var(--border-medium)' }}>
              <div className="min-h-[34px] flex items-center px-4 py-1.5">
                <span className="font-sans text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  {t.panes.noFacsimile}
                </span>
              </div>
            </section>
          )}
          {r.views.scan && (scan.display || witness) && (
            <section style={{ background: SURFACE.scanBed }}>
              <div className="h-[34px] flex items-center justify-between pl-4 pr-1 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <CapsLabel style={{ color: 'var(--text-muted)' }}>{witness ? t.panes.tabletWitness : t.panes.originalScan}</CapsLabel>
                <ScanControls
                  compact
                  zoom={scanZoom}
                  onZoomStep={zoomStep}
                  onZoomReset={() => changeZoom(1)}
                  lensOn={lensOn}
                  onToggleLens={() => setLensOn(v => !v)}
                  onExpand={scan.native || witness ? () => setLightbox(true) : undefined}
                />
              </div>
              {/* Zoom/pan and the lens need the touch stream, so keep those
                  gestures from also turning the page. Full-bleed: the pane is
                  as wide as the phone and as tall as the page's own shape —
                  the old fixed 66dvh box left the scan floating in padding
                  ("the width should fill to the ends", #4385). */}
              <div
                className="relative"
                style={{
                  aspectRatio: String(scanRatio),
                  // The exception to full-bleed: an extreme ratio (a scroll,
                  // a strip, a foldout) would otherwise make the pane several
                  // screens tall — cap those and let the viewer letterbox.
                  // ONLY those: a maxHeight on a normal page transfers back
                  // through aspect-ratio into a narrower box, quietly shaving
                  // the full-width promise on every tall-ish page.
                  maxHeight: scanRatio < 0.55 ? 'min(85dvh, 700px)' : undefined,
                }}
                data-no-page-swipe={scanZoom > 1 || lensOn ? '' : undefined}
              >
                <ScanViewer
                  page={r.currentPage} book={r.book} zoom={scanZoom} onZoomChange={changeZoom} lensOn={lensOn}
                  srcOverride={witnessSrc}
                  nativeSrcOverride={witnessNativeSrc}
                  altOverride={witness ? t.panes.witnessAlt(witness.designation) : undefined}
                  onNaturalSize={onScanNaturalSize}
                  onEdgePageTurn={onScanEdgeTurn}
                />
                {witness && (
                  <WitnessCaption
                    witness={witness}
                    index={((witnessIndex % witnessPhotos.length) + witnessPhotos.length) % witnessPhotos.length}
                    total={witnessPhotos.length}
                    onPrev={() => setWitnessIndex(i => i - 1)}
                    onNext={() => setWitnessIndex(i => i + 1)}
                    corpus={ocrCorpusInfo}
                  />
                )}
                {/* On a phone this opens the fullscreen viewer directly —
                    inline pan/zoom fights the swipe between pages. */}
                {deepzoomManifest && (
                  <PageDeepZoomButton
                    manifest={deepzoomManifest}
                    title={`${r.book.display_title || r.book.title} — ${t.search.pageLabel(r.currentPage.page_number)}`}
                  />
                )}
              </div>
            </section>
          )}
          {r.views.ocr && (
            <section data-reader-section="ocr" className="relative border-t" style={{ background: SURFACE.ocr, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center justify-between px-4 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <CapsLabel style={{ color: 'var(--text-muted)' }}>
                  {paired ? 'Greek · Berthelot' : `${r.book.language || t.panes.originalFallback} · ${t.panes.viewOcr}`}
                </CapsLabel>
                {paired && <PairedBadgeRow paired={paired} />}
                <div className="flex items-center gap-1">
                  {traceShown && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)} language={r.book.language} disabledReason={traceDisabledReason} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  {r.settings.glosses && <MarksKey />}
                  <CopyTextButton page={r.currentPage} kind="ocr" />
                </div>
              </div>
              <div data-reader-panel className="px-[22px] pt-4 pb-8">
                {paired
                      ? <PairedTranscriptionProse paired={paired} page={r.currentPage} settings={r.settings} baseSize={16} />
                      : <ReaderProse suppressBlockquote={quotesDisagree} page={r.currentPage} book={r.book} kind="ocr" settings={r.settings} baseSize={16} />}
              </div>
            </section>
          )}
          {r.views.translit && translitEligible && (
            <section data-reader-section="transliteration" className="relative border-t" style={{ background: SURFACE.popover, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center justify-between px-4 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <div className="flex items-center gap-2">
                  <CapsLabel style={{ color: 'var(--text-muted)' }}>{t.panes.romanisedHeader}</CapsLabel>
                  <AiChip short />
                </div>
                <CopyPlainButton text={translit} label={t.panes.copyTransliteration} />
              </div>
              <div data-reader-panel className="px-[22px] pt-4 pb-6">
                <TranslitBody text={translit} loading={translitLoading} error={translitError}
                  settings={r.settings} baseSize={16}
                  ocrLength={r.currentPage.ocr?.data?.length ?? 0} />
              </div>
            </section>
          )}
          {r.views.en && (
            <section data-reader-section="translation" className="relative border-t" style={{ background: SURFACE.translation, borderColor: 'var(--border-medium)' }}>
              <div className="h-[34px] flex items-center justify-between px-4 border-b" style={{ borderColor: 'var(--border-medium)' }}>
                <div className="flex items-center gap-2">
                  <TranslationLanguageHeader
                    lang={r.settings.translationLang}
                    onChange={(l) => r.updateSettings({ translationLang: l })}
                    spanishAvailable={spanishAvailable}
                    editing={editing}
                  />
                  {translationCorpusInfo && !paired && !showingSpanish && <CorpusChip corpus={translationCorpusInfo} />}
                </div>
                <div className="flex items-center gap-1">
                  {traceShown && (
                    <TraceToggle on={traceOn} onToggle={() => setTraceOn(v => !v)} language={r.book.language} disabledReason={traceDisabledReason} />
                  )}
                  <NotesToggle on={r.settings.glosses} onToggle={() => r.updateSettings({ glosses: !r.settings.glosses })} />
                  {r.settings.glosses && <MarksKey />}
                  {showingSpanish
                    ? <CopySpanishButton page={r.currentPage} />
                    : <CopyTextButton page={r.currentPage} kind="translation" />}
                </div>
              </div>
              <div data-reader-panel className="px-[22px] pt-4 pb-6">
                {paired
                  ? <PairedTranslationProse paired={paired} page={r.currentPage} settings={r.settings} baseSize={16} />
                  : showingSpanish
                  ? <SpanishProse page={r.currentPage} settings={r.settings} baseSize={16} suppressBlockquote={quotesDisagree} />
                  : <ReaderProse suppressBlockquote={quotesDisagree} page={displayPage} book={r.book} kind="translation" settings={r.settings} baseSize={16} />}
              </div>
            </section>
          )}

          {/* Fills whatever is left when the page is short, in the last
              visible pane's colour, so no white band shows above the pager */}
          <div className="flex-1" style={{ background: lastSurface }} />

          {/* End of the scroll: page turn where the reading actually ends
              (swiping left/right anywhere in this scroller does the same).
              It is the last thing in the scroller, and the strip and toolbar
              sit under the scroller's bottom edge, so it needs its own room
              or it arrives half-covered exactly when you reach for it. */}
          <div
            className="shrink-0 flex items-center justify-between border-t px-2"
            style={{
              borderColor: 'var(--border-medium)',
              background: SURFACE.panel,
            }}
          >
            <button
              type="button"
              onClick={r.goPrev}
              disabled={!prevPage}
              aria-label={t.toolbar.previousPage}
              className="min-h-[56px] px-4 flex items-center gap-1.5 font-sans text-[13px] disabled:opacity-30"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={16} /> {t.toolbar.previous}
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
              aria-label={t.toolbar.nextPage}
              className="min-h-[56px] px-4 flex items-center gap-1.5 font-sans text-[13px] disabled:opacity-30"
              style={{ color: 'var(--accent-rust)' }}
            >
              {t.toolbar.next} <ChevronRight size={16} />
            </button>
          </div>
        </main>

        {/* Tool panel — rises from the toolbar, clearing the filmstrip. While
            the keyboard is up it sits directly on the keyboard instead (the
            toolbar and strip are behind it), so the field being typed in and
            its results stay on screen. */}
        {/* Something to tap that is not a 16px glyph. The sheet had no ground
            behind it, so the only way out was the corner button — with a panel
            of content between your thumb and it. */}
        {leftPanel && !isDesktop && (
          <button
            type="button"
            aria-label={t.panels.closeAria(leftPanelTitle)}
            onClick={() => setLeftPanel(null)}
            className="fixed left-0 right-0 top-0 z-40 rv2-scrim"
            style={{ bottom: keyboardInset > 0 ? keyboardInset : MOBILE_TOOLBAR_H }}
          />
        )}
        {leftPanel && !isDesktop && (
          <div
            ref={sheetRef}
            className="fixed left-0 right-0 z-50 border-t flex flex-col rv2-slide-up transition-[height,bottom] duration-200 ease-out"
            style={{
              // From the toolbar, over the filmstrip rather than above it.
              // Clearing the strip cost the sheet 96px it does not have to
              // spare, to keep a row of page thumbnails visible behind a menu
              // nobody opened to look at thumbnails.
              bottom: keyboardInset > 0 ? keyboardInset : MOBILE_TOOLBAR_H,
              height: sheetHeight ?? undefined,
              maxHeight: keyboardInset > 0
                ? undefined
                : `calc(100dvh - ${MOBILE_TOOLBAR_H + SHEET_TOP_GAP}px)`,
              background: SURFACE.panel, borderColor: 'var(--border-medium)',
              boxShadow: '0 -24px 48px -28px rgba(30,20,8,0.5)',
            }}
            role="dialog"
            aria-labelledby="rv2-sheet-title"
          >
            {/* The header is also the grip: the handle says the sheet can be
                pushed away, and the whole band answers the drag, so the pull
                works wherever the thumb lands rather than on a 4px bar. */}
            <div
              className="shrink-0 px-4 pb-2.5 border-b select-none"
              style={{ borderColor: 'var(--border-light)', background: PANEL_HEADER_BG, touchAction: 'none' }}
              onTouchStart={onSheetDragStart}
              onTouchMove={onSheetDragMove}
              onTouchEnd={onSheetDragEnd}
              onTouchCancel={onSheetDragEnd}
            >
              {/* Square, like everything else here: globals.css flattens every
                  rounded-* utility site-wide with !important, so a pill grip or
                  a round close button silently becomes a block. */}
              <div className="flex justify-center pt-2.5 pb-2">
                <span
                  aria-hidden="true"
                  className="block"
                  style={{ width: 40, height: 4, background: 'color-mix(in srgb, var(--bg-dark) 22%, transparent)' }}
                />
              </div>
              {/* One fixed row: back (when there is somewhere to go back to),
                  title, close. Close holds the top-right corner whatever else
                  is in the row — it used to shift down whenever a back button
                  appeared above it. */}
              <div className="flex items-center gap-2 min-h-[44px]">
                {MORE_TOOLS.some(k => k === leftPanel) && (
                  <button
                    type="button"
                    aria-label={t.panels.backToMore}
                    onClick={() => setLeftPanel('more')}
                    className="w-11 h-11 shrink-0 -ml-1.5 flex items-center justify-center transition-colors active:bg-[var(--bg-white)]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ChevronLeft size={20} />
                  </button>
                )}
                <CapsLabel as="h2" id="rv2-sheet-title" className="flex-1 min-w-0 truncate !text-[12px] tracking-[0.13em]" style={{ color: 'var(--text-primary)' }}>{leftPanelTitle}</CapsLabel>
                {/* 20px in a 44px target, on the header's own ground. A 16px
                    cross on a bare band read as decoration rather than the way
                    out — and it is no longer the only way out: the ground
                    behind the sheet and a pull on this bar both close it. */}
                <button
                  type="button"
                  aria-label={t.panels.closeAria(leftPanelTitle)}
                  onClick={() => setLeftPanel(null)}
                  className="w-11 h-11 shrink-0 -mr-1.5 flex items-center justify-center transition-colors active:bg-[var(--bg-white)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <X size={20} />
                </button>
              </div>
              {leftPanelBlurb && (
                <p className="mt-0.5 pr-10 pb-1 font-sans text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
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
          /* See the desktop strip above. aria-hidden is gone with it: it was
             wrapping focusable buttons, which hands a screen-reader user focus
             on something it has just told them is not there. */
          style={{
            height: stripVisible && keyboardInset === 0 ? 96 : 0,
            visibility: stripVisible && keyboardInset === 0 ? 'visible' : 'hidden',
          }}
        >
          <div className="h-[96px]">
            {/* See the desktop strip: one layout at a time, and not until the
                client knows which one. */}
            {mounted && !isDesktop && (
              <Filmstrip
                pageList={r.pageList}
                currentPageId={r.currentPageId}
                compact
                innerRef={stripMobileRef}
                onPrev={r.goPrev}
                onNext={r.goNext}
                onGoTo={r.goToPage}
              />
            )}
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
          srcOverride={witnessNativeSrc}
          altOverride={witness ? t.panes.witnessAlt(witness.designation) : undefined}
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
