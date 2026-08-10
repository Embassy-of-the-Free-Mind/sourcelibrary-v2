'use client';

/**
 * Tap-a-word dictionary lookup for the reader's original-text pane
 * (#3823 Phase 2).
 *
 * Listens for clicks inside `targetSelector` and reads the tapped word
 * straight out of the text node via caretPositionFromPoint. The OCR content
 * is NEVER re-marked-up — no per-word <span> injection — so OCR text
 * containing literal markup (pages transcribe real <script> tags, #3609)
 * cannot break the page, and NotesRenderer's own rendering is untouched.
 *
 * Results come from GET /api/lexicon/lookup (Lewis & Short; see
 * src/lib/lexicon/lookup.ts for the tier chain). Uncertain tiers arrive
 * with confident:false and are rendered with an explicit hedge — an honest
 * "no entry found" beats a wrong entry dressed up as an answer.
 *
 * Desktop: floating card anchored near the tap. Mobile (<lg): bottom sheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, BookOpen } from 'lucide-react';

interface LexiconMatch {
  key: string;
  headword: string;
  matchType: string;
  confident: boolean;
  partOfSpeech: string | null;
  orthography: string | null;
  genitive: string | null;
  gender: string | null;
  declension: number | null;
  senses: unknown[];
  sensesTruncated: boolean;
}

interface LookupResult {
  query: string;
  normalized: string;
  found: boolean;
  matches: LexiconMatch[];
}

interface PopoverState {
  word: string;
  x: number;
  y: number;
  status: 'loading' | 'done' | 'error';
  result: LookupResult | null;
}

const cache = new Map<string, LookupResult>();
const CACHE_CAP = 300;

// One error report per page load, fire-and-forget, to the shared
// application_errors intake — repeated failures (offline reader, dead
// route) must not turn into a report storm.
let reportedLookupError = false;
function reportLookupError(word: string, detail: string) {
  if (reportedLookupError) return;
  reportedLookupError = true;
  try {
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `lexicon popover lookup failed: ${detail}`,
        source: 'LexiconTapLayer',
        url: `${location.pathname} (word: ${word})`,
        userAgent: navigator.userAgent,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

const TIER_LABEL: Record<string, string> = {
  exact: 'dictionary form',
  variant: 'spelling variant',
  irregular: 'irregular form',
  inflected: 'inflected form',
  loose: 'orthographic match',
  suffix: 'best guess by ending',
  ocr: 'possible OCR misread',
};

/** Word under (x, y): read from the text node, never from re-marked-up DOM. */
function wordAtPoint(x: number, y: number, container: Element): string | null {
  interface CaretPos { offsetNode: Node; offset: number }
  type DocWithCaret = Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPos | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const doc = document as DocWithCaret;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) { node = range.startContainer; offset = range.startOffset; }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;
  const text = node.textContent ?? '';
  if (!text[offset] && offset > 0) offset -= 1;
  const isLetter = (ch: string | undefined) => !!ch && /[\p{L}̀-ͯ]/u.test(ch);
  if (!isLetter(text[offset])) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && isLetter(text[start - 1])) start--;
  while (end < text.length && isLetter(text[end])) end++;
  const word = text.slice(start, end);
  return word.length >= 2 && word.length <= 60 ? word : null;
}

function firstSenseText(senses: unknown[]): string {
  for (const s of senses) {
    if (typeof s === 'string' && s.trim()) return s;
    if (Array.isArray(s)) {
      const inner = firstSenseText(s);
      if (inner) return inner;
    }
  }
  return '';
}

function morphologyLine(m: LexiconMatch): string {
  const bits: string[] = [];
  if (m.orthography) bits.push(m.orthography);
  if (m.genitive) bits.push(`gen. ${m.genitive}`);
  if (m.gender) bits.push(m.gender.toLowerCase() === 'm' ? 'masc.' : m.gender.toLowerCase() === 'f' ? 'fem.' : 'neut.');
  if (m.declension) bits.push(`${m.declension}${['', 'st', 'nd', 'rd', 'th', 'th'][m.declension]} decl.`);
  if (m.partOfSpeech && !m.declension) bits.push(m.partOfSpeech);
  return bits.join(' · ');
}

