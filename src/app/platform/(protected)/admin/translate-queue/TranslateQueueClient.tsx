'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface QueueState {
  status: 'queued' | 'deferred' | 'already_translated';
  priority?: number;
  note?: string;
  set_by?: string;
  set_at?: string;
}

interface Item {
  id: string;
  slug?: string;
  title: string;
  author?: string;
  language?: string;
  collections: string[];
  read_count: number;
  pages_count: number;
  pages_translated: number;
  status: 'translated' | 'partial' | 'untranslated';
  priority_score: number | null;
  confidence: string | null;
  validated_count: number;
  validated_first: { english_title?: string; translator?: string; pub_year?: string } | null;
  audit: { verdict?: string; confidence?: string } | null;
  queue: QueueState | null;
}

interface Facets {
  languages: { language: string; count: number }[];
  collections: { collection: string; count: number }[];
  status: { untranslated: number; partial: number; translated: number };
  queue: Record<string, number>;
}

interface ApiResponse {
  total: number;
  page: number;
  limit: number;
  items: Item[];
  facets: Facets;
}

const C = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  dim: '#8b949e',
  accent: '#58a6ff',
  green: '#3fb950',
  amber: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
};

const STATUS_COLOR: Record<Item['status'], string> = {
  translated: C.green,
  partial: C.amber,
  untranslated: C.red,
};

const QUEUE_COLOR: Record<string, string> = {
  queued: C.accent,
  deferred: C.dim,
  already_translated: C.purple,
};

const LIMIT = 50;

