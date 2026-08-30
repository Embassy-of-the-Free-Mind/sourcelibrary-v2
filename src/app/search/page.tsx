'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search, Book, ExternalLink, Filter, X, Loader2,
  Quote, User, MapPin, Lightbulb, BookOpen, Languages,
  ChevronLeft, ChevronRight, ArrowUpDown, ImageIcon, ChevronDown, Library
} from 'lucide-react';
import { useSearchParams, useRouter, useParams, usePathname } from 'next/navigation';
import { useLocale, useLocalePath } from '@/lib/i18n';
import type { Locale } from '@/lib/locale-path';
import { SEARCH_STRINGS, EXAMPLE_QUERIES, type SearchStrings } from '@/lib/search-i18n';
import { artworkTypeLabel } from '@/lib/artwork-record';
import { localizedCollection } from '@/lib/localized';
import SiteHeader from '@/components/layout/SiteHeader';
import { useEmbed } from '@/lib/EmbedContext';
import { useDebouncedCallback } from 'use-debounce';
import { reportError } from '@/components/providers/ErrorReporter';
import {
  search as searchApi,
  gallery as galleryApi,
  categories as categoriesApi,
  collections as collectionsApi,
  utils,
  type SearchResult,
  type IndexSearchResult,
  type GalleryItem,
  type Collection,
} from '@/lib/api-client';
import { tenantBookUrl } from '@/lib/slugify';
import { matchKnownEntity } from '@/lib/known-entities';
import { assessMatchQuality } from '@/lib/search/match-quality';
import HighlightedText from '@/components/search/HighlightedText';
import { SEARCH_TYPE_STYLES, type SearchIndexType } from '@/lib/style-constants';
import { BookLoader } from '@/components/ui/BookLoader';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import { getBookThumbnailUrl } from '@/lib/utils';
import { getEffectiveByline } from '@/lib/byline';

// How many results to show in unified view per section
const PREVIEW_BOOKS = 5;
const PREVIEW_INDEX = 5;
const PREVIEW_IMAGES = 6;
const DEFAULT_RESULTS_PER_PAGE = 20;
const RESULTS_PER_PAGE_OPTIONS = [20, 48, 96];

// `labelKey` indexes SEARCH_STRINGS rather than carrying a literal, so the
// index-type pills and the IndexResultCard badge speak the page's language from
// one place. The `value`s are API parameters and never localize.
const INDEX_TYPES: { value: string; labelKey: keyof SearchStrings; icon: typeof Search }[] = [
  { value: '', labelKey: 'indexAllTypes', icon: Search },
  { value: 'concept', labelKey: 'indexConcepts', icon: Lightbulb },
  { value: 'person', labelKey: 'indexPeople', icon: User },
  { value: 'place', labelKey: 'indexPlaces', icon: MapPin },
  { value: 'quote', labelKey: 'indexQuotes', icon: Quote },
  { value: 'keyword', labelKey: 'indexKeywords', icon: BookOpen },
  { value: 'vocabulary', labelKey: 'indexVocabulary', icon: Languages },
];

/** The label for an index type in `lang` (falls back to the raw API value). */
function indexTypeLabel(type: string, t: SearchStrings): string {
  const key = INDEX_TYPES.find((x) => x.value === type)?.labelKey;
  return key ? (t[key] as string) : type;
}

interface LanguageOption { value: string; label: string; }
interface CategoryOption { value: string; label: string; icon?: string; }

interface BphCatalogMatch {
  ubn: string;
  /** Manuscripts/photographs get no UBN from Memorix; uuid is their only key. */
  uuid?: string | null;
  /** Where manuscript records keep their title; `title` is null on them. */
  full_title?: string | null;
  title: string | null;
  parallel_title?: string | null;
  uniform_title?: string | null;
  author: string | null;
  variant_author?: string | null;
  year: number | null;
  place: string | null;
  publisher?: string | null;
  printer?: string | null;
  shelf_mark?: string | null;
  keywords?: string | null;
  thumbnail?: string | null;
  sl_book_id: string | null;
  sl_book_slug?: string | null;
  ia_identifier?: string | null;
}

type ViewMode = 'unified' | 'books' | 'index' | 'images';

