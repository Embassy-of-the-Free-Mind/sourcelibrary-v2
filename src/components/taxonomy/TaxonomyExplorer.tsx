'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
  language: string;
  slug: string;
}

interface Subcluster {
  name: string | null;
  count: number;
  books: Book[];
}

interface Cluster {
  name: string;
  cluster_id: number;
  count: number;
  subclusters: Subcluster[];
}

interface TaxonomyData {
  total_clusters: number;
  total_books: number;
  total_subclusters: number;
  clusters: Cluster[];
}

function bookUrl(book: { slug?: string; id: string }) {
  return `/book/${book.slug || book.id}`;
}

// Muted color palette for clusters
const CLUSTER_COLORS = [
  'bg-amber-900/40 border-amber-700/50',
  'bg-emerald-900/40 border-emerald-700/50',
  'bg-blue-900/40 border-blue-700/50',
  'bg-purple-900/40 border-purple-700/50',
  'bg-rose-900/40 border-rose-700/50',
  'bg-cyan-900/40 border-cyan-700/50',
  'bg-orange-900/40 border-orange-700/50',
  'bg-teal-900/40 border-teal-700/50',
  'bg-indigo-900/40 border-indigo-700/50',
  'bg-pink-900/40 border-pink-700/50',
  'bg-lime-900/40 border-lime-700/50',
  'bg-sky-900/40 border-sky-700/50',
];

function getColor(index: number) {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
}

function BookRow({ book }: { book: Book }) {
  return (
    <Link
      href={bookUrl(book)}
      className="flex items-baseline gap-3 py-1 px-3 hover:bg-stone-800/50 rounded text-sm group transition-colors"
    >
      <span className="text-stone-500 text-xs tabular-nums w-10 shrink-0 text-right">
        {book.year || '?'}
      </span>
      <span className="text-stone-300 group-hover:text-stone-100 truncate flex-1">
        {book.title}
      </span>
      <span className="text-stone-600 text-xs truncate max-w-[180px] shrink-0">
        {book.author}
      </span>
      <span className="text-stone-600 text-[10px] w-12 shrink-0 text-right">
        {book.language}
      </span>
    </Link>
  );
}