function chip(label: string, color: string, title?: string) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function TranslateQueueClient() {
  const [lang, setLang] = useState('');
  const [collection, setCollection] = useState('');
  const [status, setStatus] = useState('all');
  const [queue, setQueue] = useState('all');
  const [minReads, setMinReads] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('priority');
  const [page, setPage] = useState(0);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      status,
      queue,
      sort,
      page: String(page),
      limit: String(LIMIT),
    });
    if (lang) params.set('lang', lang);
    if (collection) params.set('collection', collection);
    if (minReads > 0) params.set('minReads', String(minReads));
    if (q.trim()) params.set('q', q.trim());
    try {
      const res = await fetch(`/api/admin/translate-queue?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      if (abortRef.current === controller) setData(json);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [lang, collection, status, queue, minReads, q, sort, page]);

  // Debounce the text query; everything else fires immediately.
  useEffect(() => {
    const t = setTimeout(fetchData, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchData, q]);

  // Reset to page 0 whenever a filter (not the page itself) changes.
  useEffect(() => {
    setPage(0);
  }, [lang, collection, status, queue, minReads, q, sort]);

  const act = useCallback(
    async (id: string, action: string, extra: Record<string, unknown> = {}) => {
      setActing(id);
      try {
        const res = await fetch('/api/admin/translate-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action, ...extra }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        await fetchData();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setActing(null);
      }
    },
    [fetchData],
  );

  const facets = data?.facets;
  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  const qf = facets?.queue ?? {};

  const selStyle: React.CSSProperties = {
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: '5px 8px',
    fontSize: 13,
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Translate Next</h1>
        <p style={{ color: C.dim, fontSize: 13, margin: '4px 0 0' }}>
          First-translation candidates (<code>confirmed_first</code>). Queue a book for translation, defer
          it, or mark it already-translated. Ranked by composite priority score.
        </p>
      </div>

      {/* Summary stat cards */}
      {facets && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
          <Stat label="Untranslated" value={facets.status.untranslated} color={C.red} onClick={() => { setStatus('untranslated'); setQueue('all'); }} />
          <Stat label="Partial" value={facets.status.partial} color={C.amber} onClick={() => { setStatus('partial'); setQueue('all'); }} />
          <Stat label="Translated" value={facets.status.translated} color={C.green} onClick={() => { setStatus('translated'); setQueue('all'); }} />
          <div style={{ width: 1, background: C.border, margin: '0 4px' }} />
          <Stat label="Queued" value={qf.queued || 0} color={C.accent} onClick={() => { setQueue('queued'); setStatus('all'); }} />
          <Stat label="Deferred" value={qf.deferred || 0} color={C.dim} onClick={() => { setQueue('deferred'); setStatus('all'); }} />
          <Stat label="Already translated" value={qf.already_translated || 0} color={C.purple} onClick={() => { setQueue('already_translated'); setStatus('all'); }} />
          <Stat label="Untriaged" value={qf.untriaged || 0} color={C.text} onClick={() => { setQueue('untriaged'); setStatus('all'); }} />
        </div>
      )}

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 12,
          marginBottom: 14,
        }}
      >
        <input
          placeholder="Search title or author…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...selStyle, minWidth: 220, flex: 1 }}
        />
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={selStyle}>
          <option value="">All languages</option>
          {facets?.languages.map((l) => (
            <option key={l.language} value={l.language}>
              {l.language} ({l.count})
            </option>
          ))}
        </select>
        <select value={collection} onChange={(e) => setCollection(e.target.value)} style={selStyle}>
          <option value="">All collections</option>
          {facets?.collections.map((c) => (
            <option key={c.collection} value={c.collection}>
              {c.collection} ({c.count})
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyle}>
          <option value="all">Any status</option>
          <option value="untranslated">Untranslated</option>
          <option value="partial">Partial</option>
          <option value="translated">Translated</option>
        </select>
        <select value={queue} onChange={(e) => setQueue(e.target.value)} style={selStyle}>
          <option value="all">Any triage</option>
          <option value="untriaged">Untriaged</option>
          <option value="queued">Queued</option>
          <option value="deferred">Deferred</option>
          <option value="already_translated">Already translated</option>
        </select>
        <select value={String(minReads)} onChange={(e) => setMinReads(Number(e.target.value))} style={selStyle}>
          <option value="0">Any reads</option>
          <option value="1">1+ reads</option>
          <option value="5">5+ reads</option>
          <option value="20">20+ reads</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={selStyle}>
          <option value="priority">Sort: Priority score</option>
          <option value="reads">Sort: Read count</option>
          <option value="pages_asc">Sort: Fewest pages</option>
          <option value="pages_desc">Sort: Most pages</option>
          <option value="queue_priority">Sort: Queue priority</option>
          <option value="recent">Sort: Recently triaged</option>
        </select>
      </div>

      {error && (
        <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>Error: {error}</div>
      )}

      <div style={{ color: C.dim, fontSize: 12, marginBottom: 8 }}>
        {loading ? 'Loading…' : `${data?.total ?? 0} books · page ${page + 1} of ${totalPages || 1}`}
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.panel, color: C.dim, textAlign: 'left' }}>
              <th style={th}>Book</th>
              <th style={th}>Lang</th>
              <th style={{ ...th, textAlign: 'right' }}>Pages</th>
              <th style={{ ...th, textAlign: 'right' }}>Reads</th>
              <th style={{ ...th, textAlign: 'right' }}>Score</th>
              <th style={th}>Status</th>
              <th style={th}>Triage</th>
              <th style={{ ...th, width: 280 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((b) => (
              <Row key={b.id} b={b} acting={acting === b.id} onAct={act} />
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: C.dim }}>
                  No books match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={pageBtn(page === 0)}>
            ← Prev
          </button>
          <span style={{ color: C.dim, fontSize: 13, alignSelf: 'center' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={pageBtn(page >= totalPages - 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '8px 14px',
        cursor: 'pointer',
        textAlign: 'left',
        minWidth: 96,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: C.dim }}>{label}</div>
    </button>
  );
}

function Row({ b, acting, onAct }: { b: Item; acting: boolean; onAct: (id: string, action: string, extra?: Record<string, unknown>) => void }) {
  const [priority, setPriority] = useState(2);
  const bookUrl = `https://sourcelibrary.org/book/${b.slug || b.id}`;
  return (
    <tr style={{ borderTop: `1px solid ${C.border}`, opacity: acting ? 0.5 : 1 }}>
      <td style={td}>
        <a href={bookUrl} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: 'none', fontWeight: 500 }}>
          {b.title}
        </a>
        <div style={{ color: C.dim, fontSize: 12 }}>
          {b.author || '—'}
          {b.collections.length > 0 && <span> · {b.collections.slice(0, 3).join(', ')}</span>}
        </div>
        {(b.validated_count > 0 || b.audit) && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {b.validated_count > 0 &&
              chip(
                `catalog: ${b.validated_first?.translator || b.validated_first?.english_title || b.validated_count}`,
                C.purple,
                'A prior translation was found in a catalog — consider "Already translated"',
              )}
            {b.audit?.verdict && chip(`audit: ${b.audit.verdict}`, C.dim, `confidence: ${b.audit.confidence || '—'}`)}
          </div>
        )}
      </td>
      <td style={td}>{b.language || '—'}</td>
      <td style={{ ...td, textAlign: 'right' }}>
        {b.pages_count}
        {b.status === 'partial' && (
          <div style={{ fontSize: 11, color: C.amber }}>{b.pages_translated} done</div>
        )}
      </td>
      <td style={{ ...td, textAlign: 'right' }}>{b.read_count}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{b.priority_score ?? '—'}</td>
      <td style={td}>{chip(b.status, STATUS_COLOR[b.status])}</td>
      <td style={td}>
        {b.queue
          ? chip(
              b.queue.status === 'queued' ? `queued P${b.queue.priority}` : b.queue.status.replace('_', ' '),
              QUEUE_COLOR[b.queue.status] || C.text,
              b.queue.note ? `${b.queue.note} — ${b.queue.set_by || ''}` : b.queue.set_by,
            )
          : chip('untriaged', C.dim)}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            disabled={acting}
            style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, padding: '2px 4px' }}
            title="Queue priority"
          >
            <option value={1}>P1</option>
            <option value={2}>P2</option>
            <option value={3}>P3</option>
          </select>
          <ActBtn label="Queue" color={C.accent} disabled={acting} onClick={() => onAct(b.id, 'queue', { priority })} />
          <ActBtn label="Defer" color={C.dim} disabled={acting} onClick={() => onAct(b.id, 'defer')} />
          <ActBtn
            label="Translated"
            color={C.purple}
            disabled={acting}
            onClick={() => {
              if (confirm(`Mark "${b.title}" as already translated? This flips is_first_translation → false.`)) {
                onAct(b.id, 'already_translated');
              }
            }}
          />
          {b.queue && <ActBtn label="Clear" color={C.text} disabled={acting} onClick={() => onAct(b.id, 'clear')} />}
        </div>
      </td>
    </tr>
  );
}

function ActBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: '3px 8px',
        fontSize: 12,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
function pageBtn(disabled: boolean): React.CSSProperties {
  return {
    background: C.panel,
    color: disabled ? C.dim : C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    cursor: disabled ? 'default' : 'pointer',
  };
}
