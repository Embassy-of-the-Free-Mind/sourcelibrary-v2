/**
 * Reading Register — an EXTERNAL-ONLY view of who reads and consults the library.
 *
 * Reads the daily snapshot from system_config.reading_register (written by
 * scripts/analytics/snapshot-reading-register.mjs on a Hetzner cron) and renders
 * it. Never runs the aggregations on page load. Gated by the protected layout
 * (requireSuperAdmin) — this view carries pseudonymous identifiers and
 * un-thresholded specifics, so it is INTERNAL ONLY, never public.
 *
 * "External-only" is the whole point: our own dev CLIs, edge functions, audit
 * probes, and `test` queries are filtered out at snapshot time, so the numbers
 * reflect real outside readers and agents. Keep the snapshot shape in sync with
 * snapshot-reading-register.mjs.
 */
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface BookRow { slug?: string; title: string; author?: string; hits?: number; n?: number }
interface QueryRow { query: string; n: number; avgResults?: number; tools?: string[] }
interface ZeroRow { query: string; n: number; held: number; visible: number }
interface ClientRow { client: string; n: number }
interface ReadingRegister {
  generatedAt?: Date | string;
  windowDays?: number;
  since?: Date | string;
  logsSince?: string | null;
  headline?: { readerViews?: number; humanSearchers?: number; humanSearches?: number; mcpExternal?: number; mcpInternal?: number; extClients?: number; claudeUser?: number };
  readerBooks?: BookRow[];
  agentBooks?: BookRow[];
  mcp?: { total?: number; external?: number; internal?: number; clients?: number; claudeUser?: number; clientRows?: ClientRow[] };
  agentQueries?: QueryRow[];
  search?: { humanSearchers?: number; humanSearches?: number; topQueries?: QueryRow[]; zeroQueries?: ZeroRow[] };
}

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');

const C = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 18px' } as const,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 } as const,
  big: { fontSize: 30, fontWeight: 700, color: '#e6edf3', lineHeight: 1.1 } as const,
  label: { fontSize: 12, color: '#8b949e', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 } as const,
  sub: { fontSize: 12, color: '#6e7681', marginTop: 2 } as const,
  h2: { fontSize: 16, fontWeight: 600, color: '#e6edf3', margin: '30px 0 4px' } as const,
  h2sub: { fontSize: 12, color: '#6e7681', margin: '0 0 12px' } as const,
  th: { textAlign: 'left' as const, fontSize: 11, color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '6px 10px', borderBottom: '1px solid #30363d' },
  td: { fontSize: 13, color: '#c9d1d9', padding: '6px 10px', borderBottom: '1px solid #21262d' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const,
};

