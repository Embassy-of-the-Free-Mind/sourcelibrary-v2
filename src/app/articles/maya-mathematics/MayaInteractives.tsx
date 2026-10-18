'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  CORRELATIONS, DAY_NAMES, DAY_NAMES_COLONIAL, GMT, LONG_COUNT_UNITS, MONTHS,
  calendrical, gregorianFromJdn, haab, jdnFromGregorian, lcm, longCount, lordOfNight, tzolkin, vigesimal,
} from './maya';

const INK = 'var(--color-primary)';
const SHELL = 'var(--color-accent-gold-dark)';

const btn = 'px-3 py-1.5 rounded-full border border-border-medium text-sm text-primary hover:bg-warm transition-colors';
const btnOn = 'px-3 py-1.5 rounded-full border border-stone-900 bg-stone-900 text-sm text-white';
const fmt = (x: number) => x.toLocaleString('en-GB');

function Card({ title, children, caption }: { title: string; children: ReactNode; caption?: ReactNode }) {
  return (
    <figure className="not-prose my-10">
      <div className="rounded-lg border border-border-light bg-white/70 p-5 md:p-6">
        <p className="font-serif text-lg text-primary mb-5">{title}</p>
        {children}
      </div>
      {caption && <figcaption className="text-sm text-muted mt-2 leading-relaxed">{caption}</figcaption>}
    </figure>
  );
}

