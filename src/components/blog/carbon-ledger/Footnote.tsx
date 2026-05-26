'use client';
import { useState } from 'react';
import { findFootnote } from '@/components/blog/carbon-ledger/footnotes';

interface FootnoteProps {
  id: number;
}

/**
 * Inline footnote reference. Renders as a small superscript [n] that, on
 * hover/tap, reveals the source, claim, and URL in a popover.
 * Every claim that's not derived in the preceding sentence should carry one.
 */
export function Footnote({ id }: FootnoteProps) {
  const [open, setOpen] = useState(false);
  const fn = findFootnote(id);
  if (!fn) return <sup className="text-red-500">[?{id}]</sup>;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="ml-0.5 text-xs font-mono text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 cursor-help align-super"
        aria-label={`Footnote ${id}: ${fn.claim.slice(0, 80)}`}
      >
        [{id}]
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-6 z-50 w-80 rounded-md border border-stone-200 bg-white p-3 text-sm text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        >
          <span className="block font-semibold text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">
            {fn.type}
          </span>
          <span className="block font-medium mb-1">{fn.claim}</span>
          <span className="block text-xs text-stone-600 dark:text-stone-400 mb-1">
            <span className="font-semibold">Source: </span>
            {fn.source}
          </span>
          {'url' in fn && fn.url && (
            <a
              href={fn.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-blue-600 dark:text-blue-400 underline truncate hover:no-underline"
            >
              {fn.url}
            </a>
          )}
          {'reproducible_via' in fn && fn.reproducible_via && (
            <span className="block text-xs font-mono text-stone-600 dark:text-stone-400 mt-1">
              ↻ {fn.reproducible_via}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
