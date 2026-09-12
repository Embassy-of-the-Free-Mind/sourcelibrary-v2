'use client';

import { useEffect, useState, useCallback } from 'react';

interface FeedbackItem {
  _id: string;
  message: string;
  page: string | null;
  name: string | null;
  email: string | null;
  created_at: string;
  read?: boolean;
  read_at?: string | null;
  addressed?: boolean;
  addressed_at?: string | null;
  addressed_by?: string | null;
  addressed_action?: string | null;
  addressed_link?: string | null;
  reply_message?: string | null;
  reply_sent_at?: string | null;
  reply_recipient?: string | null;
  channel?: 'mcp' | 'web' | null;
}

type Tab = 'unread' | 'read' | 'addressed';
type Channel = 'web' | 'mcp' | 'all';

function formatDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminFeedbackPage() {
  const [tab, setTab] = useState<Tab>('unread');
  // Human submissions are scarce and motivated; agent (MCP) submissions are
  // high-volume and would drown them in one queue — so human-first by default.
  const [channel, setChannel] = useState<Channel>('web');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<{ unread: number; read: number; addressed: number }>({ unread: 0, read: 0, addressed: 0 });
  const [channelCounts, setChannelCounts] = useState<{ web: number; mcp: number }>({ web: 0, mcp: 0 });
  const [loading, setLoading] = useState(false);
  const [actionDraft, setActionDraft] = useState<Record<string, { action: string; link: string; reply: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const channelParam = channel === 'all' ? '' : `&channel=${channel}`;
      const res = await fetch(`/api/feedback?status=${tab}&limit=200${channelParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.feedback || []);
      setCounts(data.counts || { unread: 0, read: 0, addressed: 0 });
      setChannelCounts(data.channel_counts || { web: 0, mcp: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tab, channel]);

  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(`Update failed: ${res.status}`);
      return false;
    }
    return true;
  }

  // Like patch(), but returns the parsed response (so callers can read `replied`).
  async function patchRaw(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; replied?: boolean } | null> {
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(`Update failed: ${res.status}`);
      return null;
    }
    return res.json();
  }

  async function markRead(id: string) {
    if (await patch(id, { read: true })) load();
  }

  async function markAddressed(item: FeedbackItem) {
    const id = item._id;
    const draft = actionDraft[id] || { action: '', link: '', reply: '' };
    if (!draft.action.trim()) {
      alert('Add a one-line action before marking addressed');
      return;
    }
    const willEmail = !!item.email && !item.reply_sent_at;
    if (willEmail && !confirm(`This will email ${item.email} to let them know their feedback was addressed. Continue?`)) {
      return;
    }
    const res = await patchRaw(id, {
      addressed: true,
      addressed_action: draft.action.trim(),
      addressed_link: draft.link.trim() || undefined,
      reply_message: draft.reply.trim() || undefined,
    });
    if (res) {
      if (willEmail && res.replied === false) {
        alert('Marked addressed, but the reply email failed to send (check RESEND_API_KEY / logs).');
      }
      setActionDraft(d => { const next = { ...d }; delete next[id]; return next; });
      load();
    }
  }

  async function unmarkAddressed(id: string) {
    if (!confirm('Unmark this feedback as addressed? It will move back to "read".')) return;
    if (await patch(id, { addressed: false })) load();
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Feedback</h1>
      <p className="text-sm text-stone-500 mb-4">From the &quot;Give Feedback&quot; button in the site footer and the public MCP <code>submit_feedback</code> tool. Mark items as <em>addressed</em> once a fix ships &mdash; if the submitter left an email, they&apos;re automatically notified (once).</p>

      <div className="flex gap-1 mb-4">
        {([['web', `Humans (${channelCounts.web})`], ['mcp', `Agents (${channelCounts.mcp})`], ['all', 'All']] as [Channel, string][]).map(([c, label]) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${channel === c ? 'border-accent-rust bg-accent-rust/10 text-accent-rust' : 'border-stone-200 text-stone-500 hover:text-stone-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-6 border-b border-stone-200">
        {(['unread', 'read', 'addressed'] as Tab[]).map(t => (
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
              <div className="text-xs text-stone-500 truncate">
                <span>{formatDate(item.created_at)}</span>
                {item.name && <span> · <span className="text-stone-700">{item.name}</span></span>}
                {item.email && <span className="text-stone-400"> &lt;{item.email}&gt;</span>}
                {item.channel === 'mcp' && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200 text-[10px] font-medium align-middle" title="Submitted by an AI agent via the MCP submit_feedback tool — treat claims as unverified">
                    MCP agent
                  </span>
                )}
              </div>
              {item.page && (
                <a href={item.page} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-rust hover:underline truncate max-w-[40ch]" title={item.page}>
                  {item.page}
                </a>
              )}
            </header>
            <p className="text-sm whitespace-pre-wrap text-stone-800 leading-relaxed">{item.message}</p>

            {item.addressed && (
              <div className="mt-3 pt-3 border-t border-stone-100 text-xs text-stone-600">
                <p>
                  <strong className="text-stone-700">Addressed</strong>
                  {item.addressed_at && <span> · {formatDate(item.addressed_at)}</span>}
                  {item.addressed_by && <span> · {item.addressed_by}</span>}
                </p>
                {item.addressed_action && <p className="mt-1 text-stone-700">{item.addressed_action}</p>}
                {item.addressed_link && (
                  <a href={item.addressed_link} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline mt-1 inline-block">{item.addressed_link}</a>
                )}
                {item.reply_sent_at ? (
                  <p className="mt-2 text-emerald-700">↩ Replied to {item.reply_recipient || item.email} · {formatDate(item.reply_sent_at)}</p>
                ) : item.email ? (
                  <p className="mt-2 text-stone-400">No reply email sent.</p>
                ) : null}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tab === 'unread' && (
                <button onClick={() => markRead(item._id)} className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors">
                  Mark read
                </button>
              )}
              {!item.addressed && (
                <>
                  <input
                    type="text"
                    placeholder="What was done (one line)"
                    value={actionDraft[item._id]?.action || ''}
                    onChange={e => setActionDraft(d => ({ ...d, [item._id]: { ...(d[item._id] || { action: '', link: '', reply: '' }), action: e.target.value } }))}
                    className="flex-1 min-w-[200px] text-xs px-2 py-1.5 border border-stone-200 rounded focus:outline-none focus:border-accent-rust"
                  />
                  <input
                    type="url"
                    placeholder="PR/commit URL (optional)"
                    value={actionDraft[item._id]?.link || ''}
                    onChange={e => setActionDraft(d => ({ ...d, [item._id]: { ...(d[item._id] || { action: '', link: '', reply: '' }), link: e.target.value } }))}
                    className="w-[26ch] text-xs px-2 py-1.5 border border-stone-200 rounded focus:outline-none focus:border-accent-rust"
                  />
                  {item.email && !item.reply_sent_at && (
                    <input
                      type="text"
                      placeholder={`Friendly note to ${item.email} (optional)`}
                      value={actionDraft[item._id]?.reply || ''}
                      onChange={e => setActionDraft(d => ({ ...d, [item._id]: { ...(d[item._id] || { action: '', link: '', reply: '' }), reply: e.target.value } }))}
                      className="flex-1 min-w-[200px] text-xs px-2 py-1.5 border border-stone-200 rounded focus:outline-none focus:border-accent-rust"
                    />
                  )}
                  <button onClick={() => markAddressed(item)} className="text-xs px-3 py-1.5 bg-accent-rust hover:bg-accent-rust/90 text-white rounded transition-colors">
                    {item.email && !item.reply_sent_at ? 'Mark addressed & email' : 'Mark addressed'}
                  </button>
                </>
              )}
              {item.addressed && (
                <button onClick={() => unmarkAddressed(item._id)} className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors">
                  Unmark addressed
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
