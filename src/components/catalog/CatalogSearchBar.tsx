'use client';

import { useEffect, useRef } from 'react';
import { Search, Sparkles, X, Loader2 } from 'lucide-react';

export type SearchMode = 'search' | 'ask';

interface CatalogSearchBarProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  /** The librarian is reading the request. */
  asking: boolean;
  /** What the librarian says it looked for, once it has answered. */
  askNote: string;
  /** The librarian couldn't be reached — we fell back to plain matching. */
  askDegraded: boolean;
  examples: string[];
}

const TABS: { id: SearchMode; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'ask', label: 'Ask the librarian' },
];

const LINE = 'rgba(245,240,232,0.22)';

export default function CatalogSearchBar({
  mode, onModeChange, value, onValueChange, onSubmit, onClear,
  asking, askNote, askDegraded, examples,
}: CatalogSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isAsk = mode === 'ask';

  // "/" focuses the search from anywhere on the page, the way a catalogue
  // should. Ignored while the reader is already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="w-full max-w-3xl">
      {/* Mode tabs — attached to the top edge of the field, so switching mode
          visibly changes what the box below is for. */}
      <div className="flex" role="tablist" aria-label="How to search the catalogue">
        {TABS.map((tab) => {
          const on = tab.id === mode;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => { onModeChange(tab.id); requestAnimationFrame(() => inputRef.current?.focus()); }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-medium transition-colors cursor-pointer"
              style={{
                color: on ? '#f7f2ea' : 'rgba(245,240,232,0.6)',
                background: on ? 'rgba(12,9,6,0.55)' : 'transparent',
                // Three longhands, not `border` + `borderBottom`: React warns
                // when a shorthand and a longhand for the same value are both
                // set across a rerender, and the tabs rerender on every switch.
                borderTop: `1px solid ${on ? LINE : 'transparent'}`,
                borderLeft: `1px solid ${on ? LINE : 'transparent'}`,
                borderRight: `1px solid ${on ? LINE : 'transparent'}`,
              }}
            >
              {tab.id === 'ask' && <Sparkles className="w-3.5 h-3.5" style={{ opacity: 0.8 }} />}
              {tab.label}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="flex items-stretch"
        style={{ border: `1px solid ${LINE}`, background: 'rgba(12,9,6,0.55)', backdropFilter: 'blur(6px)' }}
      >
        <span className="flex items-center pl-4 pr-2" style={{ color: 'rgba(245,240,232,0.55)' }}>
          {asking
            ? <Loader2 className="w-[18px] h-[18px] animate-spin" />
            : isAsk ? <Sparkles className="w-[18px] h-[18px]" /> : <Search className="w-[18px] h-[18px]" />}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={isAsk ? 'Find me books about…' : 'Search titles and authors'}
          aria-label={isAsk ? 'Ask the librarian for books' : 'Search the catalogue'}
          /* 16px minimum: anything smaller makes iOS zoom the page on focus. */
          className="flex-1 min-w-0 bg-transparent py-3.5 pr-3 text-base focus:outline-none"
          style={{ color: '#f7f2ea' }}
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear"
            className="px-2 transition-opacity hover:opacity-70 cursor-pointer"
            style={{ color: 'rgba(245,240,232,0.6)' }}
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        )}
        <button
          type="submit"
          disabled={asking}
          className="px-5 sm:px-7 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-70 cursor-pointer"
          style={{ background: '#a5503d' }}
        >
          {isAsk ? 'Ask' : 'Search'}
        </button>
      </form>

      {/* One line under the box: either what the librarian understood, or a
          couple of things worth trying. */}
      <div className="mt-2.5 min-h-[1.5rem] text-[12.5px]">
        {askNote ? (
          <p className="flex items-start gap-1.5" style={{ color: 'rgba(245,240,232,0.7)' }}>
            <Sparkles className="w-3.5 h-3.5 mt-[3px] shrink-0" style={{ opacity: 0.7 }} />
            <span>{askNote}</span>
          </p>
        ) : askDegraded ? (
          <p style={{ color: 'rgba(245,240,232,0.6)' }}>
            The librarian is busy, so this was matched on the words alone.
          </p>
        ) : isAsk && examples.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: 'rgba(245,240,232,0.45)' }}>
            <span>Try</span>
            {examples.map((ex, i) => (
              <button
                key={ex}
                type="button"
                onClick={() => { onValueChange(ex); requestAnimationFrame(() => inputRef.current?.focus()); }}
                className="underline underline-offset-2 transition-colors cursor-pointer hover:text-white"
                style={{ color: 'rgba(245,240,232,0.62)' }}
              >
                {ex}{i < examples.length - 1 ? ',' : ''}
              </button>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
