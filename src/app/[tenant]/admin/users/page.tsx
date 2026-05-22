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

const cellStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: '#c9d1d9', verticalAlign: 'middle' };
const headStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: 0.5, color: '#8b949e', textAlign: 'left', cursor: 'pointer',
  borderBottom: '1px solid #30363d', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, background: '#0d1117',
};

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
      padding: '14px 18px', minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#f0f6fc', marginTop: 4 }}>{value}</div>
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

  return (
    <div style={{ padding: '24px 32px', color: '#c9d1d9' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#f0f6fc', marginBottom: 4 }}>
          Users
        </h1>
        <p style={{ fontSize: 13, color: '#8b949e' }}>
          Everyone who has signed up or subscribed to Source Library — with their reading activity.
        </p>
      </div>

      {error && (
        <div style={{
          background: '#3d1518', border: '1px solid #8b3a3f', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16, color: '#ffb4b4', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {totals && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <StatCard label="Total" value={totals.users + totals.subscribers_only} color="#58a6ff" />
          <StatCard label="OAuth Users" value={totals.users} />
          <StatCard label="Email-only" value={totals.subscribers_only} />
          <StatCard label="Active Readers" value={totals.active_readers} color="#3fb950" />
          <StatCard label="EFM Opt-in" value={totals.efm_opt_in} color="#d2a8ff" />
        </div>
      )}

      <div style={{
        display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, country, source…"
          style={{
            flex: '1 1 260px', minWidth: 220, maxWidth: 400,
            padding: '8px 12px', fontSize: 13,
            background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            color: '#c9d1d9', outline: 'none',
          }}
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as typeof filter)}
          style={{
            padding: '8px 10px', fontSize: 13,
            background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            color: '#c9d1d9', cursor: 'pointer',
          }}
        >
          <option value="all">All</option>
          <option value="active">Active readers</option>
          <option value="efm">EFM opt-in</option>
          <option value="subscribers">Email-only</option>
        </select>
        <button
          onClick={() => downloadCsv(filtered)}
          disabled={!filtered.length}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 500,
            background: '#1f6feb', border: '1px solid #388bfd', borderRadius: 6,
            color: '#f0f6fc', cursor: filtered.length ? 'pointer' : 'not-allowed',
            opacity: filtered.length ? 1 : 0.5,
          }}
        >
          Export CSV ({filtered.length})
        </button>
      </div>

      <div style={{
        background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headStyle} onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
                <th style={headStyle} onClick={() => toggleSort('email')}>Email{arrow('email')}</th>
                <th style={headStyle} onClick={() => toggleSort('source')}>Source{arrow('source')}</th>
                <th style={headStyle} onClick={() => toggleSort('country')}>Country{arrow('country')}</th>
                <th style={headStyle} onClick={() => toggleSort('created_at')}>Signed up{arrow('created_at')}</th>
                <th style={headStyle} onClick={() => toggleSort('last_active')}>Last active{arrow('last_active')}</th>
                <th style={{ ...headStyle, textAlign: 'right' }} onClick={() => toggleSort('book_count')}>Books{arrow('book_count')}</th>
                <th style={{ ...headStyle, textAlign: 'right' }} onClick={() => toggleSort('pages_viewed')}>Pages{arrow('pages_viewed')}</th>
                <th style={headStyle}>EFM</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && !error && (
                <tr>
                  <td colSpan={9} style={{ ...cellStyle, textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>
                    Loading…
                  </td>
                </tr>
              )}
              {rows !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...cellStyle, textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>
                    No matches
                  </td>
                </tr>
              )}
              {filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" width={22} height={22} style={{ borderRadius: '50%' }} />
                      ) : (
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: '#21262d', color: '#8b949e',
                          fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {r.email?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <span>{r.name || '—'}</span>
                    </div>
                  </td>
                  <td style={{ ...cellStyle, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}>
                    {r.email || '—'}
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: '#8b949e' }}>{r.source?.replace(/_/g, ' ') || '—'}</span>
                  </td>
                  <td style={cellStyle}>{r.country || '—'}</td>
                  <td style={cellStyle} title={r.created_at || ''}>{fmtDate(r.created_at)}</td>
                  <td style={cellStyle} title={r.last_active || ''}>{fmtAgo(r.last_active)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', color: r.book_count > 0 ? '#3fb950' : '#8b949e' }}>
                    {r.book_count}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', color: r.pages_viewed > 0 ? '#c9d1d9' : '#8b949e' }}>
                    {r.pages_viewed.toLocaleString()}
                  </td>
                  <td style={cellStyle}>
                    {r.efm_newsletter_opt_in ? (
                      <span style={{ color: '#d2a8ff', fontWeight: 600 }} title="Opted into EFM newsletter">EFM</span>
                    ) : (
                      <span style={{ color: '#30363d' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#8b949e', marginTop: 12 }}>
        Sources: <code style={{ color: '#c9d1d9' }}>users</code> (OAuth), <code style={{ color: '#c9d1d9' }}>beta_subscribers</code> (email-only); joined to <code style={{ color: '#c9d1d9' }}>reading_history</code> for activity.
      </p>
    </div>
  );
}
