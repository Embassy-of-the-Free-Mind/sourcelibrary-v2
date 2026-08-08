/**
 * /platform/admin/line — the full pipeline line, measured semantically (#3756 §B).
 *
 * Renders the latest `stage_coverage_snapshots` doc written nightly by
 * scripts/workers/stage-coverage-snapshot.mjs. Every number here is computed
 * from DATA (rows and fields that exist), never job counters — the v1
 * archaeology's core lesson. The page never runs the measurements itself;
 * same read-a-precomputed-doc pattern as the metrics dashboard.
 *
 * Per stage: coverage %, queue depth, 7-day delta (vs the newest snapshot at
 * least ~7 days old), a red STALLED badge (queue nonempty, nightly delta zero
 * — the I54 "quietly stops advancing" detector), and a PROBE BROKEN badge
 * when a measurement's positive control failed (a broken probe must never
 * read as 0% coverage). Header: dial state, spend today, last collector run.
 *
 * Gated by the protected layout (requireSuperAdmin).
 */
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface StageMeasurement {
  stage: string;
  status: 'ok' | 'probe_broken';
  covered: number | null;
  total: number | null;
  queue_depth: number | null;
  delta?: number | null;
  detail?: Record<string, number | string | null>;
}

interface Snapshot {
  timestamp: Date | string;
  stages: StageMeasurement[];
  stalled?: string[];
  dial?: { paused?: boolean; daily_budget_usd?: number | null };
  spend_today_usd?: number;
  spend_costless_rows?: number;
  collector_last_run?: { cron?: string; timestamp?: Date | string | null; status?: string | null } | null;
  duration_ms?: number;
}

const STAGE_LABELS: Record<string, string> = {
  archived: 'Archived (page images on R2)',
  ocr: 'OCR (visible pages with ocr.data)',
  translated: 'Translated (visible pages with translation.data)',
  summaries: 'Summaries (live books)',
  chapters: 'Chapters (live books)',
  images: 'Images (gallery rows materialized)',
  embeddings: 'Embeddings (book_embeddings vs live books)',
  identity: 'Identity (work_id + edition_key, live books)',
};

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const pct = (s: StageMeasurement) =>
  s.status !== 'ok' || s.covered == null || !s.total ? '—' : `${((100 * s.covered) / s.total).toFixed(1)}%`;

const C = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 18px' } as const,
  big: { fontSize: 26, fontWeight: 700, color: '#e6edf3', lineHeight: 1.1 } as const,
  label: { fontSize: 12, color: '#8b949e', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 } as const,
  th: { textAlign: 'left' as const, fontSize: 11, color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '8px 10px', borderBottom: '1px solid #30363d' },
  td: { fontSize: 13, color: '#c9d1d9', padding: '8px 10px', borderBottom: '1px solid #21262d', verticalAlign: 'top' as const },
  badge: { display: 'inline-block', fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '2px 7px', marginLeft: 8, letterSpacing: 0.4 } as const,
};

function DeltaArrow({ delta }: { delta: number | null | undefined }) {
  if (delta == null) return <span style={{ color: '#56606b' }}>—</span>;
  const flat = delta === 0;
  const up = delta > 0;
  const color = flat ? '#8b949e' : up ? '#3fb950' : '#f85149';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return (
    <span style={{ color, fontWeight: 600 }}>
      {arrow} {delta > 0 ? '+' : ''}{delta.toLocaleString('en-US')}
    </span>
  );
}

/** 7-day covered delta: null unless both sides measured ok. */
function sevenDayDelta(current: StageMeasurement, weekAgo?: Snapshot | null): number | null {
  if (!weekAgo || current.status !== 'ok' || current.covered == null) return null;
  const prev = weekAgo.stages?.find((s) => s.stage === current.stage);
  if (!prev || prev.status !== 'ok' || prev.covered == null) return null;
  return current.covered - prev.covered;
}

