'use client';

import { useEffect, useState, useCallback } from 'react';

interface ProposalItem {
  _id: string;
  title: string;
  rationale: string;
  suggested_slug: string | null;
  book_ids: string[];
  proposer_name: string | null;
  proposer_email: string | null;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_collection_slug?: string | null;
}

type Tab = 'pending' | 'approved' | 'rejected';

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminCollectionProposalsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [counts, setCounts] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/collection-proposals?status=${tab}&limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.proposals || []);
      setCounts(data.counts || { pending: 0, approved: 0, rejected: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function act(item: ProposalItem, action: 'approve' | 'reject') {
    const slug = action === 'approve'
      ? (prompt('Slug for the new collection (blank = derive from title):', item.suggested_slug || '') ?? undefined)
      : undefined;
    if (action === 'approve' && slug === undefined) return; // cancelled
    const note = action === 'reject' ? (prompt('Reason for rejecting (optional):', '') ?? undefined) : undefined;
    if (action === 'reject' && note === undefined) return; // cancelled

    setBusy(item._id);
    try {
      const res = await fetch(`/api/collection-proposals/${item._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, slug: slug || undefined, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`${action} failed: ${data.error || res.status}`);
        return;
      }
      if (action === 'approve') {
        alert(`Created hidden draft collection "${data.collection_slug}" (${data.books_tagged} books tagged). Review & flip visible in the book-collections admin.`);
      }
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Collection proposals</h1>
      <p className="text-sm text-stone-500 mb-6">Themed-collection proposals submitted via the <code>propose_collection</code> MCP tool / <code>/api/collection-proposals</code>. Untrusted input — review the rationale and books before approving. <strong>Approve</strong> mints a <em>hidden draft</em> collection (books tagged, <code>visible:false</code>); flip it public in the book-collections admin after review.</p>

      <div className="flex gap-2 mb-6 border-b border-stone-200">
        {(['pending', 'approved', 'rejected'] as Tab[]).map(t => (
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
        <p className="text-sm text-stone-500">No <em>{tab}</em> proposals.</p>
      )}

      <div className="space-y-4">
        {items.map(item => (
          <article key={item._id} className="border border-stone-200 rounded-lg p-4 bg-white">
            <header className="flex items-baseline justify-between gap-4 mb-2">
              <h2 className="text-base font-semibold text-stone-800">
                {item.title}
                {item.suggested_slug && <span className="ml-2 text-xs font-mono text-stone-400">/{item.suggested_slug}</span>}
              </h2>
              <div className="text-xs text-stone-500 whitespace-nowrap">
                {formatDate(item.created_at)}
                {item.proposer_name && <span> · <span className="text-stone-700">{item.proposer_name}</span></span>}
                {item.proposer_email && <span className="text-stone-400"> &lt;{item.proposer_email}&gt;</span>}
              </div>
            </header>

            <p className="text-sm whitespace-pre-wrap text-stone-700 leading-relaxed mb-3">{item.rationale}</p>

            <div className="text-xs text-stone-500 mb-3">
              <span className="font-medium text-stone-600">{item.book_ids.length} books:</span>{' '}
              {item.book_ids.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <a
                    href={`https://sourcelibrary.org/book/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-rust hover:underline font-mono"
                  >
                    {id}
                  </a>
                </span>
              ))}
            </div>

            {item.status === 'pending' ? (
              <div className="flex gap-2">
                <button
                  disabled={busy === item._id}
                  onClick={() => act(item, 'approve')}
                  className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors disabled:opacity-50"
                >
                  Approve → draft collection
                </button>
                <button
                  disabled={busy === item._id}
                  onClick={() => act(item, 'reject')}
                  className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="text-xs text-stone-500">
                {item.status === 'approved' && item.created_collection_slug && (
                  <span>Approved → <a href={`/collections/${item.created_collection_slug}`} className="text-accent-rust hover:underline">/collections/{item.created_collection_slug}</a> (draft)</span>
                )}
                {item.status === 'rejected' && <span>Rejected{item.review_note ? ` — ${item.review_note}` : ''}</span>}
                {item.reviewed_by && <span className="text-stone-400"> · by {item.reviewed_by}</span>}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
