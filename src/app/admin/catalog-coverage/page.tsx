'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, RefreshCw, BookOpen, Globe, Eye, Languages,
  Search, Filter, ExternalLink, Library, BarChart3,
} from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

// ─── Types ───────────────────────────────────────────────────────────────

interface LanguageStat {
  language: string;
  editions: number;
  with_scan: number;
  pct_scanned: number;
  with_translation: number;
  pct_translated: number;
  in_source_library: number;
  distinct_works: number;
}

interface SummaryData {
  status: string;
  message?: string;
  built_at?: string;
  total: {
    editions: number;
    with_scan: number;
    with_translation: number;
    in_source_library: number;
    distinct_works: number;
  };
  by_language: LanguageStat[];
}

interface TimelineDecade {
  decade: number;
  editions: number;
  with_scan: number;
  pct_scanned: number;
  with_translation: number;
  pct_translated: number;
  in_source_library: number;
}

interface SearchResult {
  ustc_id: number;
  title: string;
  author: string;
  year: number;
  language: string;
  place: string;
  has_scan: boolean;
  scan_sources: string[];
  iiif_manifest_url: string | null;
  has_published_translation: boolean;
  translation_sources: string[];
  in_source_library: boolean;
  source_library_id: string | null;
  ocr_status: string | null;
  translation_status: string | null;
  sl_translation_percent: number | null;
}

interface WorksData {
  total_works: number;
  works_with_scan: number;
  works_with_translation: number;
  works_in_sl: number;
  works_scanned_not_translated: number;
  works_neither: number;
  pct_scanned: number;
  pct_translated: number;
}

// ─── Component ───────────────────────────────────────────────────────────

