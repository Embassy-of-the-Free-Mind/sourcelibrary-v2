'use client';

import { useEffect, useState } from 'react';
import type { Rescue } from '@/lib/search-rescue';

/**
 * What a search that found nothing probably meant, from /api/search/rescue:
 * every suggestion is checked to find something on the page before it is
 * offered. Shared by /library and /gallery.
 */
export function useRescue(query: string, scope: 'gallery' | 'library', empty: boolean): Rescue[] {
  const [result, setResult] = useState<{ key: string; rescues: Rescue[] } | null>(null);
  const key = empty && query.trim() ? `${scope}:${query.trim().toLowerCase()}` : '';
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    fetch(`/api/search/rescue?scope=${scope}&q=${encodeURIComponent(query.trim())}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : { rescues: [] }))
      .then((j) => setResult({ key, rescues: Array.isArray(j.rescues) ? j.rescues : [] }))
      .catch(() => {});
    return () => ctl.abort();
  }, [key, query, scope]);
  return key && result?.key === key ? result.rescues : [];
}

const linkCls = 'p-0 border-0 bg-transparent text-primary underline decoration-border-medium underline-offset-[3px] hover:decoration-primary font-semibold';
const label = (r: Rescue) => `${r.q}${r.type ? ` (${r.type}s)` : ''}`;

/**
 * Either the librarian's correction ("Nothing matched X, so I looked for Y"),
 * or, for a typed search, "Did you mean Y? Or: Z · W".
 */
export default function DidYouMean({ rescues, corrected, onPick }: {
  rescues: Rescue[];
  /** Set when an ask that found nothing was answered with a correction. */
  corrected?: { from: string; to: string } | null;
  onPick: (r: Rescue) => void;
}) {
  if (corrected) {
    return (
      <p role="status" className="mt-3 text-[14px] text-secondary">
        Nothing matched “{corrected.from}”, so the librarian looked for <b className="font-semibold text-primary">“{corrected.to}”</b>.
      </p>
    );
  }
  if (!rescues.length) return null;
  const [first, ...rest] = rescues;
  return (
    <p role="status" className="mt-3 text-[14px] text-secondary">
      Did you mean{' '}
      <button type="button" className={linkCls} onClick={() => onPick(first)}>{label(first)}</button>?
      {rest.length > 0 && (
        <span className="text-muted">
          {' '}Or{' '}
          {rest.map((r, i) => (
            <span key={label(r)}>
              {i > 0 && <span aria-hidden> · </span>}
              <button type="button" className="p-0 border-0 bg-transparent text-secondary underline decoration-border-medium underline-offset-[3px] hover:text-primary" onClick={() => onPick(r)}>{label(r)}</button>
            </span>
          ))}
        </span>
      )}
    </p>
  );
}
