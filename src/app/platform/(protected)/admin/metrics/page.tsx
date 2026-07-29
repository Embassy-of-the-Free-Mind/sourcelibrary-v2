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
 * Every metric carries a plain-language definition (the `def` prop on each
 * Stat) and the page closes with a Methodology panel — the numbers here come
 * from coarse proxies (ip+ua fingerprints, not accounts) and must be read with
 * their caveats, or they mislead. Keep the snapshot shape in sync with
 * snapshot-metrics.mjs.
 */
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface Delta { now?: number; prev?: number }
interface MetricsSnapshot {
  generatedAt?: Date | string;
  windowDays?: number;
  schemaVersion?: number;
  users?: Record<string, number | null>;
  deltas?: { signups7?: Delta; signups30?: Delta; pageviews7?: Delta };
  series?: {
    signupsByDay?: { date: string; n: number }[];
    signupsBaseline?: number;
    dau?: { date: string; users: number }[];
  };
  engagement?: {
    mau?: number; avgDau?: number;
    dauLast3?: { date: string; users: number }[];
    dwellMedianSec?: number; dwellMeanSec?: number; dwellSessions?: number;
  };
  conversion?: { uniqVisitors?: number; newSignups?: number; returningVisitors?: number; returningTotal?: number };
  reading?: {
    pairs?: number; median?: number; p90?: number; oneOnly?: number; deep?: number; opens?: number;
    // Set when the 7d window is mostly pre-#3405 events, which carry no
    // traffic_class and so can't be attributed to humans or crawlers.
    contaminated?: boolean; unclassified?: number; total?: number;
  } | null;
  // From reading_history: signed-in members only, therefore crawler-free.
  readingMembers?: {
    sessions?: number; users?: number; books?: number;
    median?: number; p75?: number; p90?: number; p99?: number; max?: number;
    oneOnly?: number; shallow?: number; middling?: number; deep?: number; veryDeep?: number;
    totalPages?: number; pagesOneOnly?: number; pagesDeep?: number; pagesVeryDeep?: number;
    multiDayUsers?: number; threeDayUsers?: number; spanOver24hUsers?: number;
    singleHourUsers?: number; multiBookUsers?: number; multiSessionUsers?: number;
    pacedSessions?: number; fastSessions?: number; fastPages?: number; machinePacePpm?: number;
    top1PctPageShare?: number; top10PctPageShare?: number;
    /** Pre-2026-07-29 snapshots only. Counted `sessions > 1`, which a second
     *  book opened in the same sitting satisfies — never a return. Rendered
     *  under its true label when the day-based figure is absent. */
    returningUsers?: number;
  } | null;
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 } as const,
  big: { fontSize: 30, fontWeight: 700, color: '#e6edf3', lineHeight: 1.1 } as const,
  label: { fontSize: 12, color: '#8b949e', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 } as const,
  sub: { fontSize: 12, color: '#6e7681', marginTop: 2 } as const,
  def: { fontSize: 11, color: '#56606b', marginTop: 8, lineHeight: 1.45 } as const,
  h2: { fontSize: 16, fontWeight: 600, color: '#e6edf3', margin: '30px 0 4px' } as const,
  h2sub: { fontSize: 12, color: '#6e7681', margin: '0 0 12px' } as const,
  th: { textAlign: 'left' as const, fontSize: 11, color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '6px 10px', borderBottom: '1px solid #30363d' },
  td: { fontSize: 13, color: '#c9d1d9', padding: '6px 10px', borderBottom: '1px solid #21262d' },
};

// Period-over-period change chip. Direction-neutral colour: up=green, down=red,
// flat=grey. `prev` is shown so the reader sees what it's measured against.
function DeltaChip({ d, suffix = '' }: { d?: Delta; suffix?: string }) {
  if (!d || d.now == null || d.prev == null) return null;
  const diff = d.now - d.prev;
  const p = d.prev ? (100 * diff) / d.prev : 0;
  const up = diff > 0, flat = diff === 0;
  const color = flat ? '#8b949e' : up ? '#3fb950' : '#f85149';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return (
    <div style={{ fontSize: 12, color, marginTop: 6, fontWeight: 600 }}>
      {arrow} {Math.abs(p).toFixed(0)}%{suffix}
      <span style={{ color: '#56606b', fontWeight: 400 }}> vs prev {num(d.prev)}</span>
    </div>
  );
}

