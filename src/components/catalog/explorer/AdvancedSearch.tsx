'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogFilters } from '@/lib/catalog/filters';
import { writeCatalogFilters } from '@/lib/catalog/filters';
import ApplyFooter from '@/components/search-kit/ApplyFooter';

export interface Draft extends CatalogFilters {
  topic?: string;
}

interface Props {
  /** What the results currently show; the form starts from it. */
  applied: Draft;
  languages: string[];
  categories: { value: string; label: string }[];
  collections: { value: string; label: string }[];
  /** Half-century counts for the chart (the year filter is not applied to them). */
  printed: { from: number | null; to: number | null; count: number }[];
  onApply: (draft: Draft) => void;
  /** Reports whether the form differs from what is applied, so the page can fade the old results. */
  onDirty: (dirty: boolean) => void;
}

const input = 'w-full h-10 border border-border-medium bg-white px-3 text-base text-primary focus:outline-none focus:border-primary';
const label = 'block text-[13px] font-semibold text-primary mb-1.5';
const hint = 'font-normal text-muted';

const listOf = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);
const yearOf = (s: string) => (/^-?\d{1,4}$/.test(s.trim()) ? parseInt(s, 10) : undefined);
const snapshot = (d: Draft) => JSON.stringify(d, Object.keys(d).sort());

/**
 * Advanced search, opened under the bars. Changes wait for "Show results" —
 * a deliberate step — and the panel makes that impossible to miss: the button
 * turns rust and pulses, says how many works the change would show, the old
 * results fade, and a bar with the same button rides along the bottom of the
 * screen when the button itself is out of view.
 */
