'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface StuckBook {
  id: string;
  title: string;
  author: string;
  language: string;
  provider: string | null;
  quality_score: number | null;
  pages_total: number;
  pages_r2: number;
  pages_failed: number;
  pages_unarchived: number;
  r2_pct: number;
  error?: string;
}

interface PartialBook {
  id: string;
  title: string;
  language: string;
  provider: string;
  status: string | null;
  error: string | null;
  pages: number;
  r2: number;
  failed: number;
  unarchived: number;
  pct: number;
}

interface NoR2Book {
  id: string;
  title: string;
  language: string;
  provider: string;
  status: string | null;
  pages: number;
}

interface SnapshotData {
  computed_at: string;
  computation_ms: number;
  library: { books_with_pages: number; total_pages: number; r2_pages: number; failed_pages: number; unarchived_pages: number; r2_pct: number };
  coverage_buckets: { full: number; partial_high: number; partial_med: number; partial_low: number; none: number };
  by_provider: Record<string, { books: number; pages: number; r2: number; failed: number }>;
  partial_books_count: number;
  no_r2_books_count: number;
  partial_books_top200: PartialBook[];
  no_r2_books_top200: NoR2Book[];
}

interface Coverage {
  generated_at: string;
  snapshot: SnapshotData | null;
  stuck: {
    summary: { books: number; pages_total: number; pages_r2: number; pages_unarchived: number; pages_failed: number };
    by_provider: Record<string, { books: number; pages_unarchived: number }>;
    books: StuckBook[];
  };
}

type Tab = 'stuck' | 'partial' | 'no_r2';

