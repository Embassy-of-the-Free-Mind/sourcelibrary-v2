'use client';

/**
 * Reader highlighting / annotation (restores the feature the old reader had
 * before it was deliberately gutted).
 *
 * History, for whoever next touches this: `HighlightSelection.tsx` — the
 * component the OLD reader (TranslationEditor) still mounts — is currently a
 * pure passthrough (`return <>{children}</>`). It once did two things: a
 * "Share this quote" popup (Twitter/Bluesky/copy) and a "Note" button that
 * posted to /api/annotations. The Share half was removed in #1103 ("The
 * floating Share button that appeared on every text selection was
 * obstructing the reading experience") and the Note half had already been
 * reverted a month earlier chasing an unrelated UI rollback. Neither removal
 * was about the new reader — both predate this redesign. This component
 * restores ONLY the note/highlight half, deliberately leaves Share out (that
 * was the obstructive part, and isn't what was asked for), and goes further
 * than the original ever did: the original never re-painted a saved note
 * onto the text on reload — it only listed the quoted text in a flat panel
 * below the page. This version locates each note's anchor text back in the
 * DOM (same whitespace/diacritic-normalized search TraceAlignment uses) and
 * washes it with the CSS Custom Highlight API, so a highlight is visible
 * in place, not just in a list, and survives a reload/page revisit as long
 * as the underlying text hasn't changed underneath it.
 *
 * Persistence is the EXISTING /api/annotations backend, untouched: same
 * Mongo `annotations` collection, same `annotations` api-client
 * (src/lib/api-client/annotations.ts), same `Annotation` shape
 * (src/lib/types/annotation.ts). Auth: GET is public (so anonymous readers
 * see existing highlights); POST/DELETE go through `withAuth` server-side
 * (min role 'reader' — any signed-in account), so this component only
 * offers the write actions to `useIdentity().type === 'authenticated'`
 * and lets the API be the actual enforcement.
 *
 * Span identity: the backend only ever stored `anchor.text` (the raw
 * selected string) — never a reliable offset. So "does a highlight survive
 * a reload" is answered the same way trace answers "does a click find its
 * span": by re-searching the rendered text for that string
 * (normalizeForSearch + locateSpan from src/lib/align-text.ts, shared with
 * TraceAlignment). No stored offset to go stale; the tradeoff is that if a
 * later OCR/translation pass changes the wording, the anchor simply stops
 * resolving and the highlight silently stops rendering — the note itself is
 * not lost, it just becomes un-anchored (same graceful "no-op, don't guess"
 * philosophy TraceAlignment uses for unaligned clicks).
 *
 * Coexistence with trace mode (#3091, TraceAlignment.tsx): both features
 * read/write the CSS Custom Highlight API, but under DIFFERENT registry
 * names (trace's sl-trace-*, this file's sl-annot-*), so painting never
 * collides — CSS.highlights is a Map, entries layer, they don't overwrite
 * each other. Both also install their own document-level click listener,
 * and both already bail out when a real text selection is live
 * (`sel && !sel.isCollapsed`), so selecting text to create a highlight never
 * fights trace's click-to-align behaviour. The one real overlap: if trace is
 * ON and a click lands on a span that is BOTH trace-aligned AND has a saved
 * note, both listeners fire independently (neither calls
 * stopPropagation/preventDefault) — trace shows its aligned counterpart
 * (highlight + scroll, or its bottom sheet on mobile) AND this component
 * shows its note popover, at the same time. That's a real but rare
 * (intersection of two independent, sparse sets of spans) cosmetic overlap,
 * not a functional bug; nothing here was changed in TraceAlignment.tsx to
 * avoid it, per instruction not to touch that file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Send, Check, Trash2 } from 'lucide-react';
import { annotations as annotationsApi } from '@/lib/api-client';
import { useIdentity } from '@/hooks/useIdentity';
import { normalizeForSearch, locateSpan, type NormalizedText } from '@/lib/align-text';
import type { Annotation } from '@/lib/types';

interface ReaderAnnotationsProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
}

type Side = 'ocr' | 'translation' | 'transliteration';
const SIDES: Side[] = ['ocr', 'translation', 'transliteration'];

/**
 * Highlight colour. Every warm accent in this reader is already spoken for:
 * violet = glosses/terms, sage = marginal notes on the original, gold =
 * editorial notes, rust = the current page in the filmstrip (plus links,
 * likes). Trace mode's blue (#4a6fa5) isn't a token but is visually claimed
 * too. A reader's own highlight needed a hue none of those sit near — rust
 * (~10°), gold (~38°), sage (~87°) and trace's blue (~212°) leave a gap
 * across the greens/teals between sage and blue untouched by anything else
 * in the reader. This is a muted verdigris teal (~170°): distinct from
 * every claimed colour at a glance, still sits in the same desaturated
 * "manuscript" family as the rest of the palette, and reads naturally as
 * "ink the reader added" rather than "ink the edition already had" — which
 * is exactly the distinction that matters (this is the READER'S mark, not
 * an editorial one). Kept as a literal, not a new CSS var, matching how
 * TraceAlignment keeps its own blue local rather than adding a global token
 * for a single feature.
 */