export default function AdvancedSearch({ applied, languages, categories, collections, printed, onApply, onDirty }: Props) {
  const [q, setQ] = useState(applied.q ?? '');
  const [topic, setTopic] = useState(applied.topic ?? '');
  const [also, setAlso] = useState((applied.also ?? []).join(', '));
  const [title, setTitle] = useState(applied.title ?? '');
  const [author, setAuthor] = useState(applied.author ?? '');
  const [not, setNot] = useState(applied.not ?? '');
  const [y1, setY1] = useState(applied.yearMin != null ? String(applied.yearMin) : '');
  const [y2, setY2] = useState(applied.yearMax != null ? String(applied.yearMax) : '');
  const [langs, setLangs] = useState<string[]>(applied.languages ?? []);
  const [category, setCategory] = useState(applied.category ?? '');
  const [collection, setCollection] = useState(applied.collection ?? '');
  const [hasTr, setHasTr] = useState(!!applied.hasTranslation);
  const [firstTr, setFirstTr] = useState(!!applied.firstTranslation);
  // The count for the draft it was asked for; a stale count is never shown.
  const [preview, setPreview] = useState<{ key: string; total: number } | null>(null);
  const dragFrom = useRef<number | null>(null);

  const draft: Draft = useMemo(() => ({
    q: q.trim() || undefined,
    topic: topic.trim() || undefined,
    also: listOf(also).length ? listOf(also) : undefined,
    title: title.trim() || undefined,
    author: author.trim() || undefined,
    not: not.trim() || undefined,
    languages: langs.length ? langs : undefined,
    category: category || undefined,
    collection: collection || undefined,
    yearMin: yearOf(y1),
    yearMax: yearOf(y2),
    hasTranslation: hasTr || undefined,
    firstTranslation: firstTr || undefined,
  }), [q, topic, also, title, author, not, langs, category, collection, y1, y2, hasTr, firstTr]);

  const base = useMemo(() => snapshot({
    q: applied.q, topic: applied.topic, also: applied.also, title: applied.title, author: applied.author, not: applied.not,
    languages: applied.languages, category: applied.category, collection: applied.collection,
    yearMin: applied.yearMin, yearMax: applied.yearMax, hasTranslation: applied.hasTranslation, firstTranslation: applied.firstTranslation,
  }), [applied]);
  const dirty = snapshot(draft) !== base;

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // How many works the change would show — where that is quick to know. An
  // "about" topic is a full-text search of several seconds; no count for it.
  const draftKey = snapshot(draft);
  useEffect(() => {
    if (!dirty || draft.topic) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const sp = writeCatalogFilters(draft);
      sp.set('limit', '1');
      fetch(`/api/catalog/results?${sp}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((r) => { if (typeof r.total === 'number') setPreview({ key: draftKey, total: r.total }); })
        .catch(() => {});
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [dirty, draft, draftKey]);

  const maxBucket = Math.max(1, ...printed.map((p) => p.count));
  const ymin = yearOf(y1), ymax = yearOf(y2);
  const bars = printed.map((p, i) => ({
    key: i,
    height: p.count ? Math.max(3, Math.round((72 * p.count) / maxBucket)) : 1,
    on: (ymin != null || ymax != null) && (ymin == null || (p.to ?? 9999) >= ymin) && (ymax == null || (p.from ?? -9999) <= ymax),
    label: `${p.from == null ? `before ${(p.to ?? 0) + 1}` : p.to == null ? `${p.from} and after` : `${p.from}–${String(p.to).slice(2)}`}: ${p.count.toLocaleString('en-GB')}`,
  }));
  const setSpan = (i: number, j: number) => {
    const [a, z] = [Math.min(i, j), Math.max(i, j)];
    setY1(printed[a]?.from != null ? String(printed[a].from) : '');
    setY2(printed[z]?.to != null ? String(printed[z].to) : '');
  };
  const barAt = (el: HTMLElement, x: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(printed.length - 1, Math.floor(((x - r.left) / r.width) * printed.length)));
  };

  const count = dirty && !draft.topic && preview?.key === draftKey ? preview.total : null;
  const clearAll = () => {
    setQ(''); setTopic(''); setAlso(''); setTitle(''); setAuthor(''); setNot(''); setY1(''); setY2('');
    setLangs([]); setCategory(''); setCollection(''); setHasTr(false); setFirstTr(false);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onApply(draft); }}
      className="border-b border-border-light py-[22px]"
      autoComplete="off"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-[18px]">
        <div><label className={label} htmlFor="cat-q">Keywords <span className={hint}>in title or author</span></label><input id="cat-q" className={input} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label className={label} htmlFor="cat-topic">About <span className={hint}>found inside the books</span></label><input id="cat-topic" className={input} value={topic} onChange={(e) => setTopic(e.target.value)} /></div>

        <div className="sm:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <span className={`${label} flex justify-between`}>
            Printed
            {(y1 || y2) && <button type="button" onClick={() => { setY1(''); setY2(''); }} className="text-[12.5px] font-normal text-muted underline underline-offset-2">Clear</button>}
          </span>
          <div
            className="flex items-end gap-[3px] h-[72px] cursor-pointer touch-none select-none"
            role="group"
            aria-label="Pick a span of years"
            onPointerDown={(e) => { if (!printed.length) return; const i = barAt(e.currentTarget, e.clientX); dragFrom.current = i; e.currentTarget.setPointerCapture(e.pointerId); setSpan(i, i); }}
            onPointerMove={(e) => { if (dragFrom.current != null) setSpan(dragFrom.current, barAt(e.currentTarget, e.clientX)); }}
            onPointerUp={() => { dragFrom.current = null; }}
          >
            {bars.map((b) => <div key={b.key} title={b.label} className={`flex-1 ${b.on ? 'bg-primary' : 'bg-border-medium'} hover:bg-accent-rust`} style={{ height: `${b.height}px` }} />)}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <input aria-label="Printed from" inputMode="numeric" placeholder="From" className={input} value={y1} onChange={(e) => setY1(e.target.value)} />
            <span className="text-muted">to</span>
            <input aria-label="Printed to" inputMode="numeric" placeholder="To" className={input} value={y2} onChange={(e) => setY2(e.target.value)} />
          </div>
        </div>

        <div><label className={label} htmlFor="cat-title">Title contains</label><input id="cat-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className={label} htmlFor="cat-author">Author</label><input id="cat-author" className={input} value={author} onChange={(e) => setAuthor(e.target.value)} /></div>

        <div className="sm:col-span-2 lg:col-span-3">
          <span className={label}>Language</span>
          <div className="flex flex-wrap gap-1.5">
            {languages.map((l) => {
              const on = langs.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on}
                  onClick={() => setLangs(on ? langs.filter((x) => x !== l) : [...langs, l])}
                  className={`h-[30px] px-3 border text-[13px] ${on ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`}>
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        <div><label className={label} htmlFor="cat-also">Also search for <span className={hint}>other names, comma between</span></label><input id="cat-also" className={input} value={also} onChange={(e) => setAlso(e.target.value)} /></div>
        <div><label className={label} htmlFor="cat-not">Leave out</label><input id="cat-not" className={input} value={not} onChange={(e) => setNot(e.target.value)} /></div>
        <div>
          <label className={label} htmlFor="cat-subject">Subject</label>
          <select id="cat-subject" className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any subject</option>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="cat-collection">Collection</label>
          <select id="cat-collection" className={input} value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">Any collection</option>
            {collections.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-6 items-end pb-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-[var(--color-primary)]" checked={hasTr} onChange={(e) => setHasTr(e.target.checked)} />Translated into English</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-[var(--color-primary)]" checked={firstTr} onChange={(e) => setFirstTr(e.target.checked)} />First translations only</label>
        </div>
      </div>

      <ApplyFooter dirty={dirty} count={count} noun="results" onClear={clearAll} />
    </form>
  );
}