function Stat({ value, label, sub, def, delta }: { value: string; label: string; sub?: string; def?: string; delta?: React.ReactNode }) {
  return (
    <div style={C.card}>
      <div style={C.big}>{value}</div>
      <div style={C.label}>{label}</div>
      {sub ? <div style={C.sub}>{sub}</div> : null}
      {delta}
      {def ? <div style={C.def}>{def}</div> : null}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h2 style={C.h2}>{title}</h2>
      {sub ? <p style={C.h2sub}>{sub}</p> : null}
    </>
  );
}

function Bars({ data, color = '#2f81f7', height = 90 }: { data: { date: string; value: number }[]; color?: string; height?: number }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, ...C.card, paddingTop: 18 }}>
      {data.map((d) => (
        <div key={d.date} title={`${d.date}: ${num(d.value)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ height: `${(d.value / max) * 100}%`, background: color, borderRadius: '2px 2px 0 0', minHeight: 1 }} />
        </div>
      ))}
    </div>
  );
}

// Cumulative-signups line over a faint daily-new histogram. Pure SVG, no client JS.
function GrowthChart({ daily, baseline }: { daily: { date: string; n: number }[]; baseline: number }) {
  if (!daily?.length) return null;
  const W = 1000, H = 200, pad = 4;
  let cum = baseline;
  const cumPts = daily.map((d) => { cum += d.n; return cum; });
  const cumMax = Math.max(...cumPts, 1), cumMin = baseline;
  const dailyMax = Math.max(...daily.map((d) => d.n), 1);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(daily.length - 1, 1);
  const yC = (v: number) => H - pad - ((v - cumMin) / Math.max(cumMax - cumMin, 1)) * (H - 2 * pad);
  const path = cumPts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yC(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(daily.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const barW = (W - 2 * pad) / daily.length * 0.7;
  return (
    <div style={C.card}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 200, display: 'block' }}>
        {daily.map((d, i) => {
          const h = (d.n / dailyMax) * (H - 2 * pad) * 0.55;
          return <rect key={d.date} x={x(i) - barW / 2} y={H - pad - h} width={barW} height={h} fill="#21364e" />;
        })}
        <path d={area} fill="rgba(63,185,80,0.08)" />
        <path d={path} fill="none" stroke="#3fb950" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#56606b', marginTop: 6 }}>
        <span>{daily[0]?.date}</span>
        <span style={{ color: '#3fb950' }}>━ cumulative signups</span>
        <span style={{ color: '#21364e' }}>▮ new/day</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
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

const METHODOLOGY: [string, string][] = [
  ['Snapshot cadence', 'Numbers are precomputed once a day at 05:45 UTC by scripts/analytics/snapshot-metrics.mjs and read from system_config.metrics_snapshot — they are NOT live. The header shows when this snapshot was generated; if it is more than ~30h old the timestamp turns amber.'],
  ['Visitors are fingerprints, not people', 'MAU, DAU, unique visitors, dwell and retention are all keyed on (IP + first 60 chars of user-agent), with the last IP octet zeroed at ingest. One person on phone + laptop counts twice; a shared office IP can collapse several people into one. Treat these as a consistent proxy for trend, not a true headcount. Accounts (signups, verified, logins) ARE real per-person counts.'],
  ['Dwell = multi-pageview sessions only', 'Median/mean session duration is measured over the last 7 days and only counts sessions with 2+ pageviews (a single-hit visit has no measurable duration), so it skews high relative to "average time on site across everyone."'],
  ['Reading depth median = 1 is normal', 'Most reader↔book pairs touch a single page (≈83%). This is the expected shape of a reference library — people land on one page from search or a citation. "Deep reads" (10+ pages) are the signal to watch.'],
  ['Zero-result searches are mostly typeahead', 'A large share of zero-result queries are truncated keystrokes logged mid-type (e.g. "flu", "parace"), not genuine content gaps. Only conceptual misses (a real subject we lack) indicate acquisition need.'],
  ['Traffic is bot-filtered & path-normalized', 'Pageview counts exclude known bots/crawlers/automation by user-agent. Legacy provider-prefixed and tenant /embed/ book URLs are folded to their canonical /book/<slug> so a book is counted however it was reached.'],
  ['share / cite are under-instrumented', 'The download/share/cite mission-action counts reflect what is currently wired to fire events; near-zero share/cite means the events are barely instrumented, not necessarily that nobody quotes.'],
  ['Pipeline cost can read stale', 'Gemini spend comes from the gemini_usage_daily rollup, which stops advancing while the OCR pipeline is paused. A stale "latest day" is flagged inline and means the rollup, not necessarily real spend, is behind.'],
];

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
  const dl = s.deltas || {};
  const ser = s.series || {};
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
      <p style={{ fontSize: 12, color: '#6e7681', margin: '6px 0 0' }}>
        Precomputed daily. Visitor metrics are ip+ua fingerprints (a proxy, not a headcount); account metrics are real. See methodology at the bottom.
      </p>

      <SectionHead title="Audience" sub="Signups & accounts are real per-person counts; MAU/DAU are fingerprint proxies." />
      <div style={C.grid}>
        <Stat value={num(u.total)} label="Signups" sub={`${num(u.new30)} new in ${win}d · ${num(u.new7)} in 7d`}
          delta={<DeltaChip d={dl.signups7} suffix=" wk/wk" />}
          def="Total registered accounts, all time. The week-over-week delta compares the last 7 days of new signups to the 7 before." />
        <Stat value={num(u.verified)} label="Email verified" sub={pct(u.verified, u.total) + ' of signups'}
          def="Accounts that completed email verification. The rest started signup but never confirmed." />
        <Stat value={num(u.everLoggedIn)} label="Ever logged in" sub={`${num(u.repeatLogin)} returning (2+)`}
          def="Accounts with at least one login; 'returning' have logged in 2+ times." />
        <Stat value={num(e.mau)} label="MAU" sub="30d unique ip+ua"
          def="Distinct visitor fingerprints active in the last 30 days. A proxy — not deduplicated to real people." />
        <Stat value={num(e.avgDau)} label="Avg DAU" sub="mean of last 14 days"
          def="Average daily unique fingerprints over the last 14 days." />
        <Stat value={dur(e.dwellMedianSec)} label="Median dwell" sub={`mean ${dur(e.dwellMeanSec)} · 7d`}
          def="Median session length over 7 days, counting only sessions with 2+ pageviews, so it skews high." />
        <Stat value={num(u.beta_subscribers)} label="Beta subscribers" />
        <Stat value={num(u.newsletter_subscribers)} label="Newsletter" />
      </div>

      <SectionHead title="Growth" sub="Cumulative signups (line) over daily new signups (bars), last 90 days." />
      <GrowthChart daily={ser.signupsByDay || []} baseline={ser.signupsBaseline || 0} />
      <div style={{ ...C.grid, marginTop: 12 }}>
        <Stat value={num(dl.signups30?.now)} label={`Signups this ${win}d`} delta={<DeltaChip d={dl.signups30} suffix=" vs prior 30d" />}
          def="New accounts in this window vs the window before it — the headline growth signal." />
        <Stat value={num(dl.pageviews7?.now)} label="Pageviews 7d" delta={<DeltaChip d={dl.pageviews7} suffix=" wk/wk" />}
          def="Human (bot-filtered) pageviews in the last 7 days vs the 7 before." />
      </div>

      <SectionHead title="Conversion & retention" sub={`Over the last ${win} days.`} />
      <div style={C.grid}>
        <Stat value={num(c.uniqVisitors)} label="Unique visitors" def="Distinct fingerprints in the window." />
        <Stat value={pct(c.newSignups, c.uniqVisitors)} label="Visitor → signup" sub={`${num(c.newSignups)} signups`}
          def="New signups divided by unique visitors. A rough funnel rate — numerator is accounts, denominator is fingerprints." />
        <Stat value={pct(c.returningVisitors, c.returningTotal)} label="Returning visitors" sub={`>1 day · ${num(c.returningVisitors)}`}
          def="Fingerprints seen on more than one calendar day in the window." />
        <Stat value={pct(e.avgDau, e.mau)} label="Stickiness" sub="DAU : MAU"
          def="Avg DAU as a share of MAU — how much of the monthly audience shows up on a given day." />
      </div>

      {ser.dau?.length ? (
        <>
          <SectionHead title="Daily active (30d)" sub="Unique fingerprints per day — momentum at a glance." />
          <Bars data={ser.dau.map((d) => ({ date: d.date, value: d.users }))} color="#3fb950" />
        </>
      ) : null}

      {s.readingMembers ? (
        <>
          <SectionHead
            title="Reading depth — signed-in members"
            sub={`${num(s.readingMembers.sessions)} sessions from ${num(s.readingMembers.users)} members across ${num(s.readingMembers.books)} books, last ${win} days. A session is one member on one book, activity within 30 minutes collapsed.`}
          />
          <div style={C.grid}>
            <Stat value={String(s.readingMembers.median ?? 0)} label="Median pages / session"
              sub={`p90 ${s.readingMembers.p90 ?? 0} · max ${num(s.readingMembers.max)}`}
              def="Distinct pages a member reads in one sitting. Counted from reading_history, which is written only behind a session — no crawler can appear in it." />
            <Stat value={pct(s.readingMembers.deep, s.readingMembers.sessions)} label="Deep read (10+ pages)"
              sub={s.readingMembers.pagesDeep != null
                ? `${num(s.readingMembers.deep)} sessions — but ${pct(s.readingMembers.pagesDeep, s.readingMembers.totalPages)} of all pages read`
                : `${num(s.readingMembers.deep)} sessions · ${num(s.readingMembers.veryDeep)} read 50+`}
              def="The engaged tail. This is the number the anonymous page_read metric got wrong by an order of magnitude before #3405. Counting sessions understates it: deep sessions are a quarter of sittings and the large majority of pages actually read." />
            <Stat value={pct(s.readingMembers.oneOnly, s.readingMembers.sessions)} label="One page only"
              sub={s.readingMembers.pagesOneOnly != null
                ? `only ${pct(s.readingMembers.pagesOneOnly, s.readingMembers.totalPages)} of all pages read`
                : undefined}
              def="Arrived from a search result or citation and left. Expected to be substantial for a reference library — and near-weightless once you count pages instead of sessions." />
            {s.readingMembers.multiDayUsers != null ? (
              <Stat value={pct(s.readingMembers.multiDayUsers, s.readingMembers.users)} label="Members who came back"
                sub={`${num(s.readingMembers.multiDayUsers)} of ${num(s.readingMembers.users)} read on more than one day`}
                def="Read on more than one calendar day in the window. A session is one user+BOOK, so the older 'more than one session' figure counted opening a second book in the same sitting as a return — it read roughly twice as high." />
            ) : (
              <Stat value={pct(s.readingMembers.returningUsers, s.readingMembers.users)} label="Opened more than one book"
                sub={`${num(s.readingMembers.returningUsers)} of ${num(s.readingMembers.users)} had >1 book-session`}
                def="Legacy snapshot: this counted sessions, not returns, and a second book opened in the same sitting satisfies it. Not a retention figure. Newer snapshots show read-on-more-than-one-day here instead." />
            )}
          </div>
          <div style={{ ...C.card, marginBottom: 12, marginTop: 12, lineHeight: 1.5 }}>
            <strong>A ceiling, not an average.</strong> Members are self-selected and read more than
            a passer-by, so this answers &ldquo;do our members read?&rdquo; — not &ldquo;do visitors
            read?&rdquo; The anonymous instrument below answers the second question, and only for
            windows that sit entirely after the #3405 fix.
            {s.readingMembers.fastPages != null && s.readingMembers.totalPages ? (
              <>
                {' '}<strong>And auth-gating is not a bot gate.</strong> It keeps anonymous crawlers
                out, not a signed-in account bulk-fetching: {num(s.readingMembers.fastSessions)} of{' '}
                {num(s.readingMembers.pacedSessions)} timed sessions moved faster than{' '}
                {s.readingMembers.machinePacePpm ?? 20} pages/minute, carrying{' '}
                {pct(s.readingMembers.fastPages, s.readingMembers.totalPages)} of all pages read, and
                the top 1% of members account for{' '}
                {((s.readingMembers.top1PctPageShare ?? 0) * 100).toFixed(0)}% of pages. The
                per-session percentages above survive dropping those accounts; the totals do not.
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {s.reading?.contaminated ? (
        <>
          <SectionHead title="Reading depth — anonymous visitors" sub="Not measurable for this window — see #3405." />
          <div style={{ ...C.card, marginBottom: 12, lineHeight: 1.5 }}>
            {num(s.reading.unclassified)} of {num(s.reading.total)} page_read events in the last 7
            days were written before bot classification existed. They record no user-agent, so they
            cannot be attributed to readers or crawlers after the fact — and the events that caused
            this outnumbered real human book-page views 34 to 1. No depth figure is shown rather
            than a confident wrong one. This resolves itself once a full 7-day window has elapsed
            since the fix deployed.
          </div>
        </>
      ) : s.reading ? (
        <>
          <SectionHead title="Reading depth — anonymous visitors" sub="Human-classified page_read events, last 7 days. Keyed on a /24-truncated IP, so readers behind one NAT merge into one; treat it as coarser than the member figures above." />
          <div style={C.grid}>
            <Stat value={num(s.reading.opens)} label="Book opens" def="book_read events in the last 7 days." />
            <Stat value={String(s.reading.median ?? 0)} label="Median pages / book" sub={`p90 ${s.reading.p90 ?? 0}`}
              def="Distinct pages a reader views per book. Most land on one page from search or a citation." />
            <Stat value={pct(s.reading.oneOnly, s.reading.pairs)} label="Read 1 page only" def="Share of reader-book pairs that touched a single page." />
            <Stat value={pct(s.reading.deep, s.reading.pairs)} label="Deep read (10+)" sub={`${num(s.reading.deep)} of ${num(s.reading.pairs)}`}
              def="The engaged tail — pairs where someone read 10+ pages." />
          </div>
        </>
      ) : null}

      <SectionHead title="Traffic" sub={`Human, bot-filtered pageviews over the last ${win} days; book URLs normalized across providers & tenants.`} />
      <div style={{ ...C.grid, marginBottom: 12 }}>
        <Stat value={num(t.humanPvs)} label="Human pageviews" sub={`${num(t.botPvs)} bot/auto filtered out`} />
      </div>
      <Bars data={(t.dailyPageviews || []).map((d) => ({ date: d.date, value: d.hits }))} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div>
          <SectionHead title="Top books" />
          <Table headers={['title', 'hits']} rows={(t.topBooks || []).map((b) => [`${b.title}${b.author ? ' · ' + b.author : ''}`, num(b.hits)])} />
        </div>
        <div>
          <SectionHead title="Top collections" />
          <Table headers={['collection', 'hits']} rows={(t.topCollections || []).map((x) => [x.slug, num(x.hits)])} />
        </div>
        <div>
          <SectionHead title="Referrers" />
          <Table headers={['source', 'hits']} rows={(t.topReferrers || []).map((x) => [x.referrer, num(x.hits)])} />
        </div>
        <div>
          <SectionHead title="Countries" />
          <Table headers={['country', 'hits']} rows={(t.topCountries || []).map((x) => [x.country, num(x.hits)])} />
        </div>
      </div>

      {s.search ? (
        <>
          <SectionHead title="Search" sub={`Last ${win} days. Many zero-result queries are truncated typeahead, not content gaps.`} />
          <div style={{ ...C.grid, marginBottom: 12 }}>
            <Stat value={num(s.search.human)} label="Human searches" sub={`${num(s.search.total)} total incl. bots`} />
            <Stat value={pct(s.search.zeroResult, s.search.human)} label="Zero-result" def="Share returning no results — mostly mid-type keystrokes; conceptual misses signal real gaps." />
            <Stat value={s.search.latencyP50 != null ? `${s.search.latencyP50}ms` : '—'} label="Latency p50" sub={s.search.latencyP90 != null ? `p90 ${s.search.latencyP90}ms` : undefined} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <SectionHead title="Top queries" />
              <Table headers={['query', 'count']} rows={(s.search.topQueries || []).map((q) => [q.query, num(q.count)])} />
            </div>
            <div>
              <SectionHead title="Zero-result queries" />
              <Table headers={['query', 'count']} rows={(s.search.zeroQueries || []).map((q) => [q.query, num(q.count)])} />
            </div>
          </div>
        </>
      ) : null}

      {s.social ? (
        <>
          <SectionHead title="Social & feedback" sub={`Last ${win} days.`} />
          <div style={C.grid}>
            <Stat value={num(s.social.likes)} label="Likes" sub={`${num(s.social.likeVisitors)} visitors`} />
            <Stat value={num(s.social.feedback)} label="Feedback" sub={`${num(s.social.feedbackUnread)} unread · ${num(s.social.feedbackWantsHelp)} want to help`} />
          </div>
        </>
      ) : null}

      {s.ai?.length ? (
        <>
          <SectionHead title="AI surfaces" sub={`Last ${win} days — librarian, search-expand, voice, and external MCP agents.`} />
          <Table headers={['feature', 'calls', 'cost', 'avg ms']} rows={s.ai.map((a) => [a.feature, num(a.calls), '$' + a.cost.toFixed(2), num(a.avgMs)])} />
        </>
      ) : null}

      {s.pipelineCost ? (
        <>
          <SectionHead title="Pipeline cost (Gemini)" sub="From the gemini_usage_daily rollup — can read stale while OCR is paused." />
          <div style={{ ...C.grid, marginBottom: 12 }}>
            <Stat value={'$' + (s.pipelineCost.last7 ?? 0).toFixed(2)} label="Last 7 days" />
            <Stat value={'$' + (s.pipelineCost.last30 ?? 0).toFixed(2)} label="Last 30 days" />
            <Stat value={s.pipelineCost.latestDay || '—'} label="Latest day" sub={s.pipelineCost.stale ? '⚠ rollup stale (pipeline paused?)' : undefined} />
          </div>
          <Table headers={['date', 'cost', 'records']} rows={(s.pipelineCost.recentDays || []).map((d) => [d.date, '$' + d.cost.toFixed(2), num(d.records)])} />
        </>
      ) : null}

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