const ANNOTATION_COLOR = '#3f7d70';
const ANNOTATION_WASH = 'rgba(63, 125, 112, 0.16)';
const ANNOTATION_WASH_ACTIVE = 'rgba(63, 125, 112, 0.32)';

const MARKS_NAME = 'sl-annot-marks';
const ACTIVE_NAME = 'sl-annot-active';

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

interface PaneMap {
  norm: NormalizedText;
  nodes: Array<{ node: Text; start: number }>;
}

function buildPaneMap(pane: HTMLElement): PaneMap {
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number }> = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  return { norm: normalizeForSearch(text), nodes };
}

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

function pointToOffset(map: PaneMap, node: Node, offset: number): number | null {
  const entry = map.nodes.find((e) => e.node === node);
  if (!entry) return null;
  return entry.start + offset;
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

function setHighlightRanges(name: string, ranges: Range[]) {
  if (!highlightsSupported()) return;
  const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  if (ranges.length === 0) {
    registry.delete(name);
    return;
  }
  const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  registry.set(name, new HighlightCtor(...ranges));
}

interface PendingHighlight {
  text: string;
  x: number;
  y: number;
}

interface ActiveNote {
  annotation: Annotation;
  x: number;
  y: number;
}

export default function ReaderAnnotations({ bookId, pageId, pageNumber }: ReaderAnnotationsProps) {
  const identity = useIdentity();
  const isAuthenticated = identity.type === 'authenticated';

  const [list, setList] = useState<Annotation[] | null>(null);
  const listRef = useRef<Annotation[] | null>(null);

  const [pending, setPending] = useState<PendingHighlight | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [activeNote, setActiveNote] = useState<ActiveNote | null>(null);

  // Fetch this page's notes. Public GET — anonymous readers see existing
  // highlights even though only signed-in readers can add their own.
  useEffect(() => {
    let cancelled = false;
    setList(null);
    listRef.current = null;
    setActiveNote(null);
    setPending(null);
    setHighlightRanges(MARKS_NAME, []);
    setHighlightRanges(ACTIVE_NAME, []);
    annotationsApi.list({ book_id: bookId, page_id: pageId, limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setList(res.annotations);
        listRef.current = res.annotations;
      })
      .catch(() => {
        if (cancelled) return;
        setList([]);
        listRef.current = [];
      });
    return () => { cancelled = true; };
  }, [bookId, pageId]);

  const paintMarks = useCallback((annotationList: Annotation[]) => {
    if (!highlightsSupported()) return;
    const ranges: Range[] = [];
    for (const side of SIDES) {
      const pane = getPaneEl(side);
      if (!pane) continue;
      const map = buildPaneMap(pane);
      for (const a of annotationList) {
        const text = a.anchor?.text?.trim();
        if (!text) continue;
        const hit = locateSpan(map.norm, text, 0);
        if (!hit) continue;
        const range = rangeFromOffsets(map, hit.start, hit.end);
        if (range) ranges.push(range);
      }
    }
    setHighlightRanges(MARKS_NAME, ranges);
  }, []);

  // Paint persisted marks whenever the list changes, and re-paint on pane
  // DOM mutations (e.g. the glosses/notes toggle re-rendering NotesRenderer)
  // so marks don't go stale between page navigations.
  useEffect(() => {
    if (!list) return;
    paintMarks(list);
    if (!highlightsSupported()) return;
    let raf = 0;
    const repaint = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => paintMarks(listRef.current ?? []));
    };
    const observers: MutationObserver[] = [];
    for (const side of SIDES) {
      const pane = getPaneEl(side);
      if (!pane) continue;
      const obs = new MutationObserver(repaint);
      obs.observe(pane, { childList: true, subtree: true, characterData: true });
      observers.push(obs);
    }
    return () => {
      observers.forEach((o) => o.disconnect());
      cancelAnimationFrame(raf);
    };
  }, [list, paintMarks]);

  useEffect(() => {
    return () => {
      setHighlightRanges(MARKS_NAME, []);
      setHighlightRanges(ACTIVE_NAME, []);
    };
  }, []);

  const dismissPending = useCallback(() => {
    setPending(null);
    setNoteDraft('');
    setSaveError('');
    setSaved(false);
  }, []);

  const closeActive = useCallback(() => {
    setActiveNote(null);
    setHighlightRanges(ACTIVE_NAME, []);
  }, []);

  // Selection → offer to save a highlight. Mirrors the old
  // HighlightSelection's mouseup/touchend handling, minus the Share menu
  // (#1103 removed that half as obstructive; not restoring it here).
  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || sel.rangeCount === 0 || text.length < 3) return;
      const anchorNode = sel.anchorNode;
      const el = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
      if (!el?.closest('[data-reader-panel]')) return;
      if (el?.closest('a, button, summary, input, textarea')) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setPending({ text, x: rect.left + rect.width / 2, y: rect.top });
      setNoteDraft('');
      setSaveError('');
      setSaved(false);
    };
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, []);

  // Escape / scroll dismiss the pending popup, same as the old component.
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissPending(); };
    const onScroll = () => dismissPending();
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pending, dismissPending]);

  useEffect(() => {
    if (!activeNote) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeActive(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeNote, closeActive]);

  const save = useCallback(async () => {
    if (!pending || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      // A highlight with no note still needs SOME content (the API requires
      // it) — default to the quoted text itself so "just highlight it" works
      // without typing anything, same as a plain marker.
      const trimmed = noteDraft.trim();
      const content = trimmed.length >= 3 ? trimmed : pending.text;
      const created = await annotationsApi.create({
        book_id: bookId,
        page_id: pageId,
        page_number: pageNumber,
        anchor: { text: pending.text },
        content,
      });
      const next = [...(listRef.current ?? []), created];
      listRef.current = next;
      setList(next);
      setSaved(true);
      window.getSelection()?.removeAllRanges();
      setTimeout(dismissPending, 900);
    } catch {
      setSaveError('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  }, [pending, saving, noteDraft, bookId, pageId, pageNumber, dismissPending]);

  const remove = useCallback(async (id: string) => {
    try {
      await annotationsApi.delete(id);
    } catch {
      // Fall through and update locally anyway — a retry-worthy failure
      // here isn't worth blocking the reader on.
    }
    const next = (listRef.current ?? []).filter((a) => a.id !== id);
    listRef.current = next;
    setList(next);
    closeActive();
  }, [closeActive]);

  // Click an existing mark → show its note. Bails on a live selection (same
  // rule TraceAlignment uses) so this never fights the "select text to add a
  // highlight" flow above.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button, summary, input, textarea')) return;
      const panel = target?.closest('[data-reader-panel]');
      const section = target?.closest('[data-reader-section]') as HTMLElement | null;
      const side = section?.dataset.readerSection as Side | undefined;
      if (!panel || !side || !SIDES.includes(side)) return;

      const currentList = listRef.current;
      if (!currentList || currentList.length === 0) return;
      const pane = getPaneEl(side);
      if (!pane) return;
      const caret = caretFromPoint(e.clientX, e.clientY);
      if (!caret) return;
      const map = buildPaneMap(pane);
      const rawOffset = pointToOffset(map, caret.node, caret.offset);
      if (rawOffset == null) return;

      let hit: { annotation: Annotation; range: Range } | null = null;
      for (const a of currentList) {
        const text = a.anchor?.text?.trim();
        if (!text) continue;
        const located = locateSpan(map.norm, text, 0);
        if (!located) continue;
        if (rawOffset >= located.start && rawOffset < located.end) {
          const range = rangeFromOffsets(map, located.start, located.end);
          if (range) { hit = { annotation: a, range }; break; }
        }
      }
      if (!hit) {
        closeActive();
        return;
      }
      setHighlightRanges(ACTIVE_NAME, [hit.range]);
      const rect = hit.range.getBoundingClientRect();
      setActiveNote({ annotation: hit.annotation, x: rect.left + rect.width / 2, y: rect.top });
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [closeActive]);

  return (
    <>
      {/* ::highlight() rules live here, not globals.css, for the same reason
          TraceAlignment keeps its own: Next's CSS processor rejects the
          Custom Highlight API pseudo-element outside a plain <style> tag. */}
      <style>{`
        ::highlight(${MARKS_NAME}) {
          background-color: ${ANNOTATION_WASH};
        }
        ::highlight(${ACTIVE_NAME}) {
          background-color: ${ANNOTATION_WASH_ACTIVE};
        }
      `}</style>

      {pending && (
        <div
          className="fixed z-50 -translate-x-1/2"
          style={{ left: pending.x, top: pending.y - 10, transform: 'translate(-50%, -100%)' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className="rounded-lg shadow-lg border overflow-hidden"
            style={{ background: 'var(--bg-white)', borderColor: 'var(--border-light)' }}
          >
            {!isAuthenticated ? (
              <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5">
                <span className="font-sans text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <Link href="/auth/signin" className="underline" style={{ color: ANNOTATION_COLOR }}>Sign in</Link>
                  {' '}to highlight
                </span>
                <button onClick={dismissPending} className="p-1 rounded hover:bg-stone-100" style={{ color: 'var(--text-muted)' }} aria-label="Dismiss">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : saved ? (
              <div className="flex items-center gap-1.5 px-3 py-2" style={{ color: ANNOTATION_COLOR }}>
                <Check className="w-3.5 h-3.5" />
                <span className="font-sans text-[12px]">Highlighted</span>
              </div>
            ) : (
              <div className="flex items-start gap-1 p-1.5">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
                    if (e.key === 'Escape') dismissPending();
                  }}
                  placeholder="Add a note (optional)"
                  rows={1}
                  autoFocus
                  disabled={saving}
                  className="font-sans text-[13px] resize-none rounded px-2 py-1.5 w-48 focus:outline-none"
                  style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
                />
                <button
                  onClick={save}
                  disabled={saving}
                  title="Save highlight"
                  className="p-1.5 rounded hover:bg-stone-100 transition-colors disabled:opacity-40"
                  style={{ color: ANNOTATION_COLOR }}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={dismissPending}
                  className="p-1.5 rounded hover:bg-stone-100 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {saveError && (
              <p className="font-sans text-[11px] px-3 pb-2" style={{ color: 'var(--status-error, #b3261e)' }}>{saveError}</p>
            )}
          </div>
        </div>
      )}

      {activeNote && (
        <div
          className="fixed z-50 -translate-x-1/2"
          style={{ left: activeNote.x, top: activeNote.y - 12, transform: 'translate(-50%, -100%)' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className="rounded-lg shadow-lg border p-3 w-64"
            style={{ background: 'var(--bg-white)', borderColor: 'var(--border-light)' }}
            role="dialog"
            aria-label="Highlight note"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: ANNOTATION_COLOR }}>
                Highlight
              </span>
              <button onClick={closeActive} className="p-0.5 rounded hover:bg-stone-100" style={{ color: 'var(--text-muted)' }} aria-label="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="font-body text-[14px] leading-snug mb-2" style={{ color: 'var(--text-primary)' }}>
              {activeNote.annotation.content}
            </p>
            <div className="flex items-center justify-between">
              <span className="font-sans text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {activeNote.annotation.user_name}
              </span>
              {isAuthenticated && identity.id === activeNote.annotation.user_id && (
                <button
                  onClick={() => remove(activeNote.annotation.id)}
                  className="font-sans text-[11px] flex items-center gap-1 hover:underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