function SubclusterSection({
  sub,
  isExpanded,
  onToggle,
}: {
  sub: Subcluster;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isNoise = !sub.name;
  return (
    <div className="border-l border-stone-800 ml-4 pl-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 py-1.5 px-3 hover:bg-stone-800/30 rounded-r text-left transition-colors"
      >
        <span className="text-stone-600 text-xs w-4">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className={`text-sm ${isNoise ? 'text-stone-500 italic' : 'text-stone-300'}`}>
          {sub.name || 'Unclassified'}
        </span>
        <span className="text-stone-600 text-xs tabular-nums">
          {sub.count}
        </span>
      </button>
      {isExpanded && (
        <div className="ml-6 mb-2">
          {sub.books.map((book) => (
            <BookRow key={book.id} book={book} />
          ))}
          {sub.count > sub.books.length && (
            <div className="text-stone-600 text-xs px-3 py-1">
              +{sub.count - sub.books.length} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterCard({
  cluster,
  colorClass,
  globalExpand,
}: {
  cluster: Cluster;
  colorClass: string;
  globalExpand: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSubs, setExpandedSubs] = useState<Set<number>>(new Set());

  // Respond to global expand/collapse
  useEffect(() => {
    setIsExpanded(globalExpand);
    if (!globalExpand) setExpandedSubs(new Set());
  }, [globalExpand]);

  const namedSubs = cluster.subclusters.filter((s) => s.name);
  const noise = cluster.subclusters.find((s) => !s.name);

  const toggleSub = (idx: number) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSubs(new Set(cluster.subclusters.map((_, i) => i)));
  };

  return (
    <div className={`rounded-lg border ${colorClass} overflow-hidden`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left"
      >
        <span className="text-stone-500 text-sm w-5">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="text-stone-100 font-medium flex-1">{cluster.name}</span>
        <span className="text-stone-400 text-sm tabular-nums">
          {cluster.count} books
        </span>
        {namedSubs.length > 0 && (
          <span className="text-stone-600 text-xs">
            {namedSubs.length} sub
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-stone-800/50 pb-2">
          {namedSubs.length > 2 && (
            <div className="flex justify-end px-3 pt-1">
              <button
                onClick={expandAll}
                className="text-stone-600 text-xs hover:text-stone-400 transition-colors"
              >
                expand all
              </button>
            </div>
          )}
          {/* Named subclusters */}
          {namedSubs.map((sub, idx) => (
            <SubclusterSection
              key={sub.name}
              sub={sub}
              isExpanded={expandedSubs.has(idx)}
              onToggle={() => toggleSub(idx)}
            />
          ))}
          {/* Noise/unclassified */}
          {noise && (
            <SubclusterSection
              sub={noise}
              isExpanded={expandedSubs.has(cluster.subclusters.length - 1)}
              onToggle={() => toggleSub(cluster.subclusters.length - 1)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function TaxonomyExplorer() {
  const [data, setData] = useState<TaxonomyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [globalExpand, setGlobalExpand] = useState(false);

  useEffect(() => {
    fetch('/api/taxonomy/hierarchy')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.clusters;
    const q = search.toLowerCase();
    return data.clusters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.subclusters.some(
          (s) =>
            s.name?.toLowerCase().includes(q) ||
            s.books.some(
              (b) =>
                b.title.toLowerCase().includes(q) ||
                b.author.toLowerCase().includes(q)
            )
        )
    );
  }, [data, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-stone-500">
        Loading taxonomy...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        Failed to load taxonomy data
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-light text-stone-100 mb-2">
            Taxonomy Explorer
          </h1>
          <Link
            href="/research/atlas?mode=taxonomy"
            className="text-stone-500 text-sm hover:text-stone-300 transition-colors border border-stone-800 rounded px-3 py-1.5"
          >
            View in 3D Atlas
          </Link>
        </div>
        <p className="text-stone-500 text-sm">
          {data.total_clusters} clusters &middot; {data.total_subclusters}{' '}
          subclusters &middot; {data.total_books.toLocaleString()} books
        </p>
      </div>

      {/* Distribution bar */}
      <div className="mb-8">
        <div className="text-stone-600 text-xs mb-1.5 uppercase tracking-wider">
          Distribution
        </div>
        <div className="flex h-6 rounded overflow-hidden gap-px bg-stone-900">
          {data.clusters.map((c, i) => {
            const colors = [
              'rgba(180,83,9,0.5)', 'rgba(6,95,70,0.5)', 'rgba(30,64,175,0.5)',
              'rgba(126,34,206,0.5)', 'rgba(190,18,60,0.5)', 'rgba(14,116,144,0.5)',
              'rgba(194,65,12,0.5)', 'rgba(15,118,110,0.5)', 'rgba(67,56,202,0.5)',
              'rgba(190,24,93,0.5)', 'rgba(101,163,13,0.5)', 'rgba(2,132,199,0.5)',
            ];
            const width = (c.count / data.total_books) * 100;
            if (width < 0.5) return null;
            return (
              <div
                key={c.name}
                className="h-full relative group cursor-default"
                style={{ width: `${width}%`, background: colors[i % colors.length] }}
              >
                {width > 4 && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] text-stone-300 truncate px-0.5">
                    {c.name}
                  </span>
                )}
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-stone-800 text-stone-200 text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
                  {c.name} ({c.count})
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Search + controls */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter clusters, subclusters, or books..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-600"
        />
        <button
          onClick={() => setGlobalExpand(!globalExpand)}
          className="text-stone-500 text-xs hover:text-stone-300 transition-colors px-3 py-2 border border-stone-800 rounded"
        >
          {globalExpand ? 'Collapse all' : 'Expand all'}
        </button>
        <div className="text-stone-600 text-xs">
          {filtered.length}/{data.total_clusters}
        </div>
      </div>

      {/* Cluster list */}
      <div className="space-y-2">
        {filtered.map((cluster, i) => (
          <ClusterCard
            key={cluster.name}
            cluster={cluster}
            colorClass={getColor(i)}
            globalExpand={globalExpand}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-stone-600 py-12">
          No clusters match &ldquo;{search}&rdquo;
        </div>
      )}
    </div>
  );
}
