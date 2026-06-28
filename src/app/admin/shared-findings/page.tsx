'use client';

import { useEffect, useState, useCallback } from 'react';

interface Citation {
  book_id: string;
  page: number;
  note: string | null;
}

interface FindingItem {
  _id: string;
  title: string;
  summary: string | null;
  citations: Citation[];
  name: string | null;
  email: string | null;
  created_at: string;
  read?: boolean;
}

type Tab = 'unread' | 'read';

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminSharedFindingsPage() {
  const [tab, setTab] = useState<Tab>('unread');
  const [items, setItems] = useState<FindingItem[]>([]);
  const [counts, setCounts] = useState<{ unread: number; read: number }>({ unread: 0, read: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/share-findings?status=${tab}&limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.findings || []);
      setCounts(data.counts || { unread: 0, read: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function setRead(id: string, read: boolean) {
    const res = await fetch(`/api/share-findings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read }),
    });
    if (res.ok) load();
    else alert(`Update failed: ${res.status}`);
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Shared findings</h1>
      <p className="text-sm text-stone-500 mb-6">Research dossiers shared back via the <code>share_findings</code> tool / <code>/api/share-findings</code>. Each is a title + summary + ordered citations (references, not copied text). Review and, if worthwhile, curate into a collection.</p>

      <div className="flex gap-2 mb-6 border-b border-stone-200">
        {(['unread', 'read'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-accent-rust text-accent-rust' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)} <span className="ml-1 text-xs text-stone-400">({counts[t]})</span>
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-stone-500">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-stone-500">No items in <em>{tab}</em>.</p>
      )}

      <div className="space-y-4">
        {items.map(item => (
          <article key={item._id} className="border border-stone-200 rounded-lg p-4 bg-white">
            <header className="flex items-baseline justify-between gap-4 mb-2">
              <h2 className="text-base font-semibold text-stone-800">{item.title}</h2>
              <div className="text-xs text-stone-500 whitespace-nowrap">
                {formatDate(item.created_at)}
                {item.name && <span> · <span className="text-stone-700">{item.name}</span></span>}
                {item.email && <span className="text-stone-400"> &lt;{item.email}&gt;</span>}
              </div>
            </header>

            {item.summary && (
              <p className="text-sm whitespace-pre-wrap text-stone-700 leading-relaxed mb-3">{item.summary}</p>
            )}

            <ol className="space-y-1.5 mb-3 list-decimal list-inside">
              {item.citations.map((c, i) => (
                <li key={i} className="text-sm text-stone-700">
                  <a
                    href={`https://sourcelibrary.org/book/${c.book_id}?page=${c.page}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-rust hover:underline font-mono text-xs"
                  >
                    {c.book_id} · p.{c.page}
                  </a>
                  {c.note && <span className="text-stone-500"> — {c.note}</span>}
                </li>
              ))}
            </ol>

            <div className="flex gap-2">
              {tab === 'unread' ? (
                <button onClick={() => setRead(item._id, true)} className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors">
                  Mark read
                </button>
              ) : (
                <button onClick={() => setRead(item._id, false)} className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors">
                  Mark unread
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
