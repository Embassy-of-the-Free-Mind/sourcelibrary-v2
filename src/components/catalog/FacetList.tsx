'use client';

import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

interface FacetListProps {
  /** Micro heading above the control. */
  label: string;
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Show the type-to-filter box. Defaults on once the list is long enough. */
  searchable?: boolean;
  placeholder?: string;
  /** Rows visible before the list scrolls. */
  rows?: number;
}

/**
 * One multi-select facet in the filter rail: a labelled, scrollable list of
 * checkboxes with counts, and a type-to-filter box once the list is long.
 *
 * Multi-select throughout, because one language or one subject is rarely the
 * question — "Latin or Greek", "alchemy or hermeticism" is. Values within a
 * facet are OR'd; the facets themselves AND together.
 *
 * Selected values float to the top, so a choice made before scrolling 200
 * collections is still visible after.
 */
export default function FacetList({
  label,
  options,
  selected,
  onToggle,
  onClear,
  searchable,
  placeholder = 'Filter…',
  rows = 7,
}: FacetListProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const showSearch = searchable ?? options.length > 8;

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : options;
    const chosen = new Set(selected);
    // Stable partition: everything picked, in the order it was picked, then the
    // rest. Without this a selection scrolls out of sight and looks lost.
    const picked = selected
      .map((v) => matches.find((o) => o.value === v))
      .filter((o): o is FacetOption => Boolean(o));
    return [...picked, ...matches.filter((o) => !chosen.has(o.value))];
  }, [options, query, selected]);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-[10px] uppercase tracking-[0.13em] text-muted">{label}</h3>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted hover:text-primary transition-colors cursor-pointer focus-ink"
          >
            Clear
          </button>
        )}
      </div>

      {showSearch && (
        <div className="relative mb-1.5">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/70 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={`Filter ${label.toLowerCase()}`}
            /* 16px so iOS never zooms the page on focus. The focus ring is
               handled by .focus-ink — the global one is rust. */
            className="w-full pl-7 pr-6 py-1.5 text-base sm:text-[13px] bg-white border-b border-border-light text-primary placeholder:text-muted/70 focus:border-text-primary transition-colors focus-ink"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear filter text"
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary cursor-pointer focus-ink"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Rows are exactly 28px, so `rows` shows whole ones. When there are more
          than fit, the last few pixels fade out — a silent "keep scrolling"
          that costs no chrome and no measurement. */}
      <div
        className="overflow-y-auto overscroll-contain -mx-1 px-1"
        style={{
          maxHeight: `${rows * 28}px`,
          ...(ordered.length > rows
            ? {
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 20px), transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 20px), transparent)',
              }
            : {}),
        }}
      >
        {ordered.length === 0 && (
          <p className="py-2 text-[12px] text-muted">Nothing matches that.</p>
        )}
        {ordered.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={`flex items-center justify-between gap-2 h-7 text-[13px] leading-none cursor-pointer transition-colors ${
                on ? 'text-primary' : 'text-secondary hover:text-primary'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(o.value)}
                  className="shrink-0 w-3 h-3 accent-[#3b332a] cursor-pointer focus-ink"
                />
                <span className="truncate">{o.label}</span>
              </span>
              {typeof o.count === 'number' && (
                <span className="shrink-0 text-[11px] text-faint tabular-nums">
                  {o.count.toLocaleString('en-US')}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
