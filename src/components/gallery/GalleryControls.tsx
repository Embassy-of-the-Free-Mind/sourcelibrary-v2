'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, ChevronDown } from 'lucide-react';
import SearchAskBars from '@/components/search-kit/SearchAskBars';
import FilterChips, { type Chip } from '@/components/search-kit/FilterChips';
import ApplyFooter from '@/components/search-kit/ApplyFooter';
import GalleryStatsBand from '@/components/gallery/GalleryStatsBand';
import type { GalleryStats } from '@/lib/gallery-stats';
import { readRequest } from '@/lib/catalog/read-request';
import { guideTerms } from '@/lib/catalog/ask-client';
import { SUBJECT_CATEGORIES, topicLabel } from '@/lib/image-subjects';
import { LIBRARY_PARTNERS, getPartnerByProvider } from '@/lib/library-partners';
import { RANDOM_SEEDS } from '@/lib/gallery-sort';
import { gallery, books, type GalleryResponse } from '@/lib/api-client';

/**
 * The gallery's controls, in the Library's shape: Search the gallery and Ask
 * the librarian side by side, the stats band, Advanced search under them,
 * and the applied filters as chips.
 *
 * Everything here reads and writes the gallery's own URL parameters (q, topic,
 * subject, type, library, collection, bookId, yearStart, yearEnd, minQuality,
 * includeArchive, source, sort, seed), so the fetch, ranking and grounding in
 * GalleryClient and /api/gallery (#5202–#5208) are untouched: this only
 * decides which parameters to set.
 */

export interface GalleryUrlState {
  q: string;
  topic: string;
  subject: string;
  type: string;
  library: string;
  collection: string;
  bookId: string;
  yearStart: string;
  yearEnd: string;
  /** gallery = default quality floor; exhibition = best only; archive = everything. */
  quality: 'gallery' | 'exhibition' | 'archive';
  source: string;
  sort: string;
}

type Params = Record<string, string>;

/** The URL parameters for a state; empty values are dropped by the caller. */
export function galleryParams(s: GalleryUrlState): Params {
  return {
    q: s.q, topic: s.topic, subject: s.subject, type: s.type, library: s.library, collection: s.collection,
    bookId: s.bookId, yearStart: s.yearStart, yearEnd: s.yearEnd, source: s.source === 'all' ? '' : s.source,
    minQuality: s.quality === 'exhibition' ? '0.9' : '',
    includeArchive: s.quality === 'archive' ? 'true' : '',
    sort: s.sort,
  };
}

const EMPTY: GalleryUrlState = {
  q: '', topic: '', subject: '', type: '', library: '', collection: '', bookId: '', yearStart: '', yearEnd: '',
  quality: 'gallery', source: 'all', sort: '',
};

/**
 * Things to try, each tested against /api/gallery for plenty of good images
 * (2026-10-18): dragon 1,457, unicorn 131, mermaid 81, skeleton 261,
 * sea monster 311, alchemical furnace 837, phoenix 247, tarot 449,
 * magic circle 194, labyrinth 143, cat 375. Asked on the page: alchemists at
 * their furnaces 111, monsters of the sea 285, world maps before 1600 146,
 * the signs of the zodiac 1,366, ships at sea 353. Playful, not sad.
 */
const SEARCH_POOL = ['Dragon', 'Unicorn', 'Mermaid', 'Skeleton', 'Sea monster', 'Phoenix', 'Tarot', 'Labyrinth', 'Cat', 'Owl'];
const ASK_POOL = [
  'alchemists at their furnaces', 'magic circles', 'monsters of the sea', 'maps of the world before 1600',
  'the signs of the zodiac', 'eclipses of the sun and moon', 'ships at sea', 'skeletons and anatomy',
];
function ofTheDay<T>(pool: readonly T[], n: number, offset = 0): T[] {
  const day = Math.floor(Date.now() / 86_400_000) + offset;
  return Array.from({ length: Math.min(n, pool.length) }, (_, i) => pool[(day * n + i) % pool.length]);
}

/** The gallery's subject vocabulary as the request reader takes it. */
const TOPIC_VOCAB = SUBJECT_CATEGORIES.flatMap((c) => [{ value: c.id, label: c.label }, ...c.terms.map((t) => ({ value: t.id, label: t.label }))]);


