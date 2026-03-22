'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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
  format: string;
  has_scan: boolean;
  has_iiif_scan: boolean;
  scan_sources: string[];
  iiif_manifest_url: string | null;
  has_published_translation: boolean;
  has_english_translation: boolean;
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

// ─── Helpers ─────────────────────────────────────────────────────────────

function iiifViewerUrl(manifestUrl: string): string {
  return `https://uv-v4.netlify.app/#?manifest=${encodeURIComponent(manifestUrl)}`;
}

function ustcUrl(ustcId: number): string {
  return `https://www.ustc.ac.uk/editions/${ustcId}`;
}

function resultHasScan(r: SearchResult): boolean {
  return r.has_iiif_scan ?? r.has_scan ?? false;
}
function resultHasTranslation(r: SearchResult): boolean {
  return r.has_english_translation ?? r.has_published_translation ?? false;
}

function pct(n: number, total: number): string {
  return total > 0 ? (n / total * 100).toFixed(1) : '0';
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
  const [activeTab, setActiveTab] = useState<'overview' | 'gaps' | 'search' | 'timeline'>('overview');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterHasScan, setFilterHasScan] = useState<string>('');
  const [filterHasTranslation, setFilterHasTranslation] = useState<string>('');
  const [timelineLanguage, setTimelineLanguage] = useState('');

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const sumRes = await fetch('/api/catalog/coverage?mode=summary');
      setSummary(await sumRes.json());
    } catch (err) {
      console.error('Failed to load summary:', err);
    } finally {
      setLoading(false);
    }
    try {
      const worksRes = await fetch('/api/catalog/coverage?mode=works');
      if (worksRes.ok) setWorks(await worksRes.json());
    } catch (err) {
      console.error('Failed to load works:', err);
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

  const doSearch = useCallback(async (overrides?: { scan?: string; translation?: string; language?: string }) => {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'search');
      if (searchQuery) params.set('q', searchQuery);
      const lang = overrides?.language ?? filterLanguage;
      const scan = overrides?.scan ?? filterHasScan;
      const trans = overrides?.translation ?? filterHasTranslation;
      if (lang) params.set('language', lang);
      if (scan) params.set('has_scan', scan);
      if (trans) params.set('has_translation', trans);
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

  const browseGap = useCallback((scan: string, translation: string, language?: string) => {
    setFilterHasScan(scan);
    setFilterHasTranslation(translation);
    setSearchQuery('');
    if (language) setFilterLanguage(language);
    setActiveTab('search');
    setTimeout(() => doSearch({ scan, translation, language }), 0);
  }, [doSearch]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (activeTab === 'timeline') loadTimeline(timelineLanguage);
  }, [activeTab, timelineLanguage, loadTimeline]);

  useEffect(() => {
    if (activeTab === 'gaps') doSearch({ scan: 'true', translation: 'false' });
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fdfcf9] flex items-center justify-center">
        <BookLoader />
      </div>
    );
  }

  if (summary?.status === 'empty') {
    return (
      <div className="min-h-screen bg-[#fdfcf9] p-8">
        <div className="max-w-2xl mx-auto text-center mt-20">
          <h1 className="font-['Cormorant_Garamond'] text-3xl text-[#1a1612] mb-4">Catalog Coverage</h1>
          <p className="text-[#6b6560] mb-6">No data yet. Run the build script:</p>
          <pre className="bg-[#1a1612] text-[#f5f0e8] p-4 rounded-lg text-sm text-left overflow-x-auto">
{`set -a; source .env.production.local; set +a
node scripts/catalog-coverage/build.mjs`}
          </pre>
        </div>
      </div>
    );
  }

  const t = summary?.total;
  const scannedNotTranslated = works?.works_scanned_not_translated ?? 0;

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      {/* Header */}
      <div className="border-b border-[#e8e4dc] px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <Link href="/admin" className="text-sm text-[#6b6560] hover:text-[#9e4a3a] mb-2 inline-block">&larr; Admin</Link>
          <h1 className="font-['Cormorant_Garamond'] text-3xl font-semibold text-[#1a1612]">Catalog Coverage</h1>
          <p className="text-[#6b6560] mt-1">
            Every edition printed in Europe, 1450{'\u2013'}1700. What has been scanned, what has been translated.
            {summary?.built_at && <span className="text-[#a09a92]"> {'\u00B7'} Built {new Date(summary.built_at).toLocaleDateString()}</span>}
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary — narrative flow */}
        {t && (() => {
          const nonEnglish = summary?.by_language.filter(l => l.language !== 'English').reduce((s, l) => s + l.editions, 0) ?? 0;
          const engEditions = summary?.by_language.find(l => l.language === 'English')?.editions ?? 0;
          const engScans = summary?.by_language.find(l => l.language === 'English')?.with_scan ?? 0;
          const nonEngScans = t.with_scan - engScans;
          const totalWorks = works?.total_works ?? t.distinct_works;
          return (
            <div className="mb-10 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                <div>
                  <div className="font-['Cormorant_Garamond'] text-4xl font-semibold text-[#1a1612]">{t.editions.toLocaleString()}</div>
                  <div className="text-sm text-[#6b6560] mt-1">editions catalogued</div>
                </div>
                <div>
                  <div className="font-['Cormorant_Garamond'] text-4xl font-semibold text-[#1a1612]">{nonEnglish.toLocaleString()}</div>
                  <div className="text-sm text-[#6b6560] mt-1">non-English editions</div>
                </div>
                <div>
                  <div className="font-['Cormorant_Garamond'] text-4xl font-semibold text-[#1a1612]">{totalWorks.toLocaleString()}</div>
                  <div className="text-sm text-[#6b6560] mt-1">distinct works</div>
                </div>
                <div>
                  <div className="font-['Cormorant_Garamond'] text-4xl font-semibold text-[#1a1612]">{t.with_scan.toLocaleString()}</div>
                  <div className="text-sm text-[#6b6560] mt-1">with digital scans <span className="text-[#a09a92]">({pct(t.with_scan, t.editions)}%)</span></div>
                </div>
              </div>
              <p className="text-[#444] max-w-3xl leading-relaxed">
                Of these, <strong>{pct(t.with_translation, nonEnglish)}%</strong> of non-English editions have a known English translation.
                Scan coverage is uneven: <strong>{pct(nonEngScans, nonEnglish)}%</strong> of continental editions
                have been digitized via BSB, Gallica, e-rara, and Biblissima, while only{' '}
                <strong>{pct(engScans, engEditions)}%</strong> of English editions appear{' '}
                {'\u2014'} not because they haven&apos;t been scanned, but because EEBO, HathiTrust, and the
                Bodleian are not yet in our harvest.
              </p>
            </div>
          );
        })()}

        {/* The Opportunity */}
        {works && scannedNotTranslated > 0 && (
          <div className="border border-[#e8e4dc] rounded-lg p-6 mb-10 bg-[#f5f0e8]">
            <h2 className="font-['Cormorant_Garamond'] text-xl font-semibold text-[#1a1612] mb-2">The Opportunity</h2>
            <p className="text-[#444]">
              <span className="font-['Cormorant_Garamond'] text-3xl font-semibold text-[#9e4a3a]">{scannedNotTranslated.toLocaleString()}</span>{' '}
              works have been digitized but never translated into English.
              They are waiting to be read.
            </p>
            {works.works_neither > 0 && (
              <p className="text-sm text-[#6b6560] mt-2">
                Another {works.works_neither.toLocaleString()} works have neither been scanned nor translated.
              </p>
            )}
            <button
              onClick={() => browseGap('true', 'false')}
              className="mt-4 px-4 py-2 bg-[#9e4a3a] text-white rounded text-sm hover:bg-[#8a3f32] transition-colors"
            >
              Browse these books &rarr;
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-6 mb-6 border-b border-[#e8e4dc]">
          {(['overview', 'gaps', 'timeline', 'search'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm transition-colors ${
                activeTab === tab
                  ? 'text-[#1a1612] border-b-2 border-[#9e4a3a] font-medium'
                  : 'text-[#6b6560] hover:text-[#1a1612]'
              }`}
            >
              {tab === 'overview' ? 'By Language' : tab === 'gaps' ? 'Actionable Gaps' : tab === 'timeline' ? 'By Decade' : 'Search'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && summary?.by_language && (
          <LanguageTable data={summary.by_language} onLanguageClick={(lang) => browseGap('true', 'false', lang)} />
        )}

        {activeTab === 'gaps' && (
          <div>
            <div className="flex flex-wrap gap-3 mb-5">
              {[
                { label: 'Scanned, not translated', count: works?.works_scanned_not_translated, scan: 'true', trans: 'false' },
                { label: 'Neither scanned nor translated', count: works?.works_neither, scan: 'false', trans: 'false' },
                { label: 'Both scanned and translated', count: works?.works_with_translation, scan: 'true', trans: 'true' },
              ].map(g => {
                const active = filterHasScan === g.scan && filterHasTranslation === g.trans;
                return (
                  <button
                    key={g.label}
                    onClick={() => { setFilterHasScan(g.scan); setFilterHasTranslation(g.trans); doSearch({ scan: g.scan, translation: g.trans }); }}
                    className={`px-3 py-2 rounded text-sm border transition-colors ${
                      active ? 'border-[#9e4a3a] bg-[#f5f0e8] text-[#9e4a3a]' : 'border-[#e8e4dc] text-[#6b6560] hover:border-[#d4cfc4]'
                    }`}
                  >
                    {g.label}{g.count !== undefined && <span className="ml-1 font-medium">{g.count.toLocaleString()}</span>}
                  </button>
                );
              })}
            </div>

            <select value={filterLanguage} onChange={e => { setFilterLanguage(e.target.value); doSearch({ scan: filterHasScan, translation: filterHasTranslation, language: e.target.value }); }}
              className="px-3 py-2 border border-[#e8e4dc] rounded text-sm bg-white text-[#444] mb-4">
              <option value="">All languages</option>
              {summary?.by_language.map(l => (
                <option key={l.language} value={l.language}>{l.language}</option>
              ))}
            </select>

            {searching && <div className="text-center py-8"><BookLoader /></div>}
            {!searching && searchTotal > 0 && (
              <p className="text-sm text-[#6b6560] mb-3">{searchTotal.toLocaleString()} editions</p>
            )}
            {!searching && searchResults.length > 0 && <SearchResultsTable results={searchResults} />}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div>
            <select
              value={timelineLanguage}
              onChange={e => setTimelineLanguage(e.target.value)}
              className="px-3 py-2 border border-[#e8e4dc] rounded text-sm bg-white text-[#444] mb-4"
            >
              <option value="">All languages</option>
              {summary?.by_language.map(l => (
                <option key={l.language} value={l.language}>{l.language}</option>
              ))}
            </select>
            {timeline && <TimelineChart data={timeline} />}
          </div>
        )}

        {activeTab === 'search' && (
          <div>
            <div className="flex flex-wrap gap-3 mb-5">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Search by title or author..."
                className="flex-1 min-w-[200px] px-3 py-2 border border-[#e8e4dc] rounded text-sm text-[#444] placeholder:text-[#a09a92]"
              />
              <select value={filterLanguage} onChange={e => setFilterLanguage(e.target.value)}
                className="px-3 py-2 border border-[#e8e4dc] rounded text-sm bg-white text-[#444]">
                <option value="">Any language</option>
                {summary?.by_language.map(l => (
                  <option key={l.language} value={l.language}>{l.language}</option>
                ))}
              </select>
              <select value={filterHasScan} onChange={e => setFilterHasScan(e.target.value)}
                className="px-3 py-2 border border-[#e8e4dc] rounded text-sm bg-white text-[#444]">
                <option value="">Any scan status</option>
                <option value="true">Has scan</option>
                <option value="false">No scan</option>
              </select>
              <select value={filterHasTranslation} onChange={e => setFilterHasTranslation(e.target.value)}
                className="px-3 py-2 border border-[#e8e4dc] rounded text-sm bg-white text-[#444]">
                <option value="">Any translation</option>
                <option value="true">Has translation</option>
                <option value="false">No translation</option>
              </select>
              <button
                onClick={() => doSearch()}
                disabled={searching}
                className="px-4 py-2 bg-[#1a1612] text-[#f5f0e8] rounded text-sm hover:bg-[#2a2622] disabled:opacity-50"
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {searchTotal > 0 && <p className="text-sm text-[#6b6560] mb-3">{searchTotal.toLocaleString()} results</p>}
            {searchResults.length > 0 && <SearchResultsTable results={searchResults} />}
          </div>
        )}

        {/* Methodology */}
        <details className="mt-10 border-t border-[#e8e4dc] pt-6">
          <summary className="cursor-pointer text-sm text-[#6b6560] hover:text-[#444]">
            How this was constructed
          </summary>
          <div className="mt-4 text-sm text-[#6b6560] space-y-4 max-w-3xl">
            <p>
              This coverage map joins four data sources to show, for every book printed between 1450 and 1700,
              whether a digital scan exists and whether an English translation exists.
            </p>
            <div className="space-y-3">
              <p>
                <strong className="text-[#444]">USTC.</strong>{' '}
                The Universal Short Title Catalogue (St Andrews) records every known edition printed in Europe before 1700.
                We query 1.6M records across 9 languages.
              </p>
              <p>
                <strong className="text-[#444]">Scans.</strong>{' '}
                828K IIIF digitizations from BSB Munich, e-rara, Gallica, and Biblissima, matched by author surname
                + decade + title overlap. Latin and Italian suffixes stripped for cross-form matching.
              </p>
              <p>
                <strong className="text-[#444]">Translations.</strong>{' '}
                13,862 known English translations from UNESCO, Loeb, Penguin, Cambridge, and HathiTrust, matched
                at author level with 120+ Latin-to-English name aliases.
              </p>
              <p>
                <strong className="text-[#444]">Source Library.</strong>{' '}
                Our own collection, matched by USTC ID or author + title similarity.
              </p>
            </div>
            <p className="text-xs text-[#a09a92]">
              Caveats: translation matching is at author level, not work level. Distinct works approximated by
              normalized title. IIIF coverage limited to 4 harvested sources. Translation catalog is English-only.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function LanguageTable({ data, onLanguageClick }: { data: LanguageStat[]; onLanguageClick: (lang: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#e8e4dc]">
            <th className="text-left py-3 pr-4 font-medium text-[#6b6560]">Language</th>
            <th className="text-right py-3 px-4 font-medium text-[#6b6560]">Editions</th>
            <th className="text-right py-3 px-4 font-medium text-[#6b6560]">Scanned</th>
            <th className="text-right py-3 px-4 font-medium text-[#6b6560]">Translated</th>
            <th className="text-right py-3 px-4 font-medium text-[#6b6560]">In SL</th>
            <th className="text-right py-3 pl-4 font-medium text-[#6b6560]">Gap</th>
          </tr>
        </thead>
        <tbody>
          {data.map(l => {
            const gap = Math.max(0, l.with_scan - l.with_translation);
            return (
              <tr key={l.language} className="border-b border-[#f5f0e8] hover:bg-[#f5f0e8]/50">
                <td className="py-3 pr-4 text-[#1a1612]">{l.language}</td>
                <td className="py-3 px-4 text-right text-[#444] tabular-nums">{l.editions.toLocaleString()}</td>
                <td className="py-3 px-4 text-right tabular-nums">
                  <span className="text-[#444]">{l.with_scan.toLocaleString()}</span>
                  <span className="text-[#a09a92] ml-1 text-xs">{l.pct_scanned}%</span>
                </td>
                <td className="py-3 px-4 text-right tabular-nums">
                  <span className="text-[#444]">{l.with_translation.toLocaleString()}</span>
                  <span className="text-[#a09a92] ml-1 text-xs">{l.pct_translated}%</span>
                </td>
                <td className="py-3 px-4 text-right text-[#444] tabular-nums">{l.in_source_library.toLocaleString()}</td>
                <td className="py-3 pl-4 text-right">
                  {gap > 0 ? (
                    <button
                      onClick={() => onLanguageClick(l.language)}
                      className="text-[#9e4a3a] hover:underline tabular-nums"
                    >
                      {gap.toLocaleString()}
                    </button>
                  ) : (
                    <span className="text-[#d4cfc4]">{'\u2014'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TimelineChart({ data }: { data: TimelineDecade[] }) {
  const maxEditions = Math.max(...data.map(d => d.editions), 1);

  return (
    <div>
      <div className="flex items-center gap-6 mb-4 text-xs text-[#6b6560]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#e8e4dc] inline-block" /> Total</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#c9a86c] inline-block" /> Scanned</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#8b9a7d] inline-block" /> Translated</span>
      </div>
      <div className="space-y-0.5">
        {data.map(d => (
          <div key={d.decade} className="flex items-center gap-2 group">
            <div className="w-10 text-xs text-[#a09a92] text-right shrink-0 tabular-nums">{d.decade}</div>
            <div className="flex-1 relative h-5">
              <div className="absolute inset-y-0 left-0 bg-[#e8e4dc] rounded-sm" style={{ width: `${(d.editions / maxEditions) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 bg-[#c9a86c] rounded-sm" style={{ width: `${(d.with_scan / maxEditions) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 bg-[#8b9a7d] rounded-sm" style={{ width: `${(d.with_translation / maxEditions) * 100}%` }} />
              <div className="absolute inset-0 flex items-center px-2 text-[11px] text-[#444] opacity-0 group-hover:opacity-100 transition-opacity">
                {d.editions.toLocaleString()} editions {'\u00B7'} {d.pct_scanned}% scanned {'\u00B7'} {d.pct_translated}% translated
              </div>
            </div>
            <div className="w-16 text-xs text-[#a09a92] text-right shrink-0 tabular-nums">
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#e8e4dc]">
            <th className="text-left py-3 pr-4 font-medium text-[#6b6560]">Title</th>
            <th className="text-right py-3 px-3 font-medium text-[#6b6560] w-14">Year</th>
            <th className="text-center py-3 px-3 font-medium text-[#6b6560] w-16">Scan</th>
            <th className="text-center py-3 px-3 font-medium text-[#6b6560] w-20">Translation</th>
            <th className="text-center py-3 pl-3 font-medium text-[#6b6560] w-12">SL</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.ustc_id} className="border-b border-[#f5f0e8] hover:bg-[#f5f0e8]/50">
              <td className="py-3 pr-4">
                <div className="text-[#1a1612] line-clamp-1">{r.title || 'Untitled'}</div>
                <div className="text-xs text-[#a09a92] mt-0.5 line-clamp-1">
                  {r.author || 'Unknown'} {'\u00B7'} {r.language} {'\u00B7'} {r.place || '?'}
                  {' '}{'\u00B7'}{' '}
                  <a href={ustcUrl(r.ustc_id)} target="_blank" rel="noopener noreferrer"
                    className="text-[#a09a92] hover:text-[#9e4a3a] underline decoration-dotted underline-offset-2">
                    USTC {r.ustc_id}
                  </a>
                </div>
              </td>
              <td className="py-3 px-3 text-right text-[#444] tabular-nums">{r.year || '?'}</td>
              <td className="py-3 px-3 text-center">
                {resultHasScan(r) ? (
                  r.iiif_manifest_url ? (
                    <a href={iiifViewerUrl(r.iiif_manifest_url)} target="_blank" rel="noopener noreferrer"
                      className="text-[#9e4a3a] hover:underline text-xs"
                      title={`View scan (${(r.scan_sources || []).join(', ')})`}>
                      {r.scan_sources?.[0] || 'view'}
                    </a>
                  ) : (
                    <span className="text-xs text-[#c9a86c]">{r.scan_sources?.[0] || 'yes'}</span>
                  )
                ) : (
                  <span className="text-[#d4cfc4]">{'\u2014'}</span>
                )}
              </td>
              <td className="py-3 px-3 text-center">
                {resultHasTranslation(r) ? (
                  <span className="text-xs text-[#8b9a7d]" title={`Sources: ${(r.translation_sources || []).join(', ')}`}>
                    {r.translation_sources?.[0] || 'yes'}
                  </span>
                ) : (
                  <span className="text-[#d4cfc4]">{'\u2014'}</span>
                )}
              </td>
              <td className="py-3 pl-3 text-center">
                {r.in_source_library && r.source_library_id ? (
                  <Link href={`/book/${r.source_library_id}`} className="text-xs text-[#7c5db5] hover:underline">
                    yes
                  </Link>
                ) : (
                  <span className="text-[#d4cfc4]">{'\u2014'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
