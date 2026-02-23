'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Search, User, MapPin, Lightbulb, BookOpen, ArrowRight } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import { entities as entitiesApi } from '@/lib/api-client';
import type { Entity } from '@/lib/api-client';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';

const TYPE_ICONS = {
  person: User,
  place: MapPin,
  concept: Lightbulb,
};

export default function EncyclopediaPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeType, setActiveType] = useState<'all' | 'person' | 'place' | 'concept'>('all');
  const [minBooks, setMinBooks] = useState(2);

  useEffect(() => {
    fetchEntities();
  }, [activeType, minBooks]);

  const fetchEntities = async () => {
    setLoading(true);
    try {
      const data = await entitiesApi.list({
        type: activeType !== 'all' ? activeType : undefined,
        min_books: minBooks > 1 ? minBooks : undefined,
        limit: 100,
      });
      setEntities(data.entities);
    } catch (error) {
      console.error('Failed to fetch entities:', error);
      toast.error('Failed to load entities');
    } finally {
      setLoading(false);
    }
  };

  const filteredEntities = entities.filter(e =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    total: entities.length,
    people: entities.filter(e => e.type === 'person').length,
    places: entities.filter(e => e.type === 'place').length,
    concepts: entities.filter(e => e.type === 'concept').length,
  };

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

      {/* Filters */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                placeholder="Search entities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Type filter */}
            <div className="flex gap-1 bg-stone-100 p-1 rounded-lg">
              {(['all', 'person', 'place', 'concept'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setActiveType(type)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    activeType === type
                      ? 'bg-white text-stone-900 shadow-sm'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1) + 's'}
                </button>
              ))}
            </div>

            {/* Min books filter */}
            <select
              value={minBooks}
              onChange={(e) => setMinBooks(parseInt(e.target.value))}
              className="px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value={1}>All entities</option>
              <option value={2}>2+ books</option>
              <option value={3}>3+ books</option>
              <option value={5}>5+ books</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-stone-900">{stats.total}</div>
            <div className="text-sm text-stone-500">Total</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-accent-rust">{stats.people}</div>
            <div className="text-sm text-stone-500">People</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-accent-sage">{stats.places}</div>
            <div className="text-sm text-stone-500">Places</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
            <div className="text-2xl font-bold text-accent-violet">{stats.concepts}</div>
            <div className="text-sm text-stone-500">Concepts</div>
          </div>
        </div>

        {/* Entity List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <BookLoader size="sm" />
          </div>
        ) : filteredEntities.length === 0 ? (
          <div className="text-center py-16">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <h3 className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No entities found</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredEntities.map((entity) => {
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