interface Props {
  state: GalleryUrlState;
  /** Replace the whole set of gallery parameters (a fresh search or ask). */
  replace: (p: Params) => void;
  /** Change some parameters, keeping the rest. */
  update: (p: Params) => void;
  data: GalleryResponse | null;
  loading: boolean;
  bookCollections: { slug: string; name: string; book_count: number; parent?: string | null }[];
  isTenantHost: boolean;
}

export default function GalleryControls({ state, replace, update, data, loading, bookCollections, isTenantHost }: Props) {
  const [searchText, setSearchText] = useState(state.q);
  const [askText, setAskText] = useState('');
  const [asked, setAsked] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [advOpen, setAdvOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const searchExamples = ofTheDay(SEARCH_POOL, 4);
  const askExamples = ofTheDay(ASK_POOL, 3, 2);

  // The typed text follows the committed query (back/forward, a removed chip).
  const lastQ = useRef(state.q);
  useEffect(() => {
    if (lastQ.current === state.q) return;
    lastQ.current = state.q;
    queueMicrotask(() => setSearchText(state.q));
  }, [state.q]);

  /** A typed search or an asked request, read into the gallery's own filters. */
  const read = (text: string, stems: boolean): Params => {
    const r = readRequest(text, { languages: [], categories: TOPIC_VOCAB }, { stems });
    // No language filter on images; a name after "by" is searched as words.
    const words = [r.authorQuery, r.topic].filter(Boolean).join(' ').trim();
    return {
      q: words,
      topic: r.category ?? '',
      yearStart: r.yearMin != null ? String(r.yearMin) : '',
      yearEnd: r.yearMax != null ? String(r.yearMax) : '',
    };
  };
  const search = (text: string) => {
    setAskText(''); setAsked(''); setSuggestions([]);
    replace(read(text, false));
  };
  const ask = (text: string) => {
    if (!text.trim()) return;
    setSearchText(''); setAsked(text.trim()); setSuggestions([]);
    replace(read(text, true));
    // The search guide's picture subjects, offered as other things to look at.
    guideTerms(text, 'image_terms').then(setSuggestions);
  };

  /* --- what is applied, as chips --- */
  const chips: (Chip & { clear: Params })[] = [];
  if (state.q) chips.push({ key: 'q', label: `“${state.q}”`, clear: { q: '' } });
  if (state.topic) chips.push({ key: 'topic', label: topicLabel(state.topic) ?? state.topic, clear: { topic: '' } });
  if (state.subject) chips.push({ key: 'subject', label: state.subject, clear: { subject: '' } });
  if (state.bookId) chips.push({ key: 'book', label: data?.bookInfo?.title ? `Book: ${data.bookInfo.title}` : 'One book', clear: { bookId: '' } });
  if (state.collection) chips.push({ key: 'collection', label: bookCollections.find((c) => c.slug === state.collection)?.name ?? state.collection.replace(/-/g, ' '), clear: { collection: '' } });
  if (state.library) chips.push({ key: 'library', label: getPartnerByProvider(state.library)?.name ?? state.library, clear: { library: '' } });
  if (state.type) chips.push({ key: 'type', label: state.type.charAt(0).toUpperCase() + state.type.slice(1), clear: { type: '' } });
  if (state.yearStart || state.yearEnd) {
    const y = state.yearStart && state.yearEnd ? `${state.yearStart}–${state.yearEnd}` : state.yearStart ? `from ${state.yearStart}` : `until ${state.yearEnd}`;
    chips.push({ key: 'years', label: `Printed ${y}`, clear: { yearStart: '', yearEnd: '' } });
  }
  if (state.source !== 'all') chips.push({ key: 'source', label: state.source === 'artwork' ? 'Artworks only' : 'Book plates only', clear: { source: '' } });
  if (state.quality !== 'gallery') chips.push({ key: 'quality', label: state.quality === 'exhibition' ? 'Best only' : 'All images', clear: { minQuality: '', includeArchive: '' } });
  const removeChip = (key: string) => {
    const c = chips.find((x) => x.key === key);
    if (c) update(c.clear);
  };
  const clearAll = () => { setSearchText(''); setAskText(''); setAsked(''); setSuggestions([]); replace({}); };

  /* --- the numbers --- */
  const searched = chips.length > 0;
  const { stats, galleryTotal, statsLoading } = useGalleryStats(state, searched);
  const total = loading ? null : (data?.total ?? null);
  // A search's first page also carries artworks matched by title ("ship of
  // fools" finds three, and no plates). /api/gallery/stats cannot reproduce
  // that lane, so the band adds the ones the page holds; they all come on page one.
  const titleArtworks = state.q && !loading ? (data?.items ?? []).filter((i) => i.source === 'artwork').length : 0;
  const yearMin = state.yearStart ? parseInt(state.yearStart, 10) : undefined;
  const yearMax = state.yearEnd ? parseInt(state.yearEnd, 10) : undefined;
  const yearsFromBand = (from: number | null, to: number | null) => {
    const same = yearMin === (from ?? undefined) && yearMax === (to ?? undefined);
    update({ yearStart: same || from == null ? '' : String(from), yearEnd: same || to == null ? '' : String(to) });
  };

  const sortValue = state.sort;
  const sortLabelBest = state.q ? 'Most relevant' : 'Best quality';

  return (
    <div>
      <SearchAskBars
        search={{
          id: 'gallery-search', label: 'Search the images', placeholder: 'Dragons, comets, a book',
          value: searchText, onChange: setSearchText, onSubmit: search, examples: searchExamples,
          // Entry point to /identify (#4232); hidden on partner hosts, where /identify is global-only.
          aside: isTenantHost ? undefined : (
            <Link href="/identify" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-primary" title="Photograph or upload a picture to find it in the library">
              <Camera className="w-3.5 h-3.5" aria-hidden /> Search by image
            </Link>
          ),
        }}
        ask={{
          id: 'gallery-ask', label: 'Ask the librarian', placeholder: 'What would you like to see?',
          value: askText, onChange: setAskText, onSubmit: ask, examples: askExamples,
          busy: loading && !!asked, suggestions, suggestionsLabel: 'Also look at',
          onSuggestion: (t) => { setSearchText(t); search(t); },
        }}
      />

      <GalleryStatsBand
        stats={stats}
        total={total}
        galleryTotal={galleryTotal}
        titleArtworks={titleArtworks}
        searched={searched}
        stale={loading || statsLoading || dirty}
        source={state.source}
        type={state.type}
        yearMin={yearMin}
        yearMax={yearMax}
        onYears={yearsFromBand}
        onType={(t) => update({ type: t })}
        onSource={(src) => update({ source: src })}
      />

      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mt-3 sm:mt-4 pb-3 sm:pb-3.5 border-b border-border-light">
        <button type="button" onClick={() => setAdvOpen((o) => !o)} aria-expanded={advOpen}
          className={`order-1 sm:order-none inline-flex items-center gap-2 h-9 sm:h-[38px] px-3 sm:px-3.5 border text-[13px] sm:text-sm ${advOpen ? 'bg-primary text-cream border-primary' : 'bg-white text-primary border-border-medium'}`}>
          <span className="sm:hidden">Advanced</span><span className="hidden sm:inline">Advanced search</span>
          {chips.length > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent-rust text-white text-xs grid place-items-center">{chips.length}</span>}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <FilterChips chips={chips} onRemove={removeChip} onClearAll={clearAll} />
        <div className="order-2 sm:order-none ml-auto flex items-center gap-2 sm:gap-2.5">
          <label className="sr-only" htmlFor="gallery-sort">Sort</label>
          <select id="gallery-sort" value={sortValue}
            onChange={(e) => {
              const next = e.target.value;
              // A fresh shuffle each time Random is chosen; the seed stays in the URL.
              update({ sort: next, seed: next === 'random' ? String(Math.floor(Math.random() * RANDOM_SEEDS)) : '' });
            }}
            className="h-9 sm:h-[38px] w-[140px] sm:w-auto border border-border-medium bg-white px-2.5 sm:px-3 text-base sm:text-sm text-primary">
            <option value="">{sortLabelBest}</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="book">By book</option>
            <option value="recent">Recently added</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>

      {advOpen && (
        <GalleryAdvanced
          key={JSON.stringify(state)}
          applied={state}
          types={data?.filters?.types ?? []}
          bookCollections={bookCollections}
          bookTitle={data?.bookInfo?.title ?? ''}
          onApply={(d) => { setAdvOpen(false); setDirty(false); replace(galleryParams(d)); }}
          onDirty={setDirty}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- stats */

const STATS_KEYS = ['q', 'topic', 'subject', 'type', 'library', 'collection', 'bookId', 'yearStart', 'yearEnd', 'minQuality', 'includeArchive', 'source'];

/**
 * The band's numbers for the applied filters, from /api/gallery/stats, plus the
 * whole gallery's image count for "of N". A failed count shows dashes, never
 * the previous search's figures.
 */
function useGalleryStats(state: GalleryUrlState, searched: boolean) {
  const p = galleryParams(state);
  const qs = new URLSearchParams(STATS_KEYS.filter((k) => p[k]).map((k) => [k, p[k]])).toString();
  const [result, setResult] = useState<{ key: string; stats: GalleryStats | null } | null>(null);
  const [galleryTotal, setGalleryTotal] = useState<number | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/gallery/stats?${qs}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setResult({ key: qs, stats: j && typeof j.total === 'number' ? j : null }))
      .catch((e) => { if ((e as Error).name !== 'AbortError') setResult({ key: qs, stats: null }); });
    return () => ctl.abort();
  }, [qs]);

  // The whole gallery, once, for "of N"; the unfiltered band already has it.
  useEffect(() => {
    if (galleryTotal != null) return;
    if (!qs && result?.key === '' && result.stats) { queueMicrotask(() => setGalleryTotal(result.stats!.total)); return; }
    if (!searched) return;
    const ctl = new AbortController();
    fetch('/api/gallery/stats', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.total === 'number') setGalleryTotal(j.total); })
      .catch(() => {});
    return () => ctl.abort();
  }, [galleryTotal, qs, result, searched]);

  const current = result?.key === qs ? result : null;
  return { stats: current?.stats ?? (result?.stats ?? null), galleryTotal, statsLoading: !current };
}

/* ------------------------------------------------------------- Advanced */

const input = 'w-full h-10 border border-border-medium bg-white px-3 text-base text-primary focus:outline-none focus:border-primary';
const labelCls = 'block text-[13px] font-semibold text-primary mb-1.5';
const hint = 'font-normal text-muted';
const pill = (on: boolean) => `h-[30px] px-3 border text-[13px] ${on ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`;
const PRESETS: [string, string, string][] = [['Before 1500', '', '1500'], ['1500s', '1500', '1599'], ['1600s', '1600', '1699'], ['1700s', '1700', '1799'], ['1800s', '1800', '1899']];

function GalleryAdvanced({ applied, types, bookCollections, bookTitle, onApply, onDirty }: {
  applied: GalleryUrlState;
  types: string[];
  bookCollections: { slug: string; name: string; book_count: number; parent?: string | null }[];
  bookTitle: string;
  onApply: (d: GalleryUrlState) => void;
  onDirty: (d: boolean) => void;
}) {
  const [d, setD] = useState<GalleryUrlState>(applied);
  const set = (p: Partial<GalleryUrlState>) => setD((x) => ({ ...x, ...p }));
  const [bookQuery, setBookQuery] = useState('');
  const [bookHits, setBookHits] = useState<{ id: string; title: string; display_title?: string; author?: string }[]>([]);
  const [bookName, setBookName] = useState(bookTitle);
  const [preview, setPreview] = useState<{ key: string; total: number } | null>(null);

  const key = JSON.stringify(d);
  const dirty = key !== JSON.stringify(applied);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // How many images the change would show.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      gallery.list({
        limit: 1, query: d.q || undefined, topic: d.topic || undefined, subject: d.subject || undefined, type: d.type || undefined,
        library: d.library || undefined, collection: d.collection || undefined, bookId: d.bookId || undefined,
        yearFrom: d.yearStart ? parseInt(d.yearStart, 10) : undefined, yearTo: d.yearEnd ? parseInt(d.yearEnd, 10) : undefined,
        minQuality: d.quality === 'exhibition' ? 0.9 : undefined, includeArchive: d.quality === 'archive' || undefined,
        source: d.source !== 'all' ? (d.source as 'illustration' | 'artwork') : undefined, sort: d.sort || undefined,
      }).then((r) => { if (typeof r.total === 'number') setPreview({ key, total: r.total }); }).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [dirty, d, key]);

  // Book finder: a title or author, picked from the list.
  useEffect(() => {
    const q = bookQuery.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      books.search(q, { limit: '8' }).then((r) => setBookHits(r.books.map((b) => ({ id: b.id, title: b.title, display_title: b.display_title, author: b.author })))).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [bookQuery]);

  const count = dirty && preview?.key === key ? preview.total : null;
  const topLevel = useMemo(() => bookCollections.filter((c) => !c.parent), [bookCollections]);
  const showHits = bookQuery.trim().length >= 2 && bookHits.length > 0;

  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(d); }} className="border-b border-border-light py-[22px]" autoComplete="off">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-[18px]">
        <div><label className={labelCls} htmlFor="g-q">Words <span className={hint}>in the picture’s description</span></label><input id="g-q" className={input} value={d.q} onChange={(e) => set({ q: e.target.value })} /></div>
        <div>
          <label className={labelCls} htmlFor="g-topic">Subject</label>
          <select id="g-topic" className={input} value={d.topic} onChange={(e) => set({ topic: e.target.value, subject: '' })}>
            <option value="">Any subject</option>
            {SUBJECT_CATEGORIES.map((cat) => (
              <optgroup key={cat.id} label={cat.label}>
                <option value={cat.id}>All {cat.label.toLowerCase()}</option>
                {cat.terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="g-type">Kind of image</label>
          <select id="g-type" className={input} value={d.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="">All kinds</option>
            {types.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>

        <div className="relative">
          <label className={labelCls} htmlFor="g-book">From one book</label>
          {d.bookId ? (
            <div className="flex items-center justify-between gap-2 h-10 border border-border-medium bg-warm px-3 text-sm">
              <span className="truncate">{bookName || 'Chosen book'}</span>
              <button type="button" onClick={() => { set({ bookId: '' }); setBookName(''); }} className="text-muted underline underline-offset-2 text-[12.5px] shrink-0">Change</button>
            </div>
          ) : (
            <input id="g-book" className={input} placeholder="Title or author" value={bookQuery} onChange={(e) => setBookQuery(e.target.value)} />
          )}
          {!d.bookId && showHits && (
            <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-border-medium shadow-lg max-h-64 overflow-y-auto">
              {bookHits.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => { set({ bookId: b.id }); setBookName(b.display_title || b.title); setBookQuery(''); setBookHits([]); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-warm">
                    <span className="text-primary">{b.display_title || b.title}</span>{b.author && <span className="text-muted"> · {b.author}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="g-collection">Collection</label>
          <select id="g-collection" className={input} value={d.collection} onChange={(e) => set({ collection: e.target.value })}>
            <option value="">Any collection</option>
            {topLevel.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="g-library">Library</label>
          <select id="g-library" className={input} value={d.library} onChange={(e) => set({ library: e.target.value })}>
            <option value="">All libraries</option>
            {Object.values(LIBRARY_PARTNERS).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.providerKey} value={p.providerKey}>{p.name}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2 lg:col-span-1">
          <span className={labelCls}>Printed</span>
          <div className="flex items-center gap-2">
            <input aria-label="Printed from" inputMode="numeric" placeholder="From" className={input} value={d.yearStart} onChange={(e) => set({ yearStart: e.target.value.replace(/[^\d-]/g, '') })} />
            <span className="text-muted">to</span>
            <input aria-label="Printed to" inputMode="numeric" placeholder="To" className={input} value={d.yearEnd} onChange={(e) => set({ yearEnd: e.target.value.replace(/[^\d-]/g, '') })} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {PRESETS.map(([l, a, b]) => <button key={l} type="button" className={pill(d.yearStart === a && d.yearEnd === b)} onClick={() => set({ yearStart: a, yearEnd: b })}>{l}</button>)}
          </div>
        </div>
        <div>
          <span className={labelCls}>Show</span>
          <div className="flex flex-wrap gap-1.5">
            {[['all', 'Everything'], ['illustration', 'Book plates'], ['artwork', 'Artworks']].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={d.source === v} className={pill(d.source === v)} onClick={() => set({ source: v })}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <span className={labelCls}>Image quality</span>
          <div className="flex flex-wrap gap-1.5">
            {([['gallery', 'Gallery quality'], ['exhibition', 'Best only'], ['archive', 'Show all']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={d.quality === v} className={pill(d.quality === v)} onClick={() => set({ quality: v })}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <ApplyFooter dirty={dirty} count={count} noun="images" onClear={() => { setD(EMPTY); setBookName(''); }} />
    </form>
  );
}
