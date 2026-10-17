'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Download, LayoutGrid, List, Search, X } from 'lucide-react';
import CollectionListView from '@/components/collections/CollectionListView';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import StatsBand, { type BandStats } from './StatsBand';
import AdvancedSearch, { type Draft } from './AdvancedSearch';
import AskWorkList from './AskWorkList';
import {
  PRINTED_BUCKETS, activeFilterCount, catalogFiltersOf, hasTextQuery, writeCatalogFilters, writeCatalogState,
  type CatalogSort, type CatalogState,
} from '@/lib/catalog/filters';
import { readRequest, type RequestVocabulary } from '@/lib/catalog/read-request';
import { synonymsFor } from '@/lib/catalog/synonyms';
import {
  askOtherNames, askSearch, catalogRows, guideTerms, resolveAuthor, warmSearch, yearOfHit, type AskWork,
} from '@/lib/catalog/ask-client';
import { READABLE_RUNGS, ENGLISH_ORIGINAL_READABLE_RUNGS, type TranslationRung } from '@/lib/page-counts';

/** A row from /api/catalog/results (CatalogBook as JSON). */
export interface CatalogRow {
  id: string;
  slug?: string | null;
  title: string;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  language?: string | null;
  published?: string | null;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_translated_es?: number;
  pages_blank?: number;
  pages_translatable?: number | null;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  image_card?: string | null;
  thumbnail_frame?: unknown;
  is_first_translation?: boolean;
  ft_disposition?: string;
  ft_verdict?: string | null;
  translation_rung?: string | null;
  english_original?: boolean;
  resource_type?: string | null;
  preview?: boolean;
  categories?: string[];
}

export interface ExplorerVocabulary extends RequestVocabulary {
  /** Languages offered as buttons in Advanced search, largest first. */
  pillLanguages: string[];
  collections: { value: string; label: string }[];
}

interface Props {
  initialState: CatalogState;
  initialBooks: CatalogRow[];
  initialTotal: number;
  initialStats: BandStats | null;
  libraryTotal: number;
  vocab: ExplorerVocabulary;
}

const PER_PAGE = 48;
const SORT_LABELS: [CatalogSort, string][] = [
  ['relevance', 'Most relevant'], ['popular', 'Most read'], ['year_asc', 'Oldest first'],
  ['year_desc', 'Newest first'], ['title', 'Title A–Z'], ['author', 'Author A–Z'],
];
const SEARCH_EXAMPLES = ['Paracelsus', 'Atalanta fugiens', 'Latin alchemy', 'Greek 1500s'];
const ASK_EXAMPLES = ['plague remedies before 1600', 'anything by Ficino that has been translated', 'German books on the philosophers’ stone'];
const CLEAR: Partial<CatalogState> = {
  q: undefined, also: undefined, title: undefined, author: undefined, not: undefined, languages: undefined,
  category: undefined, collection: undefined, yearMin: undefined, yearMax: undefined,
  hasTranslation: undefined, firstTranslation: undefined, ask: undefined, topic: undefined,
};

/* A catalogue row or a search hit, as the shared book card reads it. */
function rowToCard(b: CatalogRow): CollectionBook {
  return {
    ...b,
    bookId: b.id,
    slug: b.slug || undefined,
    author: b.author || 'Unknown',
    year: b.year || 0,
    pages_count: b.pages_count || 0,
    pages_translated: b.pages_translated || 0,
    pages_ocr: b.pages_ocr || 0,
    thumbnail: b.thumbnail || undefined,
    thumbnail_blob: b.thumbnail_blob || undefined,
    language: b.language || undefined,
    published: b.published || undefined,
    resource_type: b.resource_type || undefined,
  } as CollectionBook;
}
/* Band numbers counted over the works an asked search found (all of them). */
const readableRow = (r: CatalogRow) => !!r.translation_rung && (
  READABLE_RUNGS.includes(r.translation_rung as TranslationRung)
  || (!!r.english_original && ENGLISH_ORIGINAL_READABLE_RUNGS.includes(r.translation_rung as TranslationRung)));

