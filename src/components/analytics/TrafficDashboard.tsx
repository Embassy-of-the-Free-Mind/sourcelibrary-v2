'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, Globe, BarChart3, X, ChevronRight, Server, Bot, MousePointerClick } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import { AreaChart } from './charts/AreaChart';
import type { TrafficDashboardData, TrafficBin } from '@/lib/analytics-traffic';
import { TRAFFIC_CLASS_LABELS, type TrafficClass } from '@/lib/traffic-classification';

type FilterKey = 'country' | 'section' | 'referrer' | 'host';

// Display order + color for the human/bot/AI breakdown.
const CLASS_ORDER: { key: TrafficClass; color: string }[] = [
  { key: 'human', color: '#16a34a' },
  { key: 'ai_agent', color: '#8b5cf6' },
  { key: 'ai_trainer', color: '#a855f7' },
  { key: 'search_crawler', color: '#3b82f6' },
  { key: 'other_bot', color: '#94a3b8' },
];

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];
const BINS: { value: TrafficBin | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
];

type Metric = 'pageviews' | 'visitors';

function pctDelta(cur: number, prev: number): { text: string; up: boolean | null } {
  if (prev === 0) return { text: cur > 0 ? 'new' : '—', up: cur > 0 ? true : null };
  const d = ((cur - prev) / prev) * 100;
  const r = Math.round(d);
  if (r === 0) return { text: '0%', up: null };
  return { text: `${r > 0 ? '+' : ''}${r}%`, up: r > 0 };
}

function fmtBucket(iso: string, bin: TrafficBin): string {
  // iso like 2026-05-02T00:00:00.000Z
  if (bin === 'hour') return iso.slice(5, 13).replace('T', ' ') + ':00';
  return iso.slice(5, 10); // MM-DD
}

