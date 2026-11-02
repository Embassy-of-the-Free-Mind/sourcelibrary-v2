// Server-rendered SVG charts for /articles/how-many-translated-into-english.
// Data and arithmetic: scripts/eval/experiments/2026-11-02-english-translations-ever-estimate.md.
// Palette reused from /articles/how-much-in-english (validated there with the
// dataviz skill's validate_palette.js): amber = Source Library, blue = elsewhere.
const SL = '#b45309';
const ELSEWHERE = '#1d6fb8';
const INK = 'currentColor';

type Range = { label: string; low: number; high: number; ours?: number; note?: string };

const fmt = (n: number) => n.toLocaleString('en-GB');

// Horizontal range bars on one linear axis, with an optional amber tick per row.
function RangeBars({ title, rows, max, labelWidth = 120, showOurs }: {
  title: string; rows: Range[]; max: number; labelWidth?: number; showOurs?: boolean;
}) {
  const row = 36, top = 8, width = 440, plot = width - labelWidth - 16;
  const h = top + rows.length * row + 22;
  const x = (v: number) => labelWidth + (v / max) * plot;
  const ticks = [0, max / 2, max];
  return (
    <figure className="m-0 max-w-xl">
      <figcaption className="font-body text-sm text-stone-700 font-medium mb-2">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${h}`} className="w-full h-auto text-stone-600" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={h - 18} stroke="currentColor" strokeOpacity={0.15} />
            <text x={x(t)} y={h - 5} textAnchor={t === 0 ? 'start' : t === max ? 'end' : 'middle'} fontSize="10" fill={INK} className="font-body">{fmt(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * row;
          const w = Math.max(3, x(r.high) - x(r.low));
          const tip = `${r.label}: ${r.low === r.high ? fmt(r.low) : `${fmt(r.low)} to ${fmt(r.high)}`}${r.note ? ` (${r.note})` : ''}${showOurs && r.ours != null ? `; readable on Source Library: ${fmt(r.ours)}` : ''}`;
          return (
            <g key={r.label}>
              <title>{tip}</title>
              <rect x={0} y={y} width={width} height={row} fill="transparent" />
              <text x={labelWidth - 8} y={y + 15} textAnchor="end" fontSize="12" fill={INK} className="font-body">{r.label}</text>
              <rect x={x(r.low)} y={y + 6} width={w} height={12} rx={3} fill={ELSEWHERE} />
              {showOurs && r.ours != null && (
                <rect x={x(r.ours) - 1.5} y={y + 2} width={3} height={20} rx={1.5} fill={SL} />
              )}
              <text x={labelWidth} y={y + 32} fontSize="11" fill={INK} className="font-body" opacity={0.75}>
                {r.low === r.high ? fmt(r.low) : `${fmt(r.low)} to ${fmt(r.high)}`}{showOurs && r.ours != null ? ` · here ${fmt(r.ours)}` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// Works first printed 1400-1700 that have ever been published in English.
const BY_LANGUAGE: Range[] = [
  { label: 'Latin', low: 21400, high: 46000, ours: 5234, note: 'of 306,352 works' },
  { label: 'French', low: 1600, high: 10800, ours: 204, note: 'of 124,168 works' },
  { label: 'Dutch', low: 500, high: 5700, ours: 221, note: 'of 74,378 works' },
  { label: 'Spanish', low: 1000, high: 4500, ours: 29, note: 'of 59,582 works' },
  { label: 'Italian', low: 1200, high: 3400, ours: 193, note: 'of 68,819 works' },
  { label: 'German', low: 700, high: 2900, ours: 652, note: 'of 221,931 works' },
];

export function ByLanguageChart() {
  return (
    <div className="my-8">
      <RangeBars title="Works printed 1400 to 1700 that have ever been published in English" rows={BY_LANGUAGE} max={50000} showOurs />
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-body text-sm text-stone-600 mt-2">
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: ELSEWHERE }} />estimated range, translated anywhere</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block w-[3px] h-3.5 rounded-sm" style={{ background: SL }} />readable in English on Source Library</span>
      </div>
      <p className="font-body text-sm text-stone-500 mt-3">
        Share of a random sample that has an English translation, times the number of works in the
        Universal Short Title Catalogue grouped into works. Latin: 1,000 works searched (2026).
        Other languages: about 300 works each (October 2026), so their ranges are wide.
      </p>
    </div>
  );
}

// Three instruments on Latin.
const INSTRUMENTS: Range[] = [
  { label: 'In the catalogues', low: 576, high: 576, note: 'works with an English record in LoC, Open Library or Wikidata' },
  { label: 'Catalogues, recounted', low: 790, high: 1890, note: 'capture–recapture across the three lists' },
  { label: 'Random sample', low: 21400, high: 46000, note: 'works searched one by one' },
];

export function InstrumentsChart() {
  return (
    <div className="my-8">
      <RangeBars title="Latin works printed 1400 to 1700 in English: three ways of counting" rows={INSTRUMENTS} max={50000} labelWidth={136} />
      <p className="font-body text-sm text-stone-500 mt-3">
        The catalogue lists and the sample count the same 306,352 works. The lists can only find
        what libraries have recorded as a translation from Latin, and the three of them miss the
        same things, so even the recount stays small.
      </p>
    </div>
  );
}
