'use client';

import { useEffect, useMemo, useState } from 'react';

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  email_verified: boolean;
  created_at: string | null;
  welcomed_at: string | null;
  book_count: number;
  pages_viewed: number;
  first_active: string | null;
  last_active: string | null;
  source: string | null;
  country: string | null;
  efm_newsletter_opt_in: boolean;
  comment: string | null;
}

interface Totals {
  users: number;
  subscribers_only: number;
  active_readers: number;
  efm_opt_in: number;
}

type SortKey =
  | 'name'
  | 'email'
  | 'source'
  | 'country'
  | 'created_at'
  | 'last_active'
  | 'book_count'
  | 'pages_viewed';

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function fmtAgo(s: string | null) {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  if (isNaN(ms)) return '—';
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadCsv(rows: UserRow[]) {
  const cols: (keyof UserRow)[] = [
    'name', 'email', 'source', 'country', 'created_at', 'last_active',
    'book_count', 'pages_viewed', 'efm_newsletter_opt_in', 'email_verified', 'comment',
  ];
  const header = cols.join(',');
  const lines = rows.map(r => cols.map(c => csvCell(r[c])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sourcelibrary-users-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function StatCard({
  label, value, accent,
}: {
  label: string;
  value: number;
  accent?: 'rust' | 'gold' | 'sage' | 'violet' | 'default';
}) {
  const accentClass = {
    rust: 'text-accent-rust',
    gold: 'text-accent-gold-dark',
    sage: 'text-accent-sage-dark',
    violet: 'text-accent-violet',
    default: 'text-stone-900',
  }[accent || 'default'];
  return (
    <div className="bg-white border border-stone-200 rounded-xl px-5 py-4 min-w-[140px] shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 font-sans">{label}</div>
      <div className={`text-3xl font-light mt-1 ${accentClass} font-display`}>{value.toLocaleString()}</div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'efm' | 'subscribers'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('last_active');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/admin/users');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (cancelled) return;
        setRows(data.rows);
        setTotals(data.totals);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    if (filter === 'active') list = list.filter(r => r.book_count > 0);
    else if (filter === 'efm') list = list.filter(r => r.efm_newsletter_opt_in);
    else if (filter === 'subscribers') list = list.filter(r => r.id.startsWith('subscriber:'));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        (r.email && r.email.toLowerCase().includes(q))
        || (r.name && r.name.toLowerCase().includes(q))
        || (r.country && r.country.toLowerCase().includes(q))
        || (r.source && r.source.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return sorted;
  }, [rows, search, filter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'email' ? 'asc' : 'desc');
    }
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const headBase = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500 text-left cursor-pointer select-none whitespace-nowrap sticky top-0 bg-stone-50/95 backdrop-blur-sm border-b border-stone-200 hover:text-accent-rust transition-colors';
  const cellBase = 'px-3 py-2.5 text-sm text-stone-700 align-middle';

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <div className="max-w-[1400px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl text-stone-900 mb-1 font-display font-normal">Users</h1>
          <p className="text-sm text-stone-600 font-sans">
            Everyone who has signed up or subscribed to Source Library — with their reading activity.
          </p>
        </div>

        {error && (
          <div className="bg-accent-rust/8 border border-accent-rust/20 rounded-lg px-4 py-2.5 mb-4 text-accent-rust text-sm font-sans">
            {error}
          </div>
        )}

        {/* Stat cards */}
        {totals && (
          <div className="flex flex-wrap gap-3 mb-6">
            <StatCard label="Total" value={totals.users + totals.subscribers_only} accent="rust" />
            <StatCard label="OAuth Users" value={totals.users} />
            <StatCard label="Email-only" value={totals.subscribers_only} />
            <StatCard label="Active Readers" value={totals.active_readers} accent="sage" />
            <StatCard label="EFM Opt-in" value={totals.efm_opt_in} accent="violet" />
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, country, source…"
            className="flex-1 min-w-[220px] max-w-md px-4 py-2 text-sm bg-white border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30 outline-none font-sans transition-colors"
          />
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as typeof filter)}
            className="px-3 py-2 text-sm bg-white border border-stone-300 rounded-lg text-stone-900 cursor-pointer hover:border-stone-400 focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30 outline-none font-sans transition-colors"
          >
            <option value="all">All</option>
            <option value="active">Active readers</option>
            <option value="efm">EFM opt-in</option>
            <option value="subscribers">Email-only</option>
          </select>
          <button
            onClick={() => downloadCsv(filtered)}
            disabled={!filtered.length}
            className="px-4 py-2 text-sm font-medium bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors font-sans"
          >
            Export CSV ({filtered.length})
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={headBase} onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
                  <th className={headBase} onClick={() => toggleSort('email')}>Email{arrow('email')}</th>
                  <th className={headBase} onClick={() => toggleSort('source')}>Source{arrow('source')}</th>
                  <th className={headBase} onClick={() => toggleSort('country')}>Country{arrow('country')}</th>
                  <th className={headBase} onClick={() => toggleSort('created_at')}>Signed up{arrow('created_at')}</th>
                  <th className={headBase} onClick={() => toggleSort('last_active')}>Last active{arrow('last_active')}</th>
                  <th className={`${headBase} !text-right`} onClick={() => toggleSort('book_count')}>Books{arrow('book_count')}</th>
                  <th className={`${headBase} !text-right`} onClick={() => toggleSort('pages_viewed')}>Pages{arrow('pages_viewed')}</th>
                  <th className={headBase}>EFM</th>
                </tr>
              </thead>
              <tbody>
                {rows === null && !error && (
                  <tr>
                    <td colSpan={9} className="text-center text-stone-500 py-12 font-sans text-sm">
                      Loading…
                    </td>
                  </tr>
                )}
                {rows !== null && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-stone-500 py-12 font-sans text-sm">
                      No matches
                    </td>
                  </tr>
                )}
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-stone-100 hover:bg-accent-gold/5 transition-colors">
                    <td className={cellBase}>
                      <div className="flex items-center gap-2.5">
                        {r.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.image} alt="" width={26} height={26} className="rounded-full ring-1 ring-stone-200" />
                        ) : (
                          <div className="w-[26px] h-[26px] rounded-full bg-stone-100 text-stone-500 text-xs flex items-center justify-center ring-1 ring-stone-200">
                            {r.email?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        <span className="text-stone-900 font-medium">{r.name || <span className="text-stone-400 font-normal">—</span>}</span>
                      </div>
                    </td>
                    <td className={`${cellBase} font-mono text-xs text-stone-600`}>
                      {r.email || '—'}
                    </td>
                    <td className={cellBase}>
                      <span className="text-stone-500 text-xs">{r.source?.replace(/_/g, ' ') || '—'}</span>
                    </td>
                    <td className={cellBase}>
                      <span className="text-stone-600 text-xs">{r.country || '—'}</span>
                    </td>
                    <td className={`${cellBase} text-stone-600 text-xs`} title={r.created_at || ''}>{fmtDate(r.created_at)}</td>
                    <td className={`${cellBase} text-stone-600 text-xs`} title={r.last_active || ''}>{fmtAgo(r.last_active)}</td>
                    <td className={`${cellBase} text-right tabular-nums ${r.book_count > 0 ? 'text-accent-sage-dark font-medium' : 'text-stone-400'}`}>
                      {r.book_count}
                    </td>
                    <td className={`${cellBase} text-right tabular-nums ${r.pages_viewed > 0 ? 'text-stone-800' : 'text-stone-400'}`}>
                      {r.pages_viewed.toLocaleString()}
                    </td>
                    <td className={cellBase}>
                      {r.efm_newsletter_opt_in ? (
                        <span
                          className="inline-block text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded bg-accent-violet/10 text-accent-violet"
                          title="Opted into EFM newsletter"
                        >
                          EFM
                        </span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-stone-500 mt-3 font-sans">
          Sources:{' '}
          <code className="px-1 py-0.5 rounded bg-stone-100 text-stone-700 font-mono text-[11px]">users</code>{' '}
          (OAuth),{' '}
          <code className="px-1 py-0.5 rounded bg-stone-100 text-stone-700 font-mono text-[11px]">beta_subscribers</code>{' '}
          (email-only); joined to{' '}
          <code className="px-1 py-0.5 rounded bg-stone-100 text-stone-700 font-mono text-[11px]">reading_history</code>{' '}
          for activity.
        </p>
      </div>
    </div>
  );
}
