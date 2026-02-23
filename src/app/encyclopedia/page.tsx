import { Suspense } from 'react';
import Link from 'next/link';
import { User, MapPin, Lightbulb, BookOpen, ArrowRight, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import type { Sort } from 'mongodb';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';
import EncyclopediaFilters from './EncyclopediaFilters';

const TYPE_ICONS = {
  person: User,
  place: MapPin,
  concept: Lightbulb,
};

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

async function getEntities(searchParams: SearchParams) {
  const db = await getDb();

  const type = searchParams.type && searchParams.type !== 'all' ? searchParams.type : null;
  const minBooks = parseInt(searchParams.min_books || '2') || 2;
  const query = searchParams.q?.trim() || null;
  const letter = searchParams.letter?.trim().toUpperCase() || null;
  const sortMode = searchParams.sort || 'relevance';
  const page = Math.max(1, parseInt(searchParams.page || '1') || 1);
  const offset = (page - 1) * PER_PAGE;

  const filter: Record<string, unknown> = {
    book_count: { $gte: minBooks },
  };
  if (type) filter.type = type;
  if (query) {
    filter.$or = [
      { name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { aliases: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }
  if (letter && !query) {
    filter.name = { $regex: `^${letter}`, $options: 'i' };
  }

  const [entities, total, stats, letterCounts] = await Promise.all([
    db.collection('entities')
      .find(filter)
      .sort(sortMode === 'alpha' ? { name: 1 } : { book_count: -1, total_mentions: -1 })
      .skip(offset)
      .limit(PER_PAGE)
      .project({
        name: 1, type: 1, book_count: 1, total_mentions: 1, description: 1,
        books: { $slice: 3 },
      })
      .toArray(),
    db.collection('entities').countDocuments(filter),
    db.collection('entities').aggregate([
      { $match: { book_count: { $gte: minBooks }, ...(query ? { $or: [{ name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { aliases: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }] } : {}), ...(letter && !query ? { name: { $regex: `^${letter}`, $options: 'i' } } : {}) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).toArray(),
    // Get letter distribution for the A-Z bar (without letter filter applied)
    db.collection('entities').aggregate([
      { $match: { book_count: { $gte: minBooks }, ...(type ? { type } : {}), ...(query ? { $or: [{ name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { aliases: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }] } : {}) } },
      { $project: { firstLetter: { $toUpper: { $substrCP: ['$name', 0, 1] } } } },
      { $group: { _id: '$firstLetter', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const statsByType = stats.reduce((acc: Record<string, number>, s) => {
    acc[s._id as string] = s.count as number;
    return acc;
  }, {} as Record<string, number>);

  const letterMap = letterCounts.reduce((acc: Record<string, number>, l) => {
    acc[l._id as string] = l.count as number;
    return acc;
  }, {} as Record<string, number>);

  return {
    entities: entities.map(e => ({
      _id: e._id.toString(),
      name: e.name as string,
      type: e.type as 'person' | 'place' | 'concept',
      book_count: (e.book_count || 0) as number,
      total_mentions: (e.total_mentions || 0) as number,
      description: (e.description || null) as string | null,
      books: (e.books || []) as Array<{ book_id: string; book_title: string }>,
    })),
    total,
    page,
    totalPages: Math.ceil(total / PER_PAGE),
    stats: {
      total: (statsByType.person || 0) + (statsByType.place || 0) + (statsByType.concept || 0),
      people: statsByType.person || 0,
      places: statsByType.place || 0,
      concepts: statsByType.concept || 0,
    },
    letterMap,
  };
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
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <Link href="/" className="text-stone-600 hover:text-stone-900 text-sm">
            &larr; Back to Library
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12">
        <div className="max-w-6xl mx-auto px-4 text-center">
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

      <div className="max-w-6xl mx-auto px-4 py-6">
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
                      </h3>
                      {entity.description && (
                        <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{entity.description}</p>
                      )}
                      <p className="text-sm text-stone-500 mt-1">
                        {entity.book_count} book{entity.book_count !== 1 ? 's' : ''}
                        {' '}&middot;{' '}
                        {entity.total_mentions} mention{entity.total_mentions !== 1 ? 's' : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {entity.books.slice(0, 2).map((book) => (
                          <span
                            key={book.book_id}
                            className="inline-block px-2 py-0.5 bg-stone-100 text-stone-600 text-xs rounded truncate max-w-[150px]"
                          >
                            {book.book_title}
                          </span>
                        ))}
                        {entity.books.length > 2 && (
                          <span className="inline-block px-2 py-0.5 text-stone-400 text-xs">
                            +{entity.books.length - 2} more
                          </span>
                        )}
                      </div>
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
