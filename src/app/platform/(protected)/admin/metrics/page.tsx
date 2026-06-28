/**
 * Audience & usage metrics dashboard.
 *
 * Reads the daily snapshot from system_config.metrics_snapshot (written by
 * scripts/analytics/snapshot-metrics.mjs on a Hetzner cron) and renders it.
 * The page never runs the heavy analytics aggregations itself — same
 * read-a-precomputed-doc pattern as the homepage_stats surfaces. Gated by the
 * protected layout (requireSuperAdmin). Numbers are "as of" the snapshot's
 * generatedAt, shown in the header.
 *
 * The snapshot shape is produced by snapshot-metrics.mjs — keep the two in sync
 * if you add fields there.
 */
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface MetricsSnapshot {
  generatedAt?: Date | string;
  windowDays?: number;
  users?: Record<string, number | null>;
  engagement?: {
    mau?: number; avgDau?: number;
    dauLast3?: { date: string; users: number }[];
    dwellMedianSec?: number; dwellMeanSec?: number; dwellSessions?: number;
  };
  conversion?: { uniqVisitors?: number; newSignups?: number; returningVisitors?: number; returningTotal?: number };
  reading?: { pairs?: number; median?: number; p90?: number; oneOnly?: number; deep?: number; opens?: number } | null;
  missionActions?: Record<string, number>;
  traffic?: {
    humanPvs?: number; botPvs?: number;
    dailyPageviews?: { date: string; hits: number }[];
    topBooks?: { key: string; hits: number; title: string; author: string; language: string }[];
    topCollections?: { slug: string; hits: number }[];
    topReferrers?: { referrer: string; hits: number }[];
    topCountries?: { country: string; hits: number }[];
  };
  search?: {
    total?: number; human?: number; zeroResult?: number;
    topQueries?: { query: string; count: number }[];
    zeroQueries?: { query: string; count: number }[];
    latencyP50?: number | null; latencyP90?: number | null;
  } | null;
  social?: { likes?: number; likeVisitors?: number; feedback?: number; feedbackUnread?: number; feedbackWantsHelp?: number } | null;
  ai?: { feature: string; calls: number; cost: number; avgMs: number }[] | null;
  pipelineCost?: {
    latestDay?: string; stale?: boolean; last7?: number; last30?: number;
    recentDays?: { date: string; cost: number; records: number }[];
  } | null;
}

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');
const pct = (a?: number | null, b?: number | null) => (b ? ((100 * (a || 0)) / b).toFixed(1) + '%' : '—');
const dur = (s?: number | null) => `${Math.floor((s || 0) / 60)}m ${Math.round((s || 0) % 60)}s`;

const C = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 18px' } as const,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 } as const,
  big: { fontSize: 30, fontWeight: 700, color: '#e6edf3', lineHeight: 1.1 } as const,
  label: { fontSize: 12, color: '#8b949e', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 } as const,
  sub: { fontSize: 12, color: '#6e7681', marginTop: 2 } as const,
  h2: { fontSize: 16, fontWeight: 600, color: '#e6edf3', margin: '28px 0 12px' } as const,
  th: { textAlign: 'left' as const, fontSize: 11, color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '6px 10px', borderBottom: '1px solid #30363d' },
  td: { fontSize: 13, color: '#c9d1d9', padding: '6px 10px', borderBottom: '1px solid #21262d' },
};

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div style={C.card}>
      <div style={C.big}>{value}</div>
      <div style={C.label}>{label}</div>
      {sub ? <div style={C.sub}>{sub}</div> : null}
    </div>
  );
}