export default function R2CoveragePage() {
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stuck');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/r2-coverage')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const stuck = data?.stuck;
  const snap = data?.snapshot;

  const filterBook = (s: string, ...fields: (string | undefined | null)[]) =>
    !s || fields.some(f => (f || '').toLowerCase().includes(s.toLowerCase()));

  const filteredStuck = stuck?.books.filter(b => filterBook(filter, b.title, b.author, b.provider)) || [];
  const filteredPartial = snap?.partial_books_top200.filter(b => filterBook(filter, b.title, b.provider)) || [];
  const filteredNoR2 = snap?.no_r2_books_top200.filter(b => filterBook(filter, b.title, b.provider)) || [];

  return (
    <div style={{ padding: 24, color: '#c9d1d9', background: '#0d1117', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0, fontSize: 24 }}>R2 Image Archive Coverage</h1>
      <p style={{ color: '#8b949e', marginTop: 4, marginBottom: 16, fontSize: 14 }}>
        Source-of-truth image storage. Pages on R2 are durable; pages on source URLs are vulnerable to upstream throttling/404s.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#f85149' }}>Error: {error}</p>}

      {data && (
        <>
          {snap ? (
            <>
              <h2 style={{ fontSize: 16, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8 }}>Library-wide</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 8 }}>
                <Card label="R2 coverage" value={`${snap.library.r2_pct}%`} hint={`${snap.library.r2_pages.toLocaleString()} of ${snap.library.total_pages.toLocaleString()} pages`} />
                <Card label="Books fully on R2" value={snap.coverage_buckets.full.toLocaleString()} hint="≥99% archived" good />
                <Card label="Books partially on R2" value={(snap.coverage_buckets.partial_high + snap.coverage_buckets.partial_med + snap.coverage_buckets.partial_low).toLocaleString()} hint={`high ${snap.coverage_buckets.partial_high}, med ${snap.coverage_buckets.partial_med}, low ${snap.coverage_buckets.partial_low}`} warn />
                <Card label="Books with zero R2" value={snap.coverage_buckets.none.toLocaleString()} hint="have pages but never archived" warn />
                <Card label="Pages to archive" value={snap.library.unarchived_pages.toLocaleString()} hint={`${snap.library.failed_pages.toLocaleString()} permanently failed`} warn />
              </div>
              <p style={{ fontSize: 11, color: '#8b949e', marginTop: 0, marginBottom: 24 }}>
                Snapshot computed {new Date(snap.computed_at).toLocaleString()} in {(snap.computation_ms / 1000).toFixed(1)}s. Refresh: <code style={{ background: '#161b22', padding: '1px 5px', borderRadius: 3 }}>node scripts/workers/r2-coverage-snapshot.mjs</code>
              </p>
            </>
          ) : (
            <div style={{ background: '#1c2128', border: '1px solid #9e6a03', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
              <strong style={{ color: '#e3b341' }}>No library snapshot yet.</strong> Run <code style={{ background: '#0d1117', padding: '1px 5px', borderRadius: 3 }}>node scripts/workers/r2-coverage-snapshot.mjs</code> to populate (~10–20 min on Atlas). Until then this page only shows the explicitly-stuck set below.
            </div>
          )}

          {snap && (
            <>
              <h2 style={{ fontSize: 16, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8 }}>By provider</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
                {Object.entries(snap.by_provider).sort((a, b) => b[1].pages - a[1].pages).map(([provider, p]) => {
                  const pct = p.pages > 0 ? Math.round((p.r2 / p.pages) * 100) : 0;
                  return (
                    <div key={provider} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', minWidth: 180 }}>
                      <div style={{ fontSize: 12, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{provider}</div>
                      <div style={{ fontSize: 16, marginTop: 2 }}>{p.books.toLocaleString()} books · {pct}% R2</div>
                      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{(p.pages - p.r2 - p.failed).toLocaleString()} pages to archive</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ borderBottom: '1px solid #30363d', marginBottom: 12, marginTop: 24 }}>
            <TabBtn active={tab === 'stuck'} onClick={() => setTab('stuck')}>Stuck (errored) · {stuck?.summary.books ?? 0}</TabBtn>
            <TabBtn active={tab === 'partial'} onClick={() => setTab('partial')}>Partial R2 · {snap?.partial_books_count ?? 0}</TabBtn>
            <TabBtn active={tab === 'no_r2'} onClick={() => setTab('no_r2')}>Zero R2 · {snap?.no_r2_books_count ?? 0}</TabBtn>
          </div>

          <input
            type="search"
            placeholder="Filter by title or provider…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: '100%', maxWidth: 480, padding: '6px 10px', marginBottom: 12, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, fontSize: 13 }}
          />

          {tab === 'stuck' && stuck && <StuckTable rows={filteredStuck} />}
          {tab === 'partial' && snap && <PartialTable rows={filteredPartial} totalAvailable={snap.partial_books_count} showing={snap.partial_books_top200.length} />}
          {tab === 'no_r2' && snap && <NoR2Table rows={filteredNoR2} totalAvailable={snap.no_r2_books_count} showing={snap.no_r2_books_top200.length} />}
        </>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        background: 'transparent',
        color: active ? '#f0f6fc' : '#8b949e',
        border: 'none',
        borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

function StuckTable({ rows }: { rows: StuckBook[] }) {
  return (
    <div style={{ overflowX: 'auto', background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#1c2128', color: '#8b949e' }}>
            <Th>Q</Th>
            <Th>Book</Th>
            <Th>Lang</Th>
            <Th>Provider</Th>
            <Th align="right">R2 / Total</Th>
            <Th align="right">Unarchived</Th>
            <Th align="right">R2%</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(b => (
            <tr key={b.id} style={{ borderTop: '1px solid #30363d' }}>
              <Td>{b.quality_score ?? '—'}</Td>
              <Td>
                <Link href={`/book/${b.id}`} target="_blank" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                  {b.title?.slice(0, 80)}
                </Link>
                <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{b.author?.slice(0, 60)}</div>
              </Td>
              <Td>{b.language}</Td>
              <Td>{b.provider}</Td>
              <Td align="right">{b.pages_r2.toLocaleString()} / {b.pages_total.toLocaleString()}</Td>
              <Td align="right" warn={b.pages_unarchived > 0}>{b.pages_unarchived.toLocaleString()}</Td>
              <Td align="right"><Bar pct={b.r2_pct} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartialTable({ rows, totalAvailable, showing }: { rows: PartialBook[]; totalAvailable: number; showing: number }) {
  return (
    <>
      {totalAvailable > showing && (
        <p style={{ fontSize: 12, color: '#8b949e', margin: '0 0 8px' }}>Showing top {showing} of {totalAvailable.toLocaleString()} partial-R2 books (sorted by unarchived pages).</p>
      )}
      <div style={{ overflowX: 'auto', background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1c2128', color: '#8b949e' }}>
              <Th>Book</Th>
              <Th>Lang</Th>
              <Th>Provider</Th>
              <Th>Status</Th>
              <Th align="right">R2 / Total</Th>
              <Th align="right">Unarchived</Th>
              <Th align="right">R2%</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.id} style={{ borderTop: '1px solid #30363d' }}>
                <Td>
                  <Link href={`/book/${b.id}`} target="_blank" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                    {b.title?.slice(0, 80)}
                  </Link>
                </Td>
                <Td>{b.language}</Td>
                <Td>{b.provider}</Td>
                <Td>{b.status || '—'}</Td>
                <Td align="right">{b.r2.toLocaleString()} / {b.pages.toLocaleString()}</Td>
                <Td align="right" warn={b.unarchived > 0}>{b.unarchived.toLocaleString()}</Td>
                <Td align="right"><Bar pct={b.pct} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NoR2Table({ rows, totalAvailable, showing }: { rows: NoR2Book[]; totalAvailable: number; showing: number }) {
  return (
    <>
      {totalAvailable > showing && (
        <p style={{ fontSize: 12, color: '#8b949e', margin: '0 0 8px' }}>Showing top {showing} of {totalAvailable.toLocaleString()} zero-R2 books (sorted by pages).</p>
      )}
      <div style={{ overflowX: 'auto', background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1c2128', color: '#8b949e' }}>
              <Th>Book</Th>
              <Th>Lang</Th>
              <Th>Provider</Th>
              <Th>Status</Th>
              <Th align="right">Pages</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.id} style={{ borderTop: '1px solid #30363d' }}>
                <Td>
                  <Link href={`/book/${b.id}`} target="_blank" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                    {b.title?.slice(0, 80)}
                  </Link>
                </Td>
                <Td>{b.language}</Td>
                <Td>{b.provider}</Td>
                <Td>{b.status || '—'}</Td>
                <Td align="right" warn>{b.pages.toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Card({ label, value, hint, warn, good }: { label: string; value: string; hint?: string; warn?: boolean; good?: boolean }) {
  const borderColor = warn ? '#9e6a03' : good ? '#238636' : '#30363d';
  const valueColor = warn ? '#e3b341' : good ? '#3fb950' : '#f0f6fc';
  return (
    <div style={{ background: '#161b22', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, marginTop: 4, color: valueColor }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ padding: '8px 12px', textAlign: align, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{children}</th>;
}

function Td({ children, align = 'left', warn }: { children: React.ReactNode; align?: 'left' | 'right'; warn?: boolean }) {
  return <td style={{ padding: '8px 12px', textAlign: align, color: warn ? '#e3b341' : undefined }}>{children}</td>;
}

function Bar({ pct }: { pct: number }) {
  const color = pct >= 95 ? '#3fb950' : pct >= 50 ? '#e3b341' : '#f85149';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, background: '#30363d', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color }} />
      </div>
      <span style={{ minWidth: 32, textAlign: 'right', color }}>{pct}%</span>
    </div>
  );
}
