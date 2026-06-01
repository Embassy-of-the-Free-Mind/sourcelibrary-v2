'use client';

import { useCallback, useEffect, useState } from 'react';

interface Book {
  id: string;
  slug?: string;
  title: string;
  author?: string;
  language?: string;
  pages_count: number;
  pages_ocr: number;
  status: string;
  retry_count: number;
  error: string;
  last_updated: string | null;
}

interface Bucket {
  key: string;
  label: string;
  detail: string;
  action: 'retry' | 'reacquire' | 'park' | 'review';
  count: number;
  retryable: boolean;
  books: Book[];
}

interface ApiResponse {
  total: number;
  buckets: Bucket[];
}

const C = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3',
  dim: '#8b949e', accent: '#58a6ff', green: '#3fb950', amber: '#d29922',
  red: '#f85149', purple: '#bc8cff',
};

const ACTION_COLOR: Record<Bucket['action'], string> = {
  retry: C.green, reacquire: C.amber, park: C.dim, review: C.purple,
};

export function TranslationFailuresClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/translation-failures');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ApiResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(
    async (bucket: Bucket) => {
      if (!confirm(`Re-enroll ${bucket.count} book(s) in "${bucket.label}"? The pipeline cron picks them up within ~10 min.`)) return;
      setBusy(bucket.key);
      setFlash(null);
      try {
        const res = await fetch('/api/admin/translation-failures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookIds: bucket.books.map((b) => b.id) }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        setFlash(j.message || `Re-enrolled ${j.requeued}.`);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Translation-Failure Triage</h1>
      <p style={{ color: C.dim, fontSize: 13, margin: '4px 0 0' }}>
        First-translation candidates (<code>confirmed_first</code>) that are untranslated because they
        broke in the pipeline — grouped by root cause. Retry only re-enrolls buckets where re-running
        actually helps; <span style={{ color: C.amber }}>re-acquire</span> /{' '}
        <span style={{ color: C.dim }}>park</span> buckets need a different fix.
      </p>

      {flash && (
        <div style={{ background: '#0f2a16', border: `1px solid ${C.green}`, color: C.green, borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: '14px 0' }}>
          {flash}
        </div>
      )}
      {error && <div style={{ color: C.red, fontSize: 13, margin: '14px 0' }}>Error: {error}</div>}

      <div style={{ color: C.dim, fontSize: 12, margin: '16px 0 8px' }}>
        {loading ? 'Loading…' : `${data?.total ?? 0} stuck first-translation candidates across ${data?.buckets.length ?? 0} root causes`}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data?.buckets.map((bucket) => {
          const color = ACTION_COLOR[bucket.action];
          const isOpen = open === bucket.key;
          return (
            <div key={bucket.key} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: C.panel }}>
                <div style={{ fontSize: 26, fontWeight: 700, color, minWidth: 48, textAlign: 'right' }}>{bucket.count}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {bucket.label}
                    <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase' }}>
                      {bucket.action}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>{bucket.detail}</div>
                </div>
                <button onClick={() => setOpen(isOpen ? null : bucket.key)} style={btn(C.dim, busy === bucket.key)}>
                  {isOpen ? 'Hide' : 'Show'} books
                </button>
                {bucket.retryable && (
                  <button onClick={() => retry(bucket)} disabled={busy === bucket.key} style={btn(C.green, busy === bucket.key)}>
                    {busy === bucket.key ? 'Re-enrolling…' : `Retry ${bucket.count}`}
                  </button>
                )}
              </div>
              {isOpen && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: C.dim, textAlign: 'left', background: C.bg }}>
                      <th style={th}>Book</th>
                      <th style={th}>Lang</th>
                      <th style={{ ...th, textAlign: 'right' }}>Pages</th>
                      <th style={{ ...th, textAlign: 'right' }}>Retries</th>
                      <th style={th}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.books.map((b) => (
                      <tr key={b.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={td}>
                          <a href={`https://sourcelibrary.org/book/${b.slug || b.id}`} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>
                            {b.title}
                          </a>
                          <div style={{ color: C.dim, fontSize: 11 }}>{b.author || '—'}</div>
                        </td>
                        <td style={td}>{b.language || '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{b.pages_ocr}/{b.pages_count}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{b.retry_count}</td>
                        <td style={{ ...td, color: C.dim, fontFamily: 'monospace', fontSize: 11 }}>{b.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {!loading && data?.buckets.length === 0 && (
          <div style={{ color: C.dim, padding: 24, textAlign: 'center' }}>No stuck first-translation candidates — the queue is clear.</div>
        )}
      </div>
    </div>
  );
}

function btn(color: string, disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent', color, border: `1px solid ${color}`, borderRadius: 6,
    padding: '6px 12px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600, fontSize: 11 };
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'top' };
