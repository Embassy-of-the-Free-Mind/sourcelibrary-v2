'use client';

/**
 * Charts for /admin/quality (#5474). Receive only the series they draw; every value and label
 * comes from the ops_reports document. Colours are the dataviz reference palette's first three
 * categorical slots (validated all-pairs in both modes), set as CSS variables by the page.
 */
import { useState } from 'react';
import type { AuditRun, QualityData } from '@/lib/quality-report';

type Metric = 'any_major' | 'ge4';
const METRIC_LABEL: Record<Metric, string> = { any_major: 'Any major defect', ge4: 'Rated ≥ 4 of 5' };
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const day = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const hour = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

const W = 720, H = 260, PL = 44, PR = 16, PT = 14, PB = 40;
const IW = W - PL - PR, IH = H - PT - PB;

function yScale(max: number) {
  const top = Math.max(10, Math.ceil(max / 10) * 10);
  const step = top <= 30 ? 5 : top <= 60 ? 10 : 20;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { y: (v: number) => PT + IH - (v / top) * IH, ticks };
}

function Grid({ ticks, y }: { ticks: number[]; y: (v: number) => number }) {
  return (
    <>
      {ticks.map(t => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--q-grid)" strokeWidth={1} />
          <text x={PL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--q-muted)">{t}%</text>
        </g>
      ))}
    </>
  );
}

function Tip({ x, lines }: { x: number; lines: string[] }) {
  return (
    <div
      className="absolute top-0 pointer-events-none rounded px-2 py-1 text-xs shadow"
      style={{ left: `${(x / W) * 100}%`, transform: 'translateX(-50%)', background: 'var(--q-surface)', color: 'var(--q-text)', border: '1px solid var(--q-border)', whiteSpace: 'nowrap' }}
    >
      {lines.map((l, i) => <div key={i} style={i ? { color: 'var(--q-muted)' } : { fontWeight: 600 }}>{l}</div>)}
    </div>
  );
}

/**
 * Translation over time. One x slot per audit run in draw order; served-corpus runs are joined by
 * a line with their interval as a band, the chained-lane sample is its own series (a different
 * population — not a point on the served line).
 */
