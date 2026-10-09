'use client';

/**
 * Pre-import holdings check (#6019). Derek pastes a library URL or a title
 * before importing and gets, in seconds: we hold this scan / we hold another
 * edition / new — with links, hidden copies included. The logic is
 * src/lib/holdings-check.ts; this page only asks and shows.
 */

import { useState } from 'react';
import { Search } from 'lucide-react';

interface Candidate {
  book_id: string;
  url: string;
  reason: string;
  reason_detail: string;
  collection: 'books' | 'books_warehouse';
  title: string;
  author: string | null;
  year: number | null;
  language: string | null;
  visible: boolean;
  hidden: boolean;
  hidden_reason: string | null;
  duplicate_of: string | null;
  pages_count: number;
  pages_translated: number;
  provider: string | null;
}

interface Result {
  verdict: string;
  summary: string;
  candidates: Candidate[];
  limits: string[];
}

const VERDICT_LABEL: Record<string, string> = {
  same_object: 'We hold this scan',
  same_edition: 'We hold this edition',
  possible_same_edition: 'Possibly this edition',
  other_edition: 'We hold another edition',
  related_title: 'Similar titles only',
  new: 'New',
};

const VERDICT_COLOR: Record<string, string> = {
  same_object: 'var(--accent-rust)',
  same_edition: 'var(--accent-rust)',
  possible_same_edition: 'var(--accent-gold)',
  other_edition: 'var(--accent-gold)',
  related_title: 'var(--text-muted)',
  new: 'var(--text-primary)',
};

export default function HoldingsCheckPage() {
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (author.trim()) params.set('author', author.trim());
      if (year.trim()) params.set('year', year.trim());
      const res = await fetch(`/api/admin/holdings-check?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = { background: 'var(--bg-white)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Do we hold this?</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Paste a library URL (Internet Archive, Gallica, e-rara, BSB, a IIIF manifest), one of our book links, or a title, before importing. Hidden books and the warehouse are included.
      </p>

      <form onSubmit={run} className="space-y-3 mb-8">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="https://archive.org/details/…  or  Närrische Weißheit"
          className="w-full px-4 py-3 rounded-lg text-base"
          style={inputStyle}
        />
        <div className="flex flex-wrap gap-3">
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author (optional)" className="flex-1 min-w-[10rem] px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" inputMode="numeric" className="w-24 px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          <button type="submit" disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80" style={{ background: 'var(--text-primary)', color: 'var(--bg-white)' }}>
            <Search size={14} />
            {loading ? 'Checking…' : 'Check'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm" style={{ color: 'var(--accent-rust)' }}>{error}</p>}

      {result && (
        <div>
          <div className="mb-4">
            <div className="text-lg font-semibold" style={{ color: VERDICT_COLOR[result.verdict] }}>
              {VERDICT_LABEL[result.verdict] ?? result.verdict}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{result.summary}</p>
          </div>

          <ul className="space-y-2">
            {result.candidates.map((c) => (
              <li key={`${c.collection}:${c.book_id}`} className="rounded-lg px-4 py-3" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <a href={c.url} target="_blank" rel="noreferrer" className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                    {c.title || c.book_id}
                  </a>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {[c.author, c.year, c.language].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span className="px-1.5 py-0.5 rounded" style={{ border: '1px solid var(--border-light)' }}>{c.reason.replace(/_/g, ' ')}</span>
                  <span className="px-1.5 py-0.5 rounded" style={{ border: '1px solid var(--border-light)', color: c.visible ? 'var(--text-muted)' : 'var(--accent-rust)' }}>
                    {c.collection === 'books_warehouse' ? 'warehouse' : c.visible ? 'visible' : `hidden${c.hidden_reason ? `: ${c.hidden_reason}` : ''}`}
                  </span>
                  {c.duplicate_of && <span className="px-1.5 py-0.5 rounded" style={{ border: '1px solid var(--border-light)' }}>duplicate of {c.duplicate_of}</span>}
                  <span>{c.pages_count} pp · {c.pages_translated} translated{c.provider ? ` · ${c.provider}` : ''}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{c.reason_detail}</div>
              </li>
            ))}
          </ul>

          {result.limits.length > 0 && (
            <ul className="mt-4 text-xs space-y-1" style={{ color: 'var(--text-faint)' }}>
              {result.limits.map((l) => <li key={l}>{l}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