export default function SearchPage({ defaultLibrary, forceEmbedded = false, lang: langProp }: { defaultLibrary?: string; forceEmbedded?: boolean; lang?: Locale } = {}) {
  const router = useRouter();
  const { tenant } = useParams<{ tenant: string }>();
  const searchParams = useSearchParams();
  const currentPathname = usePathname();
  const embedFromContext = useEmbed();
  const embed = forceEmbedded || embedFromContext;

  // The locale comes from the URL prefix; the `lang` prop that the `/es/search`
  // twin passes is the explicit form of the same answer. Defaulting to the
  // pathname means a caller that forgets the prop still renders the right
  // language rather than English chrome on an `/es` URL (i18n.md, "both sides
  // of an edition guard must read the same locale").
  const urlLocale = useLocale();
  const lang: Locale = langProp ?? urlLocale;
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const nf = (n: number) => n.toLocaleString(t.numberLocale);

  // A localized surface gets only the lanes that can answer in its language.
  // `/api/search` (the books lane) takes `lang` and narrows to books that HAVE
  // that edition, so every result is openable at `/es/book/…`. The unified
  // ("All") lane, the index lane and the AI-expand stream do not take `lang`
  // and would return English under Spanish chrome — hidden rather than shown
  // broken (see the note in src/lib/search-i18n.ts). The gallery lane is kept
  // and LABELLED, because the images are the content.
  const localized = lang !== 'en';
  const defaultMode: ViewMode = localized ? 'books' : 'unified';
  const langParam = localized ? lang : undefined;

  // `?mode=` is user-supplied, so the clamp lives here rather than only in the
  // tab list: a hand-typed /es/search?mode=unified must not render the English
  // lane. Both hidden modes fall back to the books lane, which is also what
  // browse mode renders (it keys on `viewMode !== 'images'`).
  const rawInitialMode = (searchParams.get('mode') as ViewMode) || defaultMode;
  const initialMode: ViewMode = localized && (rawInitialMode === 'unified' || rawInitialMode === 'index')
    ? 'books'
    : rawInitialMode;
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [loading, setLoading] = useState(false);
  // Anonymous visitors get 5 free searches/hour; past that the API 401s and we
  // show a sign-in wall instead of results.
  const [signInRequired, setSignInRequired] = useState(false);

  // Unified results
  const [bookResults, setBookResults] = useState<SearchResult[]>([]);
  const [bookTotal, setBookTotal] = useState(0);
  const [indexResults, setIndexResults] = useState<IndexSearchResult[]>([]);
  const [indexTotal, setIndexTotal] = useState(0);
  const [imageResults, setImageResults] = useState<GalleryItem[]>([]);
  const [imageTotal, setImageTotal] = useState(0);
  const [collectionResults, setCollectionResults] = useState<{ slug: string; name: string; description?: string; book_count: number; featured_image?: string; hero_image?: string }[]>([]);

  // Semantic results (parallel search agent)
  const [semanticResults, setSemanticResults] = useState<any[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  // True when the semantic lane errored/timed out (vs. genuinely returned nothing).
  // Without this, a degraded 6s lane silently collapses to [] and the page presents
  // "no related results" as if it were a fact — the "looks like 1 result" bug, where
  // held editions catalogued under another name (Pimander ≈ Corpus Hermeticum) vanish.
  const [semanticDegraded, setSemanticDegraded] = useState(false);
  // Honest-failure flag from /api/search/unified (#4281): 'weak' = results
  // exist but none contains all the query's words. null = strong or unjudged.
  const [matchQuality, setMatchQuality] = useState<'strong' | 'weak' | null>(null);

  // Page-content passage results (for quoted phrase searches)
  const [passageResults, setPassageResults] = useState<SearchResult[]>([]);
  const [passageLoading, setPassageLoading] = useState(false);

  // BPH catalog metadata matches (only on a BPH tenant). Catches works that
  // exist in the bibliographic catalog but haven't been digitized — full-text
  // book search would never find them.
  const [catalogResults, setCatalogResults] = useState<BphCatalogMatch[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Track when the base search has set image results, so AI imgTerms callback
  // doesn't add images that get immediately overwritten by the base search completing.
  const baseImagesSet = useRef(false);
  const pendingAiImages = useRef<GalleryItem[]>([]);

  // Accordion open state for unified view sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['books', 'semantic']));
  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // Drill-down state
  const [offset, setOffset] = useState(parseInt(searchParams.get('offset') || '0'));
  const [indexType, setIndexType] = useState(searchParams.get('type') || '');
  const [sortBy, setSortBy] = useState<'relevance' | 'date_asc' | 'date_desc' | 'title'>(
    (searchParams.get('sort') as any) || 'relevance'
  );

  // Filters
  const hasInitialFilters = !!(searchParams.get('language') || searchParams.get('category') || searchParams.get('collection') || searchParams.get('date_from') || searchParams.get('date_to') || searchParams.get('has_doi') || searchParams.get('has_translation') || searchParams.get('first_translation') || searchParams.get('library'));
  const [showFilters, setShowFilters] = useState(hasInitialFilters);
  const [language, setLanguage] = useState(searchParams.get('language') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [collection, setCollection] = useState(searchParams.get('collection') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [hasDoi, setHasDoi] = useState(searchParams.get('has_doi') === 'true');
  const [hasTranslation, setHasTranslation] = useState(searchParams.get('has_translation') === 'true');
  const [firstTranslation, setFirstTranslation] = useState(searchParams.get('first_translation') === 'true');
  const [library, setLibrary] = useState(searchParams.get('library') || defaultLibrary || '');
  const [languages, setLanguages] = useState<LanguageOption[]>([{ value: '', label: t.allLanguages }]);
  const [categories, setCategories] = useState<CategoryOption[]>([{ value: '', label: t.allCategories }]);
  const [collectionsList, setCollectionsList] = useState<Collection[]>([]);

  // Results per page
  const [resultsPerPage, setResultsPerPage] = useState(
    parseInt(searchParams.get('per_page') || '') || DEFAULT_RESULTS_PER_PAGE
  );

  // Browse mode state
  const [browseBooks, setBrowseBooks] = useState<any[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState(false);
  const [browseSortBy, setBrowseSortBy] = useState<string>(
    searchParams.get('sort') || 'recent-translation'
  );

  // Collection pills expand/collapse (mobile)
  const [showAllCollections, setShowAllCollections] = useState(false);
  const MOBILE_COLLECTION_LIMIT = 6;

  // Browse gallery state (images tab in browse mode)
  const [browseImages, setBrowseImages] = useState<GalleryItem[]>([]);
  const [browseImageTotal, setBrowseImageTotal] = useState(0);
  const [browseImageLoading, setBrowseImageLoading] = useState(false);

  // Suggestions
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // AI-assisted search — streaming narration + expanded terms + display hint
  const [aiNarration, setAiNarration] = useState('');
  const [aiNarrationHistory, setAiNarrationHistory] = useState<{ query: string; text: string; terms: string[] }[]>([]);
  const [aiTerms, setAiTerms] = useState<string[]>([]);
  const [aiResults, setAiResults] = useState<SearchResult[]>([]);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [displayHint, setDisplayHint] = useState<'images_first' | 'books_first' | 'not_in_collection'>('books_first');
  const displayHintLocked = useRef(false); // lock once results render to prevent layout shift
  const aiAbortRef = useRef<(() => void) | null>(null);

  // Search-click telemetry context — read by the delegated click listener below.
  // Updated on each search so a result click can be attributed to the query +
  // ranking strategy that produced it (closes the search measurement loop).
  const clickCtx = useRef<{ query: string; ranking: string | null; results: SearchResult[]; view: string; total: number }>({ query: '', ranking: null, results: [], view: 'all', total: 0 });

  // Delegated capture-phase listener: any click on a /book/ link while a search
  // is active beacons {query, ranking, slug, rank, …} to /api/search/click. One
  // listener, no per-card wiring; non-result /book/ links won't match a current
  // result and are recorded with rank undefined (or skipped if no active query).
  useEffect(() => {
    function onResultClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement)?.closest?.('a[href*="/book/"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const ctx = clickCtx.current;
      if (!ctx.query) return; // only track within an active search (not browse)
      const href = anchor.getAttribute('href') || '';
      const pageMatch = href.match(/\/book\/([^/?#]+)\/page-number\/(\d+)/);
      const bookMatch = href.match(/\/book\/([^/?#]+)/);
      const slug = (pageMatch?.[1] || bookMatch?.[1] || '').toLowerCase();
      if (!slug) return;
      const idx = ctx.results.findIndex(r =>
        (r.slug || '').toLowerCase() === slug || (r.book_id || '').toLowerCase() === slug);
      const payload = {
        query: ctx.query, ranking: ctx.ranking, slug,
        page_number: pageMatch ? Number(pageMatch[2]) : undefined,
        rank: idx >= 0 ? idx + 1 : undefined, view: ctx.view, total: ctx.total,
      };
      try {
        const body = JSON.stringify(payload);
        if (navigator.sendBeacon) navigator.sendBeacon('/api/search/click', new Blob([body], { type: 'application/json' }));
        else fetch('/api/search/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      } catch { /* never block the click */ }
    }
    document.addEventListener('click', onResultClick, true);
    return () => document.removeEventListener('click', onResultClick, true);
  }, []);

  // Load filter options + collections (independent so one failure doesn't block others)
  useEffect(() => {
    utils.languages().then((langData) => {
      if (langData.languages) {
        setLanguages([
          { value: '', label: t.allLanguages },
          ...langData.languages.map((l: any) => ({ value: l.code, label: `${l.name} (${l.book_count})` })),
        ]);
      }
    }).catch(() => { });

    categoriesApi.list().then((catData) => {
      if (catData.categories) {
        setCategories([
          { value: '', label: t.allCategories },
          ...catData.categories
            .filter((c: any) => c.book_count > 0)
            .map((c: any) => ({ value: c.id, label: `${c.icon ? c.icon + ' ' : ''}${c.name} (${c.book_count})`, icon: c.icon })),
        ]);
      }
    }).catch(() => { });

    collectionsApi.list().then((colData) => {
      if (colData.collections) {
        setCollectionsList(colData.collections);
      }
    }).catch(() => { });
  }, [t]);

  // Track current narration/terms in refs so startAiStream doesn't need them as deps
  const aiNarrationRef = useRef(aiNarration);
  const aiTermsRef = useRef(aiTerms);
  const queryRef = useRef(query);
  aiNarrationRef.current = aiNarration;
  aiTermsRef.current = aiTerms;
  queryRef.current = query;

  // AI-assisted search — start streaming immediately when user searches
  // append=true means this is a pill click — keep existing narration and add below
  const startAiStream = useCallback((q: string, append = false) => {
    // Abort any existing stream
    aiAbortRef.current?.();

    if (!append) {
      // Fresh search — clear everything
      setAiNarration('');
      setAiTerms([]);
      setAiResults([]);
      setAiNarrationHistory([]);
      setDisplayHint('books_first');
      displayHintLocked.current = false;
    } else {
      // Pill click — save current narration to history before streaming new one
      const curNarration = aiNarrationRef.current;
      const curTerms = aiTermsRef.current;
      const curQuery = queryRef.current;
      setAiNarrationHistory(prev => [
        ...prev,
        ...(curNarration ? [{ query: curQuery, text: curNarration, terms: curTerms }] : []),
      ]);
      setAiNarration('');
      setAiTerms([]);
    }

    // Reset the base-images gate so imgTerms buffers until performSearch sets results
    baseImagesSet.current = false;
    pendingAiImages.current = [];

    // /api/search/ai-expand answers in English and expands to English terms
    // against an English index. On a localized surface that is a paragraph of
    // English prose above Spanish results, so the lane is skipped entirely
    // rather than shown in the wrong language (i18n.md rule 7 — the language
    // has to travel in the REQUEST, which this endpoint does not yet take).
    if (localized) return;
    if (!q || q.length < 3) return;
    setAiStreaming(true);

    let narrationAccum = '';
    const abort = searchApi.aiExpandStream(
      q,
      (text) => {
        narrationAccum += text;
        setAiNarration(narrationAccum);
      },
      async (terms) => {
        const originalLower = q.toLowerCase();
        const newTerms = terms.filter(t => t.toLowerCase() !== originalLower);
        setAiTerms(newTerms);

        if (newTerms.length === 0) return;
        // Search expanded terms sequentially to avoid saturating the backend
        const mainBookIds = new Set(bookResults.map(r => r.book_id));
        const seen = new Set<string>();
        const deduped: SearchResult[] = [];
        for (const term of newTerms) {
          try {
            const res = await searchApi.search(term, { limit: 3 });
            for (const r of (res.results || [])) {
              if (mainBookIds.has(r.book_id)) continue;
              const key = r.book_id + (r.type === 'page' ? `-p${r.page_number}` : '');
              if (!seen.has(key)) {
                seen.add(key);
                deduped.push(r);
              }
            }
            // Update results incrementally as each term resolves
            setAiResults([...deduped].slice(0, 8));
          } catch { /* skip failed term */ }
        }
      },
      () => setAiStreaming(false),
      (hint) => {
        // Only apply display hint if results haven't rendered yet (prevents layout shift)
        if (!displayHintLocked.current && (hint === 'images_first' || hint === 'books_first' || hint === 'not_in_collection')) {
          setDisplayHint(hint);
          displayHintLocked.current = true;
        }
      },
      async (imgTerms) => {
        // Fire supplementary gallery searches with LLM-suggested image terms
        // Use galleryApi.list (lightweight) instead of full unified search
        if (!imgTerms || imgTerms.length === 0) return;
        const existingIds = new Set(imageResults.map(i => `${i.pageId}-${i.detectionIndex}`));
        const newImages: GalleryItem[] = [];
        // Search all image terms in parallel
        const supplementTerms = imgTerms.slice(0, 3);
        const results = await Promise.allSettled(
          supplementTerms.map(term =>
            galleryApi.list({ query: term, limit: 4, maxPerBook: 1 })
          )
        );
        for (const [i, r] of results.entries()) {
          if (r.status !== 'fulfilled') continue;
          for (const item of (r.value.items || [])) {
            const key = `${item.pageId}-${item.detectionIndex}`;
            if (existingIds.has(key)) continue;
            existingIds.add(key);
            // Carry the LLM term that fetched this image so the card can label
            // it "related · <term>". Unlabeled, these read as direct matches —
            // a user searching "ancient egyptian" saw tarot layouts because the
            // expansion suggested "book of thoth" (#4338).
            newImages.push({ ...item, aiTerm: supplementTerms[i] } as GalleryItem);
          }
        }
        if (newImages.length > 0) {
          if (baseImagesSet.current) {
            // Base search already set results — safe to append
            setImageResults(prev => [...prev, ...newImages]);
            setImageTotal(prev => prev + newImages.length);
          } else {
            // Base search hasn't completed yet — buffer these so they don't get wiped
            pendingAiImages.current = [...pendingAiImages.current, ...newImages];
          }
        }
      },
    );
    aiAbortRef.current = abort;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookResults, localized]);

  const performSearch = useCallback(async (q: string, mode: ViewMode = viewMode, pageOffset = 0) => {
    if (!q || q.length < 2) {
      setBookResults([]); setBookTotal(0);
      setIndexResults([]); setIndexTotal(0);
      setCollectionResults([]);
      setImageResults([]); setImageTotal(0);
      setCatalogResults([]); setCatalogTotal(0);
      setMatchQuality(null);
      return;
    }
    setLoading(true);
    setSignInRequired(false);

    try {
      if (mode === 'unified') {
        // Check client-side cache first
        const cacheKey = `unified:${q}:${language}:${category}:${hasTranslation}:${firstTranslation}:${library}:${dateFrom}:${dateTo}`;
        const cached = searchCache.current.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setBookResults(cached.books);
          setBookTotal(cached.bookTotal);
          setIndexResults(cached.index);
          setIndexTotal(cached.indexTotal);
          setImageResults(cached.images);
          setImageTotal(cached.imageTotal);
          setMatchQuality(cached.matchQuality ?? null);
          setLoading(false);
          return;
        }

        // Single unified request — books + index + gallery in one roundtrip
        try {
          const filters: Record<string, string | undefined> = {
            language: language || undefined,
            category: category || undefined,
            has_translation: hasTranslation ? 'true' : undefined,
            first_translation: firstTranslation ? 'true' : undefined,
            library: library || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
          };
          const data = await searchApi.unified(q, {
            limit: PREVIEW_BOOKS,
            galleryLimit: PREVIEW_IMAGES,
            filters,
          });

          const books = data.books?.results || [];
          const bTotal = data.books?.total || 0;
          const index = (data.index?.results || []).slice(0, PREVIEW_INDEX);
          const iTotal = data.index?.total || 0;
          clickCtx.current = { query: q, ranking: (data.books as any)?.ranking || null, results: books, view: 'all', total: bTotal };

          // Map unified gallery + visual + artwork results to GalleryItem shape
          // Merge all image sources, deduped by id
          const galleryResults = data.gallery?.results || [];
          // CLIP results are approximate by nature — tag them so the card can
          // say "visual match" instead of presenting an embedding neighbor as
          // if it matched the query text (#4338: tarot cards under "ancient
          // egyptian" read as broken search when unlabeled).
          const visualResults = (data.visual?.results || []).map((v: any) => ({ ...v, visualMatch: true }));
          const artworkResults = (data as any).artworks?.results || [];
          const seenImageIds = new Set<string>();
          const allImageResults = [...galleryResults, ...visualResults];
          const images: GalleryItem[] = [];
          for (const g of allImageResults) {
            if (seenImageIds.has(g.id)) continue;
            seenImageIds.add(g.id);
            const parts = (g.id || '').split('-');
            const detectionIndex = parseInt(parts.pop() || '0');
            const pageId = parts.join('-');
            images.push({
              pageId,
              bookId: g.bookId || '',
              // Carried through so the card can say which page of which book the
              // detail was cropped from. CLIP rows have no page number; 0 reads
              // as "unknown" and the card omits it.
              pageNumber: typeof g.pageNumber === 'number' ? g.pageNumber : 0,
              detectionIndex,
              imageUrl: g.imageUrl || '',
              thumbnailUrl: g.imageUrl || '',
              bookTitle: g.bookTitle || '',
              author: '',
              description: g.description || '',
              type: g.type,
              visualMatch: (g as any).visualMatch || undefined,
            } as GalleryItem);
          }
          // Merge artwork results as image cards. With lexical recall (#2735) a
          // term like "tarot" now matches many artworks by title — show a real
          // set of them, not just the 3 nearest by vector.
          const maxArtworks = 8;
          let artworkCount = 0;
          for (const a of artworkResults) {
            if (artworkCount >= maxArtworks) break;
            const artId = `artwork-${a.book_id}`;
            if (seenImageIds.has(artId)) continue;
            seenImageIds.add(artId);
            artworkCount++;
            images.push({
              pageId: a.book_id,
              bookId: a.book_id,
              pageNumber: 0,
              detectionIndex: 0,
              imageUrl: a.thumbnail_url || '',
              thumbnailUrl: a.thumbnail_url || '',
              bookTitle: a.display_title || a.title || '',
              author: a.author || '',
              description: a.display_title || a.title || '',
              type: a.genre || 'artwork',
              isArtwork: true,
              artworkSlug: a.slug || null,
              // What makes the card readable as an object rather than a page of
              // one of our books: the medium, and the museum that holds it.
              artworkType: a.resource_type || a.genre || null,
              holder: a.holder || null,
            } as GalleryItem & { isArtwork?: boolean; artworkSlug?: string | null; artworkType?: string | null; holder?: string | null });
          }
          const imTotal = (data.gallery?.total || 0) + (data.visual?.total || 0) + artworkResults.length;

          setBookResults(books);
          setBookTotal(bTotal);
          setIndexResults(index);
          setIndexTotal(iTotal);
          // Merge any AI-supplemented images that arrived before the base search completed
          const pending = pendingAiImages.current;
          if (pending.length > 0) {
            const baseIds = new Set(images.map((i: GalleryItem) => `${i.pageId}-${i.detectionIndex}`));
            const unique = pending.filter(p => !baseIds.has(`${p.pageId}-${p.detectionIndex}`));
            setImageResults([...images, ...unique]);
            setImageTotal(imTotal + unique.length);
            pendingAiImages.current = [];
          } else {
            setImageResults(images);
            setImageTotal(imTotal);
          }
          baseImagesSet.current = true;
          setCollectionResults((data as any).collections?.results || []);
          const mq = ((data as any).match_quality === 'weak' || (data as any).match_quality === 'strong')
            ? (data as any).match_quality : null;
          setMatchQuality(mq);
          displayHintLocked.current = true; // lock layout once results render

          // Cache the result
          searchCache.current.set(cacheKey, {
            ts: Date.now(),
            books, bookTotal: bTotal,
            index, indexTotal: iTotal,
            images, imageTotal: imTotal,
            matchQuality: mq,
          });
          // Evict old cache entries
          if (searchCache.current.size > 50) {
            const oldest = [...searchCache.current.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
            if (oldest) searchCache.current.delete(oldest[0]);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Anonymous free-search allowance exhausted — show the sign-in wall
          // and stop (don't fire the parallel agents or report an error).
          if (/free searches this hour/i.test(msg) || /SIGNIN_REQUIRED/.test(msg)) {
            setSignInRequired(true);
            setBookResults([]); setBookTotal(0);
            setIndexResults([]); setIndexTotal(0);
            setImageResults([]); setImageTotal(0);
            setMatchQuality(null);
            setCollectionResults([]); setSemanticResults([]); setSemanticDegraded(false);
            // Stop the parallel AI-expand stream so nothing leaks past the wall.
            aiAbortRef.current?.();
            setAiResults([]); setAiNarration(''); setAiStreaming(false);
            setLoading(false);
            return;
          }
          reportError({
            message: `Unified search failed: ${msg}`,
            source: 'search_query',
          });
        }

        // Fire semantic search in parallel (independent agent)
        setSemanticLoading(true);
        setSemanticDegraded(false);
        const semanticParams = new URLSearchParams({ q, limit: '8' });
        if (language) semanticParams.set('language', language);
        if (dateFrom) semanticParams.set('year_min', dateFrom);
        if (dateTo) semanticParams.set('year_max', dateTo);
        fetch(`/api/search/semantic?${semanticParams.toString()}`)
          .then(r => {
            // A non-200 (timeout, 5xx) must NOT be parsed as an empty result set —
            // r.json() on an error body yields {} → [], silently hiding held editions.
            if (!r.ok) throw new Error(`semantic ${r.status}`);
            return r.json();
          })
          .then(data => {
            // Coarse dedup against whatever keyword results this closure can
            // see. The authoritative pass is the work-grain one at render time
            // (`uniqueSemantic` below) — this closure captures `bookResults`
            // from the render that fired the fetch, so it can be a step behind.
            const keywordIds = new Set(bookResults.map(b => b.id || b.book_id));
            const deduped = (data.results || []).filter((s: any) => !keywordIds.has(s.book_id));
            setSemanticResults(deduped);
          })
          .catch(() => { setSemanticResults([]); setSemanticDegraded(true); })
          .finally(() => setSemanticLoading(false));

        // Fire BPH catalog metadata search in parallel — only on a BPH tenant.
        // The /api/catalog/bph endpoint runs Postgres full-text on bph_works,
        // which catches non-digitized works that the book-content search can't see.
        if (tenant === 'bph') {
          setCatalogLoading(true);
          fetch(`/api/catalog/bph?q=${encodeURIComponent(q)}&limit=8`)
            .then(r => r.json())
            .then(data => {
              setCatalogResults(data.works || []);
              setCatalogTotal(data.total || 0);
            })
            .catch(() => { setCatalogResults([]); setCatalogTotal(0); })
            .finally(() => setCatalogLoading(false));
        }

        // For quoted phrases, also search page content to find exact passages.
        // Use unquoted query for full-text search (finds pages with both words),
        // then try phrase search for exact contiguous matches and promote those.
        const isPhrase = /^".*"$/.test(q.trim());
        if (isPhrase) {
          const unquoted = q.trim().slice(1, -1);
          setPassageLoading(true);
          Promise.all([
            // Full-text search (both words on same page)
            searchApi.search(unquoted, { limit: 15, search_content: 'true' }),
            // Phrase search (exact contiguous match)
            searchApi.search(q, { limit: 10, search_content: 'true' }).catch(() => ({ results: [] })),
          ])
            .then(([fullData, phraseData]) => {
              const fullResults = fullData.results || [];
              const phraseIds = new Set((phraseData.results || []).map((r: SearchResult) => r.id));
              // Mark phrase matches, then sort them first
              const pages = fullResults
                .filter((r: SearchResult) => r.type === 'page')
                .sort((a: SearchResult, b: SearchResult) => {
                  const aPhrase = phraseIds.has(a.id) ? 1 : 0;
                  const bPhrase = phraseIds.has(b.id) ? 1 : 0;
                  return bPhrase - aPhrase;
                });
              setPassageResults(pages);
              // Backfill book results if unified found none
              if (bookResults.length === 0) {
                const books = fullResults.filter((r: SearchResult) => r.type === 'book');
                if (books.length > 0) {
                  setBookResults(books);
                  setBookTotal(books.length);
                }
              }
            })
            .catch(() => setPassageResults([]))
            .finally(() => setPassageLoading(false));
        } else {
          setPassageResults([]);
        }
      } else if (mode === 'books') {
        const data = await searchApi.search(q, {
          // The TEXT language of the answer. Anything but `en` also narrows the
          // request to books that HAVE that edition, so every card links to a
          // page the reader can actually open (#4095).
          lang: langParam,
          language: language || undefined,
          category: category || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          has_doi: hasDoi ? 'true' : undefined,
          has_translation: hasTranslation ? 'true' : undefined,
          first_translation: firstTranslation ? 'true' : undefined,
          library: library || undefined,
          sort: sortBy !== 'relevance' ? sortBy : undefined,
          offset: pageOffset > 0 ? pageOffset : undefined,
          limit: resultsPerPage,
          search_content: 'true',
        });
        setBookResults(data.results || []);
        setBookTotal(data.total || 0);
        clickCtx.current = { query: q, ranking: (data as any).ranking || null, results: data.results || [], view: 'books', total: data.total || 0 };
      } else if (mode === 'index') {
        const data = await searchApi.index(q, {
          type: indexType || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        setIndexResults(data.results || []);
        setIndexTotal(data.total || 0);
      } else if (mode === 'images') {
        const data = await galleryApi.list({
          query: q,
          limit: resultsPerPage,
          offset: pageOffset,
          yearFrom: dateFrom ? parseInt(dateFrom, 10) || undefined : undefined,
          yearTo: dateTo ? parseInt(dateTo, 10) || undefined : undefined,
        });
        const items = data.items || [];
        // Merge any AI-supplemented images that arrived before gallery API responded
        const pending = pendingAiImages.current;
        if (pending.length > 0) {
          const baseIds = new Set(items.map((i: GalleryItem) => `${i.pageId}-${i.detectionIndex}`));
          const unique = pending.filter(p => !baseIds.has(`${p.pageId}-${p.detectionIndex}`));
          setImageResults([...items, ...unique]);
          setImageTotal((data.total || 0) + unique.length);
          pendingAiImages.current = [];
        } else {
          setImageResults(items);
          setImageTotal(data.total || 0);
        }
        baseImagesSet.current = true;
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(t.searchFailed);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, firstTranslation, library, sortBy, resultsPerPage, langParam, t]);

  const updateUrl = useCallback((q: string, mode: ViewMode, pageOffset = 0) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== defaultMode) params.set('mode', mode);
    if (mode === 'index' && indexType) params.set('type', indexType);
    // Persist filters in URL for all modes
    if (language) params.set('language', language);
    if (category) params.set('category', category);
    if (collection) params.set('collection', collection);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (hasDoi) params.set('has_doi', 'true');
    if (hasTranslation) params.set('has_translation', 'true');
    if (firstTranslation) params.set('first_translation', 'true');
    if (library) params.set('library', library);
    if (q && sortBy !== 'relevance') params.set('sort', sortBy);
    if (!q && browseSortBy !== 'recent-translation') params.set('sort', browseSortBy);
    if (pageOffset > 0) params.set('offset', pageOffset.toString());
    if (resultsPerPage !== DEFAULT_RESULTS_PER_PAGE) params.set('per_page', resultsPerPage.toString());
    // Preserve the current route's prefix. On the embed route the pathname is
    // /embed/{tenant}/search; on a tenant subdomain the proxy makes it /search;
    // on the URL-prefix variant it's /{tenant}/search. Stripping the prefix
    // would silently navigate users off the embed (and off the subdomain).
    const basePath = (currentPathname && currentPathname.endsWith('/search'))
      ? currentPathname
      : (tenant ? `/${tenant}/search` : '/search');
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });
  }, [router, currentPathname, tenant, defaultMode, indexType, language, category, collection, dateFrom, dateTo, hasDoi, hasTranslation, firstTranslation, library, sortBy, browseSortBy, resultsPerPage]);

  // Client-side search cache — avoids re-fetching on backspace/retype
  const searchCache = useRef(new Map<string, { ts: number; books: SearchResult[]; bookTotal: number; index: IndexSearchResult[]; indexTotal: number; images: GalleryItem[]; imageTotal: number; matchQuality?: 'strong' | 'weak' | null }>());
  const CACHE_TTL = 60_000; // 1 minute

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    performSearch(value, viewMode, 0);
    updateUrl(value, viewMode, 0);
  }, 450);

  // Search on initial load (from URL params) and when filters/sort/mode change
  const aiTriggeredForQuery = useRef('');
  useEffect(() => {
    if (query.length >= 2) {
      performSearch(query, viewMode, offset);
      updateUrl(query, viewMode, offset);
      // Trigger AI stream once per distinct query (on page load / enter / filter change)
      if (aiTriggeredForQuery.current !== query) {
        aiTriggeredForQuery.current = query;
        startAiStream(query);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, firstTranslation, library, sortBy, offset, performSearch, updateUrl]);

  // Clicking an AI suggestion chip = search FOR that term. Must change the query,
  // re-run the result search, update the URL, and refresh the narration — in every
  // view. The unified ("All") view previously only re-streamed narration via
  // startAiStream(term, true) and never ran performSearch, so the results never
  // changed (issue #2789). Centralized here so the two chip render sites can't drift.
  const runSearchForTerm = useCallback((term: string) => {
    setQuery(term);
    setOffset(0);
    performSearch(term, viewMode, 0);
    updateUrl(term, viewMode, 0);
    startAiStream(term, true); // append=true keeps the narration trail
    aiTriggeredForQuery.current = term; // guard the deps-effect from re-streaming a fresh one
  }, [viewMode, performSearch, updateUrl, startAiStream]);

  // Known-entity capture (#2790): a query that names a place in the library (a
  // collection, a library partner, a bespoke landing page) gets a direct
  // entry card above results instead of being left to the LLM's guess. Suppressed
  // in embed/tenant mode — these hrefs (/collections, /libraries) point
  // off-tenant and would leak past the subdomain lockdown.
  // Also suppressed on a localized surface: the entity titles and descriptions
  // are English editorial copy with no localized map behind them, so the card
  // would be an English block above Spanish results.
  const knownEntity = useMemo(
    () => (embed || localized ? null : matchKnownEntity(query, { collections: collectionsList })),
    [embed, localized, query, collectionsList]
  );

  // Browse mode: fetch books when no query
  const isBrowseMode = !query || query.length < 2;
  const prefetchUsed = useRef(false);
  const performBrowse = useCallback(async () => {
    // Check for prefetched data from homepage (instant load for common views)
    if (!prefetchUsed.current && typeof window !== 'undefined' && offset === 0 && !language && !category && !collection && !library && browseSortBy === 'recent-translation') {
      const prefetch = (window as any).__BROWSE_PREFETCH;
      const prefetchTs = (window as any).__BROWSE_PREFETCH_TS;
      const key = firstTranslation ? 'first_translation' : hasTranslation ? 'has_translation' : null;
      if (key && prefetch?.[key] && prefetchTs && (Date.now() - prefetchTs) < 300_000) {
        prefetchUsed.current = true;
        setBrowseBooks(prefetch[key].books || []);
        setBrowseTotal(prefetch[key].total || 0);
        return;
      }
    }

    setBrowseLoading(true);
    setBrowseError(false);
    try {
      const data = await searchApi.browse({
        language: language || undefined,
        category: category || undefined,
        collection: collection || undefined,
        library: library || undefined,
        sort: browseSortBy,
        limit: resultsPerPage,
        skip: offset,
        first_translation: firstTranslation || undefined,
        has_translation: hasTranslation || undefined,
      });
      setBrowseBooks(data.books || []);
      setBrowseTotal(data.total || 0);
    } catch (err) {
      setBrowseBooks([]);
      setBrowseTotal(0);
      setBrowseError(true);
      reportError({
        message: `Browse API failed: ${err instanceof Error ? err.message : String(err)}`,
        source: 'search_browse',
      });
    } finally {
      setBrowseLoading(false);
    }
  }, [language, category, collection, library, browseSortBy, offset, firstTranslation, hasTranslation, resultsPerPage]);

  useEffect(() => {
    if (isBrowseMode && viewMode !== 'images') {
      performBrowse();
      updateUrl('', viewMode, offset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowseMode, language, category, collection, library, browseSortBy, offset, firstTranslation, hasTranslation, viewMode]);

  // Browse gallery: load images when in browse mode + images tab
  const performBrowseGallery = useCallback(async () => {
    setBrowseImageLoading(true);
    try {
      const data = await galleryApi.list({
        limit: resultsPerPage,
        offset,
        maxPerBook: 2,
      });
      setBrowseImages(data.items || []);
      setBrowseImageTotal(data.total || 0);
    } catch {
      setBrowseImages([]);
      setBrowseImageTotal(0);
    } finally {
      setBrowseImageLoading(false);
    }
  }, [offset, resultsPerPage]);

  useEffect(() => {
    if (isBrowseMode && viewMode === 'images') {
      performBrowseGallery();
      updateUrl('', 'images', offset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowseMode, viewMode, offset, resultsPerPage]);

  // Fuzzy suggestions on zero results
  const totalResults = bookTotal + indexTotal + imageTotal;
  // Don't declare "no results" when the semantic lane errored out — that empty set
  // is a failure, not a fact, and the page would otherwise claim nothing exists.
  const noResults = !signInRequired && query.length >= 2 && !loading && !semanticLoading && !semanticDegraded && !passageLoading && !catalogLoading && totalResults === 0 && semanticResults.length === 0 && passageResults.length === 0 && catalogResults.length === 0;
  useEffect(() => {
    if (!noResults || query.length < 3) { setSuggestion(null); return; }
    let cancelled = false;
    searchApi.suggest(query).then(data => {
      if (!cancelled) setSuggestion(data.suggestions?.[0] || null);
    }).catch(() => { if (!cancelled) setSuggestion(null); });
    return () => { cancelled = true; };
  }, [noResults, query]);


  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value.length >= 2) {
      setOffset(0);
    }
    // Clear AI state while typing — AI only fires on Enter
    aiAbortRef.current?.();
    setAiNarration('');
    setAiTerms([]);
    setAiResults([]);
    setAiStreaming(false);
    aiTriggeredForQuery.current = '';
    debouncedSearch(value);
  };

  const handleSearchSubmit = () => {
    if (query.length >= 3) {
      aiTriggeredForQuery.current = query;
      startAiStream(query);
    }
  };

  const drillInto = (mode: ViewMode) => {
    setViewMode(mode);
    setOffset(0);
  };

  const backToUnified = () => {
    setViewMode('unified');
    setOffset(0);
    setShowFilters(false);
  };

  const clearFilters = () => {
    setLanguage(''); setCategory(''); setCollection(''); setDateFrom(''); setDateTo('');
    setHasDoi(false); setHasTranslation(false); setFirstTranslation(false); setLibrary(defaultLibrary || ''); setSortBy('relevance'); setBrowseSortBy('recent-translation'); setOffset(0);
  };
  const hasActiveFilters = language || category || collection || dateFrom || dateTo || hasDoi || hasTranslation || firstTranslation || (library && library !== defaultLibrary) || sortBy !== 'relevance';

  return (
    <div className="bg-cream" lang={lang}>
      {!embed && <SiteHeader variant="light" />}

      {/* Search Bar */}
      <div className="bg-white border-b border-border-light sticky top-0 z-30">
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(); }}
                placeholder={t.searchPlaceholder}
                className="w-full pl-12 pr-4 py-3 border border-border-medium rounded-xl bg-cream/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust/40 text-lg text-primary font-body"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted animate-spin" />
              )}
            </div>
            {!isBrowseMode && viewMode !== 'unified' && (
              <div className="relative flex-shrink-0">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value as any); setOffset(0); }}
                  className="w-full sm:w-auto pl-9 pr-3 py-3 border border-border-medium rounded-xl text-sm text-secondary bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/30 appearance-none cursor-pointer"
                >
                  <option value="relevance">{t.sortRelevance}</option>
                  <option value="date_desc">{t.sortYearNewest}</option>
                  <option value="date_asc">{t.sortYearOldest}</option>
                  <option value="title">{t.sortTitleAz}</option>
                </select>
              </div>
            )}
            {isBrowseMode && (
              <div className="relative flex-shrink-0">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <select
                  value={browseSortBy}
                  onChange={(e) => { setBrowseSortBy(e.target.value); setOffset(0); }}
                  className="w-full sm:w-auto pl-9 pr-3 py-3 border border-border-medium rounded-xl text-sm text-secondary bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/30 appearance-none cursor-pointer"
                >
                  <option value="recent-translation">{t.browseRecentTranslation}</option>
                  <option value="recent">{t.browseRecent}</option>
                  <option value="date_desc">{t.browseOldestFirst}</option>
                  <option value="date_asc">{t.browseNewestFirst}</option>
                  <option value="title-asc">{t.browseTitleAsc}</option>
                  <option value="title-desc">{t.browseTitleDesc}</option>
                </select>
              </div>
            )}
          </div>

          {/* Mode tabs */}
          <div className="mt-3 flex gap-1 border-b border-border-light -mx-4 px-4">
            {(isBrowseMode
              ? [
                { mode: defaultMode, label: t.tabBooks, icon: Book },
                { mode: 'images' as ViewMode, label: t.tabImages, icon: ImageIcon },
              ]
              : localized
                // No "All" and no "Index" on a localized surface: neither lane
                // takes `lang`. See the `localized` note above.
                ? [
                  { mode: 'books' as ViewMode, label: t.tabBooks, icon: Book },
                  { mode: 'images' as ViewMode, label: t.tabImages, icon: ImageIcon },
                ]
                : [
                  { mode: 'unified' as ViewMode, label: t.tabAll, icon: Search },
                  { mode: 'books' as ViewMode, label: t.tabBooks, icon: Book },
                  { mode: 'index' as ViewMode, label: t.tabIndex, icon: Lightbulb },
                  { mode: 'images' as ViewMode, label: t.tabImages, icon: ImageIcon },
                ]
            ).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => { setViewMode(mode); setOffset(0); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${viewMode === mode
                  ? 'border-accent-rust text-accent-rust'
                  : 'border-transparent text-muted hover:text-secondary hover:border-border-medium'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {!isBrowseMode && mode === 'books' && bookTotal > 0 && (localized || viewMode !== 'unified') && (
                  <span className="text-xs text-muted">({nf(bookTotal)})</span>
                )}
                {!isBrowseMode && mode === 'index' && indexTotal > 0 && viewMode !== 'unified' && (
                  <span className="text-xs text-muted">({nf(indexTotal)})</span>
                )}
                {!isBrowseMode && mode === 'images' && imageTotal > 0 && (localized || viewMode !== 'unified') && (
                  <span className="text-xs text-muted">({nf(imageTotal)})</span>
                )}
              </button>
            ))}
          </div>

          {/* Index type filter pills (index drill-down mode) */}
          {viewMode === 'index' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {INDEX_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => { setIndexType(type.value); setOffset(0); }}
                    className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${indexType === type.value
                      ? 'bg-accent-violet/12 text-accent-violet border border-accent-violet/30'
                      : 'bg-warm text-secondary border border-transparent hover:bg-border-light'
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t[type.labelKey] as string}
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter toggle + count badge */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 text-sm text-muted hover:text-secondary transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? '' : '-rotate-90'}`} />
              <Filter className="w-3.5 h-3.5" />
              {t.filters}
              {hasActiveFilters && <span className="w-1.5 h-1.5 bg-accent-rust rounded-full" />}
            </button>
          </div>

          {/* Filter panel — inline on desktop, bottom sheet on mobile */}
          {showFilters && (
            <>
              {/* Mobile: backdrop + bottom sheet */}
              <div className="md:hidden fixed inset-0 bg-black/30 z-40" onClick={() => setShowFilters(false)} />
              <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
                <div className="sticky top-0 bg-white border-b border-border-light px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-primary">{t.filters}</span>
                  <div className="flex items-center gap-3">
                    {hasActiveFilters && (
                      <button onClick={clearFilters} className="text-sm text-muted hover:text-primary flex items-center gap-1">
                        <X className="w-3.5 h-3.5" /> {t.clear}
                      </button>
                    )}
                    <button onClick={() => setShowFilters(false)} className="text-sm font-medium text-accent-rust">
                      {t.done}
                    </button>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterLanguage}</label>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterSubject}</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterCollection}</label>
                    <select value={collection} onChange={(e) => { setCollection(e.target.value); setOffset(0); }}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      <option value="">{t.allCollections}</option>
                      {collectionsList.map((c) => (
                        <option key={c.slug} value={c.slug}>{localizedCollection(c, lang).name} ({nf(c.book_count)})</option>
                      ))}
                    </select>
                  </div>
                  {!defaultLibrary && !embed && (
                    <div>
                      <label className="block text-sm text-secondary mb-1">{t.filterLibrary}</label>
                      <select value={library} onChange={(e) => setLibrary(e.target.value)}
                        className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                        <option value="">{t.allLibraries}</option>
                        {Object.values(LIBRARY_PARTNERS).map((p) => (
                          <option key={p.providerKey} value={p.providerKey}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterPublishedAfter}</label>
                    <input type="text" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      placeholder={t.yearFromPlaceholder} className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterPublishedBefore}</label>
                    <input type="text" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                      placeholder={t.yearToPlaceholder} className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasTranslation} onChange={(e) => setHasTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> {t.hasTranslation}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={firstTranslation} onChange={(e) => setFirstTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-gold focus:ring-accent-gold/30" /> {t.firstTranslation}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasDoi} onChange={(e) => setHasDoi(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> {t.hasDoi}
                    </label>
                  </div>
                </div>
              </div>

              {/* Desktop: inline panel */}
              <div className="hidden md:block mt-3 p-4 bg-warm rounded-xl border border-border-light relative z-20">
                <div className="flex items-center justify-between mb-3">
                  {hasActiveFilters && (
                    <button onClick={clearFilters} className="text-sm text-muted hover:text-primary flex items-center gap-1 ml-auto">
                      <X className="w-4 h-4" /> {t.clearAll}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterLanguage}</label>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterSubject}</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterCollection}</label>
                    <select value={collection} onChange={(e) => { setCollection(e.target.value); setOffset(0); }}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      <option value="">{t.allCollections}</option>
                      {collectionsList.map((c) => (
                        <option key={c.slug} value={c.slug}>{localizedCollection(c, lang).name} ({nf(c.book_count)})</option>
                      ))}
                    </select>
                  </div>
                  {!defaultLibrary && !embed && (
                    <div>
                      <label className="block text-sm text-secondary mb-1">{t.filterLibrary}</label>
                      <select value={library} onChange={(e) => setLibrary(e.target.value)}
                        className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                        <option value="">{t.allLibraries}</option>
                        {Object.values(LIBRARY_PARTNERS).map((p) => (
                          <option key={p.providerKey} value={p.providerKey}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterPublishedAfter}</label>
                    <input type="text" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      placeholder={t.yearFromPlaceholder} className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">{t.filterPublishedBefore}</label>
                    <input type="text" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                      placeholder={t.yearToPlaceholder} className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div className="flex flex-col gap-2 justify-end">
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasTranslation} onChange={(e) => setHasTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> {t.hasTranslation}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={firstTranslation} onChange={(e) => setFirstTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-gold focus:ring-accent-gold/30" /> {t.firstTranslation}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasDoi} onChange={(e) => setHasDoi(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> {t.hasDoi}
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Results */}
      <main className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-8">
        {/* Anonymous free-search wall — shown after 5 searches/hour */}
        {signInRequired && (
          <div className="text-center py-16 max-w-lg mx-auto">
            <Search className="w-16 h-16 text-border-medium mx-auto mb-4" />
            <h2 className="text-2xl font-serif font-medium text-primary mb-2">{t.signInHeading}</h2>
            <p className="text-secondary mb-6">{t.signInBody}</p>
            <Link href={`${lp('/auth/signin')}?callbackUrl=${lp('/search')}&reason=limit`}
              className="inline-block px-6 py-3 rounded-xl bg-accent-rust text-white font-medium hover:bg-accent-rust/90 transition-colors">
              {t.signInCta}
            </Link>
          </div>
        )}
        {/* Browse gallery — shown when no query + images tab */}
        {isBrowseMode && viewMode === 'images' && (
          <div>
            <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
              {!browseImageLoading && browseImageTotal > 0 && (
                <div className="text-muted">
                  {t.imagesCount(nf(browseImageTotal))}
                  {browseImageTotal > resultsPerPage && (
                    <span className="ml-2 text-faint">
                      {t.showingRange(offset + 1, Math.min(offset + resultsPerPage, browseImageTotal))}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span>{t.show}</span>
                  <select
                    value={resultsPerPage}
                    onChange={(e) => { setResultsPerPage(Number(e.target.value)); setOffset(0); }}
                    className="px-2 py-1 border border-border-medium rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                  >
                    {RESULTS_PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span>{t.perPage}</span>
                </div>
              </div>
            </div>

            {browseImageLoading && <div className="py-8"><BookLoader size="xs" /></div>}

            {!browseImageLoading && browseImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {browseImages.map((item, idx) => (
                  <ImageResultCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} query="" large tenant={tenant} />
                ))}
              </div>
            )}

            {!browseImageLoading && browseImages.length === 0 && (
              <div className="text-center py-16">
                <ImageIcon className="w-16 h-16 text-border-medium mx-auto mb-4" />
                <h2 className="text-2xl font-serif font-medium text-primary mb-2">{t.noImagesFound}</h2>
                <p className="text-base text-muted">{t.noImagesBody}</p>
              </div>
            )}

            <Pagination total={browseImageTotal} offset={offset} setOffset={setOffset} loading={browseImageLoading} pageSize={resultsPerPage} />
          </div>
        )}

        {/* Browse mode — shown when no query + books tab */}
        {isBrowseMode && viewMode !== 'images' && (
          <div>
            {/* Collection pills — truncated on mobile.
                Collections are SL-global content; hidden in embed mode to
                avoid cross-tenant leak on bph.sourcelibrary.org etc. */}
            {!embed && collectionsList.length > 0 && (() => {
              const visibleCollections = showAllCollections
                ? collectionsList
                : collectionsList.slice(0, MOBILE_COLLECTION_LIMIT);
              const hasMore = collectionsList.length > MOBILE_COLLECTION_LIMIT;
              return (
                <div className="flex flex-wrap gap-2 mb-6">
                  <button
                    onClick={() => { setCollection(''); setOffset(0); }}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${!collection
                      ? 'bg-accent-rust text-white'
                      : 'bg-warm text-secondary hover:bg-accent-rust/10 hover:text-accent-rust border border-border-light'
                      }`}
                  >
                    {t.allBooks}
                    {!collection && browseTotal > 0 && (
                      <span className="ml-1.5 text-white/80">({nf(browseTotal)})</span>
                    )}
                  </button>
                  {/* Show all on desktop, truncated on mobile */}
                  {collectionsList.map((col, idx) => (
                    <button
                      key={col.slug}
                      onClick={() => { setCollection(col.slug); setOffset(0); }}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${!showAllCollections && idx >= MOBILE_COLLECTION_LIMIT ? 'hidden sm:inline-flex' : ''
                        } ${collection === col.slug
                          ? 'bg-accent-rust text-white'
                          : 'bg-warm text-secondary hover:bg-accent-rust/10 hover:text-accent-rust border border-border-light'
                        }`}
                    >
                      {localizedCollection(col, lang).name}
                      <span className={`ml-1.5 ${collection === col.slug ? 'text-white/80' : 'text-muted'}`}>
                        ({nf(col.book_count)})
                      </span>
                    </button>
                  ))}
                  {hasMore && !showAllCollections && (
                    <button
                      onClick={() => setShowAllCollections(true)}
                      className="sm:hidden px-4 py-2 rounded-full text-sm font-medium bg-warm text-muted border border-border-light hover:text-secondary transition-colors"
                    >
                      {t.andNMore(collectionsList.length - MOBILE_COLLECTION_LIMIT)}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Results count + per-page selector */}
            {!browseLoading && browseTotal > 0 && (
              <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                <div className="text-muted">
                  {t.booksCount(nf(browseTotal))}
                  {collection && collectionsList.find(c => c.slug === collection) && (
                    <span> {t.inCollection} <span className="font-medium text-primary">{localizedCollection(collectionsList.find(c => c.slug === collection)!, lang).name}</span></span>
                  )}
                  {browseTotal > resultsPerPage && (
                    <span className="ml-2 text-faint">
                      {t.showingRange(offset + 1, Math.min(offset + resultsPerPage, browseTotal))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <span>{t.show}</span>
                    <select
                      value={resultsPerPage}
                      onChange={(e) => { setResultsPerPage(Number(e.target.value)); setOffset(0); }}
                      className="px-2 py-1 border border-border-medium rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                    >
                      {RESULTS_PER_PAGE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span>{t.perPage}</span>
                  </div>
                  {/* /catalog has no localized twin; localePath returns it
                      untouched, which is the honest outcome (i18n.md rule 5). */}
                  <Link href={lp('/catalog')} className="text-sm text-accent-rust hover:underline">
                    {t.browseFullCatalog}
                  </Link>
                </div>
              </div>
            )}

            {browseLoading && <div className="py-8"><BookLoader size="xs" /></div>}

            {/* Book grid */}
            {!browseLoading && browseBooks.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {browseBooks.map((book, idx) => (
                  <CollectionBookCard key={book.id} book={book as unknown as CollectionBook} priority={idx < 5} lang={lang} />
                ))}
              </div>
            )}

            {!browseLoading && browseError && (
              <div className="text-center py-16">
                <Book className="w-16 h-16 text-border-medium mx-auto mb-4" />
                <h2 className="text-2xl font-serif font-medium text-primary mb-2">{t.somethingWentWrong}</h2>
                <p className="text-base text-muted mb-4">{t.couldNotLoadLibrary}</p>
                <button
                  onClick={() => performBrowse()}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
                >
                  {t.tryAgain}
                </button>
              </div>
            )}

            {!browseLoading && !browseError && browseBooks.length === 0 && browseTotal === 0 && (
              <div className="text-center py-16">
                <Book className="w-16 h-16 text-border-medium mx-auto mb-4" />
                <h2 className="text-2xl font-serif font-medium text-primary mb-2">{t.noBooksFound}</h2>
                <p className="text-base text-muted">{t.adjustFilters}</p>
              </div>
            )}

            <Pagination total={browseTotal} offset={offset} setOffset={setOffset} loading={browseLoading} pageSize={resultsPerPage} />
          </div>
        )}

        {/* Known-entity capture (#2790): direct entry for a query that names a
            place in the library (reading room / collection / library partner). */}
        {knownEntity && query.length >= 2 && (
          <Link
            href={knownEntity.href}
            className="group flex items-center gap-3 mb-6 px-4 py-3 bg-warm rounded-lg border border-border-light hover:border-accent-rust/40 transition-colors"
          >
            <span className="text-2xl shrink-0" aria-hidden>{knownEntity.icon || '📚'}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-muted">
                {knownEntity.kind === 'reading-room' ? t.kindReadingRoom : knownEntity.kind === 'library' ? t.kindLibrary : t.kindCollection}
              </div>
              <div className="font-serif font-medium text-primary group-hover:text-accent-rust transition-colors">
                {knownEntity.title} <span aria-hidden>→</span>
              </div>
              <p className="text-sm text-muted line-clamp-2">{knownEntity.description}</p>
            </div>
          </Link>
        )}

        {/* Loading */}
        {query.length >= 2 && loading && viewMode === 'unified' && (
          <div className="py-8"><BookLoader size="xs" /></div>
        )}

        {/* AI narration — only for non-unified views, or unified while still loading (unified view has its own block once results render) */}
        {query.length >= 3 && (aiStreaming || aiNarration) && (viewMode !== 'unified' || loading) && (
          <div className="mb-6 px-4 py-3 bg-warm rounded-lg border border-border-light">
            <p className="text-sm text-secondary italic leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: aiNarration
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                  + (aiStreaming ? '<span class="inline-block w-1.5 h-4 bg-accent-rust/40 animate-pulse ml-0.5 align-text-bottom"></span>' : '')
              }}
            />
            {aiTerms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {aiTerms.map(term => (
                  <button
                    key={term}
                    onClick={() => runSearchForTerm(term)}
                    className="px-2.5 py-1 bg-white/60 text-secondary text-xs rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No results */}
        {noResults && !aiStreaming && aiResults.length === 0 && (
          <div className="text-center py-16 max-w-lg mx-auto">
            <Search className="w-16 h-16 text-border-medium mx-auto mb-4" />
            <h2 className="text-2xl font-serif font-medium text-primary mb-2">{t.noResultsFound}</h2>
            {suggestion && (
              <p className="text-secondary mb-6">
                {t.didYouMean}{' '}
                <button
                  onClick={() => { setQuery(suggestion); setOffset(0); performSearch(suggestion, viewMode, 0); updateUrl(suggestion, viewMode, 0); }}
                  className="font-semibold text-accent-rust hover:text-accent-rust/80 underline underline-offset-2"
                >{suggestion}</button>?
              </p>
            )}
            <p className="text-muted mb-6">{t.corpusBlurb}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLE_QUERIES[lang].map(term => (
                <button
                  key={term}
                  onClick={() => { setQuery(term); setOffset(0); performSearch(term, viewMode, 0); updateUrl(term, viewMode, 0); }}
                  className="px-3 py-1.5 bg-warm text-secondary text-sm rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
                >
                  {term}
                </button>
              ))}
              <button
                onClick={() => { setQuery(''); setOffset(0); }}
                className="px-3 py-1.5 bg-warm text-secondary text-sm rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
              >
                {t.browseAllBooks}
              </button>
            </div>
          </div>
        )}

        {/* AI-expanded results when no main results */}
        {noResults && aiResults.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t.relatedFromAi}</p>
            {aiResults.map(result => (
              <RelatedResultCard key={result.id} result={result} tenant={tenant} />
            ))}
          </div>
        )}

        {/* ==================== UNIFIED VIEW — ADAPTIVE LAYOUT ==================== */}
        {!signInRequired && viewMode === 'unified' && !loading && query.length >= 2 && (totalResults > 0 || semanticResults.length > 0 || semanticLoading || passageResults.length > 0 || passageLoading || catalogResults.length > 0 || catalogLoading) && (() => {
          // Dedup the conceptual lane against the keyword lane at the WORK
          // grain, not just by book id (#4300). The two lanes are fetched
          // independently (unified + /api/search/semantic), so each collapses
          // its own copies server-side and neither can see the other's — a
          // second scan of an already-listed work would otherwise take a slot
          // on the first screen, which is the complaint this fixes. Both lanes
          // now return `work_id`; rows without one are never merged, because an
          // unkeyed book is not shown to be an edition of anything.
          const keywordIds = new Set(bookResults.map(b => b.id || (b as any).book_id));
          const keywordWorkIds = new Set(bookResults.map(b => b.work_id).filter(Boolean));
          const uniqueSemantic = semanticResults.filter((sem: any) =>
            !keywordIds.has(sem.book_id) && !(sem.work_id && keywordWorkIds.has(sem.work_id)));
          const hasBoth = bookResults.length > 0 && uniqueSemantic.length > 0;

          // Shared components
          const narrationBlock = query.length >= 3 && (aiStreaming || aiNarration || aiNarrationHistory.length > 0) && (
            <div className="px-4 py-3 bg-warm/60 rounded-lg border border-border-light space-y-2">
              {aiNarrationHistory.map((entry, i) => (
                <div key={i} className="text-sm text-secondary/70 italic leading-relaxed border-b border-border-light pb-2">
                  <span className="text-xs text-muted not-italic font-medium">{entry.query}:</span>{' '}
                  <span dangerouslySetInnerHTML={{
                    __html: entry.text
                      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                  }} />
                </div>
              ))}
              {(aiStreaming || aiNarration) && (
                <p className="text-sm text-secondary italic leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: aiNarration
                      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                      + (aiStreaming ? '<span class="inline-block w-1.5 h-4 bg-accent-rust/40 animate-pulse ml-0.5 align-text-bottom"></span>' : '')
                  }}
                />
              )}
              {aiTerms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {aiTerms.map(term => (
                    <button
                      key={term}
                      onClick={() => runSearchForTerm(term)}
                      className="px-2.5 py-1 bg-white/60 text-secondary text-xs rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );

          const imageStrip = imageResults.length > 0 && (
            <>
              {displayHint !== 'images_first' && (
                <h2 className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-2 mt-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-gold" />
                  {t.illustrations}
                </h2>
              )}
              <div className={`grid gap-3 ${displayHint === 'images_first' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 md:grid-cols-6'}`}>
                {imageResults.slice(0, displayHint === 'images_first' ? 8 : PREVIEW_IMAGES).map((item, idx) => (
                  <ImageResultCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} query={query} large={displayHint === 'images_first'} />
                ))}
              </div>
              {imageTotal > PREVIEW_IMAGES && (
                <button onClick={() => drillInto('images')} className="text-sm text-accent-gold-dark hover:text-accent-gold font-medium transition-colors flex items-center gap-1">
                  {t.seeAllImages} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          );

          const bookSection = (
            <>
              {semanticDegraded && !semanticLoading && (
                <p className="text-xs text-muted italic mt-2">{t.semanticDegraded}</p>
              )}
              {hasBoth && (
                <h2 className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-2 mt-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  {t.conceptualMatches}
                </h2>
              )}
              {uniqueSemantic.map((sem: any) => (
                <SemanticResultCard key={sem.book_id} result={sem} query={query} />
              ))}
              {hasBoth && (
                <h2 className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-2 mt-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-rust" />
                  {t.textMatches}
                </h2>
              )}
              {bookResults.slice(0, PREVIEW_BOOKS).map((result, idx) => (
                <BookResultCard key={result.id} result={result} query={query} tenant={tenant} autoPassages={idx === 0} mobileCompact />
              ))}
              {bookTotal > PREVIEW_BOOKS && (
                <button onClick={() => drillInto('books')} className="text-sm text-accent-rust hover:text-accent-rust-dark font-medium transition-colors flex items-center gap-1">
                  {t.seeAllResults(nf(bookTotal))} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          );

          const passageSection = (passageResults.length > 0 || passageLoading) && (
            <>
              <h2 className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-2 mt-6">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-sage" />
                {t.passages}
              </h2>
              {passageLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.searchingPageContent}
                </div>
              ) : (
                passageResults.map((result, idx) => (
                  <BookResultCard key={result.id} result={result} query={query} tenant={tenant} autoPassages={idx === 0} mobileCompact />
                ))
              )}
            </>
          );

          // Collections are SL-global (cross-tenant) content. In embed mode
          // (BPH iframe etc.) they would be a cross-tenant leak — hide.
          const collectionCards = !embed && collectionResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {collectionResults.map(col => (
                <SearchCollectionCard key={col.slug} col={col} />
              ))}
            </div>
          );

          // Catalog matches: bibliographic-only entries from the BPH catalog
          // (works that exist on the shelf but aren't yet digitized). Shown as
          // a compact list — the catalog page is the destination for power use.
          const bookResultIds = new Set(bookResults.map(b => b.id || b.book_id).filter(Boolean));
          const catalogSection = (catalogResults.length > 0 || catalogLoading) && (
            <>
              <h2 className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-2 mt-6">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-gold" />
                {t.catalogMatches}
                {catalogTotal > 0 && (
                  <span className="ml-1 text-muted/70 normal-case">
                    · {nf(catalogTotal)} {t.works(catalogTotal)}
                  </span>
                )}
              </h2>
              {catalogLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.searchingCatalog}
                </div>
              ) : (
                <>
                  {catalogResults.slice(0, 5).map(work => (
                    <BphCatalogResultCard
                      key={work.ubn || work.uuid}
                      work={work}
                      query={query}
                      tenant={tenant}
                      digitizedAlsoInBooks={!!work.sl_book_id && bookResultIds.has(work.sl_book_id)}
                    />
                  ))}
                  {catalogTotal > 5 && (
                    <Link
                      href={`${lp('/catalog')}?cq=${encodeURIComponent(query)}`}
                      className="text-sm text-accent-gold-dark hover:text-accent-gold font-medium transition-colors flex items-center gap-1"
                    >
                      {t.openAllCatalogueMatches(nf(catalogTotal))} <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </>
              )}
            </>
          );

          // Honest weak-match banner (#4281): the lanes found only partial-word
          // matches ("Rainer" alone, "Maria" alone). Say so before showing them,
          // instead of presenting token noise as an answer. The unified flag is
          // metadata-only, so a page-content passage that covers every word
          // (quoted-phrase queries) overrides it — and while passages are still
          // loading we stay quiet rather than flash a claim we may retract.
          const passagesCover = assessMatchQuality(
            query,
            passageResults.map(r => [r.title, r.display_title, r.author, r.snippet].filter(Boolean).join(' ')),
          ) === 'strong';
          const weakMatchBanner = matchQuality === 'weak' && !passageLoading && !passagesCover && (
            <div className="px-4 py-3 rounded-lg border border-border-light bg-warm/60">
              <p className="text-sm font-medium text-primary">{t.weakMatchTitle(query)}</p>
              <p className="text-sm text-secondary mt-0.5">{t.weakMatchBody}</p>
            </div>
          );

          return (
            <div className="space-y-3">
              {weakMatchBanner}
              {passageSection}
              {collectionCards}
              {narrationBlock}
              {displayHint === 'images_first' ? (
                <>
                  {imageStrip}
                  {bookSection}
                  {catalogSection}
                </>
              ) : displayHint === 'not_in_collection' ? (
                <>
                  {bookSection}
                  {catalogSection}
                  {imageStrip}
                </>
              ) : (
                <>
                  {bookSection}
                  {catalogSection}
                  {imageStrip}
                </>
              )}
            </div>
          );
        })()}

        {/* ==================== BOOKS DRILL-DOWN ==================== */}
        {viewMode === 'books' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
                <div className="text-muted">
                  {t.foundBooksAndPages(nf(bookTotal), query)}
                  {bookTotal > resultsPerPage && (
                    <span className="ml-2 text-faint">
                      {t.showingRange(offset + 1, Math.min(offset + resultsPerPage, bookTotal))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span>{t.show}</span>
                  <select
                    value={resultsPerPage}
                    onChange={(e) => { setResultsPerPage(Number(e.target.value)); setOffset(0); }}
                    className="px-2 py-1 border border-border-medium rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                  >
                    {RESULTS_PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span>{t.perPage}</span>
                </div>
              </div>
            )}
            {loading && <div className="py-4"><BookLoader size="xs" /></div>}
            <div className="space-y-3">
              {bookResults.map((result) => (
                <BookResultCard key={result.id} result={result} query={query} tenant={tenant} />
              ))}
            </div>
            <Pagination total={bookTotal} offset={offset} setOffset={setOffset} loading={loading} pageSize={resultsPerPage} />
          </>
        )}

        {/* ==================== INDEX DRILL-DOWN ==================== */}
        {viewMode === 'index' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 text-muted">
                {t.foundIndexEntries(nf(indexTotal), query)}
              </div>
            )}
            {loading && <div className="py-4"><BookLoader size="xs" /></div>}
            <div className="space-y-3">
              {indexResults.map((result, idx) => (
                <IndexResultCard key={`${result.book_id}-${result.type}-${idx}`} result={result} query={query} tenant={tenant} />
              ))}
            </div>
          </>
        )}

        {/* ==================== IMAGES DRILL-DOWN ==================== */}
        {viewMode === 'images' && query.length >= 2 && (
          <>
            {/* The gallery lane matches against English illustration
                descriptions, so on a localized surface say so rather than let a
                Spanish query look like an empty library (i18n.md rule 4). */}
            {localized && t.imagesEnglishNote && (
              <p className="mb-4 px-4 py-3 bg-warm rounded-lg border border-border-light text-sm text-secondary">
                {t.imagesEnglishNote}
              </p>
            )}
            {!loading && (
              <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
                <div className="text-muted">
                  {t.foundImages(nf(imageTotal), query)}
                  {imageTotal > resultsPerPage && (
                    <span className="ml-2 text-faint">
                      {t.showingRange(offset + 1, Math.min(offset + resultsPerPage, imageTotal))}
                    </span>
                  )}
                </div>
              </div>
            )}
            {loading && <div className="py-4"><BookLoader size="xs" /></div>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {imageResults.map((item, idx) => (
                <ImageResultCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} query={query} large tenant={tenant} />
              ))}
            </div>
            <Pagination total={imageTotal} offset={offset} setOffset={setOffset} loading={loading} pageSize={resultsPerPage} />
          </>
        )}
        {/* Ask the Librarian — bottom CTA */}
        {!noResults && !loading && query.length >= 3 && viewMode === defaultMode && (
          <section className="mt-8 pt-6 border-t border-border-light">
            <Link
              href={`${lp('/librarian')}?q=${encodeURIComponent(query)}`}
              className="block p-6 rounded-xl bg-gradient-to-br from-[#2c1810] to-[#1a1612] text-white hover:from-[#3a2218] hover:to-[#2c1810] transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:bg-white/15 transition-colors">
                  <Quote className="w-5 h-5 text-[#c9a86c]" />
                </div>
                <div>
                  <h3 className="font-serif text-lg font-medium text-white">{t.askLibrarian}</h3>
                  <p className="text-sm text-white/60 mt-1 font-body leading-relaxed">
                    {t.askLibrarianBody(bookTotal > 0 ? t.askLibrarianScopeResults(nf(bookTotal)) : t.askLibrarianScopeCollection)}
                  </p>
                </div>
              </div>
            </Link>
          </section>
        )}

        {/* AI-expanded related results — shows for all searches with results */}
        {!signInRequired && !noResults && !loading && query.length >= 3 && !aiStreaming && aiResults.length > 0 && (
          <section className="mt-12 pt-8 border-t border-border-light">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">{t.relatedInLibrary}</h2>
            <div className="space-y-3">
              {aiResults.map(result => (
                <RelatedResultCard key={result.id} result={result} tenant={tenant} />
              ))}
            </div>
          </section>
        )}
      </main>

    </div>
  );
}

// ==================== RESULT CARDS ====================

interface PassageMatch {
  pageNumber: number;
  snippet: string;
  field: string;
}

function cleanSnippet(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')                    // strip XML/HTML tags
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // strip markdown bold
    .replace(/original:\s*\*[^*]*\*/g, '')      // strip "original: *Latin*" annotations
    .replace(/<-|->|#{1,6}\s*/g, '')            // strip markdown/layout markers
    .replace(/\|[\s:_-]+\|/g, ' ')             // strip markdown table separators
    .replace(/\|/g, ' ')                        // strip remaining pipe chars
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim();
}

/**
 * "N editions & copies of this work →" (#4300).
 *
 * Rendered under a result that STANDS IN for siblings the work-grain collapse
 * removed — four scans of Kircher's Musurgia now occupy one row, and this is
 * the affordance that says so instead of the library silently dropping three.
 * The count comes from the API, which reads it off the same filter `/work/[id]`
 * renders its edition list from, so the number always describes the page this
 * link opens (visibility-and-stats.md). Absent under a tenant context, by
 * construction — the API does not send it there.
 *
 * Sits OUTSIDE the card's own <Link>: a nested anchor is invalid HTML and the
 * inner one would swallow the click.
 */
function WorkEditionsLink({ group }: { group: NonNullable<SearchResult['work_group']> }) {
  const t = SEARCH_STRINGS[useLocale()];
  const lp = useLocalePath();
  return (
    <div className="px-4 pb-3 -mt-1">
      <Link
        href={lp(group.href)}
        className="inline-flex items-center gap-1 text-xs text-accent-gold-dark hover:text-accent-gold font-medium transition-colors"
      >
        <Library className="w-3.5 h-3.5" aria-hidden />
        {t.workEditionsLink(group.editions)}
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

function BookResultCard({ result, query, tenant, autoPassages, mobileCompact }: { result: SearchResult; query: string; tenant?: string; autoPassages?: boolean; mobileCompact?: boolean }) {
  // Client children take no `lang` prop — the pathname already says which
  // language they are in (i18n.md, "the book page: ONE page, two URLs").
  const lang = useLocale();
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const cover = getBookThumbnailUrl({ thumbnail: result.thumbnail, thumbnail_blob: (result as any).thumbnail_blob });
  const text = cleanSnippet(result.snippet || result.summary || '');
  const [imgError, setImgError] = useState(false);
  const [passages, setPassages] = useState<PassageMatch[] | null>(null);
  const [passagesLoading, setPassagesLoading] = useState(false);
  const [passagesOpen, setPassagesOpen] = useState(false);
  const bookPath = lp(`/book/${result.slug || result.book_id}`);
  const autoFired = useRef(false);

  const fetchPassages = useCallback(async () => {
    if (passages) return;
    setPassagesLoading(true);
    setPassagesOpen(true);
    try {
      // In-book search reads the language-keyed page store, same as the
      // result lane above it — otherwise the card quotes English passages
      // under a Spanish snippet.
      const res = await fetch(`/api/books/${result.book_id}/search?q=${encodeURIComponent(query)}&lang=${lang}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      const matches: PassageMatch[] = (data.results || [])
        .slice(0, 5)
        .map((r: any) => {
          const best = r.matches?.find((m: any) => m.field === 'translation') || r.matches?.[0];
          return {
            pageNumber: r.pageNumber,
            snippet: cleanSnippet(best?.snippet || ''),
            field: best?.field || 'ocr',
          };
        })
        .filter((m: PassageMatch) => m.snippet.length > 20);
      setPassages(matches);
    } catch {
      setPassages([]);
    } finally {
      setPassagesLoading(false);
    }
  }, [result.book_id, query, passages, lang]);

  // Auto-fetch passages for first translated book (desktop only — too tall on mobile)
  const isMobileView = typeof window !== 'undefined' && window.innerWidth < 640;
  useEffect(() => {
    if (autoPassages && !autoFired.current && result.translated_count && result.translated_count > 0 && !isMobileView) {
      autoFired.current = true;
      fetchPassages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPassages, result.translated_count, fetchPassages]);

  const findPassages = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (passages) {
      setPassagesOpen(!passagesOpen);
      return;
    }
    fetchPassages();
  }, [passages, passagesOpen, fetchPassages]);

  const href = lp(result.type === 'page'
    ? tenantBookUrl({ slug: result.slug, id: result.book_id }, tenant) + `/page-number/${result.page_number}`
    : tenantBookUrl({ slug: result.slug, id: result.book_id }, tenant));

  return (
    <div className="bg-white rounded-xl border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all">
      <Link href={href} className={`block ${mobileCompact ? 'p-3 sm:p-4' : 'p-4'}`}>
        <div className="flex items-start gap-3 sm:gap-4">
          {cover && !imgError ? (
            <Image
              src={cover}
              alt=""
              width={60}
              height={84}
              className={`rounded shadow-sm flex-shrink-0 object-cover ${mobileCompact ? 'w-[44px] h-[62px] sm:w-[60px] sm:h-[84px]' : ''}`}
              onError={() => setImgError(true)}
              unoptimized
            />
          ) : (
            <div className={`rounded bg-warm flex items-center justify-center flex-shrink-0 ${mobileCompact ? 'w-[44px] h-[62px] sm:w-[60px] sm:h-[84px]' : 'w-[60px] h-[84px]'}`}>
              <Book className="w-6 h-6 text-border-medium" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-medium text-primary line-clamp-2 font-serif leading-snug">
                  <HighlightedText text={result.display_title || result.title} query={query} />
                  {result.type === 'page' && <span className="text-muted font-normal text-sm ml-2">{t.pageAbbrev(result.page_number as number)}</span>}
                </h3>
                <p className="text-sm text-secondary mt-0.5">
                  {(() => {
                    const byline = getEffectiveByline(result);
                    if (byline.role === 'editor') {
                      return <>{t.editedByAbbrev} <HighlightedText text={byline.editor} query={query} /></>;
                    }
                    return <HighlightedText text={result.author} query={query} />;
                  })()} · {result.published}
                </p>
              </div>
              {result.has_doi && result.doi && (
                <a href={`https://doi.org/${result.doi}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-2 py-1 bg-accent-sage/15 text-accent-sage-dark rounded text-xs font-medium hover:bg-accent-sage/25 flex-shrink-0">
                  DOI <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {text ? (
              <p className={`mt-1.5 text-sm text-secondary font-body leading-relaxed ${mobileCompact ? 'line-clamp-1 sm:line-clamp-2' : 'line-clamp-2'}`}>
                <HighlightedText text={text} query={query} />
              </p>
            ) : result.categories && result.categories.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {result.categories.slice(0, mobileCompact ? 2 : 4).map((cat: string) => (
                  <span key={cat} className="text-xs px-2 py-0.5 bg-warm text-muted rounded-full">{cat}</span>
                ))}
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
              {result.type === 'book' && result.page_count && (
                <span>{t.pagesCount(result.page_count)}{result.translated_count ? ` · ${t.translatedCount(result.translated_count)}` : ''}</span>
              )}
              {result.type === 'book' && result.translated_count && result.translated_count > 0 && (
                <button
                  onClick={findPassages}
                  className="text-accent-rust hover:text-accent-rust-dark font-medium transition-colors"
                >
                  {passagesLoading ? (
                    <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {t.searchingEllipsis}</span>
                  ) : passagesOpen ? (
                    <span className="flex items-center gap-1"><ChevronDown className="w-3 h-3 rotate-180 transition-transform" /> {t.hidePassages}</span>
                  ) : (
                    <span className="flex items-center gap-1"><Quote className="w-3 h-3" /> {t.findPassages}</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </Link>
      {result.work_group && <WorkEditionsLink group={result.work_group} />}
      {passagesOpen && (
        <div className="px-4 pb-4 -mt-1">
          {passagesLoading ? (
            <div className="text-xs text-muted py-2">{t.searchingPages}</div>
          ) : passages && passages.length > 0 ? (
            <div className="space-y-2 border-t border-border-light pt-3">
              {passages.map((p, i) => (
                <Link
                  key={i}
                  href={`${bookPath}/page-number/${p.pageNumber}`}
                  className="block text-sm py-1.5 px-3 rounded-lg hover:bg-warm transition-colors group"
                >
                  <span className="text-muted text-xs font-medium mr-2">{t.pageAbbrev(p.pageNumber)}</span>
                  <span className="text-secondary italic font-body">
                    &ldquo;<HighlightedText text={p.snippet.slice(0, 200)} query={query} />{p.snippet.length > 200 ? '...' : ''}&rdquo;
                  </span>
                </Link>
              ))}
            </div>
          ) : passages ? (
            <p className="text-xs text-muted py-2 border-t border-border-light pt-3">{t.noMatchingPassages}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SearchCollectionCard({ col }: { col: { slug: string; name: string; book_count: number; hero_image?: string } }) {
  const lang = useLocale();
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const [imgError, setImgError] = useState(false);
  return (
    <Link
      href={lp(`/collections/${col.slug}`)}
      className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
    >
      {col.hero_image && !imgError ? (
        <Image
          src={col.hero_image}
          alt={t.illustrationFromCollection(col.name)}
          fill
          sizes="(max-width: 640px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          unoptimized
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3">
        <p className="text-white/50 text-[11px] mb-1">
          {t.collectionBooks(col.book_count.toLocaleString(t.numberLocale))}
        </p>
        <h3 className="font-serif text-sm sm:text-base text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h3>
      </div>
    </Link>
  );
}

function SemanticResultCard({ result, query }: { result: any; query: string }) {
  const lang = useLocale();
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const cover = getBookThumbnailUrl({ thumbnail: result.thumbnail, thumbnail_blob: result.thumbnail_blob });
  const [imgError, setImgError] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all">
      <Link href={lp(`/book/${result.slug || result.book_id}`)} className="block p-3 sm:p-4">
        <div className="flex items-start gap-3 sm:gap-4">
          {cover && !imgError ? (
            <Image src={cover} alt="" width={60} height={84} className="rounded shadow-sm flex-shrink-0 object-cover w-[44px] h-[62px] sm:w-[60px] sm:h-[84px]" unoptimized onError={() => setImgError(true)} />
          ) : (
            <div className="w-[44px] h-[62px] sm:w-[60px] sm:h-[84px] rounded bg-warm flex items-center justify-center flex-shrink-0">
              <Book className="w-6 h-6 text-border-medium" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-primary font-medium leading-snug">{result.title}</h3>
            <p className="text-sm text-muted mt-0.5">
              {(() => {
                const byline = getEffectiveByline({ author: result.author, editor: (result as { editor?: string }).editor });
                if (byline.role === 'editor') return `${t.editedByAbbrev} ${byline.editor}`;
                return result.author || '';
              })()}{result.year ? ` · ${result.year}` : ''}
              {result.language ? ` · ${result.language}` : ''}
            </p>
            {result.summary_snippet && (
              <p className="text-sm text-secondary mt-1.5 line-clamp-1 sm:line-clamp-2">{result.summary_snippet}</p>
            )}
            {result.relevance_hint && (
              <p className="text-xs text-violet-500 mt-1">{result.relevance_hint}</p>
            )}
          </div>
        </div>
      </Link>
      {result.work_group && <WorkEditionsLink group={result.work_group} />}
    </div>
  );
}

function RelatedResultCard({ result, tenant }: { result: SearchResult; tenant?: string }) {
  const lang = useLocale();
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const cover = getBookThumbnailUrl({ thumbnail: result.thumbnail, thumbnail_blob: (result as any).thumbnail_blob });
  const text = result.snippet || result.summary;
  const [imgError, setImgError] = useState(false);
  return (
    <Link
      href={lp(result.type === 'page' ? tenantBookUrl({ slug: result.slug, id: result.book_id }, tenant) + `/page-number/${result.page_number}` : tenantBookUrl({ slug: result.slug, id: result.book_id }, tenant))}
      className="flex items-start gap-3 p-3 bg-warm rounded-lg hover:bg-warm-hover transition-colors"
    >
      {cover && !imgError ? (
        <Image src={cover} alt="" width={48} height={68} className="rounded shadow-sm flex-shrink-0 object-cover" unoptimized onError={() => setImgError(true)} />
      ) : (
        <div className="w-[48px] h-[68px] rounded bg-warm-hover flex items-center justify-center flex-shrink-0">
          <Book className="w-5 h-5 text-border-medium" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="font-serif font-medium text-primary text-sm leading-tight line-clamp-1">
          {result.display_title || result.title}
        </h3>
        <p className="text-xs text-muted mt-0.5">
          {(() => {
            const byline = getEffectiveByline(result);
            if (byline.role === 'editor') return `${t.editedByAbbrev} ${byline.editor}`;
            return result.author || '';
          })()}{result.published ? `, ${result.published}` : ''}
          {result.type === 'page' && result.page_number && <span> &middot; {t.pageAbbrev(result.page_number)}</span>}
        </p>
        {text && (
          <p className="text-xs text-secondary mt-1 line-clamp-2">{text}</p>
        )}
      </div>
    </Link>
  );
}

function IndexResultCard({ result, query, tenant }: { result: IndexSearchResult; query: string; tenant?: string }) {
  const lang = useLocale();
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const typeLabel = indexTypeLabel(result.type, t);
  const isQuote = result.type === 'quote';

  // `/book/<id>/guide` has no localized twin, so localePath returns those two
  // untouched and only the bare book URL picks up the prefix. That asymmetry is
  // the registry working (i18n.md rule 5).
  const href = lp(isQuote && result.quote_page
    ? tenantBookUrl({ slug: result.book_slug, id: result.book_id }, tenant) + `/guide?page=${result.quote_page}`
    : result.pages && result.pages.length > 0
      ? tenantBookUrl({ slug: result.book_slug, id: result.book_id }, tenant) + `/guide?page=${result.pages[0]}`
      : tenantBookUrl({ slug: result.book_slug, id: result.book_id }, tenant));

  return (
    <Link
      href={href}
      className="block bg-white rounded-xl border border-border-light p-4 hover:border-accent-violet/30 hover:shadow-md transition-all"
    >
      <div className="min-w-0">
        <span className={`text-xs px-2 py-0.5 rounded-full ${(SEARCH_TYPE_STYLES[result.type as SearchIndexType] ?? SEARCH_TYPE_STYLES.keyword).badge}`}>{typeLabel}</span>

        {isQuote ? (
          <>
            <blockquote className="font-serif text-lg text-primary italic border-l-2 border-accent-gold/40 pl-3 my-2">
              &ldquo;<HighlightedText text={result.quote_text || ''} query={query} />&rdquo;
            </blockquote>
            {result.quote_significance && (
              <p className="text-sm text-secondary mt-1"><HighlightedText text={result.quote_significance} query={query} /></p>
            )}
          </>
        ) : (
          <h3 className="text-lg font-medium text-primary mt-1 font-serif"><HighlightedText text={result.term} query={query} /></h3>
        )}

        <p className="text-sm text-muted mt-1.5">
          {result.book_title} · {result.book_author}
          {result.pages && result.pages.length > 0 && (
            <span className="ml-1">· p. {result.pages.slice(0, 3).join(', ')}{result.pages.length > 3 && ` +${result.pages.length - 3}`}</span>
          )}
        </p>
      </div>
    </Link>
  );
}

function ImageResultCard({ item, query, large, tenant }: { item: GalleryItem & { isArtwork?: boolean; artworkSlug?: string | null; artworkType?: string | null; holder?: string | null; link?: string | null; aiTerm?: string; visualMatch?: boolean }; query: string; large?: boolean; tenant?: string }) {
  const [imageError, setImageError] = useState(false);
  const t = SEARCH_STRINGS[useLocale()];

  // Provenance chip: images that arrived via LLM term expansion or CLIP
  // similarity are honest neighbors, not matches — say so on the card (#4338).
  const provenance = item.aiTerm
    ? `related · ${item.aiTerm}`
    : item.visualMatch ? 'visual match' : null;

  // The strip mixes two different things and used to render them identically: a
  // standalone artwork held by a museum (links to /artwork/) and a detail cropped
  // out of a book we hold (links to /gallery/image/). The second line was
  // `item.bookTitle` in both cases — a slot meaning "the object's own title" for
  // one and "the book it came from" for the other. Say which: artworks get a
  // medium chip and their holder, illustrations get "from <book> · p. N".
  //
  // Two producers feed this card and they mark an artwork differently: the
  // unified-search artworks lane sets `isArtwork` (+ artworkType/holder), while
  // /api/gallery — which backs the dedicated Images tab — sets `source:'artwork'`
  // and puts the medium in `type` (see artworkToGalleryItem in gallery-merge.ts).
  // Reading only one of them left half the artworks wearing a book card.
  const isArtwork = item.isArtwork === true || item.source === 'artwork';
  const typeChip = isArtwork ? artworkTypeLabel(item.artworkType || item.type) : null;
  const subtitle = isArtwork
    ? (item.holder || item.author || null)
    : (item.bookTitle ? t.imageFromBook(item.bookTitle) : null);
  // A NEGATIVE page_number is a soft-hide marker, not a leaf — "p. -154" is both
  // nonsense to a reader and a leak of an internal flag. Only a positive number
  // is a page you could turn to. Rendered as its own non-shrinking span so a long
  // book title truncates without swallowing the page number with it.
  const pageLabel = !isArtwork && item.pageNumber > 0 ? `p. ${item.pageNumber}` : null;

  // Use pre-generated thumbnail/extracted URL first (publicly accessible),
  // fall back to original imageUrl (crop-image API requires auth and breaks for visitors)
  const displayUrl = item.thumbnailUrl || item.extractedUrl || item.imageUrl;
  const imageHref = tenant
    ? `/${tenant}/gallery/image/${item.pageId}-${item.detectionIndex}`
    : `/gallery/image/${item.pageId}-${item.detectionIndex}`;

  // /api/gallery hands back the canonical URL for a standalone artwork in `link`;
  // prefer it. Without this the Images tab built `/gallery/image/artwork-<id>`
  // from the synthetic pageId — a hard 404 on every artwork tile in that tab.
  const artworkHref = item.link
    || (item.artworkSlug ? `/artwork/${item.artworkSlug}` : null);

  return (
    <Link
      href={isArtwork && artworkHref ? artworkHref : imageHref}
      className="group block bg-white rounded-lg border border-border-light overflow-hidden hover:border-accent-gold/30 hover:shadow-md transition-all"
    >
      <div className={`relative bg-warm ${large ? 'aspect-[3/4]' : 'aspect-square'}`}>
        {!imageError && displayUrl ? (
          <Image
            src={displayUrl}
            alt={item.description}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes={large ? '(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw' : '(max-width: 640px) 50vw, 16vw'}
            onError={() => setImageError(true)}
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-border-medium" />
          </div>
        )}
        {(provenance || typeChip) && (
          <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
            {typeChip && (
              <span className="px-1.5 py-0.5 rounded bg-black/55 text-[10px] leading-tight text-white/90 backdrop-blur-sm">
                {typeChip}
              </span>
            )}
            {provenance && (
              <span className="px-1.5 py-0.5 rounded bg-black/55 text-[10px] leading-tight text-white/90 backdrop-blur-sm">
                {provenance}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-sm text-secondary line-clamp-2 mb-1">
          {query ? <HighlightedText text={item.description} query={query} /> : item.description}
        </p>
        {subtitle && (
          <p className="text-xs text-muted flex items-baseline gap-1">
            <span className="truncate">{subtitle}</span>
            {pageLabel && <span className="shrink-0">· {pageLabel}</span>}
          </p>
        )}
      </div>
    </Link>
  );
}

// ==================== BPH CATALOG ROW ====================

function BphCatalogResultCard({ work, query, tenant, digitizedAlsoInBooks }: {
  work: BphCatalogMatch;
  query: string;
  tenant?: string;
  digitizedAlsoInBooks: boolean;
}) {
  const lang = useLocale();
  const t = SEARCH_STRINGS[lang];
  const lp = useLocalePath();
  const title = work.title || work.full_title || work.parallel_title || work.uniform_title || t.untitled;
  const author = work.author || work.variant_author;
  const meta = [
    author,
    work.year,
    work.place,
  ].filter(Boolean).join(' · ');
  const isDigitized = !!work.sl_book_id;
  // Manuscripts and photographs get no UBN from Memorix — `uuid` is their only
  // key, and the /catalog/[ubn] route accepts either (see BphCatalogBrowser).
  const catalogKey = work.ubn || work.uuid;
  const href = lp(isDigitized && work.sl_book_id
    ? tenantBookUrl({ id: work.sl_book_id, slug: work.sl_book_slug || work.sl_book_id }, tenant)
    : `/catalog/${encodeURIComponent(catalogKey || '')}`);
  const [imgError, setImgError] = useState(false);

  // Don't double-show digitized works that already appear in book results — render
  // a slimmer version that just notes the catalog match without competing visually.
  const compact = digitizedAlsoInBooks;

  return (
    <Link
      href={href}
      className={`block bg-white rounded-lg border border-border-light hover:border-accent-gold/40 hover:shadow-sm transition-all ${compact ? 'p-2.5' : 'p-3 sm:p-4'}`}
    >
      <div className="flex items-start gap-3">
        {work.thumbnail && !imgError ? (
          <Image
            src={work.thumbnail}
            alt=""
            width={48}
            height={68}
            className={`rounded shadow-sm flex-shrink-0 object-cover ${compact ? 'w-[36px] h-[50px]' : 'w-[48px] h-[68px]'}`}
            onError={() => setImgError(true)}
            unoptimized
          />
        ) : (
          <div className={`rounded bg-warm flex items-center justify-center flex-shrink-0 ${compact ? 'w-[36px] h-[50px]' : 'w-[48px] h-[68px]'}`}>
            <Book className="w-5 h-5 text-border-medium" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`font-medium text-primary leading-snug ${compact ? 'text-sm' : 'text-base'}`}>
              {query ? <HighlightedText text={title} query={query} /> : title}
            </h3>
            <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${
              isDigitized
                ? 'bg-accent-rust/10 text-accent-rust'
                : 'bg-cream border border-border-light text-muted'
            }`}>
              {isDigitized ? t.digitized : t.catalogOnly}
            </span>
          </div>
          {meta && (
            <p className={`text-muted mt-0.5 ${compact ? 'text-xs' : 'text-sm'}`}>
              {meta}
            </p>
          )}
          {work.shelf_mark && !compact && (
            <p className="text-xs text-muted/80 mt-0.5 font-mono">
              {work.shelf_mark}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ==================== PAGINATION ====================

function Pagination({ total, offset, setOffset, loading, pageSize }: {
  total: number; offset: number; setOffset: (n: number) => void; loading: boolean; pageSize: number;
}) {
  const t = SEARCH_STRINGS[useLocale()];
  if (total <= pageSize || loading) return null;

  return (
    <div className="flex items-center justify-center gap-4 mt-8 pt-6 border-t border-border-light">
      <button
        onClick={() => { setOffset(Math.max(0, offset - pageSize)); window.scrollTo(0, 0); }}
        disabled={offset === 0}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-border-medium text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm"
      >
        <ChevronLeft className="w-4 h-4" /> {t.previous}
      </button>
      <span className="text-sm text-muted">
        {t.pageXofY(
          (Math.floor(offset / pageSize) + 1).toLocaleString(t.numberLocale),
          Math.ceil(total / pageSize).toLocaleString(t.numberLocale),
        )}
      </span>
      <button
        onClick={() => { setOffset(offset + pageSize); window.scrollTo(0, 0); }}
        disabled={offset + pageSize >= total}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-border-medium text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm"
      >
        {t.next} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
