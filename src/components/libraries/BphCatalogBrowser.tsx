'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { bookCoverResponsiveLoader } from '@/lib/book-cover-loader';
import { useDebouncedCallback } from 'use-debounce';
import { Search, X, ChevronLeft, ChevronRight, BookMarked, SlidersHorizontal, Download } from 'lucide-react';
import { useEmbed } from '@/lib/EmbedContext';
import PlaceholderCover from '@/components/book/PlaceholderCover';
// Book URL helper moved inline to use basePath

interface BphWork {
  ubn: string | null;
  /** Manuscripts and photographs get no UBN from Memorix (2,012 rows). `uuid`
      is the only key they carry, and detailUrl() falls back to it. */
  uuid?: string | null;
  /** Manuscript records keep their title here; `title` is null on all of them. */
  full_title?: string | null;
  title: string | null;
  parallel_title: string | null;
  uniform_title: string | null;
  author: string | null;
  variant_author: string | null;
  pseudonym: string | null;
  editor: string | null;
  variant_editor: string | null;
  place: string | null;
  printer: string | null;
  publisher: string | null;
  variant_printer: string | null;
  variant_publisher: string | null;
  year: number | null;
  shelf_mark: string | null;
  state_shelf_mark: string | null;
  present_location: string | null;
  keywords: string | null;
  language: string | null;
  series_title: string | null;
  volume_title: string | null;
  bibliography: string | null;
  remarks: string | null;
  number_of_copies: number | null;
  object_size_cm: string | null;
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  thumbnail: string | null;
  file_count: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  /** Cross-provider link: BPH holds this work physically, but the scan
      lives at another archive (IA, CMC Kloss, MDZ, Gallica, e-rara, etc.)
      and is readable through Source Library. Kept separate from sl_book_id
      so "BPH digitised" counters don't conflate the two. */
  sl_external_book_id?: string | null;
  sl_external_slug?: string | null;
  sl_external_source?: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
  /** Source Library cover URL, attached server-side by /api/catalog/bph
      when the row is linked to a digitised SL book. Powers the grid view. */
  sl_cover?: string | null;
}

/** Human-readable label for an external scan source. Defaults to a Title-Cased
    fallback when we don't have a curated label for a provider yet. */
/** Library-card-style impressum: "Place: Printer, Year". Picks publisher if no
    printer; collapses gracefully when fields are null. Matches the order Paul
    asked for in issue #1921 (author, title, impressum on the short card). */
function formatImpressum(w: { place?: string | null; printer?: string | null; publisher?: string | null; year?: number | null }): string {
  const place = w.place?.trim();
  const agent = w.printer?.trim() || w.publisher?.trim();
  const year = w.year ? String(w.year) : '';
  const placeAgent = [place, agent].filter(Boolean).join(': ');
  return [placeAgent, year].filter(Boolean).join(', ');
}

