'use client';

import { useMemo, useState } from 'react';
import type { WorkPr } from '@/lib/work-record';

const STATES: { key: WorkPr['state'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'merged', label: 'Merged' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed, not merged' },
];

const TONE: Record<WorkPr['state'], string> = {
  merged: 'bg-green-100 text-green-800',
  open: 'bg-amber-100 text-amber-800',
  closed: 'bg-stone-200 text-stone-700',
};

function month(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function PrList({ prs, repo }: { prs: WorkPr[]; repo: string }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<WorkPr['state'] | 'all'>('all');

  const months = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = prs.filter((p) => (state === 'all' || p.state === state)
      && (!needle || p.title.toLowerCase().includes(needle) || String(p.n).includes(needle)));
    const byMonth = new Map<string, WorkPr[]>();
    for (const p of shown) {
      const m = month(p.date);
      byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
    }
    return [...byMonth.entries()];
  }, [prs, q, state]);

  return (
    <div className="grid gap-8 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles"
          aria-label="Search pull request titles"
          className="w-full sm:w-72 rounded border border-stone-300 bg-white px-3 py-1.5 text-base text-stone-900"
        />
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setState(s.key)}
            aria-pressed={state === s.key}
            className={`rounded px-2.5 py-1.5 text-sm cursor-pointer ${state === s.key ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {months.length === 0 ? <p className="text-sm text-stone-600">Nothing matches.</p> : null}
      {months.map(([m, list]) => (
        <div key={m} className="grid gap-2 min-w-0">
          <h3 className="font-sans !font-bold tracking-tight text-xl text-stone-950">{m} <span className="font-normal text-stone-500">{list.length}</span></h3>
          <ul className="rounded border border-stone-200 bg-white divide-y divide-stone-100">
            {list.map((p) => (
              <li key={p.n} className="px-3 py-2.5 flex items-baseline gap-3 text-base min-w-0">
                <a href={`${repo}/pull/${p.n}`} className="text-accent-rust hover:underline tabular-nums shrink-0">#{p.n}</a>
                <span className="text-stone-800 min-w-0 flex-1">{p.title}</span>
                {p.state === 'merged' ? null : <span className={`text-xs rounded px-1.5 py-0.5 shrink-0 ${TONE[p.state]}`}>{p.state}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
