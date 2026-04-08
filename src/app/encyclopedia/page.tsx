import { Suspense } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { User, MapPin, Lightbulb, BookOpen, ArrowRight, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';
import EncyclopediaFilters from './EncyclopediaFilters';
import { unstable_cache } from 'next/cache';

export const revalidate = false;
export const maxDuration = 30;

const TYPE_ICONS = {
  person: User,
  place: MapPin,
  concept: Lightbulb,
};

function formatLifespan(birth?: string, death?: string): string | null {
  if (!birth && !death) return null;
  const b = birth?.slice(0, 4);
  const d = death?.slice(0, 4);
  if (b && d) return `${b}\u2013${d}`;
  if (b) return `b.\u00a0${b}`;
  return `d.\u00a0${d}`;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PER_PAGE = 60;

interface SearchParams {
  type?: string;
  min_books?: string;
  q?: string;
  letter?: string;
  sort?: string;
  page?: string;
}

async function getEntitiesRaw(searchParams: SearchParams) {
  try {
    const type = searchParams.type && searchParams.type !== 'all' ? searchParams.type : null;
    const minBooks = parseInt(searchParams.min_books || '2') || 2;
    const query = searchParams.q?.trim() || null;
    const letter = searchParams.letter?.trim().toUpperCase() || null;
    const sortMode = searchParams.sort || 'relevance';
    const page = Math.max(1, parseInt(searchParams.page || '1') || 1);
    const offset = (page - 1) * PER_PAGE;

    // Build Supabase query for entities
    let baseQuery = supabase
      .from('entities')
      .select('id, name, type, book_count, total_mentions, description, wikidata_birth_date, wikidata_death_date', { count: 'exact' })
      .gte('book_count', minBooks);

    if (type) baseQuery = baseQuery.eq('type', type);
    if (query) baseQuery = baseQuery.ilike('name', `%${query}%`);
    if (letter && !query) baseQuery = baseQuery.ilike('name', `${letter}%`);

    if (sortMode === 'alpha') {
      baseQuery = baseQuery.order('name', { ascending: true });
    } else {
      baseQuery = baseQuery.order('book_count', { ascending: false }).order('total_mentions', { ascending: false });
    }

    baseQuery = baseQuery.range(offset, offset + PER_PAGE - 1);

    // Stats query: count by type (with same filters except type)
    let statsQuery = supabase
      .from('entities')
      .select('type', { count: 'exact' })
      .gte('book_count', minBooks);
    if (query) statsQuery = statsQuery.ilike('name', `%${query}%`);
    if (letter && !query) statsQuery = statsQuery.ilike('name', `${letter}%`);

    // Run queries in parallel
    const [entitiesResult, personCount, placeCount, conceptCount] = await Promise.all([
      baseQuery,
      supabase.from('entities').select('id', { count: 'exact', head: true }).gte('book_count', minBooks).eq('type', 'person')
        .then(r => r.count || 0),
      supabase.from('entities').select('id', { count: 'exact', head: true }).gte('book_count', minBooks).eq('type', 'place')
        .then(r => r.count || 0),
      supabase.from('entities').select('id', { count: 'exact', head: true }).gte('book_count', minBooks).eq('type', 'concept')
        .then(r => r.count || 0),
    ]);

    const entities = entitiesResult.data || [];
    const total = entitiesResult.count || 0;

    // Letter distribution: fetch first letters for the A-Z bar
    // Use a lightweight query — just get distinct first letters with counts
    // For now, use a simpler approach: fetch all first letters
    let letterQuery = supabase
      .from('entities')
      .select('name')
      .gte('book_count', minBooks);
    if (type) letterQuery = letterQuery.eq('type', type);
    if (query) letterQuery = letterQuery.ilike('name', `%${query}%`);

    // Paginate to get all names for letter counting (Supabase 1000-row limit)
    const letterMap: Record<string, number> = {};
    let letterOffset = 0;
    while (true) {
      const { data } = await letterQuery.range(letterOffset, letterOffset + 999);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const firstLetter = (row.name as string)?.[0]?.toUpperCase();
        if (firstLetter && /[A-Z]/.test(firstLetter)) {
          letterMap[firstLetter] = (letterMap[firstLetter] || 0) + 1;
        }
      }
      if (data.length < 1000) break;
      letterOffset += 1000;
    }

    return {
      entities: entities.map(e => ({
        _id: e.id as string,
        name: e.name as string,
        type: e.type as 'person' | 'place' | 'concept',
        book_count: (e.book_count || 0) as number,
        total_mentions: (e.total_mentions || 0) as number,
        description: (e.description || null) as string | null,
        wikidata_birth_date: (e.wikidata_birth_date || undefined) as string | undefined,
        wikidata_death_date: (e.wikidata_death_date || undefined) as string | undefined,
        books: [] as Array<{ book_id: string; book_title: string }>,
      })),
      total,
      page,
      totalPages: Math.ceil(total / PER_PAGE),
      stats: {
        total: (personCount as number) + (placeCount as number) + (conceptCount as number),
        people: personCount as number,
        places: placeCount as number,
        concepts: conceptCount as number,
      },
      letterMap,
    };
  } catch (err) {
    console.error('Encyclopedia data fetch failed:', err);
    return {
      entities: [],
      total: 0,
      page: 1,
      totalPages: 0,
      stats: { total: 0, people: 0, places: 0, concepts: 0 },
      letterMap: {},
    };
  }
}

// Cache encyclopedia queries so Supabase fetch() calls don't make the page dynamic
async function getEntities(params: SearchParams) {
  const cacheKey = JSON.stringify(params);
  const cached = unstable_cache(
    () => getEntitiesRaw(params),
    ['encyclopedia', cacheKey],
    { revalidate: false },
  );
  return cached();
}

export default async function EncyclopediaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { entities, total, page, totalPages, stats, letterMap } = await getEntities(params);
  const activeLetter = params.letter?.toUpperCase() || null;
  const activeSort = params.sort || 'relevance';
  const hasQuery = !!params.q?.trim();

  // Build base URL params (without letter/page for the letter bar)
  function buildUrl(overrides: Record<string, string | null>) {
    const p = new URLSearchParams();
    if (params.type && params.type !== 'all') p.set('type', params.type);
    if (params.min_books && params.min_books !== '2') p.set('min_books', params.min_books);
    if (params.q) p.set('q', params.q);
    if (params.sort && params.sort !== 'relevance') p.set('sort', params.sort);
    if (params.letter) p.set('letter', params.letter);
    if (params.page && params.page !== '1') p.set('page', params.page);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === '') {
        p.delete(k);
      } else {
        p.set(k, v);
      }
    }
    const qs = p.toString();
    return `/encyclopedia${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <BookOpen className="w-12 h-12 text-accent-gold mx-auto mb-4" />
          <h1 className="text-3xl font-serif font-bold mb-2">Encyclopedia</h1>
          <p className="text-stone-300 max-w-xl mx-auto">
            People, places, and concepts that appear across multiple books in the collection.
            Discover connections between texts.
          </p>
        </div>
      </div>

      {/* Filters (client component) */}
      <Suspense>
        <EncyclopediaFilters />
      </Suspense>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-stone-900">{stats.total.toLocaleString()}</div>
            <div className="text-sm text-stone-500">Total</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-accent-rust">{stats.people.toLocaleString()}</div>
            <div className="text-sm text-stone-500">People</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-accent-sage">{stats.places.toLocaleString()}</div>
            <div className="text-sm text-stone-500">Places</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-accent-violet">{stats.concepts.toLocaleString()}</div>
            <div className="text-sm text-stone-500">Concepts</div>
          </div>
        </div>

        {/* A-Z Letter Bar + Sort */}
        {!hasQuery && (
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-wrap gap-0.5">
              <Link
                href={buildUrl({ letter: null, page: null })}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  !activeLetter
                    ? 'bg-stone-800 text-white'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
                }`}
              >
                All
              </Link>
              {LETTERS.map((l) => {
                const count = letterMap[l] || 0;
                const isActive = activeLetter === l;
                return (
                  <Link
                    key={l}
                    href={count > 0 ? buildUrl({ letter: l, page: null }) : '#'}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      isActive
                        ? 'bg-stone-800 text-white'
                        : count > 0
                        ? 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
                        : 'bg-stone-50 text-stone-300 cursor-default border border-stone-100'
                    }`}
                    aria-disabled={count === 0}
                    title={count > 0 ? `${count} entities` : 'No entities'}
                  >
                    {l}
                  </Link>
                );
              })}
            </div>
            <div className="flex gap-1 ml-4 shrink-0">
              <Link
                href={buildUrl({ sort: null, page: null })}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  activeSort === 'relevance'
                    ? 'bg-stone-800 text-white'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
                }`}
              >
                By relevance
              </Link>
              <Link
                href={buildUrl({ sort: 'alpha', page: null })}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  activeSort === 'alpha'
                    ? 'bg-stone-800 text-white'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
                }`}
              >
                A &ndash; Z
              </Link>
            </div>
          </div>
        )}

        {/* Results count */}
        {(activeLetter || hasQuery || page > 1) && (
          <p className="text-sm text-stone-500 mb-4">
            {total.toLocaleString()} result{total !== 1 ? 's' : ''}
            {activeLetter && !hasQuery && <> starting with &ldquo;{activeLetter}&rdquo;</>}
            {hasQuery && <> for &ldquo;{params.q}&rdquo;</>}
          </p>
        )}

        {/* Entity List */}
        {entities.length === 0 ? (
          <div className="text-center py-16">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <h3 className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No entities found</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {entities.map((entity) => {
              const Icon = TYPE_ICONS[entity.type];
              return (
                <Link
                  key={entity._id}
                  href={`/encyclopedia/${encodeURIComponent(entity.name)}`}
                  className="group bg-white rounded-lg border border-stone-200 p-4 hover:border-accent-gold/30 hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${ENTITY_TYPE_STYLES[entity.type as EntityType].badge}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-stone-900 group-hover:text-accent-rust transition-colors truncate">
                        {entity.name}
                        {entity.type === 'person' && formatLifespan(entity.wikidata_birth_date, entity.wikidata_death_date) && (
                          <span className="text-stone-400 font-normal text-sm ml-1.5">
                            ({formatLifespan(entity.wikidata_birth_date, entity.wikidata_death_date)})
                          </span>
                        )}
                      </h3>
                      {entity.description && (
                        <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{entity.description}</p>
                      )}
                      <p className="text-sm text-stone-500 mt-1">
                        {entity.book_count} book{entity.book_count !== 1 ? 's' : ''}
                        {' '}&middot;{' '}
                        {entity.total_mentions} mention{entity.total_mentions !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-accent-rust group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 mt-8 pb-4" aria-label="Pagination">
            {page > 1 ? (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-2 text-sm text-stone-300 bg-stone-50 border border-stone-100 rounded-lg cursor-default">
                <ChevronLeft className="w-4 h-4" />
                Previous
              </span>
            )}

            <span className="text-sm text-stone-500 px-3">
              Page {page} of {totalPages}
            </span>

            {page < totalPages ? (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-2 text-sm text-stone-300 bg-stone-50 border border-stone-100 rounded-lg cursor-default">
                Next
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