function externalSourceLabel(source: string | null | undefined): string {
  if (!source) return 'another archive';
  const map: Record<string, string> = {
    internet_archive: 'Internet Archive',
    cmc_kloss: 'CMC (Kloss collection)',
    mdz: 'MDZ',
    gallica: 'Gallica',
    'e-rara': 'e-rara',
    google_books: 'Google Books',
    allard_pierson: 'Allard Pierson',
    bodleian: 'Bodleian',
    vatican: 'Vatican',
    cambridge: 'Cambridge',
    laurenziana: 'Laurenziana',
  };
  if (map[source]) return map[source];
  return source.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface AdvancedFilters {
  author: string;
  title: string;
  editor: string;
  place: string;
  printer: string;
  publisher: string;
  shelf_mark: string;
  language: string;
  yearFrom: string;
  yearTo: string;
  digitized: '' | 'true' | 'sl' | 'false' | 'held';
  /** First English translation on Source Library. Implicitly digitised
      (joins to Atlas `books.is_first_translation` via sl_book_id). */
  firstTranslation: boolean;
}

const EMPTY_ADV: AdvancedFilters = {
  author: '', title: '', editor: '', place: '', printer: '', publisher: '',
  shelf_mark: '', language: '', yearFrom: '', yearTo: '', digitized: '',
  firstTranslation: false,
};

/** A filter is "applied" when its value is non-empty (or true for the
    boolean flags). Helper so all the `Object.entries(adv)…` call sites
    agree on the shape and don't trip over `false !== ''`. */
function isAdvFilterApplied(key: string, value: string | boolean, lockDigitized: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return value !== '' && !(lockDigitized && key === 'digitized');
}

const PER_PAGE = 60;

/** Per-column sort cycling — first click sorts ascending, second click sorts
    descending. Shelfmark only supports ascending (codes don't read meaningfully
    in reverse). Used by the clickable column headers in the list view. */
type SortColumn = 'author' | 'title' | 'year' | 'shelfmark';

function nextSort(column: SortColumn, current: string): string {
  if (column === 'shelfmark') return 'shelfmark';
  if (column === 'year') return current === 'year_asc' ? 'year_desc' : 'year_asc';
  const asc = column;
  const desc = `${column}_desc`;
  return current === asc ? desc : asc;
}

function arrowFor(column: SortColumn, current: string): 'asc' | 'desc' | null {
  if (column === 'shelfmark') return current === 'shelfmark' ? 'asc' : null;
  if (column === 'year') {
    if (current === 'year_asc') return 'asc';
    if (current === 'year_desc') return 'desc';
    return null;
  }
  if (current === column) return 'asc';
  if (current === `${column}_desc`) return 'desc';
  return null;
}

function SortArrow({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === null) return <span aria-hidden className="ml-1 text-muted/40">↕</span>;
  return <span aria-hidden className="ml-1 text-accent-rust">{direction === 'asc' ? '↑' : '↓'}</span>;
}

const KEYWORD_OPTIONS = [
  { value: '', label: 'All subjects' },
  { value: 'hermetica', label: 'Hermetica' },
  { value: 'alchemy', label: 'Alchemy' },
  { value: 'mysticism', label: 'Mysticism' },
  { value: 'esotericism', label: 'Esotericism' },
  { value: 'rosicrucianism', label: 'Rosicrucianism' },
  { value: 'Kabbalah', label: 'Kabbalah' },
  { value: 'freemasonry', label: 'Freemasonry' },
  { value: 'theosophy', label: 'Theosophy' },
  { value: 'anthroposophy', label: 'Anthroposophy' },
  { value: 'gnosis', label: 'Gnosis' },
  { value: 'magic', label: 'Magic' },
  { value: 'astrology', label: 'Astrology' },
  { value: 'Sufism', label: 'Sufism' },
  { value: 'Buddhism', label: 'Buddhism' },
  { value: 'Judaica', label: 'Judaica' },
  { value: 'grail', label: 'Grail' },
  { value: 'catharism', label: 'Catharism' },
  { value: 'tarot', label: 'Tarot' },
  { value: 'reference', label: 'Reference' },
  { value: 'history of religion', label: 'History of Religion' },
];

interface Props {
  basePath: string;
  /** Map of UBN → { id, slug } for BPH books that exist on Source Library (overrides sl_book_id from row) */
  digitizedUbns: Record<string, { id: string; slug: string }>;
  /** Optional tenant slug to include in book URLs */
  tenantSlug?: string;
  /** When true, defaults to advanced search expanded */
  defaultAdvanced?: boolean;
  /** Fires whenever the filtered result count updates so a parent shell
      (the unified catalogue header) can show "X of 27,706 works".
      `isFiltered` is true when the user has typed a search or applied an
      advanced filter (not counting parent-locked filters like `lockDigitized`),
      letting the parent decide whether to show the baseline count or the
      live filtered count. */
  onTotalChange?: (total: number, isFiltered: boolean) => void;
  /** When true, hide the inline "{total} works" label on the simple-search
      row — the parent shell shows the count instead. */
  hideInlineCount?: boolean;
  /** Optional content rendered inline in the search row (between the
      Subjects dropdown and the Advanced button). The unified catalogue
      uses this to drop in the "Show all / Show digitised & translated"
      segmented toggle so it sits alongside the other filter chips. */
  searchRowSlot?: React.ReactNode;
  /** Optional content rendered in a results-header row above the table,
      next to the sort dropdown. The unified catalogue uses this for the
      list/grid view icons. When provided, the sort dropdown moves out of
      the search row and into this header row to match the partner mockup. */
  resultsHeaderSlot?: React.ReactNode;
  /** When set, the results-header row count reads "{total} of {catalogTotal}
      works" instead of just "{total} works" — matches the partner mockup
      framing where the catalogue size is the denominator. */
  catalogTotal?: number;
  /** When true, lock the digitised filter to "On Source Library" — the user
      asked for the digitised+translated filter, so all rows must be SL-backed.
      Hides the digitisation control in Advanced so the user can't override it. */
  lockDigitized?: boolean;
  /** "list" (default) renders the table + pagination. "grid" renders a covers
      grid using the same Supabase data so search + Advanced filter the covers
      live. The chrome above stays identical so the look at the top doesn't
      shift between views. */
  display?: 'list' | 'grid';
}

// Strip diacritics so matching is accent-insensitive ("bohme" → "Böhme",
// "cafe" → "café"). Decompose to NFD and drop the combining marks.
function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Wrap occurrences of the active search query inside a piece of result text
// with <mark> so the matched term is highlighted wherever it shows (title,
// author, place, …). Case- and diacritic-insensitive, multi-token (each
// whitespace-separated token of length >= 2). Matching runs on a folded copy
// of the text but the ORIGINAL (accented) characters are what get rendered —
// we keep a folded-index → original-index map to slice the real string back
// out. Returns the original text untouched when there's no query or no match.
function highlightQuery(text: string | number | null | undefined, query: string): React.ReactNode {
  if (text == null || text === '') return text;
  const str = String(text);

  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .map(t => foldDiacritics(t).toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return str;

  // Per-character fold keeps each original code point aligned to its folded
  // form, so a match in the folded string maps cleanly back to original chars.
  const chars = Array.from(str);
  let folded = '';
  const map: number[] = []; // folded char position → index into `chars`
  for (let i = 0; i < chars.length; i++) {
    for (const fc of foldDiacritics(chars[i]).toLowerCase()) {
      folded += fc;
      map.push(i);
    }
  }

  // Collect match ranges (in original-char indices) for every token.
  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    let from = 0;
    let idx = folded.indexOf(tok, from);
    while (idx !== -1) {
      ranges.push([map[idx], map[idx + tok.length - 1] + 1]);
      from = idx + tok.length;
      idx = folded.indexOf(tok, from);
    }
  }
  if (ranges.length === 0) return str;

  // Sort + merge overlapping/adjacent ranges.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const nodes: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach(([s, e], i) => {
    if (s > pos) nodes.push(chars.slice(pos, s).join(''));
    nodes.push(<mark key={i} className="sl-search-hl">{chars.slice(s, e).join('')}</mark>);
    pos = e;
  });
  if (pos < chars.length) nodes.push(chars.slice(pos).join(''));
  return nodes;
}