function statsOfRows(rows: CatalogRow[]): BandStats {
  const langs = new Map<string, number>();
  const years: number[] = [];
  for (const r of rows) {
    if (r.language) langs.set(r.language, (langs.get(r.language) || 0) + 1);
    if (typeof r.year === 'number' && r.year !== 0) years.push(r.year);
  }
  return {
    total: rows.length,
    translated: rows.filter(readableRow).length,
    languageCount: langs.size,
    languages: [...langs].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    printed: PRINTED_BUCKETS.map(([from, to]) => ({ from, to, count: years.filter((y) => (from == null || y >= from) && (to == null || y <= to)).length })),
    yearFirst: years.length ? years.reduce((a, y) => (y < a ? y : a)) : null,
    yearLast: years.length ? years.reduce((a, y) => (y > a ? y : a)) : null,
  };
}

function sortWorks<W extends AskWork>(works: W[], sort: CatalogSort): W[] {
  const w = works.slice();
  const year = (x: W) => yearOfHit(x.hit);
  if (sort === 'year_asc') w.sort((a, b) => (year(a) ?? 9999) - (year(b) ?? 9999));
  else if (sort === 'year_desc') w.sort((a, b) => (year(b) ?? -9999) - (year(a) ?? -9999));
  else if (sort === 'title') w.sort((a, b) => (a.hit.display_title || a.hit.title).localeCompare(b.hit.display_title || b.hit.title));
  else if (sort === 'author') w.sort((a, b) => (a.hit.author || '').localeCompare(b.hit.author || ''));
  return w;
}

const idOf = (w: AskWork) => w.hit.book_id || w.hit.id;
/** An asked work with the catalogue's own record for it. */
type ListedWork = AskWork & { row: CatalogRow };
const filtersKey = (s: CatalogState) => writeCatalogFilters(catalogFiltersOf(s)).toString();

/**
 * The catalogue: the whole library, a search bar and an Ask-the-librarian bar
 * side by side, Advanced search under them, and one band of numbers that
 * describes whatever is in view. A typed search or an asked request is read
 * into the same filters Advanced search shows, so every reading is visible and
 * editable. State lives in the address bar (src/lib/catalog/filters.ts).
 */
