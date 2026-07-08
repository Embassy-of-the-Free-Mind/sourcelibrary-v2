'use client';

/**
 * Reader trace mode (issue #3091): with trace on, clicking a phrase in the
 * translation pane highlights the span of the original-language OCR that
 * produced it (and vice versa). Alignment pairs come from
 * /api/books/[id]/pages/[pageId]/alignment — one cached flash-lite call per
 * page, span strings verbatim from the wrapper-stripped page text.
 *
 * Highlighting uses the CSS Custom Highlight API so we never mutate the DOM
 * that React (NotesRenderer) owns. Spans are located in the rendered DOM by
 * whitespace-normalized text search (src/lib/align-text.ts) — the same code
 * path the server used to verify the spans, so anything stored is findable
 * unless the renderer transformed it (tables, hidden notes), in which case a
 * click is a graceful no-op.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { normalizeForSearch, locateSpan, type NormalizedText } from '@/lib/align-text';
import type { AlignmentPair } from '@/lib/word-alignment';

interface TraceAlignmentProps {
  bookId: string;
  pageId: string;
  active: boolean;
  /** Reported so the toggle can show loading / explain unavailability. */
  onStatusChange?: (status: TraceStatus) => void;
}

export type TraceStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'rate_limited';

type Side = 'ocr' | 'translation';

interface PaneMap {
  /** Concatenated text of all text nodes in the pane. */
  text: string;
  norm: NormalizedText;
  /** Text nodes with their cumulative start offsets into `text`. */
  nodes: Array<{ node: Text; start: number }>;
}

const HIGHLIGHT_PRIMARY = 'sl-trace-primary';
const HIGHLIGHT_COUNTERPART = 'sl-trace-counterpart';

function highlightsSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as unknown as { Highlight?: unknown }).Highlight === 'function'
    && !!(CSS as unknown as { highlights?: unknown }).highlights;
}