export default function BphCatalogBrowser({
  basePath,
  digitizedUbns,
  tenantSlug,
  defaultAdvanced = false,
  onTotalChange,
  hideInlineCount = false,
  searchRowSlot,
  resultsHeaderSlot,
  catalogTotal,
  lockDigitized = false,
  display = 'list',
}: Props) {
  // Build book URLs using basePath to preserve embed namespace
  const bookUrl = (book: { id: string; slug?: string }) =>
    `${basePath}/book/${encodeURIComponent(book.slug || book.id)}`;

  const searchParams = useSearchParams();
  // Generated placeholder covers are an embedded-reading-room feature only —
  // the main sourcelibrary.org catalogue keeps its plain icon fallback.
  const embed = useEmbed();

  const initialQ = searchParams.get('cq') || '';
  const initialSort = searchParams.get('csort') || 'author';
  const initialKeyword = searchParams.get('ckeyword') || '';
  const initialOffset = parseInt(searchParams.get('coffset') || '0') || 0;
  const initialAdv: AdvancedFilters = {
    author: searchParams.get('cauthor') || '',
    title: searchParams.get('ctitle') || '',
    editor: searchParams.get('ceditor') || '',
    place: searchParams.get('cplace') || '',
    printer: searchParams.get('cprinter') || '',
    publisher: searchParams.get('cpublisher') || '',
    shelf_mark: searchParams.get('cshelf') || '',
    language: searchParams.get('clang') || '',
    yearFrom: searchParams.get('cyfrom') || '',
    yearTo: searchParams.get('cyto') || '',
    digitized: lockDigitized ? 'sl' : ((searchParams.get('cdig') || '') as AdvancedFilters['digitized']),
    firstTranslation: searchParams.get('cft') === '1',
  };
  // "Has a user-applied advanced filter?" — drives whether the Advanced
  // panel is open on mount. Exclude the digitised filter when it's forced
  // by `lockDigitized` (the parent's "Show digitised & translated" toggle)
  // so the panel doesn't auto-open just because the user picked a top-level
  // view. Same exclusion rule as `advCount` below.
  const hasAnyAdv = Object.entries(initialAdv).some(
    ([k, v]) => isAdvFilterApplied(k, v as string | boolean, lockDigitized)
  );
  // The unified catalogue's grid view links here with `?cadv=1` so the
  // Advanced panel auto-opens on arrival — partner-requested affordance so
  // covers-grid users can reach the rich filter UI without first finding
  // the list/grid icon (issue #1687).
  const cadvParam = searchParams.get('cadv') === '1';

  const [works, setWorks] = useState<BphWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [sort, setSort] = useState(initialSort);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [offset, setOffset] = useState(initialOffset);
  const [adv, setAdv] = useState<AdvancedFilters>(initialAdv);
  const [showAdvanced, setShowAdvanced] = useState(defaultAdvanced || hasAnyAdv || cadvParam);
  const abortRef = useRef<AbortController | null>(null);

  const buildParams = useCallback((q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    const params = new URLSearchParams();
    params.set('limit', String(PER_PAGE));
    if (q) params.set('q', q);
    if (s) params.set('sort', s);
    if (kw) params.set('keyword', kw);
    if (off) params.set('offset', String(off));
    if (a.author) params.set('author', a.author);
    if (a.title) params.set('title', a.title);
    if (a.editor) params.set('editor', a.editor);
    if (a.place) params.set('place', a.place);
    if (a.printer) params.set('printer', a.printer);
    if (a.publisher) params.set('publisher', a.publisher);
    if (a.shelf_mark) params.set('shelf_mark', a.shelf_mark);
    if (a.language) params.set('language', a.language);
    if (a.yearFrom) params.set('yearFrom', a.yearFrom);
    if (a.yearTo) params.set('yearTo', a.yearTo);
    if (a.digitized) params.set('digitized', a.digitized);
    if (a.firstTranslation) params.set('first_translation', '1');
    return params;
  }, []);

  /**
   * The current selection as a spreadsheet. Same query string the results came
   * from, minus paging — the export is the whole selection, not the page on
   * screen. Asked for by José Bouman (BPH), 2026-08-12: "Is it possible to
   * export a search selection? […] This is an important feature, that we
   * often! use!"
   */
  const exportHref = useMemo(() => {
    const params = buildParams(searchQuery, sort, keyword, 0, adv);
    params.delete('limit');
    params.delete('offset');
    const qs = params.toString();
    return `/api/catalog/bph/export${qs ? `?${qs}` : ''}`;
  }, [buildParams, searchQuery, sort, keyword, adv]);

  const fetchWorks = useCallback(async (q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    // Cancel any in-flight request so fast typing doesn't show stale results
    // when an earlier query resolves after a later one.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // A filter is "user-applied" if it's a real search, the keyword chip, or
    // any advanced field set — but NOT the digitised filter when it was
    // forced by the parent's lockDigitized toggle. Used by the parent shell
    // to decide whether to show the baseline count or the filtered count
    // (e.g. the BPH digitised baseline lives upstream in MongoDB, not in the
    // Supabase query result this component sees).
    const isFiltered = !!q || !!kw || Object.entries(a).some(
      ([k, v]) => isAdvFilterApplied(k, v as string | boolean, lockDigitized)
    );

    setLoading(true);
    try {
      const params = buildParams(q, s, kw, off, a);
      const res = await fetch(`/api/catalog/bph?${params}`, { signal: controller.signal });
      const data = await res.json();
      // Drop the result if a newer fetch superseded us. `AbortController.abort()`
      // only rejects the fetch promise itself; if our `await fetch()` already
      // resolved before the next call fired abort, `res.json()` keeps streaming
      // the body and we'd `setWorks` with a stale page after the latest result
      // already landed. Source of the "3 of 29,876 — but 5 rows shown" first-
      // paint race when the user types fast enough to fire several debounced
      // searches in a row.
      if (abortRef.current !== controller) return;
      setWorks(data.works || []);
      setTotal(data.total || 0);
      onTotalChange?.(data.total || 0, isFiltered);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // superseded by a newer query
      if (abortRef.current !== controller) return;
      setWorks([]);
      setTotal(0);
      onTotalChange?.(0, isFiltered);
    } finally {
      if (abortRef.current === controller && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [buildParams, onTotalChange, lockDigitized]);

  // Sync URL params (using c-prefixed keys so they don't collide with parent page params).
  // Uses window.history.replaceState rather than router.replace + basePath so the
  // visible URL bar is preserved. On the BPH subdomain the user-visible path is
  // /catalog, which the proxy rewrites internally to /embed/bph?view=catalog —
  // calling router.replace(`${basePath}?…`) would shove the URL bar over to
  // /embed/bph?… and look like a full-page navigation.
  const updateUrl = useCallback((q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const setOrDel = (key: string, val: string) => {
      if (val) params.set(key, val);
      else params.delete(key);
    };
    setOrDel('cq', q);
    setOrDel('csort', s !== 'author' ? s : '');
    setOrDel('ckeyword', kw);
    setOrDel('coffset', off ? String(off) : '');
    setOrDel('cauthor', a.author);
    setOrDel('ctitle', a.title);
    setOrDel('ceditor', a.editor);
    setOrDel('cplace', a.place);
    setOrDel('cprinter', a.printer);
    setOrDel('cpublisher', a.publisher);
    setOrDel('cshelf', a.shelf_mark);
    setOrDel('clang', a.language);
    setOrDel('cyfrom', a.yearFrom);
    setOrDel('cyto', a.yearTo);
    setOrDel('cdig', a.digitized);
    setOrDel('cft', a.firstTranslation ? '1' : '');
    const qs = params.toString();
    const path = window.location.pathname;
    window.history.replaceState(null, '', qs ? `${path}?${qs}` : path);
  }, []);

  useEffect(() => {
    fetchWorks(initialQ, initialSort, initialKeyword, initialOffset, initialAdv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    fetchWorks(value, sort, keyword, 0, adv);
    updateUrl(value, sort, keyword, 0, adv);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setOffset(0);
    fetchWorks(searchQuery, newSort, keyword, 0, adv);
    updateUrl(searchQuery, newSort, keyword, 0, adv);
  };

  const handleKeywordChange = (newKw: string) => {
    setKeyword(newKw);
    setOffset(0);
    fetchWorks(searchQuery, sort, newKw, 0, adv);
    updateUrl(searchQuery, sort, newKw, 0, adv);
  };

  const handlePage = (newOffset: number) => {
    setOffset(newOffset);
    fetchWorks(searchQuery, sort, keyword, newOffset, adv);
    updateUrl(searchQuery, sort, keyword, newOffset, adv);
  };

  const applyAdvanced = (nextAdv: AdvancedFilters = adv) => {
    setOffset(0);
    fetchWorks(searchQuery, sort, keyword, 0, nextAdv);
    updateUrl(searchQuery, sort, keyword, 0, nextAdv);
  };

  const debouncedApplyAdvanced = useDebouncedCallback((nextAdv: AdvancedFilters) => {
    applyAdvanced(nextAdv);
  }, 300);

  const handleAdvChange = (key: keyof AdvancedFilters, value: string | boolean) => {
    const next = { ...adv, [key]: value } as AdvancedFilters;
    setAdv(next);
    debouncedApplyAdvanced(next);
  };

  // Toggle-style controls apply immediately (no typing debounce) — saves the
  // user 300 ms of staring at a stale list after a single click.
  const handleAdvToggle = (key: keyof AdvancedFilters, value: boolean) => {
    const next = { ...adv, [key]: value } as AdvancedFilters;
    setAdv(next);
    applyAdvanced(next);
  };

  const clearAll = () => {
    const cleared: AdvancedFilters = lockDigitized ? { ...EMPTY_ADV, digitized: 'sl' } : EMPTY_ADV;
    setSearchQuery('');
    setKeyword('');
    setAdv(cleared);
    setOffset(0);
    fetchWorks('', sort, '', 0, cleared);
    updateUrl('', sort, '', 0, cleared);
  };

  // When the digitised filter is locked by the parent (Show digitised list view),
  // don't count it as a user-applied filter — it's part of the view, not a chip.
  const advCount = useMemo(
    () => Object.entries(adv).filter(
      ([k, v]) => isAdvFilterApplied(k, v as string | boolean, lockDigitized)
    ).length,
    [adv, lockDigitized]
  );
  // Highlight the active search query wherever it appears in a result.
  const hl = (text: string | number | null | undefined) => highlightQuery(text, searchQuery);

  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const totalPages = Math.ceil(total / PER_PAGE);

  // Resolve digitized status: prefer parent-supplied map (live MongoDB), fall back to row.sl_book_id.
  const resolveDigitized = (w: BphWork) => {
    const fromMap = w.ubn ? digitizedUbns[w.ubn] : undefined;
    if (fromMap) return fromMap;
    if (w.sl_book_id) return { id: w.sl_book_id, slug: w.sl_book_slug || w.sl_book_id };
    return null;
  };

  // External scan: BPH-held work whose digitisation lives at another archive
  // (IA, CMC Kloss, MDZ, etc.) and is readable on Source Library. Surfaced
  // as a secondary "Read at [source]" link only when the row has no BPH-native
  // scan — when both exist, BPH-native wins.
  const resolveExternal = (w: BphWork, hasDigitized: boolean) => {
    if (hasDigitized || !w.sl_external_book_id) return null;
    return {
      id: w.sl_external_book_id,
      slug: w.sl_external_slug || w.sl_external_book_id,
      source: w.sl_external_source || null,
    };
  };

  // Detail-page URL for a catalog entry. Always nest under basePath so the
  // link works in every host context: bph.sourcelibrary.org (where the proxy
  // serves /embed/bph/catalog/{ubn} directly), sourcelibrary.org/embed/bph
  // (the iframe target — must stay inside /embed/bph or it 404s), and
  // /libraries/{slug}. The bph subdomain proxy doesn't rewrite /embed/...
  // paths, so the URL bar will read /embed/bph/catalog/{ubn} there — uglier
  // than the legacy /catalog/{ubn} but functional in every context.
  //
  // Returns null if ubn is missing. Callers must render plain text instead
  // of a link in that case — without this guard, `encodeURIComponent(null)`
  // produces the string "null" and the link points at /catalog/null, which
  // 404s as a soft 404 ("Catalogue entry not found"). Observed in
  // not_found_reports 2026-05-26 to 2026-05-28.
  // Takes the ROW, not a bare ubn: manuscripts and photographs have no UBN
  // (2,012 rows — every `Fot` record, 442 `M ` manuscripts), so keying on ubn
  // alone returned null and the caller rendered dead plain text. They all carry
  // a uuid, and the detail route accepts either key. Reported twice by BPH
  // staff: José Bouman 2026-07-31, Natalie Koch 2026-08-05.
  const detailUrl = (w: { ubn?: string | null; uuid?: string | null } | null | undefined): string | null => {
    const key = w?.ubn || w?.uuid;
    if (!key) return null;
    return `${basePath.replace(/\/$/, '')}/catalog/${encodeURIComponent(key)}`;
  };

  // When the parent supplies a results-header slot (the unified shell does
  // this to host the list/grid view icons), the count + icons render in a
  // second row below the filters; otherwise the count renders inline in the
  // search row.
  const hasHeaderSlot = resultsHeaderSlot !== undefined;

  return (
    <div>
      {/* Search / filter row — search input, subjects dropdown, optional
          parent-supplied toggle (e.g. Show all / Show digitised & translated),
          Advanced. Sort is driven by clicking column headers in the table. */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[14rem] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search across all fields…"
            className="w-full text-sm border border-border-light rounded-md pl-9 pr-9 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={keyword}
          onChange={(e) => handleKeywordChange(e.target.value)}
          className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
        >
          {KEYWORD_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {searchRowSlot}

        <button
          onClick={() => setShowAdvanced(s => !s)}
          className="inline-flex items-center gap-1.5 text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary hover:bg-warm transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Advanced
          {advCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-accent-rust text-white">
              {advCount}
            </span>
          )}
        </button>

        {!hideInlineCount && !hasHeaderSlot && (
          <span className="text-sm text-muted ml-auto">
            {total.toLocaleString('en-US')} works
          </span>
        )}
      </div>

      {/* Results-header row — counter on the left, parent-supplied view
          icons on the right. Only rendered when the parent passes a slot
          (the unified shell does so for the BPH iframe). The count renders
          here regardless of hideInlineCount — that prop only gates the
          inline count in the search row above. */}
      {hasHeaderSlot && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm text-muted">
            <span className="font-medium text-primary">{total.toLocaleString('en-US')}</span>
            {catalogTotal && catalogTotal > 0 ? ` of ${catalogTotal.toLocaleString('en-US')} works` : ' works'}
          </span>
          {total > 0 && (
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors"
              title={`Download all ${total.toLocaleString('en-US')} results as a spreadsheet`}
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </a>
          )}
          <div className="flex items-center gap-3 ml-auto">
            {/* Sort control — sits to the LEFT of the list/grid toggle. Drives
                the same `sort` state as the list-view column headers, so it
                works in grid view too (where there are no headers to click). */}
            <select
              value={sort}
              onChange={(e) => handleSortChange(e.target.value)}
              aria-label="Sort catalogue"
              className="h-9 text-sm border border-border-light rounded-md pl-2.5 pr-7 bg-white text-secondary hover:bg-warm transition-colors cursor-pointer"
            >
              <option value="author">Author A–Z</option>
              <option value="author_desc">Author Z–A</option>
              <option value="title">Title A–Z</option>
              <option value="title_desc">Title Z–A</option>
              <option value="year_asc">Date (oldest first)</option>
              <option value="year_desc">Date (newest first)</option>
            </select>
            {resultsHeaderSlot}
          </div>
        </div>
      )}

      {/* Advanced search panel */}
      {showAdvanced && (
        <div className="mb-4 p-4 bg-warm border border-border-light rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AdvField label="Author" value={adv.author} onChange={v => handleAdvChange('author', v)} placeholder="Behme, Böhme, …" />
            <AdvField label="Title" value={adv.title} onChange={v => handleAdvChange('title', v)} />
            <AdvField label="Editor / translator" value={adv.editor} onChange={v => handleAdvChange('editor', v)} />
            <AdvField label="Place of publication" value={adv.place} onChange={v => handleAdvChange('place', v)} placeholder="London, Lyon, Amsterdam…" />
            <AdvField label="Printer" value={adv.printer} onChange={v => handleAdvChange('printer', v)} />
            <AdvField label="Publisher" value={adv.publisher} onChange={v => handleAdvChange('publisher', v)} />
            <AdvField label="Shelfmark" value={adv.shelf_mark} onChange={v => handleAdvChange('shelf_mark', v)} />
            <AdvField label="Language" value={adv.language} onChange={v => handleAdvChange('language', v)} placeholder="Latin, German, English…" />
            <div>
              <label className="block text-xs text-muted mb-1">Year range</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={adv.yearFrom}
                  onChange={(e) => handleAdvChange('yearFrom', e.target.value)}
                  placeholder="from"
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  value={adv.yearTo}
                  onChange={(e) => handleAdvChange('yearTo', e.target.value)}
                  placeholder="to"
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                />
              </div>
            </div>
            {!lockDigitized && (
              <div>
                <label className="block text-xs text-muted mb-1">Digitization</label>
                <select
                  value={adv.digitized}
                  onChange={(e) => handleAdvChange('digitized', e.target.value)}
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary"
                >
                  <option value="">All books in the library</option>
                  <option value="held">Physically held at BPH</option>
                  <option value="sl">Digitised on Source Library</option>
                  <option value="true">Digitised anywhere</option>
                  <option value="false">Not yet digitised</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-muted mb-1">Translation</label>
              <label className="inline-flex items-center gap-2 text-sm text-primary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={adv.firstTranslation}
                  onChange={(e) => handleAdvToggle('firstTranslation', e.target.checked)}
                  className="rounded border-border-light text-accent-rust focus:ring-accent-rust/30"
                />
                First English translation
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={clearAll}
              className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
            >
              Clear all
            </button>
            <span className="text-xs text-muted ml-auto">
              Filters apply as you type. The simple search above queries every field at once.
            </span>
          </div>
        </div>
      )}

      {/* Results — table for list view, covers for grid view. The chrome
          above is identical in both modes so the top of the page doesn't
          shift between displays. */}
      {display === 'list' ? (
        <div className="border border-border-light rounded-lg overflow-hidden bg-white">
          <div className="overflow-x-auto">
            {/* table-fixed + explicit column widths so columns don't resize to
                the current page's content when the sort order changes. Title
                is left width-less to absorb the remaining space. */}
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-border-light bg-warm">
                  <th className="text-left px-3 py-2.5 font-medium text-secondary hidden sm:table-cell w-[20%]">
                    <button
                      type="button"
                      onClick={() => handleSortChange(nextSort('author', sort))}
                      className="inline-flex items-center hover:text-primary transition-colors"
                    >
                      Author<SortArrow direction={arrowFor('author', sort)} />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-secondary">
                    <button
                      type="button"
                      onClick={() => handleSortChange(nextSort('title', sort))}
                      className="inline-flex items-center hover:text-primary transition-colors"
                    >
                      Title<SortArrow direction={arrowFor('title', sort)} />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell w-[15%]">Place</th>
                  <th className="text-left px-3 py-2.5 font-medium text-secondary w-16">
                    <button
                      type="button"
                      onClick={() => handleSortChange(nextSort('year', sort))}
                      className="inline-flex items-center hover:text-primary transition-colors"
                    >
                      Year<SortArrow direction={arrowFor('year', sort)} />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell w-[15%]">
                    <button
                      type="button"
                      onClick={() => handleSortChange(nextSort('shelfmark', sort))}
                      className="inline-flex items-center hover:text-primary transition-colors"
                    >
                      Shelfmark<SortArrow direction={arrowFor('shelfmark', sort)} />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-secondary hidden lg:table-cell w-[14%]">Subject</th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-50' : ''}>
                {/* Skeleton rows while the initial fetch is in flight. Without
                  these the table renders as column-headers-only, which read
                  as broken-empty (B15). One row per expected result up to a
                  reasonable cap. */}
                {loading && works.length === 0 && (
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={`skel-${i}`} className="border-b border-border-light last:border-0">
                      <td className="px-3 py-3 align-top hidden sm:table-cell">
                        <div className="h-4 w-1/2 bg-border-light/40 rounded animate-pulse" />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="h-4 w-3/4 bg-border-light/40 rounded animate-pulse" />
                      </td>
                      <td className="px-3 py-3 align-top hidden md:table-cell">
                        <div className="h-4 w-16 bg-border-light/40 rounded animate-pulse" />
                      </td>
                      <td className="px-3 py-3 align-top tabular-nums">
                        <div className="h-4 w-10 bg-border-light/40 rounded animate-pulse" />
                      </td>
                      <td className="px-3 py-3 align-top hidden md:table-cell">
                        <div className="h-4 w-20 bg-border-light/40 rounded animate-pulse" />
                      </td>
                      <td className="px-3 py-3 align-top hidden lg:table-cell">
                        <div className="h-5 w-20 bg-border-light/40 rounded-full animate-pulse" />
                      </td>
                    </tr>
                  ))
                )}
                {works.map((w, idx) => {
                  const digitized = resolveDigitized(w);
                  const external = resolveExternal(w, !!digitized);
                  const displayTitle = w.title || w.full_title || w.parallel_title || w.uniform_title || '(untitled)';
                  const displayAuthor = w.author || w.variant_author || w.pseudonym;
                  return (
                    <tr
                      // 2,012 of 29,876 catalog rows have ubn:null (legacy
                      // pre-Memorix entries). With reactCompiler:true, multiple
                      // siblings sharing key={null} collide in the per-key
                      // memoization cache and previous-search rows persist in
                      // the DOM after works[] shrinks — e.g. searching
                      // "Helicone" returned 2 rows but rendered 4. Offset the
                      // fallback key with the row index so each null-ubn row
                      // is unique within the current results page.
                      key={w.ubn ?? `null-ubn-${idx}`}
                      className="border-b border-border-light last:border-0 hover:bg-cream/50 transition-colors"
                    >
                      <td className="px-3 py-2 align-top text-secondary hidden sm:table-cell">
                        {displayAuthor ? hl(displayAuthor) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-primary leading-snug">
                          {detailUrl(w) ? (
                            <a
                              href={detailUrl(w)!}
                              className="hover:text-accent-rust transition-colors"
                            >
                              {hl(displayTitle)}
                            </a>
                          ) : (
                            <span>{hl(displayTitle)}</span>
                          )}
                        </div>
                        {digitized && (
                          <a
                            href={bookUrl({ id: digitized.id, slug: digitized.slug })}
                            className="inline-flex items-center gap-1 mt-1 text-xs text-accent-rust hover:underline"
                          >
                            <BookMarked className="w-3 h-3" />
                            Digitised copy
                          </a>
                        )}
                        {external && (
                          <a
                            href={bookUrl({ id: external.id, slug: external.slug })}
                            className="inline-flex items-center gap-1 mt-1 text-xs text-secondary hover:text-accent-rust hover:underline"
                          >
                            <BookMarked className="w-3 h-3 opacity-60" />
                            Read at {externalSourceLabel(external.source)}
                          </a>
                        )}
                        {/* Mobile: show author inline (author column is hidden < sm) */}
                        <div className="text-xs text-muted sm:hidden mt-0.5">
                          {hl(displayAuthor)}
                        </div>
                        {/* Impressum line — place, printer/publisher, year — in
                          the order librarians expect on a short bibliographic
                          card. Falls back gracefully when fields are missing. */}
                        {(w.place || w.printer || w.publisher) && (
                          <div className="text-[11px] text-muted mt-0.5 italic">
                            {hl(formatImpressum(w))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-secondary hidden md:table-cell">
                        {w.place ? hl(w.place) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2 align-top text-secondary tabular-nums">
                        {w.year ? hl(w.year) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2 align-top text-secondary font-mono text-xs hidden md:table-cell">
                        {w.shelf_mark ? hl(w.shelf_mark) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2 align-top hidden lg:table-cell">
                        {w.keywords ? (
                          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-cream border border-border-light text-secondary capitalize">
                            {hl(w.keywords)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && works.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-12 text-center text-muted">
                      No works found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // Grid view: covers for the same filtered + sorted page. Every row
        // has a sl_book_id (lockDigitized='sl' enforces it), so detailUrl
        // links to the SL book — the catalogue detail page is reserved for
        // list rows where the user is browsing the catalogue itself.
        <div className={loading ? 'opacity-50' : ''}>
          {loading && works.length === 0 ? (
            // Skeleton tiles for the initial fetch so the grid doesn't read
            // as empty before hydration completes (B15).
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={`skel-${i}`} className="flex flex-col">
                  <div className="aspect-[2/3] bg-border-light/40 rounded-md animate-pulse" />
                  <div className="h-4 w-3/4 bg-border-light/40 rounded mt-2 animate-pulse" />
                  <div className="h-3 w-1/2 bg-border-light/40 rounded mt-1 animate-pulse" />
                </div>
              ))}
            </div>
          ) : works.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {works.map((w, idx) => {
                const digitized = resolveDigitized(w);
                const external = resolveExternal(w, !!digitized);
                const displayTitle = w.title || w.full_title || w.parallel_title || w.uniform_title || '(untitled)';
                const displayAuthor = w.author || w.variant_author || w.pseudonym;
                const href = digitized
                  ? bookUrl({ id: digitized.id, slug: digitized.slug })
                  : external
                    ? bookUrl({ id: external.id, slug: external.slug })
                    : detailUrl(w);
                const Wrapper: React.ElementType = href ? 'a' : 'div';
                return (
                  <Wrapper
                    // Same null-ubn fallback as the list view above — see
                    // comment at the table render for the reactCompiler /
                    // duplicate-key collision rationale.
                    key={w.ubn ?? `null-ubn-${idx}`}
                    {...(href ? { href } : {})}
                    className="group flex flex-col text-left"
                  >
                    <div className="relative aspect-[2/3] bg-warm rounded-md overflow-hidden border border-border-light group-hover:border-accent-rust/40 transition-colors">
                      {w.sl_cover ? (
                        // Next's image optimiser resizes the cover down to the
                        // grid-tile width (~170px) and serves AVIF/WebP, so the
                        // browser no longer downloads a ~400KB display JPEG per
                        // tile. bookCoverResponsiveLoader additionally swaps the
                        // R2 *source* to the 150px `-thumb.jpg` for small widths,
                        // cutting optimiser-side egress ~40×. Safe for every
                        // digitised BPH cover: the /cropped/ + /uploads/ thumbs
                        // (~18%) that were missing are backfilled by
                        // scripts/maintenance/backfill-bph-cover-thumbs.mjs.
                        <Image
                          src={w.sl_cover}
                          loader={bookCoverResponsiveLoader}
                          alt={displayTitle}
                          fill
                          loading="lazy"
                          quality={75}
                          sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                          className="object-cover"
                        />
                      ) : embed ? (
                        <PlaceholderCover title={displayTitle} author={displayAuthor} year={w.year} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted">
                          <BookMarked className="w-8 h-8 opacity-40" />
                        </div>
                      )}
                      {external && (
                        <div className="absolute bottom-1 left-1 right-1 px-1.5 py-0.5 text-[10px] leading-tight text-white bg-black/55 rounded-sm text-center">
                          via {externalSourceLabel(external.source)}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-medium text-primary leading-snug line-clamp-2 group-hover:text-accent-rust transition-colors">
                      {hl(displayTitle)}
                    </div>
                    {displayAuthor && (
                      <div className="text-xs text-muted mt-0.5 line-clamp-1">
                        {hl(displayAuthor)}
                        {w.year ? ` · ${w.year}` : ''}
                      </div>
                    )}
                  </Wrapper>
                );
              })}
            </div>
          ) : (
            !loading && (
              <div className="text-center py-16 text-muted">
                No works found matching your search.
              </div>
            )
          )}
        </div>
      )}

      {/* Pagination — shared by both displays. */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => handlePage(Math.max(0, offset - PER_PAGE))}
            disabled={offset === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border-light rounded-md hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => handlePage(offset + PER_PAGE)}
            disabled={currentPage >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border-light rounded-md hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function AdvField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
      />
    </div>
  );
}
