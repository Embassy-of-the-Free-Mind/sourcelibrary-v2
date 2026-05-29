'use client';

import { useState } from 'react';

interface CompareResult {
  id: string;
  type: 'book' | 'page';
  book_id: string;
  slug?: string;
  title: string;
  author?: string;
  language?: string;
  published?: string;
  page_number?: number;
  snippet?: string;
  lanes: string[];
}
interface CompareResponse {
  query: string;
  tenant: string;
  scope: 'tenant' | 'global';
  count: number;
  ladder: CompareResult[];
  rrf: CompareResult[];
}

// Seed queries span the categories where the two rankings diverge most — the
// eval showed RRF wins niche/conceptual but regresses verbatim-quote and
// broad-theme, so librarian preference on those is the decisive signal.
const EXAMPLE_QUERIES = [
  'alchemy and the transformation of the soul', // conceptual
  'rosicrucian manifestos',                      // broad theme
  '"lapis philosophorum"',                       // verbatim quote
  'Jacob Boehme on the seven properties',        // niche passage
  'kabbalah and the sefirot',                    // cross-lingual
];

type Winner = 'current' | 'new' | 'tie' | null;

export default function SearchCompareClient({ tenant }: { tenant: string }) {
  const [query, setQuery] = useState('');
  const [restrictToTenant, setRestrictToTenant] = useState(true);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, 1 | -1>>({});
  const [winner, setWinner] = useState<Winner>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function runSearch(q: string, restrict: boolean = restrictToTenant) {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    setLoading(true); setError(null); setData(null);
    setThumbs({}); setWinner(null); setNote(''); setSubmitted(false);
    try {
      const scope = restrict ? 'tenant' : 'global';
      const res = await fetch(`/api/search/compare?q=${encodeURIComponent(trimmed)}&tenant=${encodeURIComponent(tenant)}&scope=${scope}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Search failed'); return; }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function toggleThumb(column: 'current' | 'new', r: CompareResult, vote: 1 | -1) {
    const key = `${column}:${r.id}`;
    setThumbs(prev => {
      const next = { ...prev };
      if (next[key] === vote) delete next[key];
      else next[key] = vote;
      return next;
    });
  }

  async function submitVote() {
    if (!data || !winner) return;
    const thumbArr = Object.entries(thumbs).map(([key, vote]) => {
      const [column, ...rest] = key.split(':');
      const id = rest.join(':');
      const col = column === 'current' ? data.ladder : data.rrf;
      const r = col.find(x => x.id === id);
      return { column, result_id: id, book_id: r?.book_id || '', page_number: r?.page_number, vote };
    });
    try {
      await fetch('/api/search/compare/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant, scope: data.scope, query: data.query, winner, note: note || undefined, thumbs: thumbArr }),
      });
      setSubmitted(true);
    } catch {
      setError('Could not save your response — please try again.');
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900">Search ranking — help us choose</h1>
        <p className="mt-1 text-sm text-stone-600">
          Two ways of ordering the same search results, side by side. Try your own queries, mark
          results that are good (👍) or bad (👎), and tell us which column reads better. Your
          feedback decides whether we switch.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
        className="mb-4 flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the collection…"
          className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none"
        />
        <button type="submit" disabled={loading} className="rounded-md bg-stone-800 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50">
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      <label className="mb-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={restrictToTenant}
          onChange={(e) => {
            const next = e.target.checked;
            setRestrictToTenant(next);
            if (query.trim().length >= 2) runSearch(query, next); // re-run with new scope
          }}
          className="h-4 w-4 rounded border-stone-300"
        />
        Restrict to {tenant.toUpperCase()} books only
        <span className="text-xs text-stone-400">(uncheck to search all of Source Library)</span>
      </label>

      <div className="mb-8 flex flex-wrap gap-2 text-xs">
        <span className="text-stone-500">Try:</span>
        {EXAMPLE_QUERIES.map((q) => (
          <button key={q} onClick={() => { setQuery(q); runSearch(q); }} className="rounded-full border border-stone-300 px-2 py-0.5 text-stone-600 hover:bg-stone-100">
            {q}
          </button>
        ))}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <p className="mb-3 text-sm text-stone-500">
            {data.count} result{data.count === 1 ? '' : 's'} for “{data.query}”
            {' · '}
            <span className="font-medium text-stone-600">{data.scope === 'tenant' ? `${tenant.toUpperCase()} only` : 'all of Source Library'}</span>
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Column label="Current" sub="how search works today" results={data.ladder} column="current" thumbs={thumbs} onThumb={toggleThumb} />
            <Column label="New (RRF)" sub="the proposed ordering" results={data.rrf} column="new" thumbs={thumbs} onThumb={toggleThumb} />
          </div>

          <div className="mt-8 rounded-lg border border-stone-200 bg-stone-50 p-4">
            <p className="mb-2 font-medium text-stone-800">Which column reads better for this query?</p>
            <div className="flex gap-2">
              {(['current', 'new', 'tie'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setWinner(w)}
                  className={`rounded-md border px-4 py-2 text-sm capitalize ${winner === w ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'}`}
                >
                  {w === 'current' ? 'Current' : w === 'new' ? 'New (RRF)' : 'About the same'}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional: what made one better? (e.g. found the right passage, missed an obvious book…)"
              className="mt-3 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none"
              rows={2}
            />
            <button
              onClick={submitVote}
              disabled={!winner || submitted}
              className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {submitted ? 'Thank you — recorded ✓' : 'Submit feedback'}
            </button>
            {submitted && (
              <button onClick={() => { setQuery(''); setData(null); }} className="ml-2 mt-3 text-sm text-stone-600 underline">
                Try another query
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Column({
  label, sub, results, column, thumbs, onThumb,
}: {
  label: string; sub: string; results: CompareResult[]; column: 'current' | 'new';
  thumbs: Record<string, 1 | -1>; onThumb: (c: 'current' | 'new', r: CompareResult, v: 1 | -1) => void;
}) {
  return (
    <div>
      <div className="mb-2 border-b border-stone-200 pb-1">
        <span className="font-semibold text-stone-900">{label}</span>
        <span className="ml-2 text-xs text-stone-500">{sub}</span>
      </div>
      <ol className="space-y-2">
        {results.map((r, i) => {
          const key = `${column}:${r.id}`;
          const v = thumbs[key];
          return (
            <li key={r.id} className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="mr-1 text-xs text-stone-400">{i + 1}.</span>
                  <span className="font-medium text-stone-900">{r.title}</span>
                  {r.type === 'page' && r.page_number != null && (
                    <span className="ml-1 text-xs text-amber-700">· p{r.page_number}</span>
                  )}
                  {r.author && <span className="ml-1 text-sm text-stone-500">— {r.author}</span>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onThumb(column, r, 1)} className={`rounded px-1.5 text-sm ${v === 1 ? 'bg-emerald-100' : 'hover:bg-stone-100'}`} aria-label="good result">👍</button>
                  <button onClick={() => onThumb(column, r, -1)} className={`rounded px-1.5 text-sm ${v === -1 ? 'bg-red-100' : 'hover:bg-stone-100'}`} aria-label="bad result">👎</button>
                </div>
              </div>
              <div className="mt-0.5 text-xs text-stone-400">
                {r.type === 'book' ? 'Book' : 'Passage'}{r.language ? ` · ${r.language}` : ''}{r.published ? ` · ${r.published}` : ''}
              </div>
              {r.snippet && <p className="mt-1 line-clamp-2 text-sm text-stone-600">{r.snippet}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
