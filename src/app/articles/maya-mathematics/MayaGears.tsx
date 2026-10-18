'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DAY_NAMES, MONTHS, lcm } from './maya';

// The counts drawn as gears with one tooth per day, every gear turning one tooth a day. A gold mark
// on each gear starts at its reading point; all the marks are back there together only after the
// least common multiple of the tooth counts.
//
// Two layouts. 'mesh' (the Calendar Round): real meshing gears with one tooth spacing, so a gear's
// size is its cycle's length; the 365-tooth gear is far larger than the window and shows as an arc.
// 'row' (the long astronomical cycles): gears of 260 to 819 teeth would each be metres across at that
// spacing, so they stand side by side at one size, each with its true number of teeth, under a pointer.

const PITCH = 22; // tooth spacing for the meshing layout, in drawing units
const ROW_R = 100; // radius of every gear in the row layout
const rad = (d: number) => (d * Math.PI) / 180;
const mod = (a: number, m: number) => ((a % m) + m) % m;
const meshRadius = (n: number) => (n * PITCH) / (2 * Math.PI);

type Band = { from: number; to: number; text: string };
type GearDef = {
  teeth: number;
  name: string;
  /** Tooth at the reading point on day 0 (the era base, 4 Ajaw 8 Kumk'u, for the calendar gears). */
  start: number;
  /** Label for tooth v, or null. */
  label: (v: number) => string | null;
  /** What the reading point shows. */
  read: (v: number) => string;
  bands?: Band[];
};

const tz260 = (t: number) => `${(t % 13) + 1} ${DAY_NAMES[t % 20]}`;

const G13: GearDef = { teeth: 13, name: 'Numbers', start: 3, label: (v) => String(v + 1), read: (v) => String(v + 1) };
const G20: GearDef = { teeth: 20, name: 'Day names', start: 19, label: (v) => DAY_NAMES[v], read: (v) => DAY_NAMES[v] };
const G365: GearDef = {
  teeth: 365, name: '365-day year', start: 348,
  label: (v) => (v % 20 === 0 ? MONTHS[v / 20] : String(v % 20)),
  read: (v) => `${v % 20} ${MONTHS[Math.floor(v / 20)]}`,
};
const ROW365: GearDef = { ...G365, label: (v) => (v % 20 === 0 ? MONTHS[v / 20] : null) };
const ROW260: GearDef = {
  teeth: 260, name: '260-day count', start: 159,
  label: (t) => (t % 20 === 0 ? tz260(t) : null), read: tz260,
};
// Bowditch reads the Venus pages as 236 + 90 + 250 + 8 = 584 days (Numeration, p. 55).
const ROWVENUS: GearDef = {
  teeth: 584, name: 'Venus', start: 0,
  label: () => null, read: (v) => `day ${v + 1} of 584`,
  bands: [
    { from: 0, to: 236, text: 'morning star 236' },
    { from: 236, to: 326, text: 'unseen 90' },
    { from: 326, to: 576, text: 'evening star 250' },
    { from: 576, to: 584, text: '' },
  ],
};
const ROWMARS: GearDef = {
  teeth: 780, name: 'Mars', start: 0,
  label: (v) => (v % 78 === 0 ? String(v) : null), read: (v) => `day ${v + 1} of 780`,
};
const ROW819: GearDef = {
  teeth: 819, name: '819-day count', start: 0,
  label: (v) => (v % 91 === 0 ? String(v) : null), read: (v) => `day ${v + 1} of 819`,
};

type Preset = { key: string; title: string; layout: 'mesh' | 'row'; gears: GearDef[]; note: string };

export const GEAR_PRESETS: Preset[] = [
  {
    key: 'round', title: 'Calendar Round', layout: 'mesh', gears: [G20, G13, G365],
    note: 'Thirteen numbers and twenty names make the 260-day count; the 365-day year turns beside them. The three marks meet again after 18,980 days, 52 years. Here the gears really mesh: the same tooth spacing on all three, so the year gear is too big to show whole.',
  },
  {
    key: 'venus', title: 'Venus, the year and the 260 days', layout: 'row', gears: [ROW260, ROW365, ROWVENUS],
    note: 'The Dresden Venus pages: 5 × 584 = 8 × 365, and thirteen times that, 37,960 days, the 260-day count comes round too. The bands on the Venus gear are the four parts of the cycle as Bowditch reads the table. These gears are drawn the same size, so their teeth are not to scale.',
  },
  {
    key: 'mars', title: '819 days, Mars and the 260 days', layout: 'row', gears: [ROW260, ROW819, ROWMARS],
    note: 'Twenty 819-day counts are 16,380 days: 63 runs of the 260-day count and 21 Mars cycles of 780 days. These gears are drawn the same size, so their teeth are not to scale.',
  },
];

const FONT = 'var(--font-sans, sans-serif)';