export default async function LinePage() {
  const db = await getDb();
  const snapshots = db.collection<Snapshot>('stage_coverage_snapshots');

  const latest = await snapshots.find({}).sort({ timestamp: -1 }).limit(1).next();

  if (!latest) {
    return (
      <div style={{ maxWidth: 980 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>The Line</h1>
        <p style={{ color: '#8b949e', marginTop: 12 }}>
          No stage-coverage snapshot yet. Run{' '}
          <code style={{ color: '#c9d1d9' }}>node scripts/workers/stage-coverage-snapshot.mjs</code>{' '}
          on the pipeline box (or enable its crontab line) to write the first one.
        </p>
      </div>
    );
  }

  const cutoff = new Date(new Date(latest.timestamp).getTime() - 6.5 * 24 * 3600 * 1000);
  const weekAgo = await snapshots
    .find({ timestamp: { $lte: cutoff } })
    .sort({ timestamp: -1 })
    .limit(1)
    .next();

  const stalledSet = new Set(latest.stalled ?? []);
  const generatedAt = new Date(latest.timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const collector = latest.collector_last_run;
  const collectorWhen = collector?.timestamp
    ? new Date(collector.timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : 'never seen';

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>The Line</h1>
      <p style={{ fontSize: 13, color: '#8b949e', margin: '4px 0 20px' }}>
        Per-stage coverage measured from data (rows and fields), never job counters. Snapshot: {generatedAt}
        {weekAgo ? ` · 7-day deltas vs ${new Date(weekAgo.timestamp).toISOString().slice(0, 10)}` : ' · no 7-day baseline yet'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={C.card}>
          <div style={{ ...C.big, color: latest.dial?.paused ? '#f85149' : '#3fb950' }}>
            {latest.dial?.paused ? 'PAUSED' : 'Running'}
          </div>
          <div style={C.label}>Pipeline dial</div>
        </div>
        <div style={C.card}>
          <div style={C.big}>
            {latest.dial?.daily_budget_usd != null ? `$${latest.dial.daily_budget_usd.toFixed(2)}` : 'unset'}
          </div>
          <div style={C.label}>Daily budget (unset = no paid dispatch)</div>
        </div>
        <div style={C.card}>
          <div style={C.big}>${(latest.spend_today_usd ?? 0).toFixed(2)}</div>
          <div style={C.label}>Spend today (UTC)</div>
          {(latest.spend_costless_rows ?? 0) > 0 && (
            <div style={{ fontSize: 11, color: '#d29922', marginTop: 4 }}>
              {num(latest.spend_costless_rows)} usage rows without cost — undercounted
            </div>
          )}
        </div>
        <div style={C.card}>
          <div style={{ ...C.big, fontSize: 16, paddingTop: 6 }}>{collectorWhen}</div>
          <div style={C.label}>Last batch collector run{collector?.status ? ` (${collector.status})` : ''}</div>
        </div>
      </div>

      <div style={{ ...C.card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={C.th}>Stage</th>
              <th style={{ ...C.th, textAlign: 'right' }}>Coverage</th>
              <th style={{ ...C.th, textAlign: 'right' }}>Covered / total</th>
              <th style={{ ...C.th, textAlign: 'right' }}>Queue depth</th>
              <th style={{ ...C.th, textAlign: 'right' }}>7-day Δ covered</th>
            </tr>
          </thead>
          <tbody>
            {latest.stages.map((s) => {
              const broken = s.status === 'probe_broken';
              const stalled = stalledSet.has(s.stage);
              return (
                <tr key={s.stage}>
                  <td style={C.td}>
                    <span style={{ color: '#e6edf3', fontWeight: 600 }}>{s.stage}</span>
                    {broken && (
                      <span style={{ ...C.badge, background: '#3d1d1f', color: '#f85149', border: '1px solid #f85149' }}>
                        PROBE BROKEN
                      </span>
                    )}
                    {stalled && !broken && (
                      <span style={{ ...C.badge, background: '#3d1d1f', color: '#f85149', border: '1px solid #f85149' }}>
                        STALLED
                      </span>
                    )}
                    <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>{STAGE_LABELS[s.stage] ?? ''}</div>
                    {s.detail && (
                      <div style={{ fontSize: 11, color: '#56606b', marginTop: 2 }}>
                        {Object.entries(s.detail).map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString('en-US') : String(v)}`).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={{ ...C.td, textAlign: 'right', fontWeight: 700, color: broken ? '#f85149' : '#e6edf3' }}>
                    {broken ? '?' : pct(s)}
                  </td>
                  <td style={{ ...C.td, textAlign: 'right' }}>{num(s.covered)} / {num(s.total)}</td>
                  <td style={{ ...C.td, textAlign: 'right', color: (s.queue_depth ?? 0) > 0 ? '#d29922' : '#8b949e' }}>
                    {num(s.queue_depth)}
                  </td>
                  <td style={{ ...C.td, textAlign: 'right' }}>
                    <DeltaArrow delta={sevenDayDelta(s, weekAgo)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: '#6e7681', marginTop: 16, lineHeight: 1.5 }}>
        STALLED = queue depth &gt; 0 and covered didn&apos;t move since the previous nightly snapshot (the
        &ldquo;quietly stops advancing&rdquo; detector). PROBE BROKEN = the measurement&apos;s positive control found no
        known-present case, so its counts are untrustworthy — fix the probe before believing any number in that row.
        Written nightly by <code>scripts/workers/stage-coverage-snapshot.mjs</code>; API twin at <code>/api/admin/line</code>.
      </p>
    </div>
  );
}
