'use client';

/**
 * Charts for /admin/quality (#5474, #6429). Receive only the series they draw; every value and label
 * comes from the ops_reports document. Colours are the dataviz reference palette's first three
 * categorical slots (validated all-pairs in both modes), set as CSS variables by the page.
 */
import { useState, type PointerEvent } from 'react';
import type { AuditRun, QualityData, TrendChart } from '@/lib/quality-report';

type Metric = 'any_major' | 'ge4';
const METRIC_LABEL: Record<Metric, string> = { any_major: 'Any major defect', ge4: 'Rated ≥ 4 of 5' };
const pct = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(1)}%`);
const day = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const short = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

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

function Tip({ x, lines, w = W }: { x: number; lines: string[]; w?: number }) {
  // Opens toward the side with more room and wraps there, so it never leaves the chart on a phone.
  const f = x / w, side = f < 0.5 ? { left: `${f * 100}%`, maxWidth: `${(1 - f) * 100}%` } : { right: `${(1 - f) * 100}%`, maxWidth: `${f * 100}%` };
  return (
    <div
      className="absolute top-0 pointer-events-none rounded px-2 py-1 text-xs shadow z-10 w-max"
      style={{ ...side, background: 'var(--q-surface)', color: 'var(--q-text)', border: '1px solid var(--q-border)' }}
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

/** Small trend chart (#6429): one y axis, a line per series, open dots for a sparse re-run series. */
const TW = 360, TH = 184, TPL = 50, TPT = 10, TPB = 26, TFS = 12;
const TIH = TH - TPT - TPB;
const SLOT = ['', 'var(--q-s1)', 'var(--q-s2)', 'var(--q-s3)'];
const DAY = 864e5;

function fmt(unit: TrendChart['unit'], v: number) {
  if (unit === 'usd') return `$${v.toFixed(v < 10 ? 2 : 0)}`;
  if (unit === 'pct') return `${v.toFixed(Math.abs(v) < 100 && v % 1 ? 1 : 0)}%`;
  return Math.round(v).toLocaleString('en-US');
}

function niceTicks(lo: number, hi: number) {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / 3, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)!;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

export function TrendLines({ chart }: { chart: TrendChart }) {
  const [hover, setHover] = useState<string | null>(null);
  const series = chart.series.filter(s => s.points.length);
  const all = series.flatMap(s => s.points);
  const values = [...all.map(p => p.value), ...(chart.ref ? [chart.ref.value] : [])];
  const lo = chart.unit === 'count' ? Math.min(...values) : 0, hi = Math.max(...values);
  // Counts are zoomed (a zero baseline would flatten a week's growth) but never below half a percent of the value.
  const pad = chart.unit === 'count' ? Math.max((hi - lo) / 10, hi / 200, 1) : 0;
  const ticks = niceTicks(lo - pad, hi + pad);
  const TPR = chart.unit === 'count' ? 58 : 44, TIW = TW - TPL - TPR;
  const y0 = ticks[0], y1 = ticks.at(-1)!;
  const y = (v: number) => TPT + TIH - ((v - y0) / (y1 - y0 || 1)) * TIH;
  const times = all.map(p => Date.parse(p.date));
  let t0 = Math.min(...times), t1 = Math.max(...times);
  if (t1 - t0 < 6 * DAY) { const c = (t0 + t1) / 2; t0 = c - 3 * DAY; t1 = c + 3 * DAY; }
  const x = (iso: string) => TPL + ((Date.parse(iso) - t0) / (t1 - t0)) * TIW;
  const dates = [...new Set(all.map(p => p.date))].sort();

  // A line breaks where a point is missing: a gap reads as a gap, never as a straight interpolation.
  const segments = (s: TrendChart['series'][number]) => {
    const out: (typeof s.points)[] = [];
    for (const p of s.points) {
      const last = out.at(-1)?.at(-1);
      if (last && Date.parse(p.date) - Date.parse(last.date) <= s.cadence_days * 1.5 * DAY) out.at(-1)!.push(p); else out.push([p]);
    }
    return out;
  };
  // End labels: the newest value of each line series, nudged apart, in text ink.
  const ends = series.filter(s => s.style === 'line').map(s => ({ s, p: s.points.at(-1)! }))
    .map(e => ({ ...e, ly: y(e.p.value) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 13);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * TW;
    setHover(dates.reduce((b, d) => (Math.abs(x(d) - px) < Math.abs(x(b) - px) ? d : b), dates[0]));
  };
  const tipLines = hover ? [short(hover), ...series.flatMap(s => s.points.filter(p => p.date === hover).map(p => p.tip))] : [];
  const legend = series.filter(s => s.legend !== false);

  return (
    <div className="grid gap-1.5">
      {(legend.length > 1 || chart.extra_legend?.length) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: 'var(--q-muted)' }}>
          {legend.length > 1 && legend.map(s => (
            <span key={s.key} className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-0.5" style={{ background: SLOT[s.slot] }} />{s.label}</span>
          ))}
          {chart.extra_legend?.map(l => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <i className="inline-block w-2 h-2 rounded-full" style={{ border: '2px solid var(--q-muted)' }} />{l.label}
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${TW} ${TH}`} className="w-full h-auto block touch-pan-y" role="img" aria-label={`${chart.title}: ${chart.y_label}`}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={TPL} x2={TW - TPR} y1={y(t)} y2={y(t)} stroke="var(--q-grid)" strokeWidth={1} />
              <text x={TPL - 6} y={y(t) + 4} textAnchor="end" fontSize={TFS} fill="var(--q-muted)">{fmt(chart.unit, t)}</text>
            </g>
          ))}
          {chart.ref && (
            <g>
              <line x1={TPL} x2={TW - TPR} y1={y(chart.ref.value)} y2={y(chart.ref.value)} stroke="var(--q-muted)" strokeWidth={1} strokeDasharray="4 3" />
              <text x={TPL + 4} y={y(chart.ref.value) - 4} fontSize={TFS} fill="var(--q-muted)">{chart.ref.label}</text>
            </g>
          )}
          <text x={TPL} y={TH - 6} fontSize={TFS} fill="var(--q-muted)">{short(dates[0])}</text>
          {dates.length > 1 && <text x={TW - TPR} y={TH - 6} textAnchor="end" fontSize={TFS} fill="var(--q-muted)">{short(dates.at(-1)!)}</text>}
          {hover && <line x1={x(hover)} x2={x(hover)} y1={TPT} y2={TPT + TIH} stroke="var(--q-muted)" strokeWidth={1} />}
          {[...series].sort((a, b) => (a.style === b.style ? 0 : a.style === 'dots' ? -1 : 1)).map(s => (
            <g key={s.key}>
              {s.style === 'line' && segments(s).filter(g => g.length > 1).map((g, i) => (
                <polyline key={i} points={g.map(p => `${x(p.date)},${y(p.value)}`).join(' ')} fill="none" stroke={SLOT[s.slot]} strokeWidth={2} strokeLinejoin="round" />
              ))}
              {s.points.map(p => s.style === 'line'
                ? <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={hover === p.date ? 5 : 4} fill={SLOT[s.slot]} stroke="var(--q-surface)" strokeWidth={2} />
                : <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={4.5} fill="var(--q-surface)" stroke={SLOT[s.slot]} strokeWidth={2} />)}
            </g>
          ))}
          {ends.map(e => (
            <text key={e.s.key} x={TW - TPR + 4} y={e.ly + 4} fontSize={TFS} fill="var(--q-text)">{fmt(chart.unit, e.p.value)}</text>
          ))}
          <rect x={TPL} y={TPT} width={TIW} height={TIH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove} />
        </svg>
        {hover && <Tip x={x(hover)} w={TW} lines={tipLines} />}
      </div>
    </div>
  );
}