/** One gear in its own frame: teeth, labels, bands and the gold start mark. Tooth v sits at angle dir·v·step. */
function GearBody({ g, r, toothH, dir, half }: { g: GearDef; r: number; toothH: number; dir: 1 | -1; half: boolean }) {
  const step = 360 / g.teeth;
  const d = useMemo(() => {
    const w = step * 0.28;
    const out: string[] = [];
    for (let i = 0; i < g.teeth; i++) {
      const c = dir * (i + (half ? 0.5 : 0)) * step;
      const pts: [number, number][] = [
        [r - toothH / 2, c - step / 2], [r - toothH / 2, c - w * 1.5], [r + toothH / 2, c - w],
        [r + toothH / 2, c + w], [r - toothH / 2, c + w * 1.5],
      ];
      out.push(pts.map(([rr, a], k) => `${i === 0 && k === 0 ? 'M' : 'L'}${(rr * Math.cos(rad(a))).toFixed(2)} ${(rr * Math.sin(rad(a))).toFixed(2)}`).join(' '));
    }
    return out.join(' ') + ' Z';
  }, [g.teeth, r, toothH, dir, half, step]);

  const at = (v: number) => dir * v * step;
  const polar = (rr: number, a: number): [number, number] => [rr * Math.cos(rad(a)), rr * Math.sin(rad(a))];
  const fine = g.teeth > 100 && r < 200; // a row gear: hundreds of teeth on a small wheel

  return (
    <g>
      <path d={d} fill="var(--color-warm)" stroke="var(--color-primary)" strokeWidth={fine ? 0.35 : 0.8} strokeLinejoin="round" />
      <circle r={Math.min(r * 0.2, 16)} fill="none" stroke="var(--color-border-medium)" />
      {g.bands?.map((b, i) => {
        const rr = r - toothH - 10;
        const n = Math.max(2, Math.ceil((b.to - b.from) / 4));
        const pts = Array.from({ length: n + 1 }, (_, k) => polar(rr, at(b.from + ((b.to - b.from) * k) / n)));
        const mid = at((b.from + b.to) / 2);
        const [tx, ty] = polar(rr - 14, mid);
        return (
          <g key={i}>
            <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={7}
              stroke={i % 2 ? 'var(--color-border-medium)' : 'var(--color-accent-sage)'} />
            {b.text && (
              <text x={tx} y={ty} fontSize={8} textAnchor="middle" dominantBaseline="middle" fill="var(--color-secondary)" fontFamily={FONT}
                transform={`rotate(${mid + 90} ${tx} ${ty})`}>{b.text}</text>
            )}
          </g>
        );
      })}
      {Array.from({ length: g.teeth }, (_, v) => {
        const text = g.label(v);
        if (!text) return null;
        const a = at(v);
        // Short labels sit across the rim; names and longer labels run along the radius.
        const radial = text.length > 3;
        const [x, y] = polar(radial ? r - toothH / 2 - 3 : r - toothH - 9, a);
        return (
          <text key={v} x={x} y={y} fontSize={fine ? 8 : radial ? 8 : 10} textAnchor={radial ? 'end' : 'middle'} dominantBaseline="middle"
            transform={`rotate(${radial ? a : a + 90} ${x} ${y})`} fill="var(--color-primary)" fontFamily={FONT}>
            {text}
          </text>
        );
      })}
      {(() => {
        const [x, y] = polar(r - toothH / 2 - (fine ? 1 : 3), at(g.start));
        return <circle cx={x} cy={y} r={fine ? 4 : 3.6} fill="var(--color-accent-gold-dark)" />;
      })()}
    </g>
  );
}

type Placed = { g: GearDef; cx: number; cy: number; r: number; toothH: number; dir: 1 | -1; half: boolean; read: number };

function layout(p: Preset): { placed: Placed[]; lines: [number, number, number, number][]; box: { x0: number; y0: number; w: number; h: number } } {
  if (p.layout === 'row') {
    const gap = 30;
    const placed = p.gears.map((g, i): Placed => ({ g, cx: i * (2 * ROW_R + gap), cy: 0, r: ROW_R, toothH: 5, dir: 1, half: false, read: -90 }));
    const lines = placed.map((q): [number, number, number, number] => [q.cx, -ROW_R - 18, q.cx, -ROW_R + 2]);
    const w = (p.gears.length - 1) * (2 * ROW_R + gap) + 2 * ROW_R + 20;
    return { placed, lines, box: { x0: -ROW_R - 10, y0: -ROW_R - 24, w, h: 2 * ROW_R + 50 } };
  }
  // Mesh: the first gear is the hub; the 13 meshes on its left, the 365 below it.
  const [hub, left, below] = p.gears;
  const rh = meshRadius(hub.teeth), rl = meshRadius(left.teeth), rb = meshRadius(below.teeth);
  const placed: Placed[] = [
    { g: hub, cx: 0, cy: 0, r: rh, toothH: 8, dir: 1, half: false, read: 180 },
    { g: left, cx: -(rh + rl), cy: 0, r: rl, toothH: 8, dir: -1, half: true, read: 0 },
    { g: below, cx: 0, cy: rh + rb, r: rb, toothH: 8, dir: -1, half: true, read: -90 },
  ];
  // The hub reads at its left mesh; its tooth at the bottom mesh is then 5 teeth on (90° of 20 teeth),
  // which is a whole tooth, so the year gear's gap meets a hub tooth there too.
  const lines: [number, number, number, number][] = [
    [-rh - 26, 0, -rh + 26, 0],
    [0, rh - 26, 0, rh + 26],
  ];
  const x0 = -(rh + 2 * rl) - 12;
  return { placed, lines, box: { x0, y0: -rh - 14, w: rh + 150 - x0, h: 2 * rh + 110 } };
}

