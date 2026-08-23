'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';
import { CapsLabel, onInk } from './ReaderV2Bits';

// ─── Citation-pinned reading (?v=) ───────────────────────────────────────────
//
// A version-pinned citation link (`/book/x/page/y?v=1.0.0`) is a promise that
// what the reader sees is the text a citation was made against, not whatever
// the live translation happens to say today. The old reader
// (PageEditorClient.tsx, now retired behind the redesign) kept that promise:
// it detected `?v=`, fetched `/api/books/[id]/edition-page`, and overlaid the
// pinned translation with a banner. Reader2C has neither, so a version-pinned
// link into the redesigned reader silently shows the CURRENT text with no
// indication it may differ from what was cited — a citation-integrity bug on
// a platform whose whole point is citable primary sources.
//
// This file is the self-contained replacement: a hook that resolves the pin
// and a banner that makes it unmistakable. It does not touch Reader2C.tsx —
// see the file-level comment below for the mount snippet.

export interface PinnedEditionInfo {
  version: string;
  versionLabel?: string;
  publishedAt: string; // ISO date string
  isCurrentVersion: boolean;
  doi?: string;
  doiUrl?: string;
}

export type PinnedVersionError = 'not_found' | 'fetch_failed' | null;

export interface PinnedVersionResult {
  /** The raw `?v=` value, or null when the URL isn't citation-pinned. */
  pinnedVersion: string | null;
  /**
   * The pinned translation text for the CURRENT page, once resolved. Null
   * while loading, when not pinned, or when this page isn't covered by the
   * cited edition — in all those cases the caller should fall back to the
   * page's live translation, same as `pinnedVersion == null`.
   */
  pinned: string | null;
  /** Edition metadata for the banner / cite panel, once resolved. Persists across a 404 on a later page so the banner can keep saying which edition is cited. */
  edition: PinnedEditionInfo | null;
  loading: boolean;
  error: PinnedVersionError;
  /** Ready-to-render banner (null when not pinned). Sits above the panes, never inline in the text. */
  banner: React.ReactNode;
}

interface FetchState {
  /** `${version}:${pageId}` this data was resolved for — see `requestKey` below. */
  key: string;
  pinned: string | null;
  edition: PinnedEditionInfo | null;
  error: PinnedVersionError;
}

const IDLE: FetchState = { key: '', pinned: null, edition: null, error: null };

/**
 * Resolves a citation-pinned page and returns both the pinned text and a
 * ready-to-render banner.
 *
 * Reads `?v=` via `useSearchParams`, so — same as `SearchHighlighter` in
 * Reader2C.tsx — the component that calls this hook must sit inside a
 * `<Suspense>` boundary. Use the `PinnedVersionBanner` component below rather
 * than calling this hook directly from Reader2C's top-level body, so only
 * that small component suspends (mirrors the existing SearchHighlighter
 * pattern instead of forcing the whole reader under a boundary).
 */