/** One Maya numeral, 0-19: dots over bars, or the shell for zero. */
export function Numeral({ value, size = 44, label }: { value: number; size?: number; label?: string }) {
  const w = 60;
  const bars = Math.floor(value / 5);
  const dots = value % 5;
  const barH = 7, gap = 4, dotR = 4.5;
  const h = value === 0 ? 34 : (dots ? dotR * 2 + gap : 0) + bars * (barH + gap) - gap;
  const scale = size / w;
  return (
    <svg width={size} height={Math.max(h, 10) * scale} viewBox={`0 0 ${w} ${Math.max(h, 10)}`} role="img" aria-label={label ?? `Maya numeral ${value}`}>
      {value === 0 ? (
        <g fill="none" stroke={SHELL} strokeWidth={2.5} strokeLinecap="round">
          <ellipse cx={30} cy={17} rx={24} ry={14} />
          <path d="M10 13 Q30 3 50 13" />
          <path d="M14 22 Q30 28 46 22" />
          <path d="M22 9 L24 25 M38 9 L36 25" />
        </g>
      ) : (
        <g fill={INK}>
          {Array.from({ length: dots }, (_, i) => {
            const span = 52 / dots;
            return <circle key={i} cx={4 + span * (i + 0.5)} cy={dotR} r={dotR} />;
          })}
          {Array.from({ length: bars }, (_, i) => (
            <rect key={i} x={2} y={(dots ? dotR * 2 + gap : 0) + i * (barH + gap)} width={56} height={barH} rx={3} />
          ))}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Numeral builder: base 20, and the calendar's 18 in the second place.

const PRESETS = [
  { v: 20, note: 'one twenty: kal' },
  { v: 400, note: 'twenty twenties: bak' },
  { v: 8000, note: 'twenty times 400: pic' },
  { v: 360, note: 'one tun' },
  { v: 2920, note: 'five Venus cycles' },
  { v: 14600, note: '5 × 2,920, Dresden 24' },
  { v: 364, note: '4 × 91, Dresden 63' },
];

export function NumeralBuilder() {
  const [value, setValue] = useState(2920);
  const [mode, setMode] = useState<'count' | 'calendar'>('calendar');
  const digits = mode === 'count' ? vigesimal(value) : calendrical(value);
  const placeValues = digits.map((_, i) => {
    const k = digits.length - 1 - i;
    return mode === 'count' ? 20 ** k : [1, 20, 360, 7200, 144000][k];
  });
  const set = (v: number) => setValue(Math.max(0, Math.min(v, 2_879_999)));

  return (
    <Card
      title="Write a number the Maya way"
      caption="Places stack from the bottom up, as in the codices. In plain counting every place is worth twenty of the one below; in the calendar the third place is 18 × 20 = 360, so that a tun comes near a year."
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <button className={mode === 'calendar' ? btnOn : btn} onClick={() => setMode('calendar')}>Calendar places (1, 20, 360, 7,200)</button>
        <button className={mode === 'count' ? btnOn : btn} onClick={() => setMode('count')}>Plain counting (1, 20, 400, 8,000)</button>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div>
          <label className="block text-sm text-muted mb-1" htmlFor="maya-n">Number</label>
          <input
            id="maya-n" type="number" min={0} max={2879999} value={value}
            onChange={(e) => set(Number(e.target.value) || 0)}
            className="w-40 rounded border border-border-medium bg-white px-3 py-2 text-lg font-mono text-primary"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.v} className={value === p.v ? btnOn : btn} onClick={() => set(p.v)} title={p.note}>
                {fmt(p.v)} <span className="opacity-70">· {p.note}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {digits.map((d, i) => (
            <div key={`${mode}-${i}`} className="flex items-center gap-3 border-b border-border-light pb-3 last:border-0">
              <div className="flex flex-col gap-1">
                <button aria-label={`Add one ${fmt(placeValues[i])}`} className="w-7 h-7 rounded-full border border-border-medium text-sm leading-none hover:bg-warm" onClick={() => set(value + placeValues[i])}>+</button>
                <button aria-label={`Take away one ${fmt(placeValues[i])}`} className="w-7 h-7 rounded-full border border-border-medium text-sm leading-none hover:bg-warm disabled:opacity-30" disabled={value < placeValues[i]} onClick={() => set(value - placeValues[i])}>−</button>
              </div>
              <div className="w-16 flex justify-center"><Numeral value={d} /></div>
              <div className="font-mono text-sm text-secondary">
                {d} × {fmt(placeValues[i])} = <span className="text-primary">{fmt(d * placeValues[i])}</span>
              </div>
            </div>
          ))}
          <p className="font-mono text-sm text-primary pt-1">total {fmt(value)}</p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Date counter: one day number, read through every count at once.

const ANCHORS = [
  { label: 'Era base', n: 0 },
  { label: 'Pakal takes the throne (9.9.2.4.8)', n: 9 * 144000 + 9 * 7200 + 2 * 360 + 4 * 20 + 8 },
  { label: '21 December 2012', n: 1872000 },
];

function gregorianLabel(jdn: number) {
  const { y, m, d } = gregorianFromJdn(jdn);
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
  return y > 0 ? `${d} ${month} ${y}` : `${d} ${month} ${1 - y} BCE`;
}

export function DateCounter() {
  const [n, setN] = useState(1872000);
  const [corr, setCorr] = useState(GMT);
  const [colonial, setColonial] = useState(false);
  const [todayN, setTodayN] = useState<number | null>(null);

  useEffect(() => {
    const t = new Date();
    const v = jdnFromGregorian(t.getFullYear(), t.getMonth() + 1, t.getDate()) - GMT;
    setTodayN(v);
    setN(v);
  }, []);

  const lc = longCount(n);
  const shown = n === 0 ? [13, 0, 0, 0, 0] : lc;
  const tz = tzolkin(n);
  const hb = haab(n);
  const names = colonial ? DAY_NAMES_COLONIAL : DAY_NAMES;
  const g = gregorianFromJdn(n + corr);
  const iso = g.y >= 1 && g.y <= 9999 ? `${String(g.y).padStart(4, '0')}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}` : '';
  const step = (k: number) => setN((v) => Math.max(0, v + k));

  return (
    <Card
      title="One day, every count"
      caption={<>Every count is a remainder of one number: the days since the era base. The 260-day count is that number divided by 13 and by 20; the 365-day year, by 365; the Lords of the Night, by 9. The correlation is the day in our reckoning on which that number was zero. Dates before 1582 are shown in the proleptic Gregorian calendar.</>}
    >
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div>
          <label className="block text-sm text-muted mb-1" htmlFor="maya-date">Date</label>
          <input
            id="maya-date" type="date" value={iso}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (y) setN(Math.max(0, jdnFromGregorian(y, m, d) - corr));
            }}
            className="rounded border border-border-medium bg-white px-3 py-2 text-primary"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1" htmlFor="maya-corr">Correlation</label>
          <select id="maya-corr" value={corr} onChange={(e) => setCorr(Number(e.target.value))} className="rounded border border-border-medium bg-white px-3 py-2 text-primary">
            {CORRELATIONS.map((c) => <option key={c.value} value={c.value}>{c.name}</option>)}
          </select>
        </div>
        <button className={colonial ? btnOn : btn} onClick={() => setColonial((v) => !v)}>{colonial ? 'Colonial spelling' : 'Modern spelling'}</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {todayN !== null && <button className={n === todayN ? btnOn : btn} onClick={() => setN(todayN)}>Today</button>}
        {ANCHORS.map((a) => <button key={a.label} className={n === a.n ? btnOn : btn} onClick={() => setN(a.n)}>{a.label}</button>)}
      </div>

      <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] items-start">
        <div className="space-y-2">
          {LONG_COUNT_UNITS.map((u, i) => (
            <div key={u.name} className="flex items-center gap-3">
              <div className="w-14 flex justify-center"><Numeral value={shown[i]} size={40} /></div>
              <span className="font-mono text-sm text-primary w-6 text-right">{shown[i]}</span>
              <span className="text-sm text-muted">{u.name} <span className="opacity-70">({fmt(u.days)})</span></span>
            </div>
          ))}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm content-start">
          <dt className="text-muted">Long Count</dt><dd className="font-mono text-primary">{shown.join('.')}</dd>
          <dt className="text-muted">260-day count</dt><dd className="text-primary">{tz.number} {names[tz.index]}</dd>
          <dt className="text-muted">365-day year</dt><dd className="text-primary">{hb.day} {MONTHS[hb.month]}</dd>
          <dt className="text-muted">Lord of the Night</dt><dd className="text-primary">G{lordOfNight(n)}</dd>
          <dt className="text-muted">Our calendar</dt><dd className="text-primary">{gregorianLabel(n + corr)}</dd>
          <dt className="text-muted">Days since base</dt><dd className="font-mono text-primary">{fmt(n)}</dd>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2 mt-6">
        {[-7200, -360, -20, -1, 1, 20, 360, 7200].map((k) => (
          <button key={k} className={btn} onClick={() => step(k)}>{k > 0 ? '+' : '−'}{fmt(Math.abs(k))}</button>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. The 260-day count as two wheels, and the 52 years before a pair comes back.

export function CycleWheels() {
  // k = days since 4 Ajaw 8 Kumk'u. The wheels' angles only ever move forward, by the step taken
  // modulo each wheel, so a jump of 18,980 days turns them the short way instead of spinning.
  const [{ k, numTurn, nameTurn }, setState] = useState({ k: 0, numTurn: 3, nameTurn: 19 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const advance = (d: number) =>
    setState((s) => ({ k: s.k + d, numTurn: s.numTurn + (d % 13), nameTurn: s.nameTurn + (d % 20) }));
  const reset = () => setState({ k: 0, numTurn: 3, nameTurn: 19 });

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => advance(speed), 220);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, speed]);

  const tz = tzolkin(k);
  const hb = haab(k);
  const R1 = 70, R2 = 118;
  const numRot = -(numTurn * 360) / 13;
  const nameRot = -(nameTurn * 360) / 20;
  const sincePair = k % 18980;

  return (
    <Card
      title="Thirteen numbers, twenty names"
      caption="Both wheels turn one step a day. Thirteen and twenty share no factor, so the same number and name meet again only after 13 × 20 = 260 days. Add the 365-day year and a full combination returns after 18,980 days, the 52-year Calendar Round."
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] items-center">
        <svg viewBox="-150 -150 300 300" className="w-full max-w-[300px] mx-auto" role="img" aria-label={`Wheels showing ${tz.number} ${DAY_NAMES[tz.index]}`}>
          <circle r={R2 + 22} fill="none" stroke="var(--color-border-medium)" />
          <circle r={R1 + 18} fill="none" stroke="var(--color-border-medium)" />
          <circle r={R1 - 18} fill="none" stroke="var(--color-border-light)" />
          <g style={{ transition: 'transform 200ms', transform: `rotate(${nameRot}deg)` }}>
            {DAY_NAMES.map((name, i) => {
              const a = (i * 360) / 20;
              const on = i === tz.index;
              return (
                <text key={name} transform={`rotate(${a}) translate(0 ${-R2}) rotate(0)`} textAnchor="middle" dominantBaseline="middle" fontSize={on ? 12 : 10} fontWeight={on ? 700 : 400} fill={on ? INK : 'var(--color-muted)'} fontFamily="var(--font-sans, sans-serif)">
                  {name}
                </text>
              );
            })}
          </g>
          <g style={{ transition: 'transform 200ms', transform: `rotate(${numRot}deg)` }}>
            {Array.from({ length: 13 }, (_, i) => {
              const a = (i * 360) / 13;
              const on = i + 1 === tz.number;
              return (
                <text key={i} transform={`rotate(${a}) translate(0 ${-R1})`} textAnchor="middle" dominantBaseline="middle" fontSize={on ? 16 : 12} fontWeight={on ? 700 : 400} fill={on ? INK : 'var(--color-muted)'} fontFamily="var(--font-sans, sans-serif)">
                  {i + 1}
                </text>
              );
            })}
          </g>
          <path d={`M0 ${-R2 - 30} l-6 -10 h12 z`} fill={SHELL} />
          <text y={6} textAnchor="middle" fontSize={13} fill={INK} fontFamily="var(--font-sans, sans-serif)">{tz.number} {DAY_NAMES[tz.index]}</text>
        </svg>
        <div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-5">
            <dt className="text-muted">Today in the wheels</dt><dd className="text-primary">{tz.number} {DAY_NAMES[tz.index]} {hb.day} {MONTHS[hb.month]}</dd>
            <dt className="text-muted">Days counted</dt><dd className="font-mono text-primary">{fmt(k)}</dd>
            <dt className="text-muted">Into this Calendar Round</dt><dd className="font-mono text-primary">{fmt(sincePair)} of 18,980</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button className={playing ? btnOn : btn} onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
            {[1, 13, 20, 73].map((s) => <button key={s} className={speed === s ? btnOn : btn} onClick={() => setSpeed(s)}>{s} day{s > 1 ? 's' : ''} a step</button>)}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className={btn} onClick={() => advance(1)}>+1 day</button>
            <button className={btn} onClick={() => advance(260)}>+260 days</button>
            <button className={btn} onClick={() => advance(365)}>+365 days</button>
            <button className={btn} onClick={() => advance(18980)}>+18,980 days</button>
            <button className={btn} onClick={() => { reset(); setPlaying(false); }}>Back to 4 Ajaw 8 Kumk&apos;u</button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. The Kaua sequences: what a step of a winal, a tun or a k'atun does to the day number.

const KAUA = [
  { unit: 'winal', days: 20, start: 1, printed: [1, 8, 2, 9, 3, 10, 4, 11, 5, 12, 6, 13, 7], heading: 'Months' },
  { unit: 'tun', days: 360, start: 13, printed: [13, 9, 5, 1, 10, 6, 2, 11, 7, 3, 12, 8, 4], heading: 'Months' },
  { unit: "k'atun", days: 7200, start: 13, printed: [13, 11, 9, 7, 5, 3, 1, 12, 10, 8, 6, 4, 2], heading: 'Katuns' },
];

export function KauaSequences() {
  const [i, setI] = useState(2);
  const row = KAUA[i];
  const shift = row.days % 13;
  const computed = useMemo(() => Array.from({ length: 13 }, (_, k) => ((row.start - 1 + k * shift) % 13) + 1), [row, shift]);
  const [shown, setShown] = useState(13);
  useEffect(() => {
    setShown(1);
    const t = setInterval(() => setShown((s) => (s >= 13 ? 13 : s + 1)), 160);
    return () => clearInterval(t);
  }, [i]);

  return (
    <Card
      title="The three rows on the Kaua page"
      caption={<>Each step adds the same number of days, so the day number moves on by that many days counted in thirteens. A k&apos;atun of 7,200 days is 553 thirteens and 11 over, and adding 11 in a count of 13 is the same as going back 2: so the k&apos;atuns come 13, 11, 9, 7…</>}
    >
      <div className="flex flex-wrap gap-2 mb-5">
        {KAUA.map((r, j) => <button key={r.unit} className={i === j ? btnOn : btn} onClick={() => setI(j)}>Step by a {r.unit} ({fmt(r.days)} days)</button>)}
      </div>
      <p className="text-sm text-secondary mb-4 font-mono">
        {fmt(row.days)} = {Math.floor(row.days / 13)} × 13 + {shift}, so each step moves the number on by {shift}{shift > 6 ? ` (or back by ${13 - shift})` : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <tbody>
            <tr>
              <th className="text-left text-muted font-normal pr-3 py-1 whitespace-nowrap">Counted</th>
              {computed.map((v, k) => <td key={k} className={`w-9 text-center font-mono py-1 ${k < shown ? 'text-primary' : 'text-transparent'}`}>{v}</td>)}
            </tr>
            <tr>
              <th className="text-left text-muted font-normal pr-3 py-1 whitespace-nowrap">Kaua, “{row.heading}”</th>
              {row.printed.map((v, k) => <td key={k} className="w-9 text-center font-mono py-1 text-secondary">{v}</td>)}
            </tr>
            <tr>
              <th />
              {row.printed.map((v, k) => <td key={k} className="w-9 text-center text-xs text-accent-sage-dark">{k < shown ? (v === computed[k] ? '✓' : '✗') : ''}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Cycles that meet: least common multiples instead of fractions.

const CYCLES = [
  { key: 'tz', name: '260-day count', unit: '260-day counts', days: 260, truth: null as number | null },
  { key: 'hb', name: '365-day year', unit: 'years', days: 365, truth: 365.2422 },
  { key: 've', name: 'Venus', unit: 'Venus cycles', days: 584, truth: 583.92 },
  { key: 'ma', name: 'Mars', unit: 'Mars cycles', days: 780, truth: 779.94 },
  { key: 'me', name: 'Mercury', unit: 'Mercury cycles', days: 117, truth: 115.88 },
  { key: 'c819', name: '819-day count', unit: '819-day counts', days: 819, truth: null },
];

export function CyclesMeet() {
  const [on, setOn] = useState<Record<string, boolean>>({ tz: false, hb: true, ve: true, ma: false });
  const chosen = CYCLES.filter((c) => on[c.key]);
  const L = chosen.reduce((a, c) => lcm(a, c.days), 1);
  const W = 640;

  return (
    <Card
      title="When do the cycles meet?"
      caption="Each row marks where one cycle ends, laid out to the day all the chosen cycles end together. The tables count whole days only, so they run slightly off the sky; the last column shows how far by the meeting day, using modern lengths for the year and the synodic periods of Venus and Mars."
    >
      <div className="flex flex-wrap gap-2 mb-5">
        {CYCLES.map((c) => (
          <button key={c.key} className={on[c.key] ? btnOn : btn} onClick={() => setOn((o) => ({ ...o, [c.key]: !o[c.key] }))}>
            {c.name} · {c.days}
          </button>
        ))}
      </div>
      {chosen.length < 2 ? (
        <p className="text-sm text-muted">Choose two or more cycles.</p>
      ) : (
        <>
          <p className="font-serif text-xl text-primary mb-1">{fmt(L)} days</p>
          <p className="text-sm text-muted mb-4">
            {chosen.map((c) => `${fmt(L / c.days)} × ${c.days}`).join(' = ')}
          </p>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W + 260} ${chosen.length * 34 + 10}`} className="w-full min-w-[520px]" role="img" aria-label={`The chosen cycles meet after ${fmt(L)} days`}>
              {chosen.map((c, r) => {
                const count = L / c.days;
                const y = 18 + r * 34;
                const drift = c.truth ? (c.days - c.truth) * count : null;
                return (
                  <g key={c.key}>
                    <line x1={0} x2={W} y1={y} y2={y} stroke="var(--color-border-medium)" />
                    {count <= 400
                      ? Array.from({ length: count + 1 }, (_, t) => <line key={t} x1={(t / count) * W} x2={(t / count) * W} y1={y - 7} y2={y + 7} stroke={INK} strokeWidth={count > 120 ? 0.6 : 1.2} />)
                      : <rect x={0} y={y - 7} width={W} height={14} fill={INK} opacity={0.25} />}
                    <text x={W + 12} y={y + 4} fontSize={12} fill={INK} fontFamily="var(--font-sans, sans-serif)">
                      {fmt(count)} {c.unit}{drift !== null ? ` · ${drift >= 0 ? '+' : ''}${drift.toFixed(1)} d` : ''}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </Card>
  );
}