export function GearTrain({ initial = 'round' }: { initial?: string }) {
  const [presetKey, setPresetKey] = useState(initial);
  const preset = GEAR_PRESETS.find((p) => p.key === presetKey) ?? GEAR_PRESETS[0];
  const { gears } = preset;
  const L = gears.reduce((a, g) => lcm(a, g.teeth), 1);
  const { placed, lines, box } = layout(preset);

  // Days counted, and each gear's turn in teeth. A turn moves by (step mod teeth), so a jump of
  // thousands of days turns each gear the short way instead of spinning it.
  const zero = (p: Preset) => ({ k: 0, turns: p.gears.map(() => 0) });
  const [state, setState] = useState(() => zero(preset));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const choose = (p: Preset) => { setPresetKey(p.key); setState(zero(p)); setPlaying(false); };

  const advance = (d: number) => setState((s) => ({ k: s.k + d, turns: s.turns.map((t, i) => t + (d % gears[i].teeth)) }));

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => advance(speed), 200);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, speed, presetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (x: number) => x.toLocaleString('en-GB');
  const sinceMeet = state.k % L;
  const btn = 'px-3 py-1.5 rounded-full border border-border-medium text-sm text-primary hover:bg-warm transition-colors';
  const btnOn = 'px-3 py-1.5 rounded-full border border-stone-900 bg-stone-900 text-sm text-white';

  return (
    <figure className="not-prose my-10">
      <div className="rounded-lg border border-border-light bg-white/70 p-5 md:p-6">
        <p className="font-serif text-lg text-primary mb-4">The counts as gears</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {GEAR_PRESETS.map((p) => <button key={p.key} className={p.key === presetKey ? btnOn : btn} onClick={() => choose(p)}>{p.title}</button>)}
        </div>
        <svg viewBox={`${box.x0} ${box.y0} ${box.w} ${box.h}`} className="w-full h-auto max-h-[440px]" role="img"
          aria-label={`${preset.title}: gears of ${gears.map((g) => g.teeth).join(', ')} teeth`}>
          {placed.map((q, i) => {
            const rot = q.read - q.dir * (q.g.start + state.turns[i]) * (360 / q.g.teeth);
            return (
              <g key={`${presetKey}-${i}`} transform={`translate(${q.cx} ${q.cy})`}>
                <g style={{ transition: 'transform 180ms linear', transform: `rotate(${rot}deg)` }}>
                  <GearBody g={q.g} r={q.r} toothH={q.toothH} dir={q.dir} half={q.half} />
                </g>
                {preset.layout === 'row' && (
                  <text y={q.r + 18} textAnchor="middle" fontSize={11} fill="var(--color-muted)" fontFamily={FONT}>{q.g.name}</text>
                )}
              </g>
            );
          })}
          {lines.map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-accent-gold-dark)" strokeWidth={1.4} strokeDasharray="3 2" />
          ))}
        </svg>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mt-4">
          {gears.map((g, i) => (
            <div key={g.teeth} className="contents">
              <dt className="text-muted">{g.name} · {g.teeth} teeth</dt>
              <dd className="text-primary">{g.read(mod(g.start + state.turns[i], g.teeth))}</dd>
            </div>
          ))}
          <dt className="text-muted">Days turned</dt><dd className="font-mono text-primary">{fmt(state.k)}</dd>
          <dt className="text-muted">Gold marks together</dt>
          <dd className="text-primary">every {fmt(L)} days{sinceMeet === 0 ? (state.k ? ': together now' : ': together now, at the start') : `; next in ${fmt(L - sinceMeet)}`}</dd>
        </dl>

        <div className="flex flex-wrap gap-2 mt-4">
          <button className={playing ? btnOn : btn} onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
          {[1, 5, 20, 73].map((s) => <button key={s} className={speed === s ? btnOn : btn} onClick={() => setSpeed(s)}>{s} day{s > 1 ? 's' : ''} a step</button>)}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button className={btn} onClick={() => advance(1)}>+1 day</button>
          {gears.map((g) => <button key={g.teeth} className={btn} onClick={() => advance(g.teeth)}>+{fmt(g.teeth)}</button>)}
          <button className={btn} onClick={() => advance(L - sinceMeet)}>Turn to the next meeting</button>
          <button className={btn} onClick={() => { setState(zero(preset)); setPlaying(false); }}>Reset</button>
        </div>
      </div>
      <figcaption className="text-sm text-muted mt-2 leading-relaxed">{preset.note}</figcaption>
    </figure>
  );
}