export function TranslationTrend({ runs, groupLabels }: { runs: AuditRun[]; groupLabels: QualityData['translation']['group_labels'] }) {
  const [metric, setMetric] = useState<Metric>('any_major');
  const [group, setGroup] = useState<string>('all');
  const [hover, setHover] = useState<number | null>(null);
  const usable = runs.filter(r => r.controls_pass);
  const cells = usable.map(r => r.groups[group] ?? null);
  const max = Math.max(...cells.flatMap(c => (c ? [c[metric].ci?.[1] ?? c[metric].est] : [0])));
  const { y, ticks } = yScale(metric === 'ge4' ? 100 : max);
  const slot = IW / Math.max(1, usable.length);
  const x = (i: number) => PL + slot * (i + 0.5);
  const servedIdx = usable.map((r, i) => (r.population === 'served' && cells[i] ? i : -1)).filter(i => i >= 0);
  const line = servedIdx.map(i => `${x(i)},${y(cells[i]![metric].est)}`).join(' ');
  const band = servedIdx.every(i => cells[i]![metric].ci)
    ? [...servedIdx.map(i => `${x(i)},${y(cells[i]![metric].ci![1])}`), ...[...servedIdx].reverse().map(i => `${x(i)},${y(cells[i]![metric].ci![0])}`)].join(' ')
    : '';
  const color = (r: AuditRun) => (r.population === 'served' ? 'var(--q-s1)' : 'var(--q-s2)');
  const h = hover != null ? usable[hover] : null;
  const hc = hover != null ? cells[hover] : null;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--q-muted)' }}>
        <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--q-border)' }}>
          {(Object.keys(METRIC_LABEL) as Metric[]).map(m => (
            <button key={m} onClick={() => setMetric(m)} className="px-2 py-1"
              style={metric === m ? { background: 'var(--q-text)', color: 'var(--q-surface)' } : { color: 'var(--q-text)' }}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <select value={group} onChange={e => setGroup(e.target.value)} className="px-2 py-1 rounded"
          style={{ border: '1px solid var(--q-border)', background: 'var(--q-surface)', color: 'var(--q-text)' }}>
          {Object.entries(groupLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-0.5" style={{ background: 'var(--q-s1)' }} />Served corpus</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'var(--q-s2)' }} />Chained-lane sample</span>
      </div>
      <div className="relative max-w-3xl">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img"
          aria-label={`${METRIC_LABEL[metric]} by audit run, ${groupLabels[group] ?? group}`} onMouseLeave={() => setHover(null)}>
          <Grid ticks={ticks} y={y} />
          {band && <polygon points={band} fill="var(--q-s1)" opacity={0.15} />}
          {servedIdx.length > 1 && <polyline points={line} fill="none" stroke="var(--q-s1)" strokeWidth={2} />}
          {usable.map((r, i) => {
            const c = cells[i];
            return (
              <g key={r.id} onMouseEnter={() => setHover(i)}>
                <rect x={x(i) - slot / 2} y={PT} width={slot} height={IH} fill="transparent" />
                {c?.[metric].ci && <line x1={x(i)} x2={x(i)} y1={y(c[metric].ci![0])} y2={y(c[metric].ci![1])} stroke={color(r)} strokeWidth={2} />}
                {c && <circle cx={x(i)} cy={y(c[metric].est)} r={hover === i ? 6 : 5} fill={color(r)} stroke="var(--q-surface)" strokeWidth={2} />}
                {!c && <text x={x(i)} y={PT + IH / 2} textAnchor="middle" fontSize={11} fill="var(--q-muted)">no measurement</text>}
                <text x={x(i)} y={H - PB + 16} textAnchor="middle" fontSize={11} fill="var(--q-text)">{r.label}</text>
                <text x={x(i)} y={H - PB + 30} textAnchor="middle" fontSize={11} fill="var(--q-muted)">{day(r.drawn_at)}</text>
              </g>
            );
          })}
        </svg>
        {h && (
          <Tip x={x(hover!)} lines={hc ? [
            `${h.label} · ${pct(hc[metric].est)}`,
            hc[metric].ci ? `${hc[metric].ci_kind}: ${pct(hc[metric].ci![0])} – ${pct(hc[metric].ci![1])}` : 'no interval',
            `n = ${hc.n} pages, one per book · ${hc.weighting}`,
            `drawn ${day(h.drawn_at)} · judge ${h.judge}`,
          ] : [`${h.label}`, 'no measurement for this group']} />
        )}
      </div>
    </div>
  );
}

/** Speed-test gate windows: major-defect share per window with its interval, against the chained-lane baseline. */
export function LaneWindows({ lanes }: { lanes: QualityData['lanes'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ws = lanes.windows;
  const base = lanes.baseline?.any_major.est ?? null;
  const bound = lanes.trend_rule?.bound_pct ?? null;
  const max = Math.max(base ?? 0, bound ?? 0, ...ws.map(w => w.ci?.[1] ?? w.major_pct ?? 0));
  const { y, ticks } = yScale(max);
  const slot = IW / Math.max(1, ws.length);
  const x = (i: number) => PL + slot * (i + 0.5);
  const w = hover != null ? ws[hover] : null;
  return (
    <div className="relative max-w-3xl">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Major-defect share per speed-test window" onMouseLeave={() => setHover(null)}>
        <Grid ticks={ticks} y={y} />
        {base != null && (
          <g>
            <line x1={PL} x2={W - PR} y1={y(base)} y2={y(base)} stroke="var(--q-s2)" strokeWidth={2} strokeDasharray="6 4" />
            <text x={PL + 4} y={y(base) + 14} textAnchor="start" fontSize={11} fill="var(--q-text)">{lanes.baseline!.label} {pct(base)}</text>
          </g>
        )}
        {bound != null && (
          <g>
            <line x1={PL} x2={W - PR} y1={y(bound)} y2={y(bound)} stroke="var(--q-muted)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={W - PR} y={y(bound) - 4} textAnchor="end" fontSize={11} fill="var(--q-muted)">trend bound {pct(bound)}</text>
          </g>
        )}
        {ws.map((win, i) => (
          <g key={win.window} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - slot / 2} y={PT} width={slot} height={IH} fill="transparent" />
            {win.ci && <line x1={x(i)} x2={x(i)} y1={y(win.ci[0])} y2={y(win.ci[1])} stroke="var(--q-s1)" strokeWidth={2} />}
            {win.major_pct != null && <circle cx={x(i)} cy={y(win.major_pct)} r={hover === i ? 6 : 5} fill="var(--q-s1)" stroke="var(--q-surface)" strokeWidth={2} />}
            <text x={x(i)} y={H - PB + 16} textAnchor="middle" fontSize={11} fill="var(--q-text)">{hour(win.window.split('/')[1] ?? win.window)}</text>
            <text x={x(i)} y={H - PB + 30} textAnchor="middle" fontSize={11} fill="var(--q-muted)">{win.verdict}{win.trend_warn ? ' · trend' : ''}</text>
          </g>
        ))}
      </svg>
      {w && (
        <Tip x={x(hover!)} lines={[
          `${w.verdict} · ${pct(w.major_pct)} major (${w.defective}/${w.n})`,
          w.ci ? `Wilson 95%: ${pct(w.ci[0])} – ${pct(w.ci[1])}` : 'no interval',
          `window ending ${hour(w.window.split('/')[1] ?? w.window)} UTC`,
          w.trend_warn ? 'trend WARN: second window in a row above the bound' : 'no trend warning',
        ]} />
      )}
    </div>
  );
}