export default function TrafficDashboard() {
  const [data, setData] = useState<TrafficDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [bin, setBin] = useState<TrafficBin | 'auto'>('auto');
  const [metric, setMetric] = useState<Metric>('pageviews');
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (bin !== 'auto') params.set('bin', bin);
    (['country', 'section', 'referrer', 'host'] as FilterKey[]).forEach(k => {
      if (filters[k]) params.set(k, filters[k]!);
    });
    fetch(`/api/analytics/traffic?${params.toString()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days, bin, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleFilter = (key: FilterKey, value: string) => {
    setFilters(f => ({ ...f, [key]: f[key] === value ? undefined : value }));
  };

  const activeFilters = (['host', 'section', 'country', 'referrer'] as FilterKey[])
    .map(k => (filters[k] ? { key: k, value: filters[k]! } : null))
    .filter(Boolean) as { key: FilterKey; value: string }[];

  const card = { background: 'var(--bg-white)', border: '1px solid var(--border-light)' };
  const pill = (active: boolean) => ({
    background: active ? 'var(--bg-white)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
  });

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-all"
              style={pill(days === r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
          {BINS.map(b => (
            <button
              key={b.value}
              onClick={() => setBin(b.value)}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-all"
              style={pill(bin === b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
            binned {data.range.bin} · vs previous {data.range.days}d
          </span>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase font-medium" style={{ color: 'var(--text-muted)' }}>Filtered:</span>
          {activeFilters.map(f => (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key, f.value)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: 'var(--accent-sage)', color: 'white' }}
            >
              <span className="opacity-70">{f.key}:</span> {f.value} <X className="w-3 h-3" />
            </button>
          ))}
          <button onClick={() => setFilters({})} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
            clear all
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center"><BookLoader size="xs" /></div>
      ) : !data ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No traffic data available for this view</p>
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryCard
              icon={<BarChart3 className="w-5 h-5" style={{ color: '#8b5cf6' }} />}
              label="Pageviews"
              value={data.summary.pageviews}
              delta={pctDelta(data.summary.pageviews, data.summary.prevPageviews)}
            />
            <SummaryCard
              icon={<Users className="w-5 h-5" style={{ color: '#3b82f6' }} />}
              label="Unique visitors"
              value={data.summary.visitors}
              delta={pctDelta(data.summary.visitors, data.summary.prevVisitors)}
              hint="approx — anonymized IP"
            />
          </div>

          {/* Sites + Human/bot/AI split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ListCard title="Sites" icon={<Server className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />} hint="click to filter by subdomain">
              {data.sites.length === 0 ? <Empty /> : data.sites.map((s, i) => (
                <Row key={i} label={s.host} count={s.count} unit="views"
                  active={filters.host === s.host}
                  onClick={s.host === '(pre-tracking)' ? undefined : () => toggleFilter('host', s.host)} />
              ))}
            </ListCard>
            <ClassificationCard rows={data.classification} />
          </div>

          {/* Trend */}
          <div className="p-6 rounded-xl" style={card}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>Trend</h2>
              <div className="flex rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
                {(['pageviews', 'visitors'] as Metric[]).map(m => (
                  <button key={m} onClick={() => setMetric(m)}
                    className="px-3 py-1 rounded-md text-xs font-medium capitalize transition-all" style={pill(metric === m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <AreaChart
              data={data.series.map(s => ({ x: s.bucket, y: s[metric] }))}
              color={metric === 'pageviews' ? 'var(--accent-violet)' : '#3b82f6'}
              xLabel={(v) => fmtBucket(v, data.range.bin)}
            />
          </div>

          {/* Sections + Top pages */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ListCard title="Sections" hint="click to drill in">
              {data.sections.map((s, i) => (
                <Row key={i} label={s.section} count={s.count} unit="views"
                  active={filters.section === s.section}
                  onClick={() => toggleFilter('section', s.section)} drill />
              ))}
            </ListCard>
            <ListCard title={filters.section ? `Pages in ${filters.section}` : 'Top pages'}>
              {data.topPages.map((p, i) => (
                <Row key={i} label={p.path} count={p.count} unit="views" />
              ))}
            </ListCard>
          </div>

          {/* Clicks by source vs Traffic sources — distinct visitors vs pageviews */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ListCard
              title="Clicks by source"
              icon={<MousePointerClick className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />}
              hint="distinct visitors · ~ Search Console clicks"
            >
              {data.clicksBySource.length === 0 ? <Empty /> : data.clicksBySource.map((r, i) => (
                <Row key={i} label={r.referrer} count={r.count} unit="clicks"
                  active={filters.referrer === r.referrer}
                  onClick={() => toggleFilter('referrer', r.referrer)} />
              ))}
            </ListCard>
            <ListCard title="Traffic sources" hint="pageviews · click to filter">
              {data.topReferrers.length === 0 ? <Empty /> : data.topReferrers.map((r, i) => (
                <Row key={i} label={r.referrer} count={r.count} unit="views"
                  active={filters.referrer === r.referrer}
                  onClick={() => toggleFilter('referrer', r.referrer)} />
              ))}
            </ListCard>
          </div>

          {/* Countries */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ListCard title="Countries" icon={<Globe className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />} hint="click to filter">
              {data.topCountries.length === 0 ? <Empty /> : data.topCountries.map((c, i) => (
                <Row key={i} label={c.country} count={c.count} unit="views"
                  active={filters.country === c.country}
                  onClick={() => toggleFilter('country', c.country)} />
              ))}
            </ListCard>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, delta, hint }: {
  icon: React.ReactNode; label: string; value: number;
  delta: { text: string; up: boolean | null }; hint?: string;
}) {
  const color = delta.up === null ? 'var(--text-muted)' : delta.up ? '#16a34a' : '#dc2626';
  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <div className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>{value.toLocaleString('en-US')}</div>
        <span className="text-sm font-medium" style={{ color }}>{delta.text}</span>
      </div>
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

function ListCard({ title, hint, icon, children }: {
  title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          {icon}{title}
        </h2>
        {hint && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, count, unit, active, onClick, drill }: {
  label: string; count: number; unit: string; active?: boolean; onClick?: () => void; drill?: boolean;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between py-2 px-2 -mx-2 rounded-lg ${clickable ? 'cursor-pointer hover:bg-[var(--bg-warm)]' : ''}`}
      style={active ? { background: 'var(--bg-warm)' } : undefined}
    >
      <p className="font-medium truncate flex items-center gap-1" style={{ color: active ? 'var(--accent-rust)' : 'var(--text-primary)' }}>
        {drill && <ChevronRight className="w-3.5 h-3.5 opacity-40 shrink-0" />}
        {label || '(home)'}
      </p>
      <p className="text-sm ml-4 shrink-0" style={{ color: 'var(--text-muted)' }}>{count.toLocaleString('en-US')} {unit}</p>
    </div>
  );
}

function Empty() {
  return <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>None in this range</p>;
}

// Human vs bot vs AI. Counts come from the ingestion-time classifier, which
// only starts accruing once this ships — so it's empty for prior history.
function ClassificationCard({ rows }: { rows: { class: string; count: number }[] }) {
  const byClass = new Map(rows.map(r => [r.class, r.count]));
  const ordered = CLASS_ORDER.map(c => ({ ...c, count: byClass.get(c.key) ?? 0 }));
  const total = ordered.reduce((sum, c) => sum + c.count, 0);
  const aiCount = (byClass.get('ai_agent') ?? 0) + (byClass.get('ai_trainer') ?? 0);

  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Bot className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />
          Human · bot · AI
        </h2>
        {total > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            AI {Math.round((aiCount / total) * 100)}% of {total.toLocaleString('en-US')}
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>
          No classified traffic yet — this begins accruing now that ingestion records it.
        </p>
      ) : (
        <>
          {/* Proportion bar */}
          <div className="flex w-full h-3 rounded-full overflow-hidden mb-4">
            {ordered.filter(c => c.count > 0).map(c => (
              <div key={c.key} style={{ width: `${(c.count / total) * 100}%`, background: c.color }}
                title={`${TRAFFIC_CLASS_LABELS[c.key]}: ${c.count.toLocaleString('en-US')}`} />
            ))}
          </div>
          <div className="space-y-1">
            {ordered.map(c => (
              <div key={c.key} className="flex items-center justify-between py-1">
                <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                  {TRAFFIC_CLASS_LABELS[c.key]}
                </span>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {c.count.toLocaleString('en-US')} · {total > 0 ? Math.round((c.count / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
