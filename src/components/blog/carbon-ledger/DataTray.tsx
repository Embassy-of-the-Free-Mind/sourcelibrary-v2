'use client';
import { useState, ReactNode } from 'react';

interface DataTrayProps {
  title?: string;
  /** Footnote IDs (from /data/provenance.json) supporting the chart */
  sources: number[];
  /** Inline rendering of the underlying data table or notes */
  children: ReactNode;
}

import { findFootnote } from '@/components/blog/carbon-ledger/footnotes';

/**
 * Slide-open tray under every interactive chart. Shows the chart's
 * underlying data, the assumptions, and citations. Closed by default.
 */
export function DataTray({ title = 'Data & sources', sources, children }: DataTrayProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-stone-200 dark:border-stone-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left text-sm font-mono text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 flex items-center justify-between"
      >
        <span>
          {open ? '▾' : '▸'} {title}
        </span>
        <span className="text-xs text-stone-400">
          {sources.length} source{sources.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-4 pt-1 text-sm space-y-3 text-stone-700 dark:text-stone-300">
          {children}
          <div className="text-xs space-y-2 border-t border-stone-100 dark:border-stone-800 pt-3">
            <div className="font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
              Sources
            </div>
            {sources.map((id) => {
              const f = findFootnote(id);
              if (!f) return null;
              return (
                <div key={id} className="leading-snug">
                  <span className="font-mono text-amber-700 dark:text-amber-300">[{id}]</span>{' '}
                  <span className="text-stone-700 dark:text-stone-300">{f.source}</span>
                  {'url' in f && f.url && (
                    <>
                      {' '}
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 underline hover:no-underline break-all"
                      >
                        ↗
                      </a>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
