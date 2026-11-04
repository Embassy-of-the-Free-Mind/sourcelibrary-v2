'use client';

/**
 * Interactive parts of /admin/tokens (#8201): usage over time, the waste trends and the job table.
 * Series colours are the palette of /admin/spend, assigned by the sorted key, so a key keeps its
 * colour when the range changes.
 */
import { useMemo, useState } from 'react';
import { estimateVerdict, type BoardJob, type Dimension, type SignalRow, type UsageCell } from '@/lib/token-usage';

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const kTok = (v: number) => `${Math.round(v / 1000)}K`;
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const pts = (cost: number, perPoint: number | null) => (perPoint ? (cost / perPoint).toFixed(cost / perPoint < 10 ? 1 : 0) : '—');

const DIMS: { id: Dimension; label: string }[] = [
  { id: 'account', label: 'Account' }, { id: 'machine', label: 'Machine' }, { id: 'model', label: 'Model' }, { id: 'part', label: 'Cost type' },
];

function Toggle<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border border-stone-200 overflow-hidden text-xs">
      {options.map(o => (
        <button key={String(o.id)} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 ${o.id === value ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CHART_HEIGHT = 200;

export function UsageOverTime({ cells, perPoint }: { cells: UsageCell[]; perPoint: number | null }) {
  const [dim, setDim] = useState<Dimension>('account');
  const [range, setRange] = useState<number>(14);
  const [hover, setHover] = useState<string | null>(null);

  const dimCells = useMemo(() => cells.filter(c => c.dim === dim), [cells, dim]);
  const keys = useMemo(() => [...new Set(dimCells.map(c => c.key))].sort(), [dimCells]);
  const colour = (k: string) => SERIES[keys.indexOf(k) % SERIES.length];
  const days = useMemo(() => [...new Set(dimCells.map(c => c.day))].sort().slice(-range), [dimCells, range]);
  const byDay = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of dimCells) {
      if (!m.has(c.day)) m.set(c.day, new Map());
      m.get(c.day)!.set(c.key, c.cost);
    }
    return m;
  }, [dimCells]);
  const total = (d: string) => [...(byDay.get(d)?.values() || [])].reduce((t, v) => t + v, 0);
  const max = Math.max(1, ...days.map(total));
  const shown = hover ?? days[days.length - 1];

  return (
    <div className="grid gap-3 min-w-0">
      <div className="flex flex-wrap gap-2 items-center">
        <Toggle label="Split by" value={dim} options={DIMS} onChange={setDim} />
        <Toggle label="Range" value={range} options={[{ id: 7, label: '7 days' }, { id: 14, label: '14 days' }]} onChange={setRange} />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {keys.map(k => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colour(k) }} />{k}
          </li>
        ))}
      </ul>
      <div className="flex gap-1 items-end overflow-x-auto" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setHover(null)}>
        {days.map(d => (
          <button key={d} type="button" aria-label={`${dayName(d)}: ${usd(total(d))}`} onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)}
            className={`flex-1 min-w-[14px] h-full flex flex-col justify-end gap-[2px] rounded-t ${hover === d ? 'bg-stone-100' : ''}`}>
            {keys.filter(k => byDay.get(d)?.get(k)).map(k => (
              <span key={k} className="block w-full first:rounded-t" style={{ height: `${((byDay.get(d)!.get(k)!) / max) * (CHART_HEIGHT - 4)}px`, background: colour(k) }} />
            ))}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-stone-500">
        <span>{days[0] && dayName(days[0])}</span><span>tallest day {usd(max)}</span><span>{days.length > 0 && dayName(days[days.length - 1])}</span>
      </div>
      {shown && (
        <div className="text-xs text-stone-700 rounded border border-stone-200 bg-white px-3 py-2">
          <b>{dayName(shown)}</b>: {usd(total(shown))} $-eq{perPoint ? `, about ${pts(total(shown), perPoint)} points` : ''}
          <span className="text-stone-500">
            {' '}· {keys.filter(k => byDay.get(shown)?.get(k)).sort((a, b) => byDay.get(shown)!.get(b)! - byDay.get(shown)!.get(a)!)
              .map(k => `${k} ${usd(byDay.get(shown)!.get(k)!)}`).join(' · ')}
          </span>
        </div>
      )}
      <details className="text-xs text-stone-600">
        <summary className="cursor-pointer">Table</summary>
        <div className="overflow-x-auto mt-2">
          <table className="text-right border-collapse">
            <thead><tr><th className="text-left pr-3 font-medium">Day</th>{keys.map(k => <th key={k} className="px-2 font-medium">{k}</th>)}<th className="pl-2 font-medium">Total</th></tr></thead>
            <tbody>{days.map(d => (
              <tr key={d} className="border-t border-stone-100"><td className="text-left pr-3">{dayName(d)}</td>{keys.map(k => <td key={k} className="px-2">{usd(byDay.get(d)?.get(k) || 0)}</td>)}<td className="pl-2">{usd(total(d))}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Trend({ title, note, rows, value, format }: { title: string; note: string; rows: SignalRow[]; value: (s: SignalRow) => number; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = rows.map(value);
  const max = Math.max(...vals, 1e-9);
  const i = hover ?? rows.length - 1;
  return (
    <div className="rounded border border-stone-200 bg-white px-4 py-3 grid gap-2 content-start min-w-0">
      <div>
        <h3 className="text-sm font-medium text-stone-900">{title}</h3>
        <p className="text-[11px] text-stone-500 leading-snug">{note}</p>
      </div>
      <div className="text-lg font-semibold text-stone-900">{rows[i] ? format(vals[i]) : '—'}<span className="text-xs font-normal text-stone-500"> {rows[i] && dayName(rows[i].day)}</span></div>
      <div className="flex gap-[2px] items-end h-14" onMouseLeave={() => setHover(null)}>
        {rows.map((s, n) => (
          <button key={s.day} type="button" aria-label={`${dayName(s.day)}: ${format(vals[n])}`} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} className="flex-1 h-full flex items-end">
            <span className="block w-full rounded-t" style={{ height: `${Math.max(1, (vals[n] / max) * 56)}px`, background: n === i ? '#eb6834' : '#2a78d6' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function WasteTrends({ rows }: { rows: SignalRow[] }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
      <Trend title="Spend above 200K context" note="Each turn re-reads the whole context, so late turns in a long session cost most. Share of the day." rows={rows} value={s => (s.cost ? s.big / s.cost : 0)} format={pct} />
      <Trend title="Opus subagents" note="Sonnet is the default for subagents. Judging pages may need Opus; searching and summarising do not." rows={rows} value={s => s.sub_opus} format={usd} />
      <Trend title="Polling" note="Cache-read cost of the turn after a sleep: what it cost to wake up and look again." rows={rows} value={s => s.poll_cost} format={usd} />
      <Trend title="Short calls on default flags" note="Scripted calls that also loaded the CLI's default prompt and tools. Lean flags cost about 2% as much." rows={rows} value={s => s.fat_cost} format={usd} />
    </div>
  );
}

type SortKey = 'cost' | 'avg_ctx' | 'max_ctx' | 'sub_opus' | 'poll_cost' | 'last';

export function JobTable({ jobs, perPoint }: { jobs: BoardJob[]; perPoint: number | null }) {
  const [sort, setSort] = useState<SortKey>('cost');
  const [box, setBox] = useState('all');
  const [recent, setRecent] = useState(true);
  const [limit, setLimit] = useState(40);
  const boxes = useMemo(() => [...new Set(jobs.map(j => j.box))].sort(), [jobs]);
  const rows = useMemo(() => jobs
    .filter(j => (box === 'all' || j.box === box) && (!recent || j.active_recent))
    .sort((a, b) => (sort === 'last' ? b.last.localeCompare(a.last) : b[sort] - a[sort])), [jobs, box, recent, sort]);

  const H = ({ id, children }: { id: SortKey; children: string }) => (
    <th className="px-2 py-1 font-medium text-right whitespace-nowrap" aria-sort={sort === id ? 'descending' : 'none'}>
      <button type="button" onClick={() => setSort(id)} className={sort === id ? 'text-stone-900 underline' : 'text-stone-600 hover:text-stone-900'}>{children}</button>
    </th>
  );

  return (
    <div className="grid gap-2 min-w-0">
      <div className="flex flex-wrap gap-2 items-center">
        <Toggle label="Machine" value={box} options={[{ id: 'all', label: 'All' }, ...boxes.map(b => ({ id: b, label: b }))]} onChange={setBox} />
        <Toggle label="Period" value={recent ? 'recent' : 'all'} options={[{ id: 'recent', label: 'Active in 7 days' }, { id: 'all', label: 'All 15 days' }]} onChange={v => setRecent(v === 'recent')} />
      </div>
      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-2 py-1 font-medium text-left text-stone-600">Job</th>
              <th className="px-2 py-1 font-medium text-left text-stone-600">Machine</th>
              <H id="cost">$-eq</H>
              <th className="px-2 py-1 font-medium text-right text-stone-600">Points</th>
              <th className="px-2 py-1 font-medium text-right text-stone-600">Estimate</th>
              <H id="avg_ctx">Avg ctx</H>
              <H id="max_ctx">Max ctx</H>
              <H id="sub_opus">Opus subs</H>
              <H id="poll_cost">Polling</H>
              <H id="last">Last</H>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(j => {
              const actual = perPoint ? j.cost / perPoint : null;
              const verdict = estimateVerdict(j.estimate_pts, actual);
              return (
                <tr key={`${j.box}|${j.account}|${j.job}`} className="border-b border-stone-100 last:border-0">
                  <td className="px-2 py-1 text-left text-stone-900 max-w-[280px] truncate" title={`${j.job}, ${j.account}, ${j.sessions} sessions, ${j.req} requests`}>{j.job}</td>
                  <td className="px-2 py-1 text-left text-stone-600">{j.box}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(j.cost)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pts(j.cost, perPoint)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                    {j.estimate_pts == null ? <span className="text-stone-400">none</span> : j.estimate_pts}
                    {verdict === 'over' && <span className="ml-1 font-medium text-red-700">over</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{kTok(j.avg_ctx)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{kTok(j.max_ctx)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{j.sub_opus ? usd(j.sub_opus) : '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{j.polls ? `${usd(j.poll_cost)} · ${j.polls}` : '—'}</td>
                  <td className="px-2 py-1 text-right text-stone-500 whitespace-nowrap">{dayName(j.last.slice(0, 10))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setLimit(l => l + 60)} className="justify-self-start text-xs text-stone-600 underline">Show more ({rows.length - limit} left)</button>
      )}
    </div>
  );
}
