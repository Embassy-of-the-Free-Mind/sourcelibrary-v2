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

interface Coverage {
  generated_at: string;
  stuck: {
    summary: { books: number; pages_total: number; pages_r2: number; pages_unarchived: number; pages_failed: number };
    by_provider: Record<string, { books: number; pages_unarchived: number }>;
    books: StuckBook[];
  };
  library_by_provider: { provider: string; books: number; pages: number }[];
}

export default function R2CoveragePage() {
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const filtered = stuck?.books.filter(b =>
    !filter ||
    b.title.toLowerCase().includes(filter.toLowerCase()) ||
    (b.author || '').toLowerCase().includes(filter.toLowerCase()) ||
    (b.provider || '').toLowerCase().includes(filter.toLowerCase())
  ) || [];

  return (
    <div style={{ padding: 24, color: '#c9d1d9', background: '#0d1117', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0, fontSize: 24 }}>R2 Image Archive Coverage</h1>
      <p style={{ color: '#8b949e', marginTop: 4, marginBottom: 16, fontSize: 14 }}>
        Source-of-truth image storage. Pages on R2 are durable; pages on source URLs are vulnerable to upstream throttling/404s (this is what blocks OCR for the books below).
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#f85149' }}>Error: {error}</p>}

      {data && stuck && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <Card label="Stuck books" value={stuck.summary.books.toLocaleString()} hint="needs_attention with image-download failures" />
            <Card label="Pages on R2" value={stuck.summary.pages_r2.toLocaleString()} hint={`of ${stuck.summary.pages_total.toLocaleString()} (${stuck.summary.pages_total > 0 ? Math.round(stuck.summary.pages_r2 / stuck.summary.pages_total * 100) : 0}%)`} />
            <Card label="Pages to archive" value={stuck.summary.pages_unarchived.toLocaleString()} hint="re-archive these to clear the queue" warn />
            <Card label="Pages permanently failed" value={stuck.summary.pages_failed.toLocaleString()} hint="archived_photo: 'failed:...'" />
          </div>

          <h2 style={{ fontSize: 18, marginTop: 24 }}>Stuck by provider</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {Object.entries(stuck.by_provider).sort((a, b) => b[1].books - a[1].books).map(([provider, s]) => (
              <div key={provider} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', minWidth: 160 }}>
                <div style={{ fontSize: 12, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{provider}</div>
                <div style={{ fontSize: 18, marginTop: 2 }}>{s.books.toLocaleString()} books</div>
                <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>{s.pages_unarchived.toLocaleString()} pages to archive</div>
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: 18, marginTop: 24, marginBottom: 8 }}>Stuck books ({filtered.length}{filter ? ` of ${stuck.books.length}` : ''})</h2>
          <input
            type="search"
            placeholder="Filter by title, author, or provider…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: '100%', maxWidth: 480, padding: '6px 10px', marginBottom: 12, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, fontSize: 13 }}
          />
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
                {filtered.map(b => (
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
                    <Td align="right">
                      <Bar pct={b.r2_pct} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 16, fontSize: 12, color: '#8b949e' }}>
            Generated {new Date(data.generated_at).toLocaleString()}.
            Re-archive script: <code style={{ background: '#161b22', padding: '2px 6px', borderRadius: 4 }}>scripts/_tmp-archive-needs-attention.ts</code>
          </p>
        </>
      )}
    </div>
  );
}

function Card({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div style={{ background: '#161b22', border: `1px solid ${warn ? '#9e6a03' : '#30363d'}`, borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, marginTop: 4, color: warn ? '#e3b341' : '#f0f6fc' }}>{value}</div>
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