export default function CatalogCoveragePage() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeline, setTimeline] = useState<TimelineDecade[] | null>(null);
  const [works, setWorks] = useState<WorksData | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'search' | 'timeline'>('overview');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterHasScan, setFilterHasScan] = useState<string>('');
  const [filterHasTranslation, setFilterHasTranslation] = useState<string>('');
  const [timelineLanguage, setTimelineLanguage] = useState('');

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, worksRes] = await Promise.all([
        fetch('/api/catalog/coverage?mode=summary'),
        fetch('/api/catalog/coverage?mode=works'),
      ]);
      setSummary(await sumRes.json());
      setWorks(await worksRes.json());
    } catch (err) {
      console.error('Failed to load summary:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async (lang: string) => {
    try {
      const url = `/api/catalog/coverage?mode=timeline${lang ? `&language=${lang}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setTimeline(data.decades);
    } catch (err) {
      console.error('Failed to load timeline:', err);
    }
  }, []);

  const doSearch = useCallback(async () => {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'search');
      if (searchQuery) params.set('q', searchQuery);
      if (filterLanguage) params.set('language', filterLanguage);
      if (filterHasScan) params.set('has_scan', filterHasScan);
      if (filterHasTranslation) params.set('has_translation', filterHasTranslation);
      params.set('limit', '50');

      const res = await fetch(`/api/catalog/coverage?${params}`);
      const data = await res.json();
      setSearchResults(data.results || []);
      setSearchTotal(data.total || 0);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, filterLanguage, filterHasScan, filterHasTranslation]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (activeTab === 'timeline') loadTimeline(timelineLanguage);
  }, [activeTab, timelineLanguage, loadTimeline]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <BookLoader />
      </div>
    );
  }

  if (summary?.status === 'empty') {
    return (
      <div className="min-h-screen bg-stone-50 p-8">
        <div className="max-w-2xl mx-auto text-center mt-20">
          <Library className="w-16 h-16 text-stone-300 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-stone-800 mb-2">Catalog Coverage</h1>
          <p className="text-stone-500 mb-6">The catalog_coverage collection is empty. Run the build script to populate it:</p>
          <pre className="bg-stone-900 text-stone-100 p-4 rounded-lg text-sm text-left overflow-x-auto">
{`set -a; source .env.production.local; set +a
node scripts/catalog-coverage/build.mjs`}
          </pre>
        </div>
      </div>
    );
  }

  const t = summary?.total;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-stone-400 hover:text-stone-600">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-stone-800">Catalog Coverage</h1>
              <p className="text-sm text-stone-500">
                USTC 1450–1700: what has been scanned, what has been translated
                {summary?.built_at && <> · Built {new Date(summary.built_at).toLocaleDateString()}</>}
              </p>
            </div>
          </div>
          <button onClick={loadSummary} className="p-2 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Summary Cards */}
        {t && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <StatCard label="Total Editions" value={t.editions.toLocaleString()} icon={<BookOpen className="w-5 h-5" />} />
            <StatCard label="Distinct Works" value={t.distinct_works.toLocaleString()} icon={<Library className="w-5 h-5" />} />
            <StatCard
              label="With Scans"
              value={t.with_scan.toLocaleString()}
              sub={`${(t.with_scan / t.editions * 100).toFixed(1)}%`}
              icon={<Eye className="w-5 h-5" />}
              color="blue"
            />
            <StatCard
              label="With Translation"
              value={t.with_translation.toLocaleString()}
              sub={`${(t.with_translation / t.editions * 100).toFixed(1)}%`}
              icon={<Languages className="w-5 h-5" />}
              color="green"
            />
            <StatCard
              label="In Source Library"
              value={t.in_source_library.toLocaleString()}
              sub={`${(t.in_source_library / t.editions * 100).toFixed(1)}%`}
              icon={<Globe className="w-5 h-5" />}
              color="amber"
            />
          </div>
        )}

        {/* Work-level stats */}
        {works && works.total_works > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-5 mb-8">
            <h2 className="text-sm font-semibold text-stone-600 uppercase tracking-wide mb-3">Work-Level Coverage</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MiniStat label="Scanned works" value={works.works_with_scan} total={works.total_works} />
              <MiniStat label="Translated works" value={works.works_with_translation} total={works.total_works} />
              <MiniStat label="Scanned, not translated" value={works.works_scanned_not_translated} total={works.total_works} color="amber" />
              <MiniStat label="Neither scanned nor translated" value={works.works_neither} total={works.total_works} color="red" />
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-stone-100 rounded-lg p-1 w-fit">
          {(['overview', 'timeline', 'search'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {tab === 'overview' ? 'By Language' : tab === 'timeline' ? 'By Decade' : 'Search'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && summary?.by_language && (
          <LanguageTable data={summary.by_language} />
        )}

        {activeTab === 'timeline' && (
          <div>
            <div className="flex gap-2 mb-4">
              <select
                value={timelineLanguage}
                onChange={e => setTimelineLanguage(e.target.value)}
                className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white"
              >
                <option value="">All languages</option>
                {summary?.by_language.map(l => (
                  <option key={l.language} value={l.language}>{l.language}</option>
                ))}
              </select>
            </div>
            {timeline && <TimelineChart data={timeline} />}
          </div>
        )}

        {activeTab === 'search' && (
          <div>
            {/* Search controls */}
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doSearch()}
                    placeholder="Search by title or author..."
                    className="w-full pl-10 pr-4 py-2 border border-stone-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <select value={filterLanguage} onChange={e => setFilterLanguage(e.target.value)}
                className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white">
                <option value="">Any language</option>
                {summary?.by_language.map(l => (
                  <option key={l.language} value={l.language}>{l.language}</option>
                ))}
              </select>
              <select value={filterHasScan} onChange={e => setFilterHasScan(e.target.value)}
                className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white">
                <option value="">Any scan status</option>
                <option value="true">Has scan</option>
                <option value="false">No scan</option>
              </select>
              <select value={filterHasTranslation} onChange={e => setFilterHasTranslation(e.target.value)}
                className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white">
                <option value="">Any translation status</option>
                <option value="true">Has translation</option>
                <option value="false">No translation</option>
              </select>
              <button
                onClick={doSearch}
                disabled={searching}
                className="px-4 py-2 bg-stone-800 text-white rounded-lg text-sm hover:bg-stone-700 disabled:opacity-50"
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {searchTotal > 0 && (
              <p className="text-sm text-stone-500 mb-3">{searchTotal.toLocaleString()} results</p>
            )}

            {searchResults.length > 0 && <SearchResultsTable results={searchResults} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; color?: string;
}) {
  const colors: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
  };
  const iconColor = color ? colors[color] : 'text-stone-500 bg-stone-100';

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className={`inline-flex p-2 rounded-lg mb-2 ${iconColor}`}>{icon}</div>
      <div className="text-2xl font-semibold text-stone-800">{value}</div>
      <div className="text-sm text-stone-500">{label}</div>
      {sub && <div className="text-xs text-stone-400 mt-1">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, total, color }: {
  label: string; value: number; total: number; color?: string;
}) {
  const pct = total > 0 ? (value / total * 100) : 0;
  const barColor = color === 'amber' ? 'bg-amber-500' : color === 'red' ? 'bg-red-400' : 'bg-blue-500';

  return (
    <div>
      <div className="text-sm text-stone-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-stone-800">{value.toLocaleString()}</div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-xs text-stone-400">{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function LanguageTable({ data }: { data: LanguageStat[] }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            <th className="text-left px-4 py-3 font-medium text-stone-600">Language</th>
            <th className="text-right px-4 py-3 font-medium text-stone-600">Editions</th>
            <th className="text-right px-4 py-3 font-medium text-stone-600">Works</th>
            <th className="text-right px-4 py-3 font-medium text-stone-600">Scanned</th>
            <th className="text-right px-4 py-3 font-medium text-stone-600">Translated</th>
            <th className="text-right px-4 py-3 font-medium text-stone-600">In SL</th>
          </tr>
        </thead>
        <tbody>
          {data.map(l => (
            <tr key={l.language} className="border-b border-stone-100 hover:bg-stone-50">
              <td className="px-4 py-3 font-medium text-stone-800">{l.language}</td>
              <td className="px-4 py-3 text-right text-stone-600">{l.editions.toLocaleString()}</td>
              <td className="px-4 py-3 text-right text-stone-600">{l.distinct_works.toLocaleString()}</td>
              <td className="px-4 py-3 text-right">
                <span className="text-stone-800">{l.with_scan.toLocaleString()}</span>
                <span className="text-stone-400 ml-1">({l.pct_scanned}%)</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-stone-800">{l.with_translation.toLocaleString()}</span>
                <span className="text-stone-400 ml-1">({l.pct_translated}%)</span>
              </td>
              <td className="px-4 py-3 text-right text-stone-600">{l.in_source_library.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimelineChart({ data }: { data: TimelineDecade[] }) {
  const maxEditions = Math.max(...data.map(d => d.editions), 1);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <div className="flex items-center gap-4 mb-4 text-xs text-stone-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-stone-200 inline-block" /> Editions</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Scanned</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Translated</span>
      </div>
      <div className="space-y-1">
        {data.map(d => (
          <div key={d.decade} className="flex items-center gap-2 group">
            <div className="w-12 text-xs text-stone-400 text-right shrink-0">{d.decade}s</div>
            <div className="flex-1 relative h-6">
              {/* Background: total editions */}
              <div
                className="absolute inset-y-0 left-0 bg-stone-100 rounded"
                style={{ width: `${(d.editions / maxEditions) * 100}%` }}
              />
              {/* Scanned overlay */}
              <div
                className="absolute inset-y-0 left-0 bg-blue-200 rounded"
                style={{ width: `${(d.with_scan / maxEditions) * 100}%` }}
              />
              {/* Translated overlay */}
              <div
                className="absolute inset-y-0 left-0 bg-green-400 rounded"
                style={{ width: `${(d.with_translation / maxEditions) * 100}%` }}
              />
              {/* Hover tooltip */}
              <div className="absolute inset-0 flex items-center px-2 text-xs text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity">
                {d.editions.toLocaleString()} ed · {d.pct_scanned}% scanned · {d.pct_translated}% translated
              </div>
            </div>
            <div className="w-20 text-xs text-stone-400 text-right shrink-0">
              {d.editions.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchResultsTable({ results }: { results: SearchResult[] }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            <th className="text-left px-4 py-3 font-medium text-stone-600">Title / Author</th>
            <th className="text-center px-3 py-3 font-medium text-stone-600 w-16">Year</th>
            <th className="text-center px-3 py-3 font-medium text-stone-600 w-20">Lang</th>
            <th className="text-center px-3 py-3 font-medium text-stone-600 w-16">Scan</th>
            <th className="text-center px-3 py-3 font-medium text-stone-600 w-16">Trans.</th>
            <th className="text-center px-3 py-3 font-medium text-stone-600 w-16">SL</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.ustc_id} className="border-b border-stone-100 hover:bg-stone-50">
              <td className="px-4 py-3">
                <div className="font-medium text-stone-800 line-clamp-1">{r.title || 'Untitled'}</div>
                <div className="text-xs text-stone-400 line-clamp-1">
                  {r.author || 'Unknown'} · {r.place || '?'}
                  <span className="ml-2 text-stone-300">USTC {r.ustc_id}</span>
                </div>
              </td>
              <td className="text-center px-3 py-3 text-stone-600">{r.year || '?'}</td>
              <td className="text-center px-3 py-3 text-stone-600">{r.language}</td>
              <td className="text-center px-3 py-3">
                {r.has_scan ? (
                  r.iiif_manifest_url ? (
                    <a href={r.iiif_manifest_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800">
                      <Eye className="w-4 h-4" />
                    </a>
                  ) : (
                    <Eye className="w-4 h-4 text-blue-400 mx-auto" />
                  )
                ) : (
                  <span className="text-stone-300">—</span>
                )}
              </td>
              <td className="text-center px-3 py-3">
                {r.has_published_translation ? (
                  <Languages className="w-4 h-4 text-green-500 mx-auto" />
                ) : (
                  <span className="text-stone-300">—</span>
                )}
              </td>
              <td className="text-center px-3 py-3">
                {r.in_source_library && r.source_library_id ? (
                  <Link href={`/book/${r.source_library_id}`}
                    className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-800">
                    <BookOpen className="w-4 h-4" />
                  </Link>
                ) : (
                  <span className="text-stone-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