function Bars({ data }: { data: { date: string; hits: number }[] }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.hits), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, ...C.card, paddingTop: 18 }}>
      {data.map((d) => (
        <div key={d.date} title={`${d.date}: ${num(d.hits)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ height: `${(d.hits / max) * 100}%`, background: '#2f81f7', borderRadius: '2px 2px 0 0', minHeight: 1 }} />
        </div>
      ))}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  if (!rows?.length) return <p style={{ color: '#6e7681', fontSize: 13 }}>No data.</p>;
  return (
    <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...C.th, textAlign: i === 0 ? 'left' : i === headers.length - 1 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ ...C.td, textAlign: ci === r.length - 1 ? 'right' : 'left', color: ci === 0 ? '#c9d1d9' : '#8b949e' }}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MetricsPage() {
  const db = await getDb();
  const s = (await db.collection('system_config').findOne({ _id: 'metrics_snapshot' } as never)) as MetricsSnapshot | null;

  if (!s) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>Metrics</h1>
        <p style={{ color: '#8b949e', marginTop: 12 }}>
          No snapshot yet. Run <code style={{ color: '#e6edf3' }}>node scripts/analytics/snapshot-metrics.mjs</code> to populate it
          (it also runs daily on the Hetzner cron).
        </p>
      </div>
    );
  }

  const u = s.users || {};
  const e = s.engagement || {};
  const c = s.conversion || {};
  const t = s.traffic || {};
  const win = s.windowDays || 30;
  const gen = s.generatedAt ? new Date(s.generatedAt) : null;
  const ageH = gen ? Math.round((Date.now() - gen.getTime()) / 36e5) : null;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3', margin: 0 }}>Audience &amp; Usage</h1>
        <span style={{ fontSize: 12, color: ageH !== null && ageH > 30 ? '#d29922' : '#6e7681' }}>
          snapshot {gen ? gen.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown'}
          {ageH !== null ? ` · ${ageH}h ago` : ''} · {win}-day window
        </span>
      </div>

      <h2 style={C.h2}>Audience</h2>
      <div style={C.grid}>
        <Stat value={num(u.total)} label="Signups" sub={`${num(u.new30)} new in ${win}d · ${num(u.new7)} in 7d`} />
        <Stat value={num(u.verified)} label="Email verified" sub={pct(u.verified, u.total) + ' of signups'} />
        <Stat value={num(u.everLoggedIn)} label="Ever logged in" sub={`${num(u.repeatLogin)} returning (2+)`} />
        <Stat value={num(e.mau)} label="MAU" sub="30d unique ip+ua" />
        <Stat value={num(e.avgDau)} label="Avg DAU" sub="last 14 days" />
        <Stat value={dur(e.dwellMedianSec)} label="Median dwell" sub={`mean ${dur(e.dwellMeanSec)} · 7d`} />
        <Stat value={num(u.beta_subscribers)} label="Beta subscribers" />
        <Stat value={num(u.newsletter_subscribers)} label="Newsletter" />
      </div>

      <h2 style={C.h2}>Conversion &amp; retention ({win}d)</h2>
      <div style={C.grid}>
        <Stat value={num(c.uniqVisitors)} label="Unique visitors" />
        <Stat value={pct(c.newSignups, c.uniqVisitors)} label="Visitor → signup" sub={`${num(c.newSignups)} signups`} />
        <Stat value={pct(c.returningVisitors, c.returningTotal)} label="Returning visitors" sub={`>1 day · ${num(c.returningVisitors)}`} />
        <Stat value={pct(e.avgDau, e.mau)} label="Stickiness" sub="DAU : MAU" />
      </div>

      {s.reading ? (
        <>
          <h2 style={C.h2}>Reading depth (7d)</h2>
          <div style={C.grid}>
            <Stat value={num(s.reading.opens)} label="Book opens" />
            <Stat value={String(s.reading.median ?? 0)} label="Median pages / book" sub={`p90 ${s.reading.p90 ?? 0}`} />
            <Stat value={pct(s.reading.oneOnly, s.reading.pairs)} label="Read 1 page only" />
            <Stat value={pct(s.reading.deep, s.reading.pairs)} label="Deep read (10+ pages)" sub={`${num(s.reading.deep)} of ${num(s.reading.pairs)}`} />
          </div>
        </>
      ) : null}

      <h2 style={C.h2}>Traffic ({win}d)</h2>
      <div style={{ ...C.grid, marginBottom: 12 }}>
        <Stat value={num(t.humanPvs)} label="Human pageviews" sub={`${num(t.botPvs)} bot/auto`} />
      </div>
      <Bars data={t.dailyPageviews || []} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div>
          <h2 style={C.h2}>Top books</h2>
          <Table headers={['title', 'hits']} rows={(t.topBooks || []).map((b) => [`${b.title}${b.author ? ' · ' + b.author : ''}`, num(b.hits)])} />
        </div>
        <div>
          <h2 style={C.h2}>Top collections</h2>
          <Table headers={['collection', 'hits']} rows={(t.topCollections || []).map((x) => [x.slug, num(x.hits)])} />
        </div>
        <div>
          <h2 style={C.h2}>Referrers</h2>
          <Table headers={['source', 'hits']} rows={(t.topReferrers || []).map((x) => [x.referrer, num(x.hits)])} />
        </div>
        <div>
          <h2 style={C.h2}>Countries</h2>
          <Table headers={['country', 'hits']} rows={(t.topCountries || []).map((x) => [x.country, num(x.hits)])} />
        </div>
      </div>

      {s.search ? (
        <>
          <h2 style={C.h2}>Search ({win}d)</h2>
          <div style={{ ...C.grid, marginBottom: 12 }}>
            <Stat value={num(s.search.human)} label="Human searches" sub={`${num(s.search.total)} total incl. bots`} />
            <Stat value={pct(s.search.zeroResult, s.search.human)} label="Zero-result" />
            <Stat value={s.search.latencyP50 != null ? `${s.search.latencyP50}ms` : '—'} label="Latency p50" sub={s.search.latencyP90 != null ? `p90 ${s.search.latencyP90}ms` : undefined} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <h2 style={C.h2}>Top queries</h2>
              <Table headers={['query', 'count']} rows={(s.search.topQueries || []).map((q) => [q.query, num(q.count)])} />
            </div>
            <div>
              <h2 style={C.h2}>Zero-result queries</h2>
              <Table headers={['query', 'count']} rows={(s.search.zeroQueries || []).map((q) => [q.query, num(q.count)])} />
            </div>
          </div>
        </>
      ) : null}

      {s.social ? (
        <>
          <h2 style={C.h2}>Social &amp; feedback ({win}d)</h2>
          <div style={C.grid}>
            <Stat value={num(s.social.likes)} label="Likes" sub={`${num(s.social.likeVisitors)} visitors`} />
            <Stat value={num(s.social.feedback)} label="Feedback" sub={`${num(s.social.feedbackUnread)} unread · ${num(s.social.feedbackWantsHelp)} want to help`} />
          </div>
        </>
      ) : null}

      {s.ai?.length ? (
        <>
          <h2 style={C.h2}>AI surfaces ({win}d)</h2>
          <Table headers={['feature', 'calls', 'cost', 'avg ms']} rows={s.ai.map((a) => [a.feature, num(a.calls), '$' + a.cost.toFixed(2), num(a.avgMs)])} />
        </>
      ) : null}

      {s.pipelineCost ? (
        <>
          <h2 style={C.h2}>Pipeline cost (Gemini)</h2>
          <div style={{ ...C.grid, marginBottom: 12 }}>
            <Stat value={'$' + (s.pipelineCost.last7 ?? 0).toFixed(2)} label="Last 7 days" />
            <Stat value={'$' + (s.pipelineCost.last30 ?? 0).toFixed(2)} label="Last 30 days" />
            <Stat value={s.pipelineCost.latestDay || '—'} label="Latest day" sub={s.pipelineCost.stale ? '⚠ rollup stale (pipeline paused?)' : undefined} />
          </div>
          <Table headers={['date', 'cost', 'records']} rows={(s.pipelineCost.recentDays || []).map((d) => [d.date, '$' + d.cost.toFixed(2), num(d.records)])} />
        </>
      ) : null}
    </div>
  );
}