function getPaneEl(side: Side): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-reader-section="${side}"] [data-reader-panel]`,
  );
}

function buildPaneMap(pane: HTMLElement): PaneMap {
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number }> = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  return { text, norm: normalizeForSearch(text), nodes };
}

/** Map a raw offset in the pane's concatenated text to a DOM point. */
function offsetToPoint(map: PaneMap, offset: number): { node: Text; offset: number } | null {
  let lo = 0, hi = map.nodes.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (map.nodes[mid].start <= offset) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (best === -1) return null;
  const entry = map.nodes[best];
  return { node: entry.node, offset: Math.min(offset - entry.start, entry.node.data.length) };
}

function rangeFromOffsets(map: PaneMap, start: number, end: number): Range | null {
  const a = offsetToPoint(map, start);
  const b = offsetToPoint(map, Math.max(start, end - 1));
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, Math.min(b.offset + 1, b.node.data.length));
  return range;
}

/** Raw offset in the concatenated pane text of a (textNode, offset) DOM point. */
function pointToOffset(map: PaneMap, node: Node, offset: number): number | null {
  const entry = map.nodes.find((e) => e.node === node);
  if (!entry) return null;
  return entry.start + offset;
}

/** Raw offset → offset in the normalized string (largest normIdx whose rawIdx ≤ raw). */
function rawToNorm(norm: NormalizedText, raw: number): number {
  let lo = 0, hi = norm.rawIdx.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (norm.rawIdx[mid] <= raw) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

interface PairInterval {
  pairIndex: number;
  start: number;      // raw offsets in pane text
  end: number;
  normStart: number;
}

/**
 * Locate every pair's span on one side of the rendered DOM, walking in
 * stored-offset order with a moving cursor so repeated phrases bind to
 * successive occurrences (mirrors resolveAlignmentPairs on the server).
 */
function locatePairIntervals(map: PaneMap, pairs: AlignmentPair[], side: Side): PairInterval[] {
  const order = pairs
    .map((_, i) => i)
    .sort((a, b) => (side === 'ocr' ? pairs[a].so - pairs[b].so : pairs[a].to - pairs[b].to));
  const out: PairInterval[] = [];
  let cursor = 0;
  for (const i of order) {
    const span = side === 'ocr' ? pairs[i].s : pairs[i].t;
    const hit = locateSpan(map.norm, span, cursor);
    if (!hit) continue;
    cursor = hit.normStart + 1;
    out.push({ pairIndex: i, start: hit.start, end: hit.end, normStart: hit.normStart });
  }
  return out;
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  return null;
}

function setHighlight(name: string, range: Range | null) {
  if (!highlightsSupported()) return;
  const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  if (range) {
    const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    registry.set(name, new HighlightCtor(range));
  } else {
    registry.delete(name);
  }
}

function clearHighlights() {
  setHighlight(HIGHLIGHT_PRIMARY, null);
  setHighlight(HIGHLIGHT_COUNTERPART, null);
}

/** Scroll a range to the vertical center of its pane's scroll container. */
function scrollRangeIntoPane(pane: HTMLElement, range: Range) {
  const rect = range.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  // Desktop panes are their own scroll containers; on mobile the window
  // scrolls. Handle both by adjusting whichever actually overflows.
  if (pane.scrollHeight > pane.clientHeight + 4) {
    pane.scrollTo({
      top: pane.scrollTop + (rect.top - paneRect.top) - pane.clientHeight / 2 + rect.height / 2,
      behavior: 'smooth',
    });
  } else {
    window.scrollTo({
      top: window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2,
      behavior: 'smooth',
    });
  }
}

interface SheetState {
  /** The counterpart snippet to show (original text when English clicked, and vice versa). */
  snippet: string;
  counterpartSide: Side;
  scrollTo: () => void;
}

export default function TraceAlignment({ bookId, pageId, active, onStatusChange }: TraceAlignmentProps) {
  const [pairs, setPairs] = useState<AlignmentPair[] | null>(null);
  const [status, setStatusRaw] = useState<TraceStatus>('idle');
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const statusRef = useRef<TraceStatus>('idle');
  const pairsRef = useRef<AlignmentPair[] | null>(null);

  const setStatus = useCallback((s: TraceStatus) => {
    statusRef.current = s;
    setStatusRaw(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  // Fetch alignment when trace turns on or the page changes.
  useEffect(() => {
    setPairs(null);
    pairsRef.current = null;
    setSheet(null);
    clearHighlights();
    if (!active) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    fetch(`/api/books/${bookId}/pages/${pageId}/alignment`, { signal: controller.signal })
      .then((res) => (res.status === 429 ? { status: 'rate_limited' } : res.json()))
      .then((data: { status: string; pairs?: AlignmentPair[] }) => {
        if (data.status === 'ready' && data.pairs && data.pairs.length > 0) {
          setPairs(data.pairs);
          pairsRef.current = data.pairs;
          setStatus('ready');
        } else if (data.status === 'rate_limited') {
          setStatus('rate_limited');
        } else {
          setStatus('unavailable');
        }
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setStatus('unavailable');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bookId, pageId]);

  // Click handling: one document-level listener, resilient to pane re-renders.
  useEffect(() => {
    if (!active) return;

    const handleClick = (e: MouseEvent) => {
      if (statusRef.current !== 'ready' || !pairsRef.current) return;
      // Never fight a real text selection (quote/share flows).
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;

      const target = e.target as HTMLElement | null;
      const panel = target?.closest?.('[data-reader-panel]');
      const section = target?.closest?.('[data-reader-section]') as HTMLElement | null;
      const side = section?.dataset.readerSection as Side | undefined;
      if (!panel || !side || (side !== 'ocr' && side !== 'translation')) return;
      // Ignore clicks on interactive elements inside the panes.
      if (target?.closest('a, button, summary, input, textarea')) return;

      const clickedPane = getPaneEl(side);
      const otherSide: Side = side === 'ocr' ? 'translation' : 'ocr';
      const otherPane = getPaneEl(otherSide);
      if (!clickedPane) return;

      const caret = caretFromPoint(e.clientX, e.clientY);
      if (!caret) return;

      const clickedMap = buildPaneMap(clickedPane);
      const rawOffset = pointToOffset(clickedMap, caret.node, caret.offset);
      if (rawOffset == null) return;

      const currentPairs = pairsRef.current;
      const intervals = locatePairIntervals(clickedMap, currentPairs, side);
      const normOffset = rawToNorm(clickedMap.norm, rawOffset);

      // Prefer the SHORTEST interval containing the click (most specific
      // phrase); fall back to the nearest interval within ~60 chars.
      let hit: PairInterval | null = null;
      for (const iv of intervals) {
        const normEnd = iv.normStart + (iv.end - iv.start); // approximate but adequate
        if (normOffset >= iv.normStart && normOffset <= normEnd) {
          if (!hit || iv.end - iv.start < hit.end - hit.start) hit = iv;
        }
      }
      if (!hit) {
        let bestDist = 60;
        for (const iv of intervals) {
          const dist = normOffset < iv.normStart
            ? iv.normStart - normOffset
            : normOffset - (iv.normStart + (iv.end - iv.start));
          if (dist < bestDist) { bestDist = dist; hit = iv; }
        }
      }
      if (!hit) {
        clearHighlights();
        setSheet(null);
        return;
      }

      const pair = currentPairs[hit.pairIndex];
      const primaryRange = rangeFromOffsets(clickedMap, hit.start, hit.end);
      setHighlight(HIGHLIGHT_PRIMARY, primaryRange);

      // Locate the counterpart span in the other pane (may be hidden on
      // mobile-collapsed layouts or missing — then we still show the sheet).
      let counterRange: Range | null = null;
      let counterPaneEl: HTMLElement | null = null;
      if (otherPane) {
        const otherMap = buildPaneMap(otherPane);
        const otherIntervals = locatePairIntervals(otherMap, currentPairs, otherSide);
        const counter = otherIntervals.find((iv) => iv.pairIndex === hit!.pairIndex);
        if (counter) {
          counterRange = rangeFromOffsets(otherMap, counter.start, counter.end);
          counterPaneEl = otherPane;
        }
      }
      setHighlight(HIGHLIGHT_COUNTERPART, counterRange);

      const counterpartText = side === 'translation' ? pair.s : pair.t;
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
      const doScroll = () => {
        if (counterRange && counterPaneEl) scrollRangeIntoPane(counterPaneEl, counterRange);
      };

      if (isDesktop && counterRange && highlightsSupported()) {
        setSheet(null);
        doScroll();
      } else {
        // Mobile (stacked panes — don't yank the reader away), or no
        // highlight support: show the counterpart in a bottom sheet.
        setSheet({ snippet: counterpartText, counterpartSide: otherSide, scrollTo: doScroll });
      }
    };

    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
      clearHighlights();
      setSheet(null);
    };
  }, [active, pageId]);

  if (!active) return null;

  return (
    <>
      {/* ::highlight() rules live here (not globals.css): Next's CSS processor
          rejects the Custom Highlight API pseudo-element. Gold family from the
          /blog/word-alignment demo; primary = clicked span, counterpart = the
          aligned span in the other pane. */}
      <style>{`
        ::highlight(${HIGHLIGHT_PRIMARY}) {
          background-color: rgba(160, 120, 40, 0.22);
        }
        ::highlight(${HIGHLIGHT_COUNTERPART}) {
          background-color: rgba(160, 120, 40, 0.38);
          text-decoration: underline;
          text-decoration-color: rgba(160, 120, 40, 0.85);
          text-decoration-thickness: 2px;
        }
      `}</style>
      {sheet && (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 lg:left-auto lg:right-6 lg:max-w-md"
      role="dialog"
      aria-label={sheet.counterpartSide === 'ocr' ? 'Original text' : 'Translation'}
    >
      <div
        className="rounded-xl border shadow-lg p-4"
        style={{ background: 'var(--bg-white)', borderColor: 'var(--border-light)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--text-muted)' }}>
            {sheet.counterpartSide === 'ocr' ? 'In the original' : 'In the translation'}
          </span>
          <button
            onClick={() => { setSheet(null); clearHighlights(); }}
            className="p-1 rounded hover:bg-stone-100"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="font-serif text-[15px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {sheet.snippet}
        </p>
        <button
          onClick={() => {
            const sectionEl = document.querySelector(`[data-reader-section="${sheet.counterpartSide}"]`);
            sectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            sheet.scrollTo();
          }}
          className="mt-3 text-xs font-medium hover:underline"
          style={{ color: 'var(--accent-gold-dark, #a07828)' }}
        >
          Show in place →
        </button>
      </div>
    </div>
      )}
    </>
  );
}
