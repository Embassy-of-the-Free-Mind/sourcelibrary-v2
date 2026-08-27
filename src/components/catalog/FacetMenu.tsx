'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
  /** Small right-hand note (e.g. a language's own name). */
  hint?: string;
}

interface FacetMenuProps {
  label: string;
  /** Rendered on the button when a value is chosen — usually the option's label. */
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
  /** Row shown at the top that clears the facet. */
  allLabel?: string;
  /** Show the type-to-filter box. Defaults on once the list is long enough to need it. */
  searchable?: boolean;
  placeholder?: string;
  align?: 'left' | 'right';
  width?: number;
  children?: ReactNode;
}

/**
 * One catalogue facet: a button that opens a list.
 *
 * The catalogue used to hand its ~200 collections to a native `<select>`, which
 * on desktop is an unreadable wall and on mobile a full-screen wheel — there was
 * no way to find "Fungi & Mycology" except by scrolling. A popover with a
 * type-to-filter box is the same one-of-many choice, findable.
 */
export default function FacetMenu({
  label,
  value,
  options,
  onChange,
  allLabel = 'All',
  searchable,
  placeholder = 'Type to filter…',
  align = 'left',
  width = 280,
  children,
}: FacetMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length > 12;

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);

  useEffect(() => {
    if (!open) return;
    // Autofocus the filter box, but not on touch: it would throw up the
    // keyboard over the list the reader is trying to read.
    if (showSearch && !window.matchMedia?.('(pointer: coarse)').matches) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, showSearch, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const active = !!value;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-[13px] border transition-colors cursor-pointer whitespace-nowrap ${
          active
            ? 'border-border-medium bg-warm text-primary font-medium'
            : 'border-border-light bg-white text-secondary hover:border-border-medium hover:text-primary'
        }`}
      >
        <span className={active ? '' : 'text-muted'}>{label}</span>
        {active && <span className="max-w-[11rem] truncate">{value}</span>}
        <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute z-40 mt-1 bg-white border border-border-medium shadow-[0_18px_40px_-20px_rgba(26,22,18,0.5)] ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width }}
          role="listbox"
        >
          {children}

          {showSearch && (
            <div className="relative border-b border-border-light">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                /* 16px so iOS never zooms the page on focus. */
                className="w-full pl-9 pr-3 py-2.5 text-base bg-transparent text-primary placeholder:text-muted/70 focus:outline-none"
              />
            </div>
          )}

          {!children && (
            <div className="max-h-[19rem] overflow-y-auto overscroll-contain py-1">
              <button
                type="button"
                onClick={() => { onChange(''); close(); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-[13px] text-left hover:bg-warm cursor-pointer"
              >
                <span className={value ? 'text-secondary' : 'text-primary font-medium'}>{allLabel}</span>
                {!value && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>

              {filtered.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => { onChange(o.value); close(); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-[13px] text-left hover:bg-warm cursor-pointer"
                  >
                    <span className={`truncate ${selected ? 'text-primary font-medium' : 'text-secondary'}`}>
                      {o.label}
                      {o.hint && <span className="text-muted"> {o.hint}</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {typeof o.count === 'number' && (
                        <span className="text-[11px] text-muted tabular-nums">{o.count.toLocaleString('en-US')}</span>
                      )}
                      {selected && <Check className="w-3.5 h-3.5 text-primary" />}
                    </span>
                  </button>
                );
              })}

              {filtered.length === 0 && (
                <p className="px-3 py-4 text-[13px] text-muted">Nothing matches that.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
