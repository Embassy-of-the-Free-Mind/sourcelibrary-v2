'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

interface Result { id: string; title: string; display_title: string | null; author: string }

/** Choose a book to make a cover for. */
export default function CoverMakerPicker() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/books/search?q=${encodeURIComponent(term)}&limit=30`, { signal: ctl.signal })
        .then(r => r.json())
        .then(d => setResults(d.results || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const shown = q.trim().length >= 2 ? results : [];

  return (
    <div>
      <label className="relative block mb-6">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by title or author"
          className="w-full pl-10 pr-3 py-3 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-white)]"
          style={{ fontSize: 16 }}
        />
      </label>
      {loading && <p className="text-sm text-[var(--text-muted)]">Searching…</p>}
      <ul className="divide-y divide-[var(--border-light)]">
        {shown.map(r => (
          <li key={r.id}>
            <Link href={`/admin/covers/${r.id}`} className="block py-3 hover:bg-[var(--bg-warm)] -mx-2 px-2 rounded">
              <span className="block">{r.display_title || r.title}</span>
              <span className="block text-sm text-[var(--text-muted)]">{r.author}</span>
            </Link>
          </li>
        ))}
      </ul>
      {!loading && q.trim().length >= 2 && !shown.length && <p className="text-sm text-[var(--text-muted)]">No books found.</p>}
    </div>
  );
}
