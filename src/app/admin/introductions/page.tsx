'use client';

import { useEffect, useMemo, useState } from 'react';

interface Introduction {
  id: string;
  name: string | null;
  email: string | null;
  about: string;
  help: string;
  language: string;
  language_key: string;
  created_at: string | null;
  updated_at: string | null;
  volunteered: boolean;
  volunteered_at: string | null;
  contacted: boolean;
}

interface Totals {
  wrote: number;
  welcomed: number;
  skipped: number;
  pending: number;
  offered_help: number;
  gave_language: number;
  language_respondents: number;
  volunteered: number;
  awaiting_reply: number;
}

interface Payload {
  introductions: Introduction[];
  totals: Totals;
  language_tally: { language: string; count: number }[];
  language_unmatched: string[];
}

interface ReaderMsg {
  _id: string;
  source: { kind: 'introduction'; id: string };
  to_email: string;
  to_name: string | null;
  body: string;
  by: string;
  status: 'queued' | 'sent' | 'failed';
  created_at: string;
  sent_at: string | null;
  /** When the reader dismissed it as a note on the site. */
  read_at?: string | null;
  error: string | null;
}

type Filter = 'all' | 'help' | 'substantial' | 'volunteered' | 'awaiting';

function fmtDate(s: string | null) {
  if (!s) return '–';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '–' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function IntroductionsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Overlay of contacted flips made in this session, so the list responds at
  // once instead of waiting on a refetch that would also reshuffle the filter.
  const [contactedOverride, setContactedOverride] = useState<Record<string, boolean>>({});
  // Replies written from this screen (v3#405). Writing one keeps it in the
  // outbox; sending is a separate click, here or in the outbox.
  const [messages, setMessages] = useState<ReaderMsg[]>([]);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outboxNote, setOutboxNote] = useState<string | null>(null);

  const loadMessages = async () => {
    const r = await fetch('/api/admin/reader-messages?kind=introduction');
    if (r.ok) setMessages((await r.json()).messages || []);
  };
  useEffect(() => { loadMessages(); }, []);

  const messagesFor = useMemo(() => {
    const m = new Map<string, ReaderMsg[]>();
    // The API returns newest first; a card reads oldest first, like a thread.
    for (const msg of [...messages].reverse()) {
      const list = m.get(msg.source.id) ?? [];
      list.push(msg);
      m.set(msg.source.id, list);
    }
    return m;
  }, [messages]);
  const outbox = messages.filter(m => m.status !== 'sent');
  const queuedCount = outbox.filter(m => m.status === 'queued').length;

  const writeReply = async (intro: Introduction, sendNow: boolean) => {
    const text = (replyDraft[intro.id] || '').trim();
    if (!text) return;
    if (sendNow && !confirm(`Email this to ${intro.email} now?`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/reader-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'introduction', source_id: intro.id, body: text, send_now: sendNow }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Could not save the reply: ${res.error || r.status}`); return; }
      if (sendNow && res.sent === false) alert('Saved, but the email failed. It is in the outbox to try again.');
      setReplyDraft(d => { const n = { ...d }; delete n[intro.id]; return n; });
      await loadMessages();
    } finally {
      setBusy(false);
    }
  };

  const sendQueued = async (ids?: string[]) => {
    const n = ids ? ids.length : queuedCount;
    if (!n || !confirm(`Email ${n} repl${n === 1 ? 'y' : 'ies'} now?`)) return;
    setBusy(true);
    setOutboxNote(null);
    try {
      const r = await fetch('/api/admin/reader-messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { setOutboxNote(`Send failed: ${res.error || r.status}`); return; }
      setOutboxNote(`Sent ${res.sent}${res.failed ? `, ${res.failed} failed` : ''}${res.remaining ? ` · ${res.remaining} still queued` : ''}.`);
      await loadMessages();
    } finally {
      setBusy(false);
    }
  };

  const editQueued = async (msg: ReaderMsg, body: string) => {
    if (!body.trim() || body.trim() === msg.body) return;
    const r = await fetch(`/api/admin/reader-messages/${msg._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!r.ok) alert('Could not save the edit.');
    await loadMessages();
  };

  const discardQueued = async (msg: ReaderMsg) => {
    if (!confirm(`Discard the unsent reply to ${msg.to_email}?`)) return;
    await fetch(`/api/admin/reader-messages/${msg._id}`, { method: 'DELETE' });
    await loadMessages();
  };

  const markContacted = async (email: string | null, contacted: boolean) => {
    if (!email) return;
    setContactedOverride(prev => ({ ...prev, [email]: contacted }));
    try {
      const res = await fetch('/api/admin/introductions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, contacted }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Put it back rather than showing a state the server does not hold.
      setContactedOverride(prev => ({ ...prev, [email]: !contacted }));
    }
  };

  useEffect(() => {
    fetch('/api/admin/introductions')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setError(String(e.message || e)));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.introductions.filter(i => {
      if (filter === 'help' && !i.help.trim()) return false;
      // "Substantial" = wrote more than a couple of words. Most introductions are
      // one line ("leer"); the handful of long ones are where the offers and the
      // corpus gaps actually are, and they get buried by volume otherwise.
      if (filter === 'substantial' && i.about.trim().length < 120) return false;
      if (filter === 'volunteered' && !i.volunteered) return false;
      // The queue that actually needs working: raised a hand, no reply yet.
      // A reply written here, sent or still queued, takes them out of it.
      if (filter === 'awaiting' && (!i.volunteered || (contactedOverride[i.email ?? ''] ?? i.contacted) || messagesFor.has(i.id))) return false;
      if (!q) return true;
      return [i.name, i.email, i.about, i.help, i.language]
        .some(f => (f || '').toLowerCase().includes(q));
    });
  }, [data, query, filter, contactedOverride, messagesFor]);

  function exportCsv() {
    if (!data) return;
    const header = ['name', 'email', 'language', 'about', 'help', 'written'];
    const lines = [header.join(',')];
    for (const i of rows) {
      lines.push([i.name, i.email, i.language, i.about, i.help, i.updated_at].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `introductions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return <div className="p-8 text-status-error">Could not load introductions: {error}</div>;
  }
  if (!data) {
    return <div className="p-8 text-stone-500">Loading…</div>;
  }

  const t = data.totals;
  const topLanguage = data.language_tally[0];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-stone-900 mb-1">Introductions</h1>
        <p className="text-stone-500 text-sm">
          What readers wrote about themselves on <code className="text-stone-600">/welcome</code>. Every field is optional.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Wrote something', value: t.wrote },
          { label: 'Volunteered', value: t.volunteered },
          { label: 'Awaiting a reply', value: t.awaiting_reply },
          { label: 'Offered to help', value: t.offered_help },
          { label: 'Gave a language', value: t.gave_language },
          { label: 'Not yet seen', value: t.pending },
        ].map(s => (
          <div key={s.label} className="border border-stone-200 rounded-lg p-3">
            <div className="text-2xl font-serif text-stone-900">{s.value.toLocaleString()}</div>
            <div className="text-xs text-stone-500">{s.label}</div>
          </div>
        ))}
      </div>

      {data.language_tally.length > 0 && (
        <section className="mb-6 border border-stone-200 rounded-lg p-4">
          <h2 className="font-serif text-lg text-stone-900 mb-1">Languages readers want</h2>
          <p className="text-xs text-stone-500 mb-3">
            Free text, so one reader who names two languages counts for both.
            {topLanguage && t.language_respondents > 0 && (
              <>
                {' '}
                {topLanguage.language} leads at{' '}
                {Math.round((100 * topLanguage.count) / t.language_respondents)}% of the{' '}
                {t.language_respondents} who answered.
              </>
            )}
          </p>
          <div className="space-y-1.5">
            {data.language_tally.map(l => (
              <div key={l.language} className="flex items-center gap-3 text-sm">
                <div className="w-24 text-stone-700">{l.language}</div>
                <div className="flex-1 bg-stone-100 rounded h-4 overflow-hidden">
                  <div
                    className="bg-accent-rust/70 h-full"
                    style={{ width: `${Math.round((100 * l.count) / Math.max(1, t.language_respondents))}%` }}
                  />
                </div>
                <div className="w-10 text-right text-stone-500 tabular-nums">{l.count}</div>
              </div>
            ))}
          </div>
          {data.language_unmatched.length > 0 && (
            <p className="text-xs text-stone-500 mt-3">
              Not recognised: {data.language_unmatched.join(' · ')}
            </p>
          )}
        </section>
      )}

      {(outbox.length > 0 || outboxNote) && (
        <section className="mb-6 border border-amber-200 bg-amber-50/40 rounded-lg p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h2 className="font-serif text-lg text-stone-900">Outbox</h2>
            {queuedCount > 0 && (
              <button
                onClick={() => sendQueued()}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-sm bg-accent-rust text-white hover:bg-accent-rust/90 disabled:opacity-50"
              >
                Send queued ({queuedCount})
              </button>
            )}
          </div>
          <p className="text-xs text-stone-500 mb-3">
            Replies you have written that have not gone out. Edit or discard them here; nothing is emailed until you press send.
            A sent reply also appears as a note the next time the reader is signed in on the site. A reader who answers reaches derek@sourcelibrary.org.
          </p>
          {outboxNote && <p className="text-sm text-stone-700 mb-3">{outboxNote}</p>}
          <ul className="space-y-2">
            {outbox.map(m => (
              <li key={m._id} className="bg-white border border-stone-200 rounded p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-stone-500 mb-1">
                  <span>
                    To <span className="text-stone-800">{m.to_name || m.to_email}</span>
                    {m.to_name && <> &lt;{m.to_email}&gt;</>} · written {fmtDate(m.created_at)}
                    {m.status === 'failed' && <span className="ml-2 text-status-error">failed: {m.error}</span>}
                  </span>
                  <span className="flex gap-3">
                    <button onClick={() => sendQueued([m._id])} disabled={busy} className="text-accent-rust hover:underline disabled:opacity-50">
                      {m.status === 'failed' ? 'Try again' : 'Send'}
                    </button>
                    <button onClick={() => discardQueued(m)} disabled={busy} className="text-stone-500 hover:underline disabled:opacity-50">
                      Discard
                    </button>
                  </span>
                </div>
                <textarea
                  key={m.body}
                  defaultValue={m.body}
                  onBlur={e => editQueued(m, e.target.value)}
                  rows={Math.min(6, m.body.split('\n').length + 1)}
                  className="w-full text-sm px-2 py-1.5 border border-stone-200 rounded focus:outline-none focus:border-accent-rust"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name, email, or what they wrote…"
          className="flex-1 min-w-[240px] px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
        />
        {([
          ['all', 'All'],
          ['awaiting', 'Awaiting a reply'],
          ['volunteered', 'Volunteered'],
          ['help', 'Offered help'],
          ['substantial', 'Wrote at length'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              filter === key
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={exportCsv}
          className="px-3 py-2 rounded-lg text-sm border border-stone-300 text-stone-600 hover:border-stone-400"
        >
          CSV
        </button>
      </div>

      <p className="text-xs text-stone-500 mb-3">
        {rows.length === data.introductions.length
          ? `${rows.length} introduction${rows.length === 1 ? '' : 's'}`
          : `${rows.length} of ${data.introductions.length}`}
      </p>

      <div className="space-y-3">
        {rows.map(i => (
          <article key={i.id} className="border border-stone-200 rounded-lg p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <div>
                <span className="font-medium text-stone-900">{i.name || '(no name given)'}</span>
                {i.email && (
                  <a
                    href={`mailto:${i.email}`}
                    className="ml-2 text-sm text-stone-500 hover:text-accent-rust break-all"
                  >
                    {i.email}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {i.volunteered && (
                  <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent-rust/10 text-accent-rust">
                    volunteered
                  </span>
                )}
                {i.volunteered && (
                  <button
                    onClick={() => markContacted(i.email, !(contactedOverride[i.email ?? ''] ?? i.contacted))}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                      (contactedOverride[i.email ?? ''] ?? i.contacted)
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-white text-stone-600 border-stone-300 hover:border-stone-500'
                    }`}
                    title="Whether we have written back"
                  >
                    {(contactedOverride[i.email ?? ''] ?? i.contacted) ? 'replied' : 'mark replied'}
                  </button>
                )}
                <span className="text-xs text-stone-400">{fmtDate(i.updated_at)}</span>
              </div>
            </div>

            {i.language && (
              <p className="text-sm text-stone-600 mb-2">
                <span className="text-stone-400">Reads in </span>
                {i.language}
              </p>
            )}
            {i.about && (
              <p className="text-stone-800 whitespace-pre-wrap text-[15px] leading-relaxed">{i.about}</p>
            )}
            {i.help && (
              <p className="mt-2 pt-2 border-t border-stone-100 text-stone-700 whitespace-pre-wrap text-[15px] leading-relaxed">
                <span className="text-stone-400">Would help by </span>
                {i.help}
              </p>
            )}

            {(messagesFor.get(i.id) ?? []).length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {(messagesFor.get(i.id) ?? []).map(m => (
                  <li
                    key={m._id}
                    className={`text-xs rounded px-3 py-2 border ${
                      m.status === 'sent' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    <span className={m.status === 'sent' ? 'text-emerald-700' : 'text-amber-700'}>
                      {m.status === 'sent'
                        ? `↩ Emailed ${fmtDate(m.sent_at)} · ${m.read_at ? `seen on the site ${fmtDate(m.read_at)}` : 'not yet seen on the site'}`
                        : m.status === 'failed'
                          ? 'Failed, in the outbox'
                          : 'In the outbox, not sent yet'}
                      {' · '}
                      {m.by}
                    </span>
                    <p className="mt-0.5 whitespace-pre-wrap text-stone-700">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {i.email && (
              <div className="mt-3 pt-3 border-t border-stone-100 flex gap-2 items-start">
                <textarea
                  rows={2}
                  placeholder={`Reply to ${i.name || i.email}`}
                  value={replyDraft[i.id] || ''}
                  onChange={e => setReplyDraft(d => ({ ...d, [i.id]: e.target.value }))}
                  className="flex-1 text-sm px-2 py-1.5 border border-stone-200 rounded resize-y focus:outline-none focus:border-accent-rust"
                />
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => writeReply(i, false)}
                    disabled={busy || !(replyDraft[i.id] || '').trim()}
                    className="text-xs px-3 py-1.5 bg-stone-900 text-white rounded disabled:opacity-40"
                    title="Keep it in the outbox and send later"
                  >
                    Queue
                  </button>
                  <button
                    onClick={() => writeReply(i, true)}
                    disabled={busy || !(replyDraft[i.id] || '').trim()}
                    className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded disabled:opacity-40"
                  >
                    Send now
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
        {rows.length === 0 && (
          <p className="text-stone-500 text-sm py-8 text-center">Nothing matches that filter.</p>
        )}
      </div>
    </div>
  );
}
