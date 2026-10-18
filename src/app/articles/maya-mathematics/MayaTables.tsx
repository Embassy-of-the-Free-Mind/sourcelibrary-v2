'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ECLIPSE_GROUPS, ECLIPSE_HALF_YEAR, LUNAR_MONTH, VENUS_PAGES, VENUS_ROWS, VENUS_STATIONS, VENUS_SYNODIC,
  fromOneAjaw, venusDays,
} from './tables';

const btn = 'px-3 py-1.5 rounded-full border border-border-medium text-sm text-primary hover:bg-warm transition-colors disabled:opacity-40';
const btnOn = 'px-3 py-1.5 rounded-full border border-stone-900 bg-stone-900 text-sm text-white';
const fmt = (x: number, d = 0) => x.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), d)}`;

function Card({ title, children, caption }: { title: string; children: ReactNode; caption: ReactNode }) {
  return (
    <figure className="not-prose my-10">
      <div className="rounded-lg border border-border-light bg-white/70 p-5 md:p-6">
        <p className="font-serif text-lg text-primary mb-4">{title}</p>
        {children}
      </div>
      <figcaption className="text-sm text-muted mt-2 leading-relaxed">{caption}</figcaption>
    </figure>
  );
}

function usePlayer(max: number, step: number, start = 0) {
  const [i, setI] = useState(start);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setI((v) => {
      if (v + step > max) { setPlaying(false); return max; }
      return v + step;
    }), 260);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, max, step]);
  const go = (v: number) => { setI(Math.max(0, Math.min(max, v))); };
  return { i, go, playing, setPlaying };
}

// ---------------------------------------------------------------------------------------------
// The Venus table: 13 rows of 20 stations across Dresden 46-50.

export function VenusTable() {
  const LAST = VENUS_ROWS * 20 - 1;
  const { i, go, playing, setPlaying } = usePlayer(LAST, 1);
  const [restart, setRestart] = useState(false);
  const row = Math.floor(i / 20), col = i % 20;
  const page = VENUS_PAGES[Math.floor(col / 4)];
  const station = VENUS_STATIONS[i % 4];
  const days = venusDays(i);
  const day = fromOneAjaw(days);
  // How far the count has run ahead of the planet: every 584-day cycle is 0.08 days too long.
  const ahead = days * (1 - VENUS_SYNODIC / 584);
  const atRestart = 57 * 584 * (1 - VENUS_SYNODIC / 584);

  return (
    <Card
      title="Step through the Venus table"
      caption={<>The layout follows Bowditch&apos;s reading of Dresden 46 to 50: each page carries four stations, a row runs across all five pages (2,920 days, eight years), and thirteen rows bring the count back to 1 Ajaw after 37,960 days. Every day is counted from 1 Ajaw in the 260-day count. What each station marks (the morning star last seen, and so on) is the usual reading of the four intervals; the planet&apos;s 583.92 days is the modern value.</>}
    >
      <div className="overflow-x-auto">
        <table className="text-[11px] leading-tight border-collapse min-w-[760px]">
          <thead>
            <tr>
              <th />
              {VENUS_PAGES.map((p) => <th key={p} colSpan={4} className="text-center font-normal text-muted pb-1 border-b border-border-light">Dresden {p}</th>)}
            </tr>
            <tr>
              <th />
              {Array.from({ length: 20 }, (_, c) => <th key={c} className="font-normal text-muted px-1 pt-1">+{VENUS_STATIONS[c % 4].days}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: VENUS_ROWS }, (_, r) => (
              <tr key={r}>
                <td className="pr-2 text-muted text-right">{r + 1}</td>
                {Array.from({ length: 20 }, (_, c) => {
                  const k = r * 20 + c;
                  const d = fromOneAjaw(venusDays(k));
                  const on = k === i, past = k < i;
                  return (
                    <td key={c} className={`px-1 py-0.5 text-center cursor-pointer whitespace-nowrap ${c % 4 === 0 ? 'border-l border-border-light' : ''} ${on ? 'bg-stone-900 text-white' : past ? 'bg-warm text-primary' : 'text-secondary'}`}
                      onClick={() => { setPlaying(false); go(k); }}>
                      {d.number} {d.name}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mt-5">
        <dt className="text-muted">Station</dt><dd className="text-primary">Row {row + 1}, Dresden {page}: {station.after}, +{station.days} days</dd>
        <dt className="text-muted">Day</dt><dd className="text-primary">{day.number} {day.name}</dd>
        <dt className="text-muted">Days from 1 Ajaw</dt><dd className="font-mono text-primary">{fmt(days)} <span className="text-muted">({fmt(days / 584, 2)} cycles of 584)</span></dd>
        <dt className="text-muted">Count against the planet</dt><dd className="text-primary">{signed(ahead)} days ahead of Venus</dd>
      </dl>

      <div className="flex flex-wrap gap-2 mt-4">
        <button className={playing ? btnOn : btn} onClick={() => setPlaying((p) => !p)} disabled={i === LAST && !playing}>{playing ? 'Pause' : 'Play'}</button>
        <button className={btn} onClick={() => go(i - 1)} disabled={i === 0}>Back</button>
        <button className={btn} onClick={() => go(i + 1)} disabled={i === LAST}>Next station</button>
        <button className={btn} onClick={() => go(i + 4)} disabled={i + 4 > LAST}>+584 days</button>
        <button className={btn} onClick={() => go(i + 20)} disabled={i + 20 > LAST}>+2,920 days</button>
        <button className={btn} onClick={() => go(LAST)}>End of the table</button>
        <button className={btn} onClick={() => { setPlaying(false); go(0); }}>Start</button>
      </div>

      <div className="mt-5 border-t border-border-light pt-4">
        <button className={restart ? btnOn : btn} onClick={() => setRestart((v) => !v)}>
          {restart ? 'Hide' : 'Show'} a correction: restart 8 days early after 57 cycles
        </button>
        {restart && (
          <p className="text-sm text-secondary leading-relaxed mt-3 max-w-2xl">
            After 57 cycles (33,288 days) the count is {fmt(atRestart, 1)} days ahead of the planet. Starting the
            next run 8 days early, at 33,280 days, puts it {fmt(8 - atRestart, 1)} days behind instead, and the new run
            still opens on 1 Ajaw, because 33,280 is exactly 128 runs of 260 days. Förstemann found 33,280 on Dresden
            24, the page that introduces the Venus table. Schemes of this kind, with more than one restart, are how
            Teeple, Lounsbury, the Brickers and Aldana have read the corrections; they differ on the details.
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The eclipse table: 69 groups of five or six lunar months across Dresden 51-58.

const W = 720;
const TOTAL = ECLIPSE_GROUPS.reduce((a, g) => a + g.days, 0);
// Running totals; each group's place on the strip; and each group end's distance from the middle of an
// eclipse season (n half eclipse years from the start). All fixed, so computed once.
const ENDS = ECLIPSE_GROUPS.map((_, k) => ECLIPSE_GROUPS.slice(0, k + 1).reduce((a, g) => a + g.days, 0));
const SEGS = ECLIPSE_GROUPS.map((g, k) => ({ ...g, x0: ((ENDS[k] - g.days) / TOTAL) * W, x1: (ENDS[k] / TOTAL) * W }));
const OFFSETS = ENDS.map((end, k) => end - (k + 1) * ECLIPSE_HALF_YEAR);
const PAGE_MARKS = SEGS.filter((s, k) => k === 0 || SEGS[k - 1].page !== s.page);

export function EclipseTable() {
  const { i, go, playing, setPlaying } = usePlayer(ECLIPSE_GROUPS.length, 1, ECLIPSE_GROUPS.length);
  // i = number of groups counted (0 to 69).
  const done = ECLIPSE_GROUPS.slice(0, i);
  const days = done.reduce((a, g) => a + g.days, 0);
  const months = done.reduce((a, g) => a + g.months, 0);
  const moonDrift = days - months * LUNAR_MONTH;
  const offsets = OFFSETS;
  const cur = ECLIPSE_GROUPS[Math.max(0, i - 1)];

  // Chart geometry: the strip of groups, and beneath it each group end's distance from the middle of an eclipse season.
  const chartH = 120, mid = 30 + chartH / 2, yScale = chartH / 2 / 20; // ±20 days
  const segs = SEGS, pageMarks = PAGE_MARKS;

  return (
    <Card
      title="Step through the eclipse table"
      caption={<>The 69 groups and their order are Förstemann&apos;s, with his corrections (<em>Commentary</em>, printed pp. 203 to 204). Six lunar months come to 177 or 178 days, five to 148. The lower chart uses modern values: six months (177.2 days) are a little longer than half an eclipse year (173.3 days), so each six-month group drifts about four days later in the eclipse season, and a five-month group pulls it back. The dashed lines are 18 days either side of the middle of the season, about as far as a solar eclipse can fall from it.</>}
    >
      <div className="overflow-x-auto">
        <svg viewBox={`-30 0 ${W + 40} ${mid + chartH / 2 + 26}`} className="w-full min-w-[620px]" role="img" aria-label={`Eclipse table, ${i} of 69 groups counted`}>
          {pageMarks.map((s) => (
            <text key={s.page} x={s.x0 + 1} y={9} fontSize={8} fill="var(--color-muted)" fontFamily="var(--font-sans, sans-serif)">{s.page}</text>
          ))}
          {segs.map((s, k) => (
            <rect key={s.n} x={s.x0 + 0.3} y={13} width={s.x1 - s.x0 - 0.6} height={12}
              fill={s.days === 148 ? 'var(--color-accent-sage)' : s.days === 178 ? 'var(--color-accent-gold)' : 'var(--color-border-medium)'}
              opacity={k < i ? 1 : 0.35} stroke={k === i - 1 ? 'var(--color-primary)' : 'none'} strokeWidth={1.2}
              onClick={() => { setPlaying(false); go(k + 1); }} style={{ cursor: 'pointer' }} />
          ))}
          <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--color-border-medium)" />
          {[-18, 18].map((d) => <line key={d} x1={0} x2={W} y1={mid - d * yScale} y2={mid - d * yScale} stroke="var(--color-border-medium)" strokeDasharray="3 3" />)}
          <text x={-4} y={mid - 18 * yScale + 3} fontSize={8} textAnchor="end" fill="var(--color-muted)" fontFamily="var(--font-sans, sans-serif)">+18</text>
          <text x={-4} y={mid + 18 * yScale + 3} fontSize={8} textAnchor="end" fill="var(--color-muted)" fontFamily="var(--font-sans, sans-serif)">−18</text>
          <polyline fill="none" stroke="var(--color-primary)" strokeWidth={1.2}
            points={[`0,${mid}`, ...segs.slice(0, i).map((s, k) => `${s.x1},${mid - offsets[k] * yScale}`)].join(' ')} />
          {segs.slice(0, i).map((s, k) => (
            <circle key={s.n} cx={s.x1} cy={mid - offsets[k] * yScale} r={s.days === 148 ? 2.6 : 1.6}
              fill={s.days === 148 ? 'var(--color-accent-sage-dark)' : 'var(--color-primary)'} />
          ))}
          <text x={W / 2} y={mid + chartH / 2 + 18} fontSize={9} textAnchor="middle" fill="var(--color-muted)" fontFamily="var(--font-sans, sans-serif)">
            days from the middle of the eclipse season at the end of each group
          </text>
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted mt-2">
        <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{ background: 'var(--color-border-medium)' }} />177 days, six months</span>
        <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{ background: 'var(--color-accent-gold)' }} />178 days, six months</span>
        <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{ background: 'var(--color-accent-sage)' }} />148 days, five months</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mt-4">
        <dt className="text-muted">Groups counted</dt><dd className="text-primary">{i} of 69{i ? `; the last, group ${cur.n} on Dresden ${cur.page}, is ${cur.days} days` : ''}</dd>
        <dt className="text-muted">Days and months</dt><dd className="font-mono text-primary">{fmt(days)} days, {months} months</dd>
        <dt className="text-muted">Against the moon</dt><dd className="text-primary">{i ? `${signed(moonDrift, 2)} days from ${months} true lunar months` : '—'}</dd>
        <dt className="text-muted">In the eclipse season</dt><dd className="text-primary">{i ? `${signed(offsets[i - 1])} days from its middle` : '—'}</dd>
      </dl>

      <div className="flex flex-wrap gap-2 mt-4">
        <button className={playing ? btnOn : btn} onClick={() => { if (i === 69) go(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play'}</button>
        <button className={btn} onClick={() => go(i - 1)} disabled={i === 0}>Back</button>
        <button className={btn} onClick={() => go(i + 1)} disabled={i === 69}>Next group</button>
        <button className={btn} onClick={() => go(69)}>All 69</button>
        <button className={btn} onClick={() => { setPlaying(false); go(0); }}>Start</button>
      </div>
    </Card>
  );
}
