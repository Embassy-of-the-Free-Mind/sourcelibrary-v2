import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import { BookOpen, Users, MapPin, FileText, Lightbulb, Search, ArrowLeft } from 'lucide-react';
import { EncyclopediaEntry, EncyclopediaEntryType } from '@/lib/types';
import EncyclopediaSearch from './EncyclopediaSearch';

export const metadata: Metadata = {
  title: 'Encyclopedia - Source Library',
  description: 'Browse the community-built encyclopedia of terms, people, places, and concepts from historical texts.',
};

const TYPE_ICONS: Record<EncyclopediaEntryType, React.ReactNode> = {
  term: <BookOpen className="w-4 h-4" />,
  person: <Users className="w-4 h-4" />,
  place: <MapPin className="w-4 h-4" />,
  work: <FileText className="w-4 h-4" />,
  concept: <Lightbulb className="w-4 h-4" />,
};

const TYPE_COLORS: Record<EncyclopediaEntryType, string> = {
  term: 'bg-blue-100 text-blue-700',
  person: 'bg-purple-100 text-purple-700',
  place: 'bg-green-100 text-green-700',
  work: 'bg-amber-100 text-amber-700',
  concept: 'bg-pink-100 text-pink-700',
};

async function getEncyclopediaStats() {
  const db = await getDb();

  const [total, byType, categories, recentEntries] = await Promise.all([
    db.collection('encyclopedia').countDocuments(),
    db.collection('encyclopedia').aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('encyclopedia').distinct('categories'),
    db.collection('encyclopedia')
      .find({})
      .sort({ created_at: -1 })
      .limit(10)
      .project({ id: 1, slug: 1, title: 1, type: 1, summary: 1, view_count: 1 })
      .toArray(),
  ]);

  const typeStats: Record<string, number> = {};
  for (const item of byType) {
    typeStats[item._id as string] = item.count as number;
  }

  return {
    total,
    typeStats,
    categories: categories.sort() as string[],
    recentEntries: recentEntries as unknown as EncyclopediaEntry[],
  };
}

async function getPopularEntries() {
  const db = await getDb();
  const entries = await db.collection('encyclopedia')
    .find({})
    .sort({ view_count: -1 })
    .limit(10)
    .project({ id: 1, slug: 1, title: 1, type: 1, summary: 1, view_count: 1 })
    .toArray();

  return entries as unknown as EncyclopediaEntry[];
}

function EncyclopediaSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 bg-stone-200 rounded-lg" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-stone-200 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: EncyclopediaEntry }) {
  return (
    <Link
      href={`/encyclopedia/${entry.slug}`}
      className="block p-4 bg-white border border-stone-200 rounded-lg hover:border-amber-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${TYPE_COLORS[entry.type]}`}>
          {TYPE_ICONS[entry.type]}
          {entry.type}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-stone-900 truncate">{entry.title}</h3>
          <p className="text-sm text-stone-600 line-clamp-2 mt-1">{entry.summary}</p>
          {entry.view_count > 0 && (
            <p className="text-xs text-stone-400 mt-2">{entry.view_count} views</p>
          )}
        </div>
      </div>
    </Link>
  );
}

async function EncyclopediaContent() {
  const [stats, popularEntries] = await Promise.all([
    getEncyclopediaStats(),
    getPopularEntries(),
  ]);

  const types: EncyclopediaEntryType[] = ['term', 'person', 'place', 'work', 'concept'];

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-8">
        {types.map((type) => (
          <div
            key={type}
            className={`p-4 rounded-lg ${TYPE_COLORS[type]} bg-opacity-20`}
          >
            <div className="flex items-center gap-2 mb-1">
              {TYPE_ICONS[type]}
              <span className="text-sm font-medium capitalize">{type}s</span>
            </div>
            <div className="text-2xl font-bold">{stats.typeStats[type] || 0}</div>
          </div>
        ))}
      </div>

      {/* Categories */}
      {stats.categories.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-stone-900 mb-3">Categories</h2>
          <div className="flex flex-wrap gap-2">
            {stats.categories.map((category) => (
              <Link
                key={category}
                href={`/encyclopedia?category=${encodeURIComponent(category)}`}
                className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-full text-sm transition-colors"
              >
                {category}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        {/* Popular Entries */}
        <div>
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Most Viewed</h2>
          {popularEntries.length === 0 ? (
            <p className="text-stone-500 text-sm">No entries yet.</p>
          ) : (
            <div className="space-y-3">
              {popularEntries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* Recent Entries */}
        <div>
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Recently Added</h2>
          {stats.recentEntries.length === 0 ? (
            <p className="text-stone-500 text-sm">No entries yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.recentEntries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>

      {stats.total === 0 && (
        <div className="text-center py-16 bg-stone-50 rounded-xl mt-8">
          <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-stone-900 mb-2">Encyclopedia is Empty</h2>
          <p className="text-stone-600 max-w-md mx-auto">
            The encyclopedia grows from community annotations. Select text while reading
            and add annotations that link to encyclopedia entries to start building
            the knowledge base.
          </p>
        </div>
      )}
    </>
  );
}

export default function EncyclopediaPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900 mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-stone-900">Encyclopedia</h1>
              <p className="text-stone-600 mt-1">
                Community-built knowledge from historical texts
              </p>
            </div>
            <EncyclopediaSearch />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<EncyclopediaSkeleton />}>
          <EncyclopediaContent />
        </Suspense>
      </main>
    </div>
  );
}