export function usePinnedVersion(bookId: string, pageId: string): PinnedVersionResult {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const v = searchParams.get('v');
  // Identifies which (version, page) a resolved `state` belongs to, so a
  // page flip while pinned can never show the PREVIOUS page's pinned text
  // under the new page's banner while the new fetch is still in flight.
  const requestKey = v ? `${v}:${pageId}` : '';

  const [state, setState] = useState<FetchState>(IDLE);

  useEffect(() => {
    if (!v) return; // render below falls back to IDLE; nothing to fetch or clear.
    let cancelled = false;
    const key = `${v}:${pageId}`;

    fetch(`/api/books/${encodeURIComponent(bookId)}/edition-page?page_id=${encodeURIComponent(pageId)}&v=${encodeURIComponent(v)}`)
      .then(async res => {
        if (cancelled) return;
        if (res.status === 404) {
          // Version doesn't exist on this book, or this page isn't in that
          // edition's snapshot. Keep whatever edition metadata we already
          // have (e.g. from the page the reader landed on) so the banner can
          // still say which edition is cited rather than going silent.
          setState(prev => ({ key, pinned: null, edition: prev.edition, error: 'not_found' }));
          return;
        }
        if (!res.ok) {
          setState(prev => ({ key, pinned: null, edition: prev.edition, error: 'fetch_failed' }));
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setState({
          key,
          pinned: typeof data.translation === 'string' ? data.translation : null,
          edition: data.edition ? {
            version: data.edition.version,
            versionLabel: data.edition.versionLabel,
            publishedAt: data.edition.publishedAt,
            isCurrentVersion: !!data.is_current_version,
            doi: data.edition.doi,
            doiUrl: data.edition.doiUrl,
          } : null,
          error: null,
        });
      })
      .catch(() => {
        if (!cancelled) setState(prev => ({ key, pinned: null, edition: prev.edition, error: 'fetch_failed' }));
      });

    return () => { cancelled = true; };
  }, [v, bookId, pageId]);

  // Settled once `state` was written for the exact (version, page) currently
  // requested — until then we're loading it (or nothing was ever requested).
  const settled = !!v && state.key === requestKey;
  const loading = !!v && !settled;
  // Never surface pinned text (or an error) for a DIFFERENT page than the one
  // being rendered — that would be citing the wrong passage. Edition metadata
  // is lower-stakes and stays visible across the gap so the banner doesn't
  // flicker blank on every page turn.
  const pinned = settled ? state.pinned : null;
  const error = settled ? state.error : null;
  const edition = v ? state.edition : null;

  const banner = v
    ? (
      <PinnedBanner
        v={v}
        edition={edition}
        loading={loading}
        error={error}
        currentPageUrl={pathname}
      />
    )
    : null;

  return {
    pinnedVersion: v,
    pinned,
    edition,
    loading,
    error,
    banner,
  };
}

/**
 * The visible chrome: an ink ribbon above the panes, in the same surface
 * family as the top bar (`INK = var(--bg-dark)` in Reader2C) rather than any
 * of the four inline accent hues (violet/sage/gold/rust) or the two literals
 * (trace's #4a6fa5, the reader's own #3f7d70 highlight teal). Every one of
 * those six colours already marks something INSIDE the text — a gloss, a
 * marginal note, an editorial note, the current filmstrip page, a trace
 * alignment, a reader's own highlight. "You are reading a cited, possibly
 * stale, edition" is not a mark on a span of text; it is a statement about
 * the whole page, at the same level as the header chrome above it — so it
 * borrows the header's own surface instead of adding a seventh hue to a
 * system that already spoken for every hue with headroom (rust~10°,
 * gold~38°, sage~87°, highlight-teal~170°, trace-blue~212°, violet~265°+).
 * The one exception is deliberate reuse, not a new claim: the "view current
 * edition" link uses `--accent-rust`, because rust already means "current"
 * everywhere else in this reader (the current filmstrip page, "current"
 * bookmarks/likes) — pointing a reader at the current text with the reader's
 * own colour for "current" reinforces the vocabulary instead of competing
 * with it.
 */
function PinnedBanner({
  v, edition, loading, error, currentPageUrl,
}: {
  v: string;
  edition: PinnedEditionInfo | null;
  loading: boolean;
  error: PinnedVersionError;
  currentPageUrl: string;
}) {
  const lang = useLocale();
  const t = getReaderStrings(lang).pinnedEdition;
  const wrapperStyle: React.CSSProperties = {
    background: 'var(--bg-dark)',
    color: onInk(0.85),
    borderBottom: `1px solid ${onInk(0.12)}`,
  };

  if (!edition && loading) {
    return (
      <div
        className="px-4 py-2 font-sans text-[12.5px] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center"
        style={wrapperStyle}
        role="status"
      >
        <CapsLabel style={{ color: onInk(0.55) }}>{t.citedVersion}</CapsLabel>
        <span>{t.resolving}</span>
      </div>
    );
  }

  if (!edition) {
    // Errored before we ever got edition metadata — version unknown, book has
    // no editions, or this landing page isn't in any edition. Still an
    // unmistakable notice: showing the current text is a silent substitution
    // otherwise, exactly the bug this file exists to close.
    return (
      <div
        className="px-4 py-2.5 font-sans text-[12.5px] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center"
        style={wrapperStyle}
        role="alert"
      >
        <CapsLabel style={{ color: onInk(0.55) }}>{t.citedVersion}</CapsLabel>
        <span>{t.unresolvable(v)}</span>
        <a href={currentPageUrl} className="underline font-medium" style={{ color: 'var(--accent-rust)' }}>
          {t.continueReadingLink}
        </a>
      </div>
    );
  }

  const label = edition.versionLabel ? `${edition.versionLabel} (v${edition.version})` : `v${edition.version}`;
  const date = new Date(edition.publishedAt).toLocaleDateString(lang, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const pageMissingFromEdition = error === 'not_found';

  return (
    <div
      className="px-4 py-2.5 font-sans text-[12.5px] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center"
      style={wrapperStyle}
      role="status"
    >
      <CapsLabel style={{ color: onInk(0.55) }}>{t.citedVersion}</CapsLabel>
      {pageMissingFromEdition ? (
        <span>{t.pageNotInEdition(label, date)}</span>
      ) : (
        <span>
          {edition.isCurrentVersion
            ? t.readingEdition(label, date)
            : t.readingEditionRevised(label, date)}
        </span>
      )}
      {(pageMissingFromEdition || !edition.isCurrentVersion) && (
        <a href={currentPageUrl} className="underline font-medium" style={{ color: 'var(--accent-rust)' }}>
          {t.viewCurrentEdition}
        </a>
      )}
      {edition.doiUrl && (
        <a
          href={edition.doiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: onInk(0.65) }}
        >
          DOI
        </a>
      )}
    </div>
  );
}

export interface PinnedVersionBannerProps {
  bookId: string;
  pageId: string;
  /**
   * Called whenever the resolved pinned translation text changes (including
   * back to null, on unpin or on a page the edition doesn't cover). Read via
   * a ref internally, so it does not need to be memoised by the caller.
   */
  onPinnedTranslation: (pinned: string | null) => void;
}

/**
 * Mountable wrapper: resolves the pin, reports the text upward, renders the
 * banner. This is the piece that needs `<Suspense>` — see the mount snippet
 * below.
 */
export default function PinnedVersionBanner({ bookId, pageId, onPinnedTranslation }: PinnedVersionBannerProps) {
  const { pinned, banner } = usePinnedVersion(bookId, pageId);

  const callbackRef = useRef(onPinnedTranslation);
  useEffect(() => {
    callbackRef.current = onPinnedTranslation;
  }, [onPinnedTranslation]);
  useEffect(() => {
    callbackRef.current(pinned);
  }, [pinned]);

  return <>{banner}</>;
}

// ─── Mount snippet (for Reader2C.tsx — NOT applied here, see instructions) ──
//
//   const [pinnedTranslation, setPinnedTranslation] = useState<string | null>(null);
//   …
//   <Suspense fallback={null}>
//     <PinnedVersionBanner
//       bookId={book.id}
//       pageId={r.currentPage.id}
//       onPinnedTranslation={setPinnedTranslation}
//     />
//   </Suspense>
//   …
//   const displayPage = pinnedTranslation != null
//     ? { ...r.currentPage, translation: { ...(r.currentPage.translation ?? {}), data: pinnedTranslation } }
//     : r.currentPage;
//
// Feed `displayPage` (not `r.currentPage`) into whatever renders the
// translation pane (ReaderProse / NotesRenderer) so the pinned text replaces
// the live one exactly where the OCR pane keeps reading `r.currentPage`
// unchanged — a citation pins the TRANSLATION, not the transcription.
