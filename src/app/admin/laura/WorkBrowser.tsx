'use client';

import { useMemo, useState } from 'react';
import type { WorkItem, WorkStatus } from '@/lib/work-record';

const LINK = 'text-accent-rust hover:underline';
const HEADING = 'font-sans !font-bold tracking-tight text-stone-950';

const STATUS: Record<WorkStatus, { label: string; tone: string }> = {
  live: { label: 'Finished', tone: 'bg-green-100 text-green-800' },
  waiting: { label: 'Not finished', tone: 'bg-amber-200 text-amber-900' },
  shelved: { label: 'Shelved', tone: 'bg-stone-300 text-stone-800' },
  local: { label: "On Laura's computer", tone: 'bg-sky-100 text-sky-800' },
};
const STATUS_ORDER: WorkStatus[] = ['live', 'waiting', 'shelved', 'local'];

type Sort = 'newest' | 'oldest' | 'title';

function month(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function PrLinks({ prs, repo }: { prs: number[]; repo: string }) {
  const link = (n: number) => <a key={n} href={`${repo}/pull/${n}`} className={LINK}>#{n}</a>;
  if (prs.length === 1) return <span className="text-stone-600">Pull request {link(prs[0])}</span>;
  return (
    <details className="text-stone-600">
      <summary className="cursor-pointer hover:text-stone-900">{prs.length} pull requests</summary>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{prs.map(link)}</div>
    </details>
  );
}

function Item({ item, repo, onTag }: { item: WorkItem; repo: string; onTag: (t: string) => void }) {
  const { label, tone } = STATUS[item.status];
  return (
    <li className="py-7 first:pt-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_15rem] min-w-0">
      <div className="grid gap-3 content-start min-w-0 max-w-2xl">
        <div className="grid gap-1.5">
          <h4 className={`${HEADING} text-xl`}>{item.title}</h4>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className={`rounded px-2 py-0.5 font-medium ${tone}`}>{label}</span>
            {item.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(t)}
                className="rounded px-2 py-0.5 bg-stone-100 text-stone-700 hover:bg-stone-200 cursor-pointer"
              >
                {t}
              </button>
            ))}
            {item.when ? <span className="text-stone-500 ml-1">{item.when}</span> : null}
          </div>
        </div>
        <p className="text-base text-stone-800 leading-relaxed">{item.what}</p>
        {item.next ? (
          <p className="text-base text-stone-900 leading-relaxed bg-amber-50 border-l-4 border-amber-400 px-3 py-2">
            <strong>Next:</strong> {item.next}
          </p>
        ) : null}
        {item.team ? (
          <p className="text-sm text-stone-700 leading-relaxed bg-stone-100 border-l-4 border-stone-300 px-3 py-2">
            <strong className="text-stone-900">For the team:</strong> {item.team}
          </p>
        ) : null}
        {item.href || item.prs?.length ? (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            {item.href ? <a href={item.href} className={`${LINK} font-semibold`}>Open page</a> : null}
            {item.prs?.length ? <PrLinks prs={item.prs} repo={repo} /> : null}
          </div>
        ) : null}
      </div>
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI from the record, nothing to optimise
        <img src={item.image} alt="" loading="lazy" className="w-full h-auto rounded border border-stone-300" />
      ) : null}
    </li>
  );
}

function Option({ on, label, n, onClick }: { on: boolean; label: string; n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`w-full flex justify-between gap-3 rounded px-2.5 py-1.5 text-sm text-left cursor-pointer ${on ? 'bg-stone-900 text-white' : 'text-stone-800 hover:bg-stone-200'}`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${on ? 'text-stone-300' : 'text-stone-500'}`}>{n}</span>
    </button>
  );
}

function searchable(i: WorkItem) {
  return [i.title, i.what, i.team, i.next, ...i.tags, ...(i.prs ?? []).map(String)].join(' ').toLowerCase();
}

export function WorkBrowser({ items, repo }: { items: WorkItem[]; repo: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<WorkStatus | 'all'>('all');
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const clear = () => { setQ(''); setStatus('all'); setTags([]); };

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter((i) => (status === 'all' || i.status === status)
      && (!tags.length || i.tags.some((t) => tags.includes(t)))
      && words.every((w) => searchable(i).includes(w)));
    return list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      const byDate = a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
      return sort === 'oldest' ? byDate : -byDate;
    });
  }, [items, q, status, tags, sort]);

  const sections = useMemo(() => {
    if (sort === 'title') return [{ heading: null as string | null, list: shown }];
    const out: { heading: string | null; list: WorkItem[] }[] = [];
    for (const i of shown) {
      const m = month(i.date);
      if (out.at(-1)?.heading === m) out.at(-1)!.list.push(i);
      else out.push({ heading: m, list: [i] });
    }
    return out;
  }, [shown, sort]);

  const filtered = q.trim() !== '' || status !== 'all' || tags.length > 0;
  const activeFilters = (status === 'all' ? 0 : 1) + tags.length;

  return (
    <section id="work" className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12 min-w-0">
      <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="lg:hidden w-full rounded border border-stone-300 bg-white px-3 py-2 text-base text-left text-stone-900 cursor-pointer mb-3"
        >
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <div className={`${filtersOpen ? 'grid' : 'hidden'} lg:grid gap-6 mb-6 lg:mb-0`}>
          <div className="grid gap-0.5">
            <h3 className={`${HEADING} text-base mb-1 px-2.5`}>Status</h3>
            <Option on={status === 'all'} label="All" n={items.length} onClick={() => setStatus('all')} />
            {STATUS_ORDER.map((s) => (
              <Option
                key={s}
                on={status === s}
                label={STATUS[s].label}
                n={items.filter((i) => i.status === s).length}
                onClick={() => setStatus(status === s ? 'all' : s)}
              />
            ))}
          </div>
          <div className="grid gap-0.5">
            <h3 className={`${HEADING} text-base mb-1 px-2.5`}>Tags</h3>
            {allTags.map(([t, n]) => <Option key={t} on={tags.includes(t)} label={t} n={n} onClick={() => toggleTag(t)} />)}
          </div>
        </div>
      </aside>

      <div className="grid gap-8 min-w-0 content-start">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the work"
            aria-label="Search the work"
            className="flex-1 min-w-52 rounded border border-stone-300 bg-white px-3 py-2 text-base text-stone-900"
          />
          <label className="flex items-center gap-2 text-base text-stone-700">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded border border-stone-300 bg-white px-2 py-2 text-base text-stone-900 cursor-pointer"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="title">A to Z</option>
            </select>
          </label>
          <p className="basis-full text-sm text-stone-600" aria-live="polite">
            {shown.length} of {items.length} shown
            {filtered ? <button type="button" onClick={clear} className={`${LINK} ml-3 cursor-pointer`}>Clear</button> : null}
          </p>
        </div>

        {shown.length === 0 ? <p className="text-base text-stone-700">Nothing matches.</p> : null}
        {sections.map(({ heading, list }) => (
          <div key={heading ?? 'all'} className="grid gap-1 min-w-0">
            {heading ? <h3 className={`${HEADING} text-3xl border-b-2 border-stone-900 pb-2`}>{heading}</h3> : null}
            <ul className="divide-y divide-stone-200">
              {list.map((item) => <Item key={item.title} item={item} repo={repo} onTag={toggleTag} />)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