export default function CatalogExplorer({ initialState, initialBooks, initialTotal, initialStats, libraryTotal, vocab }: Props) {
  const [s, setS] = useState<CatalogState>(initialState);
  const [books, setBooks] = useState<CatalogRow[]>(initialBooks);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [works, setWorks] = useState<ListedWork[] | null>(null);
  const [early, setEarly] = useState<CatalogRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [stats, setStats] = useState<BandStats | null>(initialStats);
  const [statsLoading, setStatsLoading] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [advDirty, setAdvDirty] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [authorName, setAuthorName] = useState('');
  const [searchText, setSearchText] = useState(initialState.topic ? '' : (initialState.q ?? ''));
  const [askText, setAskText] = useState(initialState.ask ?? '');
  const asking = useRef(0);
  const listCtl = useRef<AbortController | null>(null);
  // The catalogue's record for each asked work, by id; filled as works arrive.
  const rowsRef = useRef<Map<string, CatalogRow>>(new Map());
  const statsCtl = useRef<AbortController | null>(null);
  const statsKey = useRef(filtersKey(initialState));

  const searched = activeFilterCount(s) > 0 || hasTextQuery(s);

  /* ---------------------------------------------------------- loading */

  const loadStats = useCallback(async (next: CatalogState) => {
    const key = filtersKey(next);
    if (key === statsKey.current && stats) return;
    statsKey.current = key;
    statsCtl.current?.abort();
    const ctl = new AbortController();
    statsCtl.current = ctl;
    setStatsLoading(true);
    // One retry: the first count of a new filter set can time out on a cold
    // database. If both fail the band shows dashes — never the previous
    // search's numbers under the new one.
    let got: BandStats | null = null;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try {
        if (attempt) await new Promise((r) => setTimeout(r, 1200));
        const r = await fetch(`/api/catalog/stats?${key}`, { signal: ctl.signal });
        if (r.ok) got = await r.json();
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    if (statsCtl.current !== ctl) return;
    setStats(got);
    setStatsLoading(false);
  }, [stats]);

  const loadList = useCallback(async (next: CatalogState, pageNo: number) => {
    listCtl.current?.abort();
    const ctl = new AbortController();
    listCtl.current = ctl;
    setLoading(true);
    const sp = writeCatalogFilters(catalogFiltersOf(next));
    sp.set('sort', next.sort);
    sp.set('page', String(pageNo));
    sp.set('limit', String(PER_PAGE));
    try {
      const r = await fetch(`/api/catalog/results?${sp}`, { signal: ctl.signal });
      const j = await r.json();
      if (listCtl.current !== ctl) return;
      setBooks((prev) => (pageNo > 1 ? [...prev, ...(j.books || [])] : j.books || []));
      setTotal(j.total || 0);
      setPage(pageNo);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
    if (listCtl.current === ctl) setLoading(false);
  }, []);

  /** An asked topic: titles first, then the pages, then the other names. */
  const loadTopic = useCallback(async (next: CatalogState) => {
    const token = ++asking.current;
    const topic = next.topic ?? '';
    const f = catalogFiltersOf(next);
    setWorks(null);
    setEarly(null);
    setBusy(`Reading the pages of ${libraryTotal.toLocaleString('en-GB')} works for “${topic}”…`);
    // Titles and authors answer in half a second; show them while the pages are read.
    if (!f.author) {
      const sp = writeCatalogFilters({ ...f, q: topic, also: undefined });
      sp.set('limit', '24');
      fetch(`/api/catalog/results?${sp}`).then((r) => r.json()).then((j) => {
        if (asking.current === token && j.books?.length) setEarly(j.books);
      }).catch(() => {});
    }
    // Only works the catalogue lists (visible, not artworks), drawn from its own records.
    const listed = async (ws: AskWork[]): Promise<ListedWork[]> => {
      const need = ws.map(idOf).filter((id) => !rowsRef.current.has(id));
      if (need.length) for (const [id, row] of await catalogRows<CatalogRow>(need)) rowsRef.current.set(id, row);
      return ws.flatMap((w) => {
        const row = rowsRef.current.get(idOf(w));
        return row ? [{ ...w, row }] : [];
      });
    };
    const rowsOf = (ws: ListedWork[]) => ws.map((w) => w.row);
    let found: ListedWork[] = [];
    try {
      found = await listed(await askSearch(f, topic));
    } catch {
      if (asking.current === token) { setBusy(''); setWorks([]); }
      return;
    }
    if (asking.current !== token) return;
    setWorks(found);
    setStats(statsOfRows(rowsOf(found)));
    const names = next.also ?? [];
    if (!names.length) { setBusy(''); return; }
    setBusy(`Adding books under ${names.length > 3 ? `“${names[0]}”, “${names[1]}” and ${names.length - 2} other names` : names.map((n) => `“${n}”`).join(', ')}…`);
    const merged = await listed(await askOtherNames(f, topic, names, found));
    if (asking.current !== token) return;
    setWorks(merged);
    setStats(statsOfRows(rowsOf(merged)));
    setBusy('');
  }, [libraryTotal]);

  /** Apply a new state: address bar, list, numbers. */
  const run = useCallback((next: CatalogState) => {
    setS(next);
    window.history.replaceState(null, '', `${window.location.pathname}${writeCatalogState(next).toString() ? `?${writeCatalogState(next)}` : ''}`);
    if (next.topic) {
      listCtl.current?.abort();
      loadTopic(next);
    } else {
      asking.current++;
      setBusy('');
      setWorks(null);
      setEarly(null);
      loadList(next, 1);
      loadStats(next);
    }
  }, [loadList, loadStats, loadTopic]);

  // An asked URL (shared or reloaded) is answered in the browser.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Started after the effect returns, not inside it.
    if (initialState.topic) Promise.resolve().then(() => loadTopic(initialState));
    if (initialState.ask) guideTerms(initialState.ask).then(setSuggestions);
  }, [initialState, loadTopic]);

  /* ---------------------------------------------------------- the bars */

  const search = async (text: string) => {
    const r = readRequest(text, vocab, { stems: false });
    const who = r.authorQuery ? await resolveAuthor(r.authorQuery) : null;
    const topic = who || !r.authorQuery ? r.topic : `${r.authorQuery} ${r.topic}`.trim();
    const also = synonymsFor(topic);
    setAuthorName(who?.name ?? '');
    setAskText('');
    setSuggestions([]);
    const next: CatalogState = {
      ...s, ...CLEAR, view: 'grid',
      q: topic || undefined, also: also.length ? also : undefined, author: who?.surname,
      languages: r.languages.length ? r.languages : undefined, category: r.category,
      yearMin: r.yearMin, yearMax: r.yearMax, hasTranslation: r.hasTranslation, firstTranslation: r.firstTranslation,
      sort: 'popular',
    };
    next.sort = hasTextQuery(next) ? 'relevance' : 'popular';
    run(next);
  };

  const ask = async (text: string) => {
    if (!text.trim()) return;
    const r = readRequest(text, vocab);
    const who = r.authorQuery ? await resolveAuthor(r.authorQuery) : null;
    const topic = who || !r.authorQuery ? r.topic : `${r.authorQuery} ${r.topic}`.trim().toLowerCase();
    const also = synonymsFor(topic);
    setAuthorName(who?.name ?? '');
    setSearchText('');
    setSuggestions([]);
    const next: CatalogState = {
      ...s, ...CLEAR, view: 'grid', ask: text.trim(),
      topic: topic || undefined, also: topic && also.length ? also : undefined, author: who?.surname,
      languages: r.languages.length ? r.languages : undefined, category: r.category,
      yearMin: r.yearMin, yearMax: r.yearMax, hasTranslation: r.hasTranslation, firstTranslation: r.firstTranslation,
      sort: 'popular',
    };
    next.sort = hasTextQuery(next) ? 'relevance' : 'popular';
    run(next);
    guideTerms(text).then((terms) => setSuggestions(terms));
  };

  // While a request is typed, its full-text search starts after a short pause,
  // so asking often finds the answer already on its way.
  useEffect(() => {
    const words = askText.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return;
    const t = setTimeout(() => {
      const r = readRequest(askText, vocab);
      if (r.topic && !r.authorQuery) warmSearch({ languages: r.languages, yearMin: r.yearMin, yearMax: r.yearMax, category: r.category, hasTranslation: r.hasTranslation, firstTranslation: r.firstTranslation }, r.topic);
    }, 600);
    return () => clearTimeout(t);
  }, [askText, vocab]);
  const warmExample = (text: string) => {
    const r = readRequest(text, vocab);
    if (r.topic && !r.authorQuery) warmSearch({ languages: r.languages, yearMin: r.yearMin, yearMax: r.yearMax, category: r.category, hasTranslation: r.hasTranslation }, r.topic);
  };

  /* ---------------------------------------------------------- derived */

  const also = s.also ?? [];
  const suggestionList = suggestions.filter((t) => !also.includes(t));
  const chips: { key: string; label: string; other?: boolean; remove: () => CatalogState }[] = [];
  if (s.q) chips.push({ key: 'q', label: `“${s.q}”`, remove: () => ({ ...s, q: undefined, also: undefined }) });
  if (s.topic) chips.push({ key: 'topic', label: `About: ${s.topic}`, remove: () => ({ ...s, topic: undefined, also: undefined }) });
  if (also.length > 2) chips.push({ key: 'also', other: true, label: `${also[0]}, ${also[1]} +${also.length - 2} more`, remove: () => ({ ...s, also: undefined }) });
  else for (const a of also) chips.push({ key: `also:${a}`, other: true, label: a, remove: () => ({ ...s, also: also.filter((x) => x !== a) }) });
  if (s.title) chips.push({ key: 'title', label: `Title: ${s.title}`, remove: () => ({ ...s, title: undefined }) });
  if (s.author) chips.push({ key: 'author', label: `Author: ${authorName || s.author}`, remove: () => ({ ...s, author: undefined }) });
  if (s.not) chips.push({ key: 'not', label: `Leaving out: ${s.not}`, remove: () => ({ ...s, not: undefined }) });
  for (const l of s.languages ?? []) chips.push({ key: `lang:${l}`, label: l, remove: () => ({ ...s, languages: (s.languages ?? []).filter((x) => x !== l) }) });
  if (s.yearMin != null || s.yearMax != null) {
    const yrs = s.yearMin != null && s.yearMax != null ? `${s.yearMin}–${s.yearMax}` : s.yearMin != null ? `from ${s.yearMin}` : `until ${s.yearMax}`;
    chips.push({ key: 'years', label: `Printed ${yrs}`, remove: () => ({ ...s, yearMin: undefined, yearMax: undefined }) });
  }
  if (s.category) chips.push({ key: 'cat', label: vocab.categories.find((c) => c.value === s.category)?.label ?? s.category, remove: () => ({ ...s, category: undefined }) });
  if (s.collection) chips.push({ key: 'col', label: vocab.collections.find((c) => c.value === s.collection)?.label ?? s.collection, remove: () => ({ ...s, collection: undefined }) });
  if (s.hasTranslation) chips.push({ key: 'tr', label: 'Translated', remove: () => ({ ...s, hasTranslation: undefined }) });
  if (s.firstTranslation) chips.push({ key: 'ft', label: 'First translations', remove: () => ({ ...s, firstTranslation: undefined }) });
  const chipCount = chips.length;

  const withText = hasTextQuery(s);
  const sortOptions = SORT_LABELS.filter(([v]) => v !== 'relevance' || withText);
  const shownWorks = useMemo(() => (works ? sortWorks(works, s.sort) : null), [works, s.sort]);
  const workCards = useMemo(() => (shownWorks ? shownWorks.map((w) => rowToCard(w.row)) : []), [shownWorks]);
  const bookCards = useMemo(() => books.map(rowToCard), [books]);
  const earlyCards = useMemo(() => (early ? early.map(rowToCard) : []), [early]);
  const topicMode = !!s.topic;
  const showSkeleton = topicMode && !shownWorks && !earlyCards.length;
  const showEarly = topicMode && !shownWorks && earlyCards.length > 0;
  const earlyLabel = `${earlyCards.length === 1 ? 'One title matches' : `${earlyCards.length} titles match`} so far`;
  const moreLeft = !topicMode && books.length < total;
  const printed = stats?.printed ?? [];
  const advKey = filtersKey(s) + (s.topic ?? '');
  const applied: Draft = { ...catalogFiltersOf(s), topic: s.topic };
  const csvHref = `/api/catalog/csv${s.languages?.length === 1 ? `?language=${encodeURIComponent(s.languages[0])}` : ''}`;

  const yearsFromBand = (from: number | null, to: number | null) => {
    const same = s.yearMin === (from ?? undefined) && s.yearMax === (to ?? undefined);
    run({ ...s, yearMin: same ? undefined : from ?? undefined, yearMax: same ? undefined : to ?? undefined });
  };
  const languageFromBand = (l: string) => {
    const cur = s.languages ?? [];
    const nextLangs = cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l];
    run({ ...s, languages: nextLangs.length ? nextLangs : undefined });
  };
  const applyDraft = (d: Draft) => {
    const next: CatalogState = { ...s, ...d, also: d.also, topic: d.topic, ask: d.topic ? s.ask : undefined };
    if (d.author !== s.author) setAuthorName('');
    if (hasTextQuery(next) && !hasTextQuery(s)) next.sort = 'relevance';
    if (!hasTextQuery(next) && next.sort === 'relevance') next.sort = 'popular';
    setAdvOpen(false);
    run(next);
  };
  const addSuggestion = (t: string) => {
    if (s.topic) run({ ...s, also: [...also, t] });
    else run({ ...s, topic: t, sort: 'relevance' });
  };
  const clearAll = () => {
    setSearchText(''); setAskText(''); setSuggestions([]); setAuthorName('');
    run({ ...s, ...CLEAR, sort: 'popular', view: 'grid' });
  };

  const fieldClass = 'flex items-stretch h-[52px] border border-border-medium bg-white focus-within:border-primary';
  const exampleClass = 'px-1 py-0.5 text-[12.5px] text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary';

  return (
    <div>
      {/* The two ways in */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[22px] md:gap-7">
        <form onSubmit={(e) => { e.preventDefault(); search(searchText); }} role="search" aria-label="Search the catalogue">
          <label htmlFor="catalog-search" className="block text-[13.5px] font-semibold text-primary mb-2">Search the catalogue</label>
          <div className={fieldClass}>
            <Search className="w-[17px] h-[17px] self-center ml-4 text-muted shrink-0" aria-hidden />
            <input id="catalog-search" type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              placeholder="Title, author, subject or date"
              className="flex-1 min-w-0 px-3 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
            <button type="submit" className="px-5 bg-primary text-cream text-sm shrink-0">Search</button>
          </div>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-2 text-[12.5px]">
            <span className="text-muted mr-0.5">Try</span>
            {SEARCH_EXAMPLES.map((e) => (
              <button key={e} type="button" className={exampleClass} onClick={() => { setSearchText(e); search(e); }}>{e}</button>
            ))}
          </div>
        </form>

        <form onSubmit={(e) => { e.preventDefault(); ask(askText); }} aria-label="Ask the librarian">
          <label htmlFor="catalog-ask" className="block text-[13.5px] font-semibold text-primary mb-2">Ask the librarian</label>
          <div className={fieldClass}>
            <input id="catalog-ask" type="text" value={askText} onChange={(e) => setAskText(e.target.value)}
              placeholder="Describe what you are looking for"
              className="flex-1 min-w-0 px-4 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
            <button type="submit" aria-busy={!!busy} className="relative px-5 bg-primary text-cream text-sm shrink-0">
              <span className={busy ? 'invisible' : ''}>Ask</span>
              {busy && <span aria-hidden className="absolute left-1/2 top-1/2 -ml-2 -mt-2 w-4 h-4 rounded-full border-2 border-cream/30 border-t-cream animate-spin" />}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-2 text-[12.5px]">
            {suggestionList.length > 0 ? (
              <>
                <span className="text-muted mr-0.5">{s.topic ? 'Add to search' : 'Also try'}</span>
                {suggestionList.map((t) => (
                  <button key={t} type="button" className={exampleClass} onClick={() => addSuggestion(t)}>{s.topic ? `+ ${t}` : t}</button>
                ))}
              </>
            ) : (
              <>
                <span className="text-muted mr-0.5">Try</span>
                {ASK_EXAMPLES.map((e) => (
                  <button key={e} type="button" className={exampleClass} onPointerEnter={() => warmExample(e)} onFocus={() => warmExample(e)} onClick={() => { setAskText(e); ask(e); }}>{e}</button>
                ))}
              </>
            )}
          </div>
        </form>
      </div>

      <StatsBand
        stats={stats}
        libraryTotal={libraryTotal}
        searched={searched}
        loading={statsLoading || !!busy}
        stale={advDirty}
        selectedLanguages={s.languages ?? []}
        yearMin={s.yearMin}
        yearMax={s.yearMax}
        hasTranslation={!!s.hasTranslation}
        onYears={yearsFromBand}
        onLanguage={languageFromBand}
        onTranslated={() => run({ ...s, hasTranslation: s.hasTranslation ? undefined : true })}
      />

      {busy && (
        <div role="status" className="flex items-center gap-3 mt-[18px] text-[13.5px] text-secondary">
          <span className="relative w-[140px] h-[3px] bg-warm overflow-hidden shrink-0" aria-hidden>
            <i className="absolute inset-y-0 w-2/5 bg-primary animate-[catalog-slide_1.1s_ease-in-out_infinite] motion-reduce:animate-none" />
          </span>
          <span>{busy}</span>
        </div>
      )}

      {/* Advanced search, what is applied, and how it is shown */}
      <div className="flex flex-wrap items-center gap-2.5 mt-[22px] pb-3.5 border-b border-border-light">
        <button type="button" onClick={() => setAdvOpen((o) => !o)} aria-expanded={advOpen}
          className={`inline-flex items-center gap-2 h-[38px] px-3.5 border text-sm ${advOpen ? 'bg-primary text-cream border-primary' : 'bg-white text-primary border-border-medium'}`}>
          Advanced search
          {chipCount > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent-rust text-white text-xs grid place-items-center">{chipCount}</span>}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {chips.map((c) => (
          <span key={c.key} className={`inline-flex items-center gap-1.5 h-[30px] pl-3 pr-1.5 border text-[13.5px] whitespace-nowrap ${c.other ? 'bg-warm border-dashed border-border-medium' : 'bg-white border-border-medium'}`}>
            {c.other && <span className="text-muted">also</span>}
            {c.label}
            <button type="button" onClick={() => run(c.remove())} aria-label={`Remove ${c.label}`} className="w-5 h-5 rounded-full grid place-items-center text-muted hover:bg-warm hover:text-primary">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        {chipCount > 1 && <button type="button" onClick={clearAll} className="text-[13.5px] text-muted underline underline-offset-[3px]">Clear all</button>}
        <div className="flex items-center gap-2.5 w-full sm:w-auto sm:ml-auto">
          <a href={csvHref} className="hidden md:inline-flex items-center gap-1 text-xs text-muted hover:text-primary" title="Download the catalogue as CSV">
            <Download className="w-3.5 h-3.5" aria-hidden /> CSV
          </a>
          <Link href="/catalog/scholar" className="hidden md:inline text-xs text-muted hover:text-primary mr-1" title="Minimal bibliographic view for researchers">Scholar view</Link>
          <select value={s.sort} onChange={(e) => run({ ...s, sort: e.target.value as CatalogSort })} aria-label="Sort"
            className="h-[38px] flex-1 sm:flex-none border border-border-medium bg-white px-3 text-base sm:text-sm text-primary">
            {sortOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="flex border border-border-medium" role="group" aria-label="View">
            <button type="button" aria-pressed={s.view === 'grid'} aria-label="Grid" onClick={() => run({ ...s, view: 'grid' })}
              className={`w-[38px] h-9 grid place-items-center ${s.view === 'grid' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><LayoutGrid className="w-4 h-4" /></button>
            <button type="button" aria-pressed={s.view === 'list'} aria-label="List" onClick={() => run({ ...s, view: 'list' })}
              className={`w-[38px] h-9 grid place-items-center ${s.view === 'list' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {advOpen && (
        <AdvancedSearch
          key={advKey}
          applied={applied}
          languages={vocab.pillLanguages}
          categories={vocab.categories}
          collections={vocab.collections}
          printed={printed}
          onApply={applyDraft}
          onDirty={setAdvDirty}
        />
      )}

      {/* Results */}
      <div className={`mt-6 transition-opacity ${advDirty || (loading && !topicMode) ? 'opacity-35' : ''}`}>
        {showSkeleton && <Skeleton />}
        {showEarly && (
          <>
            <p className="text-[13px] text-muted mb-3">{earlyLabel}</p>
            <BookGrid books={earlyCards} />
          </>
        )}
        {topicMode && shownWorks && (
          shownWorks.length === 0 ? <Empty /> :
            s.view === 'list' ? <AskWorkList works={shownWorks} topic={s.topic ?? ''} /> : <BookGrid books={workCards} />
        )}
        {!topicMode && (
          bookCards.length === 0 && !loading ? <Empty /> :
            s.view === 'list'
              ? <CollectionListView books={bookCards as never} sort={s.sort === 'relevance' ? 'popular' : s.sort} onSort={(v: string) => run({ ...s, sort: v as CatalogSort })} loading={loading} />
              : <BookGrid books={bookCards} />
        )}
      </div>
      {moreLeft && (
        <button type="button" onClick={() => loadList(s, page + 1)} disabled={loading}
          className="block mx-auto mt-9 mb-20 h-10 px-4 border border-border-medium bg-white text-sm text-primary hover:border-primary">
          Show more
        </button>
      )}
    </div>
  );
}

function Empty() {
  return <div className="py-16 text-center text-muted text-base">Nothing matches all of that. Remove one of the filters above.</div>;
}

/** The site's standard book grid and card, as on every other surface. */
function BookGrid({ books }: { books: CollectionBook[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
      {books.map((book, i) => (
        <CollectionBookCard key={`${book.bookId || book.id || book.slug}:${i}`} book={book} priority={i < 6} />
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="border border-border-light bg-white">
          <div className="aspect-[3/4] bg-gradient-to-r from-border-light via-warm to-border-light bg-[length:200%_100%] animate-shimmer" />
          <div className="p-3">
            <div className="h-[11px] bg-warm" />
            <div className="h-[11px] mt-1.5 w-3/5 bg-warm" />
          </div>
        </div>
      ))}
    </div>
  );
}
