'use client';

import type { ReactNode } from 'react';

/**
 * The two ways into a collection page: a search bar and an Ask-the-librarian
 * bar side by side, each with a line of things to try. Shared by /library and
 * /gallery so both read the same; each page decides what a search and an ask
 * mean for its own results.
 *
 * Phones: 40px bars (16px text, so iOS does not zoom), one line of examples
 * scrolled sideways. The black button sits over the bar's border so it reads
 * as the bar's full height; the bar's own border shows focus
 * ([data-catalog-bar] in globals.css switches the rust ring off inside it).
 */

const field = 'flex items-stretch h-10 sm:h-[52px] border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary';
const input = 'flex-1 min-w-0 px-3 sm:px-4 text-base text-primary bg-transparent outline-none focus-visible:outline-none placeholder:text-muted/70';
const button = 'relative -my-px -mr-px px-3.5 sm:px-5 bg-primary text-cream text-[13px] sm:text-sm shrink-0';
const labelCls = 'block text-[12px] sm:text-[13.5px] font-semibold text-primary mb-1 sm:mb-2';
const exampleCls = 'shrink-0 px-1 py-0.5 text-[11.5px] sm:text-[12.5px] text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary';
const examplesRow = 'flex flex-nowrap sm:flex-wrap items-center gap-x-1 gap-y-0.5 mt-1.5 sm:mt-2 text-[11.5px] sm:text-[12.5px] overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] whitespace-nowrap sm:whitespace-normal';

export interface BarProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  /** Things to try; clicking one runs it. */
  examples: string[];
  /** Hovering or focusing an example — e.g. to start its search early. */
  onExampleWarm?: (e: string) => void;
  /** Desktop only: a link at the right end of the examples line (the gallery's "Search by image"). */
  aside?: ReactNode;
}

export interface AskBarProps extends BarProps {
  busy?: boolean;
  /** Suggestions offered after asking; they replace the examples while shown. */
  suggestions?: string[];
  suggestionsLabel?: string;
  /** Prefix shown on each suggestion, e.g. '+ ' when it adds to the search. */
  suggestionPrefix?: string;
  onSuggestion?: (s: string) => void;
}

function Examples({ items, label, prefix = '', onPick, onWarm }: { items: string[]; label: string; prefix?: string; onPick: (e: string) => void; onWarm?: (e: string) => void }) {
  return (
    <div className={examplesRow}>
      <span className="shrink-0 text-muted mr-0.5">{label}</span>
      {items.map((e) => (
        <button key={e} type="button" className={exampleCls} onPointerEnter={onWarm ? () => onWarm(e) : undefined} onFocus={onWarm ? () => onWarm(e) : undefined} onClick={() => onPick(e)}>
          {prefix}{e}
        </button>
      ))}
    </div>
  );
}

export default function SearchAskBars({ search, ask }: { search: BarProps; ask: AskBarProps }) {
  const suggestions = ask.suggestions ?? [];
  const showSuggestions = suggestions.length > 0 && !!ask.onSuggestion;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-7">
      <form onSubmit={(e) => { e.preventDefault(); search.onSubmit(search.value); }} role="search" aria-label={search.label}>
        <label htmlFor={search.id} className={labelCls}>{search.label}</label>
        <div className={field} data-catalog-bar>
          <input id={search.id} type="search" value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} className={input} />
          <button type="submit" className={button}>Search</button>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Examples items={search.examples} label="Try" onWarm={search.onExampleWarm} onPick={(e) => { search.onChange(e); search.onSubmit(e); }} />
          </div>
          {search.aside && <div className="hidden md:block shrink-0 mt-2">{search.aside}</div>}
        </div>
      </form>

      <form onSubmit={(e) => { e.preventDefault(); ask.onSubmit(ask.value); }} aria-label={ask.label}>
        <label htmlFor={ask.id} className={labelCls}>{ask.label}</label>
        <div className={field} data-catalog-bar>
          <input id={ask.id} type="text" value={ask.value} onChange={(e) => ask.onChange(e.target.value)} placeholder={ask.placeholder} className={input} />
          <button type="submit" aria-busy={!!ask.busy} className={button}>
            <span className={ask.busy ? 'invisible' : ''}>Ask</span>
            {ask.busy && <span aria-hidden className="absolute left-1/2 top-1/2 -ml-2 -mt-2 w-4 h-4 rounded-full border-2 border-cream/30 border-t-cream animate-spin" />}
          </button>
        </div>
        {showSuggestions
          ? <Examples items={suggestions} label={ask.suggestionsLabel ?? 'Also try'} prefix={ask.suggestionPrefix} onPick={(s) => ask.onSuggestion?.(s)} />
          : <Examples items={ask.examples} label="Try" onWarm={ask.onExampleWarm} onPick={(e) => { ask.onChange(e); ask.onSubmit(e); }} />}
      </form>
    </div>
  );
}
