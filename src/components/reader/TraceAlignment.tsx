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

type Side = 'ocr' | 'translation' | 'transliteration';

const SIDES: Side[] = ['ocr', 'translation', 'transliteration'];

/** The pair field holding this side's span, and the field holding its offset. */
function spanFor(pair: AlignmentPair, side: Side): string | undefined {
  return side === 'ocr' ? pair.s : side === 'translation' ? pair.t : pair.r;
}
function offsetFor(pair: AlignmentPair, side: Side): number | undefined {
  return side === 'ocr' ? pair.so : side === 'translation' ? pair.to : pair.ro;
}

/**
 * How far (in normalized chars) a click may sit outside a span and still snap
 * to it. Generous enough to absorb a click on trailing punctuation or the space
 * after a phrase; too small to reach the next phrase. It used to be 60 — about
 * ten words — which meant that clicking anywhere in the ~33% of a page the
 * model leaves unaligned confidently highlighted an unrelated phrase.
 */
const SNAP_TOLERANCE = 12;

interface PaneMap {
  /** Concatenated text of all text nodes in the pane. */
  text: string;
  norm: NormalizedText;
  /** Text nodes with their cumulative start offsets into `text`. */
  nodes: Array<{ node: Text; start: number }>;
}

const HIGHLIGHT_PRIMARY = 'sl-trace-primary';
const HIGHLIGHT_COUNTERPART = 'sl-trace-counterpart';
/** Second counterpart, so a click lights all three panes at once. */
const HIGHLIGHT_COUNTERPART_2 = 'sl-trace-counterpart-2';

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
  normEnd: number;    // offsets in the NORMALIZED pane text
}

/**
 * Locate every pair's span on one side of the rendered DOM, walking in
 * stored-offset order with a moving cursor so repeated phrases bind to
 * successive occurrences (mirrors resolveAlignmentPairs on the server).
 * Pairs with no span on this side (a romanized span that never resolved) are
 * simply absent — clicking their words highlights nothing rather than guessing.
 */
function locatePairIntervals(map: PaneMap, pairs: AlignmentPair[], side: Side): PairInterval[] {
  const order = pairs
    .map((_, i) => i)
    .filter((i) => spanFor(pairs[i], side) !== undefined)
    .sort((a, b) => (offsetFor(pairs[a], side)! - offsetFor(pairs[b], side)!));
  const out: PairInterval[] = [];
  let cursor = 0;
  for (const i of order) {
    const hit = locateSpan(map.norm, spanFor(pairs[i], side)!, cursor);
    if (!hit) continue;
    cursor = hit.normStart + 1;
    out.push({ pairIndex: i, start: hit.start, end: hit.end, normStart: hit.normStart, normEnd: hit.normEnd });
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
  setHighlight(HIGHLIGHT_COUNTERPART_2, null);
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
      if (!panel || !side || !SIDES.includes(side)) return;
      // Ignore clicks on interactive elements inside the panes.
      if (target?.closest('a, button, summary, input, textarea')) return;

      const clickedPane = getPaneEl(side);
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
      // phrase); otherwise snap only to a span the click all but touches.
      let hit: PairInterval | null = null;
      for (const iv of intervals) {
        if (normOffset >= iv.normStart && normOffset <= iv.normEnd) {
          if (!hit || iv.normEnd - iv.normStart < hit.normEnd - hit.normStart) hit = iv;
        }
      }
      if (!hit) {
        let bestDist = SNAP_TOLERANCE;
        for (const iv of intervals) {
          const dist = normOffset < iv.normStart ? iv.normStart - normOffset : normOffset - iv.normEnd;
          if (dist < bestDist) { bestDist = dist; hit = iv; }
        }
      }
      if (!hit) {
        // The click landed on text the model never aligned. Say nothing rather
        // than highlighting a phrase that merely happens to be nearby.
        clearHighlights();
        setSheet(null);
        return;
      }

      const pair = currentPairs[hit.pairIndex];
      const primaryRange = rangeFromOffsets(clickedMap, hit.start, hit.end);
      setHighlight(HIGHLIGHT_PRIMARY, primaryRange);

      // Light up the pair in every other pane that is on screen and has a span
      // for it. The romanized pane only participates when its span resolved.
      const counterparts: Array<{ side: Side; range: Range; pane: HTMLElement }> = [];
      for (const otherSide of SIDES) {
        if (otherSide === side) continue;
        const otherPane = getPaneEl(otherSide);
        if (!otherPane || spanFor(pair, otherSide) === undefined) continue;
        const otherMap = buildPaneMap(otherPane);
        const counter = locatePairIntervals(otherMap, currentPairs, otherSide)
          .find((iv) => iv.pairIndex === hit!.pairIndex);
        if (!counter) continue;
        const range = rangeFromOffsets(otherMap, counter.start, counter.end);
        if (range) counterparts.push({ side: otherSide, range, pane: otherPane });
      }

      // The sheet (mobile / no-highlight fallback) shows the reader's opposite
      // text, so a romanized click reads back as the translation.
      const sheetSide: Side = side === 'translation' ? 'ocr' : 'translation';
      const scrollTarget = counterparts.find((c) => c.side === sheetSide) ?? counterparts[0];

      setHighlight(HIGHLIGHT_COUNTERPART, scrollTarget?.range ?? null);
      setHighlight(
        HIGHLIGHT_COUNTERPART_2,
        counterparts.find((c) => c !== scrollTarget)?.range ?? null,
      );

      const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
      const doScroll = () => {
        if (scrollTarget) scrollRangeIntoPane(scrollTarget.pane, scrollTarget.range);
      };

      if (isDesktop && counterparts.length && highlightsSupported()) {
        setSheet(null);
        doScroll();
      } else {
        // Mobile (stacked panes — don't yank the reader away), or no
        // highlight support: show the counterpart in a bottom sheet. The
        // snippet is always the sheet's labelled side, never whichever pane
        // happened to scroll.
        setSheet({
          snippet: spanFor(pair, sheetSide) ?? '',
          counterpartSide: sheetSide,
          scrollTo: doScroll,
        });
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
          rejects the Custom Highlight API pseudo-element. Primary = clicked
          span, counterparts = the aligned span in each other pane.

          Blue, not gold. Gold is the editorial-note colour in the text
          (NOTE_TAG_STYLES.note), so a gold trace highlight was indistinguishable
          from an annotation — and tracing is a transient machine alignment, not
          an editorial mark. Blue is used by nothing else in the reading panes. */}
      <style>{`
        ::highlight(${HIGHLIGHT_PRIMARY}) {
          background-color: rgba(74, 111, 165, 0.20);
        }
        /* The counterpart is distinguished by a stronger wash, not by an
           underline as well. Underlining a whole sentence of translation on
           top of a highlight was two marks doing one job. */
        ::highlight(${HIGHLIGHT_COUNTERPART}),
        ::highlight(${HIGHLIGHT_COUNTERPART_2}) {
          background-color: rgba(74, 111, 165, 0.34);
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
