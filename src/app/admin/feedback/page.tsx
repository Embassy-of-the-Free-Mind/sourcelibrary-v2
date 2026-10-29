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
  /** Internal notes: never emailed; the triage script prints them for the next job (#7678). */
  notes?: { text: string; by?: string; at: string }[];
  /** A saved, unsent message to the submitter. */
  reply_draft?: string | null;
  /** Emails actually sent to the submitter. */
  replies?: { message: string | null; link?: string | null; to: string; by?: string; at: string; kind?: string }[];
  /** Public R2 URLs written by /api/feedback/upload; absent on rows without pictures. */
  images?: string[];
}

type Tab = 'unread' | 'read' | 'addressed';
const TAB_LABEL: Record<Tab, string> = { unread: 'New', read: 'Open', addressed: 'Done' };

interface Draft { action: string; link: string; reply: string; note: string; notify: boolean }
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // A card's draft starts from what is saved on the row (the reply draft) and
  // defaults the done-email ON only while the submitter has not yet heard from us.
  const draftOf = (item: FeedbackItem): Draft => drafts[item._id] ?? {
    action: '', link: '', note: '', reply: item.reply_draft || '', notify: !!item.email && !item.reply_sent_at,
  };
  const setDraft = (item: FeedbackItem, patchDraft: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [item._id]: { ...draftOf(item), ...patchDraft } }));
  const clearDraft = (id: string) => setDrafts(d => { const next = { ...d }; delete next[id]; return next; });

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

  async function addNote(item: FeedbackItem) {
    const note = draftOf(item).note.trim();
    if (!note) return;
    if (await patch(item._id, { add_note: note })) { setDraft(item, { note: '' }); load(); }
  }

  // Saved on blur, so a half-written reply survives a reload or another admin.
  async function saveReplyDraft(item: FeedbackItem) {
    const reply = draftOf(item).reply;
    if (reply === (item.reply_draft || '')) return;
    await patch(item._id, { reply_draft: reply });
  }

  async function sendReply(item: FeedbackItem) {
    const d = draftOf(item);
    if (!item.email || !d.reply.trim()) return;
    if (!confirm(`Send this reply to ${item.email} now? The item stays open.`)) return;
    const res = await patchRaw(item._id, { send_reply: { message: d.reply.trim(), link: d.link.trim() || undefined } });
    if (res) {
      if (res.replied === false) {
        alert('The reply email failed to send (check RESEND_API_KEY / logs).');
        await patch(item._id, { reply_draft: d.reply });
      } else {
        setDraft(item, { reply: '' });
      }
      load();
    }
  }

  async function markDone(item: FeedbackItem) {
    const d = draftOf(item);
    const willEmail = !!item.email && d.notify && !item.reply_sent_at;
    if (willEmail && !confirm(`Mark done and email ${item.email}${d.reply.trim() ? ' your message' : ' that it was handled'}?`)) {
      return;
    }
    const res = await patchRaw(item._id, {
      addressed: true,
      addressed_action: d.action.trim() || undefined,
      addressed_link: d.link.trim() || undefined,
      reply_message: d.reply.trim() || undefined,
      notify: willEmail,
    });
    if (res) {
      if (willEmail && res.replied === false) {
        alert('Marked done, but the email failed to send (check RESEND_API_KEY / logs).');
      }
      clearDraft(item._id);
      load();
    }
  }

  async function reopen(id: string) {
    if (await patch(id, { addressed: false })) load();
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Feedback</h1>
      <p className="text-sm text-stone-500 mb-4">From the &quot;Give Feedback&quot; button in the site footer and the public MCP <code>submit_feedback</code> tool. A <em>note</em> stays inside: the team and the next triage job read it. A <em>reply</em> is emailed to the submitter and leaves the item open. <em>Mark done</em> can email them too; <em>Reopen</em> undoes it.</p>

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
            {TAB_LABEL[t]} <span className="ml-1 text-xs text-stone-400">({counts[t]})</span>
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-stone-500">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-stone-500">No items in <em>{TAB_LABEL[tab]}</em>.</p>
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
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200 text-[10px] font-medium align-middle" title="Submitted by an AI agent via the MCP submit_feedback tool. Treat claims as unverified.">
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
            {item.images && item.images.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {item.images.map(src => (
                  <li key={src}>
                    <a href={src} target="_blank" rel="noopener noreferrer" title="Open full size">
                      {/* eslint-disable-next-line @next/next/no-img-element -- R2 URL, already validated at write time */}
                      <img src={src} alt="Attached by the submitter" className="h-28 w-auto max-w-[240px] object-cover rounded border border-stone-200 bg-stone-50" loading="lazy" />
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {item.notes && item.notes.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {item.notes.map((n, i) => (
                  <li key={i} className="text-xs bg-amber-50 border border-amber-200 rounded px-3 py-2 text-stone-700">
                    <span className="text-stone-400">Note · {formatDate(n.at)}{n.by && ` · ${n.by}`}</span>
                    <p className="mt-0.5 whitespace-pre-wrap">{n.text}</p>
                  </li>
                ))}
              </ul>
            )}

            {item.replies && item.replies.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {item.replies.map((r, i) => (
                  <li key={i} className="text-xs bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-stone-700">
                    <span className="text-emerald-700">↩ Emailed {r.to} · {formatDate(r.at)}</span>
                    {r.message && <p className="mt-0.5 whitespace-pre-wrap">{r.message}</p>}
                  </li>
                ))}
              </ul>
            ) : item.reply_sent_at ? (
              <p className="mt-3 text-xs text-emerald-700">↩ Emailed {item.reply_recipient || item.email} · {formatDate(item.reply_sent_at)}</p>
            ) : null}

            {item.addressed && (
              <div className="mt-3 pt-3 border-t border-stone-100 text-xs text-stone-600">
                <p>
                  <strong className="text-stone-700">Done</strong>
                  {item.addressed_at && <span> · {formatDate(item.addressed_at)}</span>}
                  {item.addressed_by && <span> · {item.addressed_by}</span>}
                </p>
                {item.addressed_action && <p className="mt-1 text-stone-700">{item.addressed_action}</p>}
                {item.addressed_link && (
                  <a href={item.addressed_link} target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline mt-1 inline-block">{item.addressed_link}</a>
                )}
              </div>
            )}

            {(() => {
              const d = draftOf(item);
              const input = 'text-xs px-2 py-1.5 border border-stone-200 rounded focus:outline-none focus:border-accent-rust';
              const quiet = 'text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors disabled:opacity-40';
              return (
                <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
                  <div className="flex gap-2 items-start">
                    <textarea
                      rows={1}
                      placeholder="Note for the team or the next job (not emailed)"
                      value={d.note}
                      onChange={e => setDraft(item, { note: e.target.value })}
                      className={`${input} flex-1 resize-y`}
                    />
                    <button onClick={() => addNote(item)} disabled={!d.note.trim()} className={quiet}>Add note</button>
                  </div>

                  {item.email && (
                    <div className="flex gap-2 items-start">
                      <textarea
                        rows={2}
                        placeholder={`Message to ${item.email}`}
                        value={d.reply}
                        onChange={e => setDraft(item, { reply: e.target.value })}
                        onBlur={() => saveReplyDraft(item)}
                        className={`${input} flex-1 resize-y`}
                      />
                      <button onClick={() => sendReply(item)} disabled={!d.reply.trim()} className={quiet}>Send reply</button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {tab === 'unread' && (
                      <button onClick={() => markRead(item._id)} className={quiet}>Mark read</button>
                    )}
                    {!item.addressed ? (
                      <>
                        <input
                          type="text"
                          placeholder="What was done (optional)"
                          value={d.action}
                          onChange={e => setDraft(item, { action: e.target.value })}
                          className={`${input} flex-1 min-w-[200px]`}
                        />
                        <input
                          type="url"
                          placeholder="Link (optional)"
                          value={d.link}
                          onChange={e => setDraft(item, { link: e.target.value })}
                          className={`${input} w-[22ch]`}
                        />
                        {item.email && !item.reply_sent_at && (
                          <label className="text-xs text-stone-600 flex items-center gap-1">
                            <input type="checkbox" checked={d.notify} onChange={e => setDraft(item, { notify: e.target.checked })} />
                            email them
                          </label>
                        )}
                        <button onClick={() => markDone(item)} className="text-xs px-3 py-1.5 bg-accent-rust hover:bg-accent-rust/90 text-white rounded transition-colors">
                          Mark done
                        </button>
                      </>
                    ) : (
                      <button onClick={() => reopen(item._id)} className={quiet}>Reopen</button>
                    )}
                  </div>
                </div>
              );
            })()}
          </article>
        ))}
      </div>
    </div>
  );
}