function Stat({ value, label, sub, accent }: { value: string; label: string; sub?: string; accent?: string }) {
  return (
    <div style={C.card}>
      <div style={{ ...C.big, color: accent || '#e6edf3' }}>{value}</div>
      <div style={C.label}>{label}</div>
      {sub ? <div style={C.sub}>{sub}</div> : null}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (<><h2 style={C.h2}>{title}</h2>{sub ? <p style={C.h2sub}>{sub}</p> : null}</>);
}

// Horizontal-bar rank list for specific books / clients.
function RankBars({ rows, color }: { rows: { label: React.ReactNode; value: number }[]; color: string }) {
  if (!rows?.length) return <p style={{ color: '#6e7681', fontSize: 13 }}>No data.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ ...C.card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 40px', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
          <div style={{ height: 7, background: '#21262d', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: color, minWidth: 2 }} />
          </div>
          <div style={{ ...C.mono, fontSize: 12, color: '#8b949e', textAlign: 'right' }}>{num(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (!rows?.length) return <p style={{ color: '#6e7681', fontSize: 13 }}>No data.</p>;
  return (
    <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...C.th, textAlign: i === headers.length - 1 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ ...C.td, textAlign: ci === r.length - 1 ? 'right' : 'left', color: ci === 0 ? '#c9d1d9' : '#8b949e' }}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCHEMA: { name: string; fields: string[]; note: string }[] = [
  { name: 'mcp_tool_calls', fields: ['tool', 'args', 'ms', 'ok', 'error', 'ip_hash', 'user_agent', 'ts'], note: 'One row per agent tool-call. args holds the payload — the exact query, or a book_id + page. That is where intent lives.' },
  { name: 'search_queries', fields: ['query', 'total', 'route', 'ms', 'ok', 'identity_kind', 'filters', 'stage_ms', 'ip_hash', 'user_agent'], note: 'One row per search (web + MCP). total is the result count (0 flags a possible miss); filters records language + ranking; stage_ms times each lane.' },
];

const METHODOLOGY: [string, string][] = [
  ['External-only', 'Our own dev CLIs (claude-code), edge functions (Deno/Supabase), audit probes, and test queries are filtered out at snapshot time. What remains is outside readers and agents. In the last window that removed ~72% of raw MCP calls — do not compare these numbers to the raw logs.'],
  ['Snapshot, not live', 'Precomputed daily by scripts/analytics/snapshot-reading-register.mjs and read from system_config.reading_register. The header shows when it was generated; older than ~30h turns amber.'],
  ['Zero-result ≠ missing book', 'Each zero-result query is checked against holdings. "held" / "visible" columns > 0 mean we HAVE the book and search failed to surface it (a recall bug), not that we lack it. Only held=0 is a genuine acquisition signal.'],
  ['Readers vs agents are different shelves', 'Human page views and agent tool-calls rank different books — readers spread across the whole collection; agents cluster hard on the Hermetic core. Neither is "the" popularity.'],
  ['Identifiers are pseudonymous', 'ip_hash is a salted hash, never a raw IP — but it is still pseudonymous, not anonymous, so this page stays internal. Recommended hygiene: age operational logs out at 30–90 days, keep only anonymised aggregates beyond that.'],
];

export default async function ReadingRegisterPage() {
  const db = await getDb();
  const s = (await db.collection('system_config').findOne({ _id: 'reading_register' } as never)) as ReadingRegister | null;

  if (!s) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>Reading Register</h1>
        <p style={{ color: '#8b949e', marginTop: 12 }}>
          No snapshot yet. Run <code style={{ color: '#e6edf3' }}>node scripts/analytics/snapshot-reading-register.mjs</code> to populate it
          (it also runs daily on the Hetzner cron).
        </p>
      </div>
    );
  }

  const h = s.headline || {};
  const win = s.windowDays || 30;
  const gen = s.generatedAt ? new Date(s.generatedAt) : null;
  const ageH = gen ? Math.round((Date.now() - gen.getTime()) / 36e5) : null;
  const sr = s.search || {};

  const bookLabel = (b: BookRow) =>
    b.slug ? <a href={`https://sourcelibrary.org/book/${b.slug}`} style={{ color: '#c9d1d9' }} target="_blank" rel="noopener noreferrer">{b.title}{b.author ? <span style={{ color: '#6e7681' }}> · {b.author}</span> : null}</a>
      : <span>{b.title}{b.author ? <span style={{ color: '#6e7681' }}> · {b.author}</span> : null}</span>;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3', margin: 0 }}>Reading Register</h1>
        <span style={{ fontSize: 12, color: ageH !== null && ageH > 30 ? '#d29922' : '#6e7681' }}>
          snapshot {gen ? gen.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown'}
          {ageH !== null ? ` · ${ageH}h ago` : ''} · {win}-day window{s.logsSince ? ` · logs since ${s.logsSince}` : ''}
        </span>
      </div>
      <p style={{ fontSize: 12, color: '#6e7681', margin: '6px 0 0' }}>
        External readers &amp; agents only — our own dev, testing, and infrastructure traffic is filtered out. Internal view; never publish as-is.
      </p>

      <SectionHead title="Headline" sub={`Trailing ${win} days. Reader views are human page views; agent calls exclude our own clients.`} />
      <div style={C.grid}>
        <Stat value={num(h.readerViews)} label="Reader views" accent="#d4837a" />
        <Stat value={num(h.humanSearchers)} label="Human searchers" accent="#d4837a" sub={`${num(h.humanSearches)} searches`} />
        <Stat value={num(h.mcpExternal)} label="External agent calls" accent="#d3aa57" sub={`${num(h.mcpInternal)} internal excluded`} />
        <Stat value={num(h.extClients)} label="External agents" accent="#d3aa57" />
        <Stat value={num(h.claudeUser)} label="Via Claude (people)" accent="#d3aa57" />
      </div>

      <SectionHead title="What we capture" sub="The full field set of each log. ip_hash + user_agent are the identifying fields that keep this internal." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {SCHEMA.map((sc) => (
          <div key={sc.name} style={C.card}>
            <div style={{ ...C.mono, fontSize: 13, color: '#e6edf3', marginBottom: 10 }}>{sc.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {sc.fields.map((f) => {
                const pii = f === 'ip_hash' || f === 'user_agent';
                const key = f === 'tool' || f === 'args' || f === 'query' || f === 'total';
                return <span key={f} style={{ ...C.mono, fontSize: 11.5, padding: '3px 8px', borderRadius: 3, background: '#0d1117', border: `1px solid ${pii ? '#5c2e2b' : key ? '#2a4d3a' : '#30363d'}`, color: pii ? '#d4837a' : key ? '#7ee2a8' : '#8b949e' }}>{f}</span>;
              })}
            </div>
            <div style={{ fontSize: 12.5, color: '#8b949e', lineHeight: 1.5 }}>{sc.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <SectionHead title="What people opened" sub="Specific books, by human page views." />
          <RankBars color="#d4837a" rows={(s.readerBooks || []).slice(0, 12).map((b) => ({ label: bookLabel(b), value: b.hits || 0 }))} />
        </div>
        <div>
          <SectionHead title="What agents chose" sub="External MCP get_book / get_quote." />
          <RankBars color="#d3aa57" rows={(s.agentBooks || []).slice(0, 12).map((b) => ({ label: bookLabel(b), value: b.n || 0 }))} />
        </div>
      </div>

      <SectionHead title="Search, and what it can't find" sub="Top human searches resolve well. Zero-result queries are checked against holdings — held/visible > 0 means a recall bug, not a gap." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <SectionHead title="Top queries" sub="avg results" />
          <Table headers={['query', 'count', 'avg']} rows={(sr.topQueries || []).map((q) => [q.query, num(q.n), `~${q.avgResults}`])} />
        </div>
        <div>
          <SectionHead title="Zero results" sub="held / visible in catalogue" />
          <Table headers={['query', 'count', 'held·vis']} rows={(sr.zeroQueries || []).map((q) => [
            <span key="q">{q.query}{q.held === 0 ? <span style={{ color: '#d29922' }}> · possible gap</span> : q.visible > 0 ? <span style={{ color: '#6e7681' }}> · held, not surfaced</span> : <span style={{ color: '#6e7681' }}> · held, hidden</span>}</span>,
            num(q.n),
            `${q.held}·${q.visible}`,
          ])} />
        </div>
      </div>

      {s.agentQueries?.length ? (
        <>
          <SectionHead title="What agents searched for" sub="External concept / library / image queries — the research campaigns passing through." />
          <Table headers={['query', 'tools', 'count']} rows={s.agentQueries.map((q) => [q.query, (q.tools || []).join(', '), num(q.n)])} />
        </>
      ) : null}

      <SectionHead title="Who is calling — external agents only" sub={`${num(s.mcp?.clients)} clients · ${num(s.mcp?.external)} calls. Internal (${num(s.mcp?.internal)}) excluded.`} />
      <RankBars color="#3fb950" rows={(s.mcp?.clientRows || []).map((c) => ({ label: <span style={C.mono}>{c.client}</span>, value: c.n }))} />

      <SectionHead title="Methodology & caveats" sub="What these numbers mean — and what they do not." />
      <div style={{ ...C.card, display: 'grid', gap: 14 }}>
        {METHODOLOGY.map(([title, body]) => (
          <div key={title}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>{title}</div>
            <div style={{ fontSize: 12.5, color: '#8b949e', marginTop: 3, lineHeight: 1.5 }}>{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
