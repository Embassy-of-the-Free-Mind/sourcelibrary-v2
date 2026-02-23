import { Suspense } from 'react';
import Link from 'next/link';
import { User, MapPin, Lightbulb, BookOpen, ArrowRight, Search } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';
import EncyclopediaFilters from './EncyclopediaFilters';

const TYPE_ICONS = {
  person: User,
  place: MapPin,
  concept: Lightbulb,
};

interface SearchParams {
  type?: string;
  min_books?: string;
  q?: string;
}

async function getEntities(searchParams: SearchParams) {
  const db = await getDb();

  const type = searchParams.type && searchParams.type !== 'all' ? searchParams.type : null;
  const minBooks = parseInt(searchParams.min_books || '2') || 2;
  const query = searchParams.q?.trim() || null;

  const filter: Record<string, unknown> = {
    book_count: { $gte: minBooks },
  };
  if (type) filter.type = type;
  if (query) {
    filter.name = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  const [entities, stats] = await Promise.all([
    db.collection('entities')
      .find(filter)
      .sort({ book_count: -1 })
      .limit(100)
      .project({
        name: 1, type: 1, book_count: 1, total_mentions: 1, description: 1,
        books: { $slice: 3 },
      })
      .toArray(),
    db.collection('entities').aggregate([
      { $match: { book_count: { $gte: minBooks }, ...(query ? { name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const statsByType = stats.reduce((acc: Record<string, number>, s) => {
    acc[s._id as string] = s.count as number;
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
    stats: {
      total: (statsByType.person || 0) + (statsByType.place || 0) + (statsByType.concept || 0),
      people: statsByType.person || 0,
      places: statsByType.place || 0,
      concepts: statsByType.concept || 0,
    },
  };
}

export default async function EncyclopediaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { entities, stats } = await getEntities(params);

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
          <BookOpen className="w-12 h-12 text-amber-400 mx-auto mb-4" />
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

      {/* Stats */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-4 gap-4 mb-8">
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
                  className="group bg-white rounded-lg border border-stone-200 p-4 hover:border-amber-400 hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${ENTITY_TYPE_STYLES[entity.type as EntityType].badge}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-stone-900 group-hover:text-amber-700 transition-colors truncate">
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
                    <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-amber-600 group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
