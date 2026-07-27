'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Bot, ShieldBan, Gauge, Users } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

interface ByBot {
  bot: string;
  hits: number;
  unique_ips: number;
  paths: string[];
  last_seen: string;
}
interface Counted { _id: string; hits: number; bots?: string[] }
interface UnknownAgent {
  ua: string;
  hits: number;
  buckets: string[];
  countries: string[];
  paths: string[];
  last_seen: string;
}
interface BotStats {
  period: { since: string; days: number };
  total_hits: number;
  total_unique_ips: number;
  by_bot: ByBot[];
  by_day: Counted[];
  by_path: Counted[];
  by_action: Counted[];
  unknown_agents?: UnknownAgent[];
}

const ACTION_LABEL: Record<string, string> = {
  blocked: 'Hard-blocked (proxy 403)',
  'rate-limited': 'Rate-limited (429)',
  'api-bot': 'Bot request (allowed / gated)',
  request: 'Request',
};

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function AdminBotsPage() {
  const [data, setData] = useState<BotStats | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/bots?days=${days}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const action = (k: string) => data?.by_action.find(a => a._id === k)?.hits ?? 0;
  const maxBotHits = Math.max(1, ...(data?.by_bot ?? []).map(b => b.hits));

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', color: '#c9d1d9' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bot className="w-5 h-5" />
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#f0f6fc', margin: 0 }}>Bots &amp; Abuse</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {[1, 7, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                border: '1px solid #30363d',
                background: days === d ? '#1f6feb' : 'transparent',
                color: days === d ? '#fff' : '#8b949e',
              }}
            >{d}d</button>
          ))}
          <button onClick={load} style={{ padding: 6, borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <BookLoader />
      ) : !data ? (
        <p style={{ color: '#8b949e' }}>No data.</p>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <Card icon={<Bot className="w-4 h-4" />} label="Bot hits" value={fmt(data.total_hits)} />
            <Card icon={<Users className="w-4 h-4" />} label="Unique IPs" value={fmt(data.total_unique_ips)} />
            <Card icon={<ShieldBan className="w-4 h-4" />} label="Hard-blocked" value={fmt(action('blocked'))} tone="#f85149" />
            <Card icon={<Gauge className="w-4 h-4" />} label="Rate-limited" value={fmt(action('rate-limited'))} tone="#d29922" />
          </div>

          {/* By action */}
          <Section title="By outcome">
            {data.by_action.map(a => (
              <Row key={a._id} label={ACTION_LABEL[a._id] || a._id} value={fmt(a.hits)} />
            ))}
          </Section>

          {/* By bot */}
          <Section title={`Top bots (${data.period.days}d, since ${data.period.since})`}>
            {data.by_bot.slice(0, 20).map(b => (
              <div key={b.bot} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span style={{ color: b.bot === 'ratelimit' ? '#d29922' : '#c9d1d9' }}>{b.bot}</span>
                  <span style={{ color: '#8b949e' }}>{fmt(b.hits)} hits · {fmt(b.unique_ips)} IPs</span>
                </div>
                <div style={{ height: 4, background: '#161b22', borderRadius: 2 }}>
                  <div style={{ height: 4, width: `${(b.hits / maxBotHits) * 100}%`, background: b.bot === 'ratelimit' ? '#d29922' : '#1f6feb', borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </Section>

          {/* Unknown user-agents — what the opaque buckets actually are */}
          {data.unknown_agents && data.unknown_agents.length > 0 && (
            <Section title="Unknown / unnamed bot user-agents">
              <p style={{ color: '#6e7681', fontSize: 12, margin: '0 0 12px' }}>
                Raw UA strings behind the <code>unknown-bot</code> / <code>other-bot</code> / <code>script</code> buckets. A flood of single-hit UAs = a UA-randomizing scraper.
              </p>
              {data.unknown_agents.map((u, i) => (
                <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid #161b22' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <code style={{ fontSize: 12, color: '#c9d1d9', wordBreak: 'break-all' }}>{u.ua || '(empty UA)'}</code>
                    <span style={{ color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(u.hits)} hits</span>
                  </div>
                  <div style={{ color: '#6e7681', fontSize: 11, marginTop: 2 }}>
                    {u.buckets.join(', ')}
                    {u.countries.length > 0 && ` · ${u.countries.slice(0, 8).join(' ')}`}
                    {u.paths.length > 0 && ` · ${u.paths.slice(0, 4).join(' ')}`}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* By path */}
          <Section title="Top targets">
            {data.by_path.slice(0, 15).map(p => (
              <Row key={p._id} label={p._id || '(root)'} value={fmt(p.hits)} />
            ))}
          </Section>

          {/* By day */}
          <Section title="By day">
            {data.by_day.map(d => (
              <Row key={d._id} label={d._id} value={fmt(d.hits)} sub={`${d.bots?.length ?? 0} bot types`} />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Card({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b949e', fontSize: 12, marginBottom: 6 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || '#f0f6fc' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 12px' }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #161b22', fontSize: 13 }}>
      <span style={{ color: '#c9d1d9', wordBreak: 'break-all' }}>{label}</span>
      <span style={{ color: '#8b949e', whiteSpace: 'nowrap', marginLeft: 12 }}>{value}{sub ? ` · ${sub}` : ''}</span>
    </div>
  );
}
