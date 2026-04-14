'use client';

import { useState, useCallback } from 'react';
import { Search, BookOpen, Check, X, ExternalLink } from 'lucide-react';

interface CatalogMatch {
  source: string;
  english_title: string;
  translator?: string;
  pub_year?: string;
  publisher?: string;
  completeness?: string;
}

interface CensusResult {
  ustc_id: number;
  title: string;
  english_title?: string;
  author: string;
  year?: number;
  language: string;
  place?: string;
  has_iiif_scan: boolean;
  has_english_translation: boolean;
  in_source_library: boolean;
  translation_status: 'translated' | 'untranslated';
  catalog_matches: CatalogMatch[];
}

export default function CensusSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CensusResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [catalogCount, setCatalogCount] = useState(0);

  const search = useCallback(async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/census/search?q=${encodeURIComponent(query.trim())}&limit=30`);
      const data = await res.json();
      setResults(data.results || []);
      setCatalogCount(data.catalog_entries || 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') search();
  };

  const translated = results.filter(r => r.translation_status === 'translated');
  const untranslated = results.filter(r => r.translation_status === 'untranslated');

  return (
    <div>
      {/* Search box */}
      <div className="relative mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search by author or title... e.g. Ficino, Paracelsus, De Vita"
              className="w-full pl-10 pr-4 py-3 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            />
          </div>
          <button
            onClick={search}
            disabled={loading || query.trim().length < 2}
            className="px-5 py-3 bg-stone-900 text-white rounded-lg text-sm font-medium hover:bg-stone-800 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        <p className="text-xs text-stone-400 mt-2">
          Searches 1.57 million editions from the Universal Short Title Catalogue and 13,800+ known English translations.
        </p>
      </div>

      {/* Results */}
      {searched && !loading && (
        <div>
          {results.length === 0 ? (
            <div className="text-center py-8 text-secondary">
              <BookOpen className="w-8 h-8 mx-auto mb-2 text-stone-300" />
              <p>No editions found for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-stone-400 mt-1">Try searching by author surname or a shorter title</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex items-center gap-4 text-sm text-secondary border-b border-stone-100 pb-3">
                <span>{results.length} editions found</span>
                {catalogCount > 0 && (
                  <span className="text-emerald-700">{catalogCount} known translations in catalogs</span>
                )}
              </div>

              {/* Translated works */}
              {translated.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-emerald-800 mb-2 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    Has known English translation ({translated.length})
                  </h3>
                  <div className="space-y-2">
                    {translated.map((r, i) => (
                      <ResultCard key={`t-${i}`} result={r} />
                    ))}
                  </div>
                </div>
              )}

              {/* Untranslated works */}
              {untranslated.length > 0 && (
                <div className={translated.length > 0 ? 'mt-6' : ''}>
                  <h3 className="text-sm font-medium text-stone-500 mb-2 flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5" />
                    No known English translation ({untranslated.length})
                  </h3>
                  <div className="space-y-2">
                    {untranslated.map((r, i) => (
                      <ResultCard key={`u-${i}`} result={r} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: CensusResult }) {
  const isTranslated = result.translation_status === 'translated';

  return (
    <div className={`border rounded-lg p-3 ${isTranslated ? 'border-emerald-200 bg-emerald-50/30' : 'border-stone-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-primary truncate">{result.title}</div>
          {result.english_title && result.english_title !== result.title && (
            <div className="text-xs text-stone-500 italic truncate">{result.english_title}</div>
          )}
          <div className="text-xs text-secondary mt-0.5">
            {result.author}
            {result.year ? ` (${result.year})` : ''}
            {result.place ? ` — ${result.place}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {result.language && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{result.language}</span>
          )}
          {result.in_source_library && (
            <a
              href={`https://sourcelibrary.org/search?q=${encodeURIComponent(result.author?.split(',')[0] || result.title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors flex items-center gap-0.5"
            >
              In SL <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          {result.has_iiif_scan && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Scanned</span>
          )}
        </div>
      </div>

      {/* Show catalog matches */}
      {result.catalog_matches.length > 0 && (
        <div className="mt-2 pt-2 border-t border-stone-100">
          <div className="text-[10px] text-stone-400 mb-1">Known translations:</div>
          {result.catalog_matches.slice(0, 3).map((m, i) => (
            <div key={i} className="text-xs text-secondary flex items-start gap-1">
              <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">{m.english_title}</span>
                {m.translator && <span className="text-stone-400"> — tr. {m.translator}</span>}
                {m.pub_year && <span className="text-stone-400"> ({m.pub_year})</span>}
                {m.publisher && <span className="text-stone-400"> [{m.publisher}]</span>}
                <span className="text-stone-300 ml-1">({m.source})</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