export default function LexiconTapLayer({ targetSelector, enabled, lang = 'la' }: { targetSelector: string; enabled: boolean; lang?: 'la' | 'grc' }) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  const close = useCallback(() => {
    setPopover(null);
    setExpanded(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Delegate from document: the OCR panel mounts/unmounts as the reader
    // toggles panels, so a listener bound to the panel itself would miss a
    // panel shown after mount.
    const onClick = (ev: Event) => {
      const e = ev as MouseEvent;
      const target = e.target as Element | null;
      const container = target?.closest?.(targetSelector);
      if (!container) return;
      // A real text selection in progress is not a lookup gesture.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      // Leave links, buttons, details/summary and other interactive bits alone.
      if (target?.closest('a, button, summary, input, textarea, [role="button"]')) return;
      const word = wordAtPoint(e.clientX, e.clientY, container);
      if (!word) return;

      const seq = ++requestSeq.current;
      setExpanded(false);
      setPopover({ word, x: e.clientX, y: e.clientY, status: 'loading', result: null });

      const cached = cache.get(`${lang}:${word.toLowerCase()}`);
      if (cached) {
        setPopover({ word, x: e.clientX, y: e.clientY, status: 'done', result: cached });
        return;
      }
      fetch(`/api/lexicon/lookup?word=${encodeURIComponent(word)}&lang=${lang}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((result: LookupResult) => {
          if (cache.size >= CACHE_CAP) {
            const first = cache.keys().next().value;
            if (first !== undefined) cache.delete(first);
          }
          cache.set(`${lang}:${word.toLowerCase()}`, result);
          if (requestSeq.current === seq) {
            setPopover((p) => (p && p.word === word ? { ...p, status: 'done', result } : p));
          }
        })
        .catch((err: unknown) => {
          reportLookupError(word, err instanceof Error ? err.message : String(err));
          if (requestSeq.current === seq) {
            setPopover((p) => (p && p.word === word ? { ...p, status: 'error' } : p));
          }
        });
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [enabled, targetSelector]);

  // Escape / outside-click dismiss.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      // Both the desktop card and the mobile sheet carry data-lexicon-popover.
      if (!(e.target as Element | null)?.closest?.('[data-lexicon-popover]')) close();
    };
    document.addEventListener('keydown', onKey);
    // Delay so the opening click doesn't immediately dismiss.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [popover, close]);

  if (!enabled || !popover) return null;

  const match = popover.result?.matches?.[0] ?? null;
  const alternates = (popover.result?.matches ?? []).slice(1, 3);

  // Desktop position: clamp the card inside the viewport.
  const CARD_W = 340;
  const left = Math.min(Math.max(8, popover.x - CARD_W / 2), (typeof window !== 'undefined' ? window.innerWidth : 1200) - CARD_W - 8);
  const showBelow = popover.y < (typeof window !== 'undefined' ? window.innerHeight : 800) / 2;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-base" style={{ color: 'var(--text-primary, #1f2937)' }}>
              {match ? (match.orthography || match.headword) : popover.word}
            </span>
            {match && match.headword.toLowerCase() !== popover.word.toLowerCase() && (
              <span className="text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>← {popover.word}</span>
            )}
          </div>
          {match && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted, #6b7280)' }}>
              {morphologyLine(match)}
            </div>
          )}
        </div>
        <button type="button" onClick={close} aria-label="Close dictionary popover" className="p-1 -m-1 shrink-0 opacity-60 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      </div>

      {popover.status === 'loading' && (
        <div className="py-3 text-sm" style={{ color: 'var(--text-muted, #6b7280)' }}>Looking up…</div>
      )}
      {popover.status === 'error' && (
        <div className="py-3 text-sm" style={{ color: 'var(--text-muted, #6b7280)' }}>Lookup failed — try again.</div>
      )}
      {popover.status === 'done' && !match && (
        <div className="py-3 text-sm" style={{ color: 'var(--text-muted, #6b7280)' }}>
          No entry found in Lewis &amp; Short. Abbreviations, names, and heavily contracted early modern forms often miss.
        </div>
      )}

      {match && (
        <>
          {!match.confident && (
            <div className="mt-2 text-[11px] px-2 py-1 rounded" style={{ background: 'var(--bg-cream, #fef9ef)', color: 'var(--accent-rust, #c45d3a)' }}>
              Uncertain match ({TIER_LABEL[match.matchType] ?? match.matchType}) — treat as a suggestion.
            </div>
          )}
          <div
            className={`mt-2 text-sm leading-relaxed ${expanded ? 'max-h-72' : 'max-h-28'} overflow-y-auto`}
            style={{ color: 'var(--text-secondary, #374151)' }}
          >
            {expanded
              ? (match.senses.filter((s) => typeof s === 'string') as string[]).map((s, i) => (
                  <p key={i} className={i > 0 ? 'mt-2' : ''}>{s}</p>
                ))
              : <p>{firstSenseText(match.senses) || '(no sense text)'}</p>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {match.senses.length > 1 || match.sensesTruncated ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs underline underline-offset-2"
                style={{ color: 'var(--accent-sage, #5f7d61)' }}
              >
                {expanded ? 'Show less' : `Full entry${match.senses.length > 1 ? ` (${match.senses.length} senses)` : ''}`}
              </button>
            ) : <span />}
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted, #9ca3af)' }}>
              <BookOpen className="w-3 h-3" /> Lewis &amp; Short
            </span>
          </div>
          {alternates.length > 0 && (
            <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted, #6b7280)' }}>
              also: {alternates.map((a) => a.headword).join(', ')}
            </div>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      {/* Desktop: anchored card */}
      <div
        ref={cardRef}
        data-lexicon-popover
        role="dialog"
        aria-label={`Dictionary entry for ${popover.word}`}
        className="hidden lg:block fixed z-[60] rounded-lg shadow-xl border p-3"
        style={{
          left,
          top: showBelow ? popover.y + 14 : undefined,
          bottom: showBelow ? undefined : window.innerHeight - popover.y + 14,
          width: CARD_W,
          background: 'var(--bg-paper, #ffffff)',
          borderColor: 'var(--border-light, #e5e7eb)',
        }}
      >
        {body}
      </div>
      {/* Mobile: bottom sheet */}
      <div
        data-lexicon-popover
        role="dialog"
        aria-label={`Dictionary entry for ${popover.word}`}
        className="lg:hidden fixed inset-x-0 bottom-0 z-[60] rounded-t-xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{ background: 'var(--bg-paper, #ffffff)', borderColor: 'var(--border-light, #e5e7eb)' }}
      >
        {body}
      </div>
    </>
  );
}
