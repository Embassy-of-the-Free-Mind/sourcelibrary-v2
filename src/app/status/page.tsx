import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Status — Source Library',
  description: 'Live health status for Source Library systems.',
};

export const revalidate = 30;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';

interface StatusData {
  status: string;
  latency: Record<string, number>;
  timestamp: string;
  version: string;
}

interface LatencyTrend {
  current: Record<string, number>;
  current_check_duration: number;
  avg_1h: { duration_ms: number; samples: number };
  avg_6h: { duration_ms: number; samples: number };
  avg_24h: { duration_ms: number; samples: number };
  trend: string;
  alert: { message: string; since: string } | null;
  history: { timestamp: string; duration_ms: number }[];
  computed_at: string;
}

interface CacheProbe {
  probed_at: string;
  total: number;
  hits: number;
  misses: number;
  stale: number;
  revalidated: number;
  hit_rate: number;
}

interface PipelineInfo {
  total: number;
  stalled: number;
  paused: boolean;
}

async function fetchStatus(): Promise<StatusData | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/status`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function fetchLatencyTrend(): Promise<LatencyTrend | null> {
  try {
    // Read from system_config directly via internal fetch is not possible without auth.
    // Instead, we'll read from the public-facing data stored by the cron.
    // For the status page, we fetch from the DB directly since this is a server component.
    const { getDb } = await import('@/lib/mongodb');
    const db = await getDb();
    const stored = await db.collection('system_config').findOne(
      { _id: 'latency_trend' as any },
      { maxTimeMS: 5000 }
    );
    return stored?.data || null;
  } catch {
    return null;
  }
}

async function fetchCacheProbe(): Promise<CacheProbe | null> {
  try {
    const { getDb } = await import('@/lib/mongodb');
    const db = await getDb();
    const stored = await db.collection('system_config').findOne(
      { _id: 'cache_probe' as any },
      { maxTimeMS: 5000 }
    );
    return stored?.data || null;
  } catch {
    return null;
  }
}

async function fetchPipelineInfo(): Promise<PipelineInfo | null> {
  try {
    const { getDb } = await import('@/lib/mongodb');
    const db = await getDb();
    const [activeJobs, stalledBooks, config] = await Promise.all([
      db.collection('jobs').countDocuments(
        { status: { $in: ['pending', 'processing'] } },
        { maxTimeMS: 5000 }
      ),
      db.collection('books').countDocuments(
        {
          'pipeline_auto.status': {
            $in: ['archiving', 'ocr_submitted', 'translate_submitted', 'enriching', 'chapters', 'images_submitted'],
          },
          'pipeline_auto.last_updated': { $lt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
        },
        { maxTimeMS: 5000 }
      ),
      db.collection('system_config').findOne(
        { _id: 'processing_control' as any },
        { maxTimeMS: 5000 }
      ),
    ]);
    return {
      total: activeJobs,
      stalled: stalledBooks,
      paused: config?.paused === true,
    };
  } catch {
    return null;
  }
}

function StatusDot({ state }: { state: 'ok' | 'degraded' | 'down' | 'unknown' }) {
  const colors: Record<string, string> = {
    ok: '#22c55e',
    degraded: '#eab308',
    down: '#ef4444',
    unknown: '#6b7280',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        backgroundColor: colors[state] || colors.unknown,
        marginRight: 8,
        boxShadow: state === 'ok' ? '0 0 6px #22c55e' : undefined,
      }}
    />
  );
}

function TrendArrow({ trend }: { trend: string }) {
  const arrows: Record<string, string> = {
    improving: '↓',
    stable: '→',
    degrading: '↑',
    critical: '⬆',
  };
  const colors: Record<string, string> = {
    improving: '#22c55e',
    stable: '#9ca3af',
    degrading: '#eab308',
    critical: '#ef4444',
  };
  return (
    <span style={{ color: colors[trend] || '#9ca3af', fontWeight: 'bold' }}>
      {arrows[trend] || '?'}
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

export default async function StatusPage() {
  const [status, latency, cache, pipeline] = await Promise.all([
    fetchStatus(),
    fetchLatencyTrend(),
    fetchCacheProbe(),
    fetchPipelineInfo(),
  ]);

  const overallState: 'ok' | 'degraded' | 'down' | 'unknown' =
    !status ? 'unknown'
    : status.status === 'ok' ? 'ok'
    : status.status === 'degraded' ? 'degraded'
    : 'down';

  const overallLabel: Record<string, string> = {
    ok: 'All Systems Operational',
    degraded: 'Degraded Performance',
    down: 'Service Disruption',
    unknown: 'Unable to Check',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0a',
        color: '#e5e5e5',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 14,
        padding: '40px 20px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: '#fff' }}>
            Source Library Status
          </h1>
          <p style={{ margin: '8px 0 0', color: '#9ca3af', fontSize: 12 }}>
            Live system health — refreshes every 30 seconds
          </p>
        </div>

        {/* Overall Status Banner */}
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 8,
            border: `1px solid ${overallState === 'ok' ? '#22c55e33' : overallState === 'degraded' ? '#eab30833' : '#ef444433'}`,
            backgroundColor: overallState === 'ok' ? '#22c55e0a' : overallState === 'degraded' ? '#eab3080a' : '#ef44440a',
            marginBottom: 32,
          }}
        >
          <StatusDot state={overallState} />
          <span style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
            {overallLabel[overallState]}
          </span>
          {status?.timestamp && (
            <span style={{ float: 'right', fontSize: 12, color: '#6b7280' }}>
              {formatTime(status.timestamp)}
            </span>
          )}
        </div>

        {/* Systems Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Database */}
          <Section title="Database">
            <Row
              label="MongoDB Ping"
              value={status?.latency?.db_ping != null ? `${status.latency.db_ping}ms` : '--'}
              state={
                status?.latency?.db_ping == null ? 'unknown'
                : status.latency.db_ping > 500 ? 'degraded'
                : 'ok'
              }
            />
            <Row
              label="Book Query"
              value={status?.latency?.book_query != null ? `${status.latency.book_query}ms` : '--'}
              state={
                status?.latency?.book_query == null ? 'unknown'
                : status.latency.book_query > 2000 ? 'degraded'
                : 'ok'
              }
            />
            {latency && (
              <>
                <Row
                  label="Latency Trend"
                  value={
                    <span>
                      <TrendArrow trend={latency.trend} /> {latency.trend}
                      <span style={{ color: '#6b7280', marginLeft: 12 }}>
                        1h: {latency.avg_1h.duration_ms}ms / 6h: {latency.avg_6h.duration_ms}ms / 24h: {latency.avg_24h.duration_ms}ms
                      </span>
                    </span>
                  }
                  state={
                    latency.trend === 'critical' ? 'down'
                    : latency.trend === 'degrading' ? 'degraded'
                    : 'ok'
                  }
                />
                {latency.alert && (
                  <div style={{ padding: '8px 12px', backgroundColor: '#ef44440f', borderRadius: 4, fontSize: 12, color: '#fca5a5' }}>
                    {latency.alert.message}
                    <span style={{ color: '#6b7280', marginLeft: 8 }}>since {formatTime(latency.alert.since)}</span>
                  </div>
                )}
              </>
            )}
          </Section>

          {/* Cache */}
          <Section title="Cache">
            {cache ? (
              <>
                <Row
                  label="Hit Rate"
                  value={`${Math.round(cache.hit_rate * 100)}% (${cache.hits}/${cache.total})`}
                  state={cache.hit_rate >= 0.5 ? 'ok' : cache.hit_rate >= 0.25 ? 'degraded' : 'down'}
                />
                <Row
                  label="Breakdown"
                  value={`${cache.hits} hit / ${cache.misses} miss / ${cache.stale} stale / ${cache.revalidated} revalidated`}
                  state="ok"
                />
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  Last probed: {formatTime(cache.probed_at)}
                </div>
              </>
            ) : (
              <div style={{ color: '#6b7280', fontSize: 12 }}>No cache probe data available</div>
            )}
          </Section>

          {/* Pipeline */}
          <Section title="Pipeline">
            {pipeline ? (
              <>
                <Row
                  label="Active Jobs"
                  value={String(pipeline.total)}
                  state={pipeline.total > 500 ? 'degraded' : 'ok'}
                />
                <Row
                  label="Stalled (4h+)"
                  value={String(pipeline.stalled)}
                  state={pipeline.stalled > 20 ? 'degraded' : pipeline.stalled > 0 ? 'ok' : 'ok'}
                />
                <Row
                  label="System"
                  value={pipeline.paused ? 'PAUSED' : 'Running'}
                  state={pipeline.paused ? 'degraded' : 'ok'}
                />
              </>
            ) : (
              <div style={{ color: '#6b7280', fontSize: 12 }}>Unable to check pipeline</div>
            )}
          </Section>

          {/* Version */}
          <Section title="System">
            <Row
              label="Version"
              value={status?.version || '--'}
              state="ok"
            />
            <Row
              label="Region"
              value="fra1 (Frankfurt)"
              state="ok"
            />
          </Section>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid #1f1f1f', fontSize: 11, color: '#6b7280' }}>
          <a href="https://sourcelibrary.org" style={{ color: '#9ca3af', textDecoration: 'none' }}>
            sourcelibrary.org
          </a>
          <span style={{ margin: '0 8px' }}>|</span>
          Powered by Vercel + MongoDB Atlas
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 20px',
        borderRadius: 8,
        border: '1px solid #1f1f1f',
        backgroundColor: '#111',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, state }: { label: string; value: React.ReactNode; state: 'ok' | 'degraded' | 'down' | 'unknown' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#9ca3af' }}>
        <StatusDot state={state} />
        {label}
      </span>
      <span style={{ color: '#e5e5e5' }}>{value}</span>
    </div>
  );
}
