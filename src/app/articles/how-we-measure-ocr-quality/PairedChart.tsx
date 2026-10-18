'use client';

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Link from 'next/link';
import { PAGES } from './paired-pages';

// The worked example as a picture: each dot is one sealed page (one book), placed by the production
// engine's character error rate (x) and PaddleOCR-VL's (y) against the same reference window. The four
// buttons read the same 69 dots the way the preregistered rules do. Counts are computed from the data
// in paired-pages.ts and match decisions/cost-lane-chinese-2026-09-18.json. Tap, hover or use the arrow
// keys on the chart to read one page and open it in the reader.

const GOLD = '#a97b22';
const BLUE = '#3b63c4';
const GREY = '#c4bfb9';
const INK = '#44403c';
const RULE = '#e7e5e4';
const TINT = '#f6efe1';

type Mode = 'all' | 'wins' | 'catastrophic' | 'bar';

const W = 360;
const M = { l: 46, r: 12, t: 12, b: 42 };
const S = W - M.l - M.r; // square plot
const H = M.t + S + M.b;
const x = (v: number) => M.l + v * S;
const y = (v: number) => M.t + (1 - v) * S;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function PairedChart({ source }: { source: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('all');
  const [active, setActive] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const stats = useMemo(() => {
    const d = PAGES.map(([, , prod, paddle]) => r3(paddle - prod));
    const sorted = [...d].sort((a, b) => a - b);
    const n = d.length;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return {
      n,
      d,
      wins: d.filter((v) => v < 0).length,
      losses: d.filter((v) => v > 0).length,
      ties: d.filter((v) => v === 0).length,
      median,
      bar: d.filter((v) => v <= -0.05).length,
      catProd: PAGES.filter((p) => p[2] > 0.5).length,
      catPaddle: PAGES.filter((p) => p[3] > 0.5).length,
    };
  }, []);

  const colourOf = (i: number): { fill: string; hollow?: boolean } => {
    const [, , prod, paddle] = PAGES[i];
    const d = stats.d[i];
    if (mode === 'wins') return d < 0 ? { fill: GOLD } : d > 0 ? { fill: BLUE } : { fill: INK, hollow: true };
    if (mode === 'catastrophic') return prod > 0.5 || paddle > 0.5 ? { fill: GOLD } : { fill: GREY };
    if (mode === 'bar') return d <= -0.05 ? { fill: GOLD } : { fill: GREY };
    return { fill: GOLD };
  };

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = -1;
    let bestD = 22 * 22;
    PAGES.forEach(([, , prod, paddle], i) => {
      const dd = (x(prod) - pt.x) ** 2 + (y(paddle) - pt.y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    if (best >= 0) setActive(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    setActive((a) => (a + step + PAGES.length) % PAGES.length);
  };

  const [book, page, prod, paddle, title] = PAGES[active];
  const d = stats.d[active];
  const diff =
    d === 0
      ? 'a tie'
      : `${Math.abs(d * 100).toFixed(1)} points ${d < 0 ? 'in Paddle’s favour' : 'in production’s favour'}`;

  const MODES: { id: Mode; label: string }[] = [
    { id: 'all', label: 'Every page' },
    { id: 'wins', label: 'Wins and losses' },
    { id: 'catastrophic', label: 'Catastrophic pages' },
    { id: 'bar', label: '5-point bar' },
  ];

  const note: Record<Mode, React.ReactNode> = {
    all: (
      <>
        Each dot is one book: its sealed page, read by both engines and scored against the same reference window. Dots under the diagonal are pages where PaddleOCR-VL came closer to the reference than production did.
      </>
    ),
    wins: (
      <>
        The paired test: Paddle wins <strong className="text-primary">{stats.wins}</strong> pages <Swatch c={GOLD} />, loses{' '}
        <strong className="text-primary">{stats.losses}</strong> <Swatch c={BLUE} />, ties <strong className="text-primary">{stats.ties}</strong>{' '}
        <Swatch c={INK} hollow />. The median paired difference is {Math.abs(stats.median * 100).toFixed(1)} points in Paddle&rsquo;s favour.
      </>
    ),
    catastrophic: (
      <>
        Error above 50 percent: <strong className="text-primary">{stats.catProd}</strong> pages for production, right of the line, and{' '}
        <strong className="text-primary">{stats.catPaddle}</strong> for Paddle, above it. The cost lane allows Paddle no more than one extra.
      </>
    ),
    bar: (
      <>
        The better-reader bar: Paddle at least 5 points better on <strong className="text-primary">{stats.bar}</strong> of {stats.n} pages,{' '}
        {Math.round((100 * stats.bar) / stats.n)} percent, under the dashed line. The rule asks for 60 percent, so Paddle passes as a cost lane and fails as the better reader.
      </>
    ),
  };

  return (
    <div className="not-prose border border-border-light bg-white p-4 md:p-6 font-sans">
      <p className="text-sm text-primary mb-1">Siku manuscript, {stats.n} referenced pages: production against PaddleOCR-VL, page by page</p>
      <p className="text-xs text-muted mb-4">Pick a reading of the chart. Tap, hover or use the arrow keys on the chart to read one page.</p>

      <div role="group" aria-label="Reading of the chart" className="flex flex-wrap gap-2 mb-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`min-h-[40px] px-3 py-1.5 text-sm rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
              mode === m.id ? 'bg-stone-800 border-stone-800 text-white' : 'bg-white border-stone-300 text-primary hover:border-stone-500'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-secondary leading-relaxed min-h-[4.5rem] mb-3" aria-live="polite">
        {note[mode]}
      </p>

      <div className="max-w-[460px] mx-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-accent-gold rounded"
          tabIndex={0}
          role="group"
          aria-label={`Scatter of ${stats.n} pages. Arrow keys step through the pages; the page under the chart is read out.`}
          onKeyDown={onKey}
          onPointerMove={(e) => e.pointerType === 'mouse' && pick(e)}
          onPointerDown={pick}
        >
          {/* zones */}
          {mode === 'catastrophic' && (
            <>
              <rect x={x(0.5)} y={M.t} width={S / 2} height={S} fill={TINT} />
              <rect x={M.l} y={M.t} width={S} height={S / 2} fill="#eef2fb" opacity={0.6} />
            </>
          )}
          {mode === 'bar' && <polygon points={`${x(0.05)},${y(0)} ${x(1)},${y(0)} ${x(1)},${y(0.95)}`} fill={TINT} />}

          {/* grid */}
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.t} y2={M.t + S} stroke={RULE} />
              <line x1={M.l} x2={M.l + S} y1={y(t)} y2={y(t)} stroke={RULE} />
              <text x={x(t)} y={M.t + S + 15} fontSize={11} fill="#78716c" textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}>
                {t * 100}%
              </text>
              <text x={M.l - 6} y={y(t) + 4} fontSize={11} fill="#78716c" textAnchor="end">
                {t * 100}%
              </text>
            </g>
          ))}
          <text x={M.l + S / 2} y={H - 6} fontSize={12} fill={INK} textAnchor="middle">
            Production engine: character error rate
          </text>
          <text transform={`translate(12 ${M.t + S / 2}) rotate(-90)`} fontSize={12} fill={INK} textAnchor="middle">
            PaddleOCR-VL: character error rate
          </text>

          {/* rule lines */}
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={INK} strokeWidth={1.25} />
          {(mode === 'all' || mode === 'wins') && (
            <text x={x(0.75)} y={y(0.75) - 7} fontSize={11} fill={INK} transform={`rotate(-45 ${x(0.75)} ${y(0.75) - 7})`} textAnchor="middle">
              same error for both
            </text>
          )}
          {mode === 'bar' && (
            <>
              <line x1={x(0.05)} y1={y(0)} x2={x(1)} y2={y(0.95)} stroke={INK} strokeWidth={1.25} strokeDasharray="4 3" />
              <text x={x(0.8)} y={y(0.75) + 12} fontSize={11} fill={INK} transform={`rotate(-45 ${x(0.8)} ${y(0.75) + 12})`} textAnchor="middle">
                5 points better
              </text>
            </>
          )}
          {mode === 'catastrophic' && (
            <>
              <line x1={x(0.5)} x2={x(0.5)} y1={M.t} y2={M.t + S} stroke={INK} strokeDasharray="4 3" />
              <line x1={M.l} x2={M.l + S} y1={y(0.5)} y2={y(0.5)} stroke={INK} strokeDasharray="4 3" />
              <text x={x(0.52)} y={y(0.03)} fontSize={11} fill={INK}>
                production above 50%
              </text>
              <text x={x(0.02)} y={y(0.53)} fontSize={11} fill={INK}>
                Paddle above 50%
              </text>
            </>
          )}

          {/* dots: grey ones first so the highlighted set sits on top */}
          {PAGES.map((p, i) => ({ p, i, c: colourOf(i) }))
            .sort((a, b) => (a.c.fill === GREY ? 0 : 1) - (b.c.fill === GREY ? 0 : 1))
            .map(({ p, c }) => (
              <circle
                key={p[5]}
                cx={x(p[2])}
                cy={y(p[3])}
                r={4.5}
                fill={c.hollow ? 'white' : c.fill}
                stroke={c.hollow ? c.fill : 'white'}
                strokeWidth={c.hollow ? 2 : 1.5}
              />
            ))}
          <circle cx={x(prod)} cy={y(paddle)} r={9} fill="none" stroke={INK} strokeWidth={2} pointerEvents="none" />
        </svg>
      </div>

      <div className="mt-3 min-h-[4.5rem] text-sm text-secondary leading-relaxed" aria-live="polite">
        <p>
          <span className="text-primary">{title}</span>, p. {page}: production {pct(prod)}, Paddle {pct(paddle)}, {diff}.
        </p>
        <p className="mt-1">
          <Link href={`/book/${book}?page=${page}`}>Open this page in the reader</Link>
        </p>
      </div>
      <p className="mt-3 text-xs text-muted leading-relaxed">{source}</p>
    </div>
  );
}

function Swatch({ c, hollow }: { c: string; hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-2.5 h-2.5 rounded-full align-middle mx-0.5"
      style={hollow ? { border: `2px solid ${c}` } : { background: c }}
    />
  );
}
