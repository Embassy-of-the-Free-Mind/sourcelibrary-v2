// Server-rendered SVG charts for /articles/how-much-in-english. Data: the
// October 2026 work-level census (scripts/translation-layer/11-work-graph.mjs,
// #7751). Palette validated with the dataviz skill's validate_palette.js
// (light surface): amber = Source Library, blue = elsewhere.
const SL = '#b45309';
const ELSEWHERE = '#1d6fb8';
const INK = 'currentColor';

type Bar = { label: string; value: number; note?: string };

// Horizontal bars, one series, values labelled at the bar end.
function HBars({ title, bars, max, unit = '%', color, labelWidth = 92 }: {
  title: string; bars: Bar[]; max: number; unit?: string; color: string; labelWidth?: number;
}) {
  const row = 26, top = 8, width = 320, plot = width - labelWidth - 56;
  const h = top + bars.length * row + 4;
  return (
    <figure className="m-0">
      <figcaption className="font-body text-sm text-stone-700 font-medium mb-2">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${h}`} className="w-full h-auto text-stone-600" role="img" aria-label={title}>
        {bars.map((b, i) => {
          const y = top + i * row;
          const w = Math.max(2, (b.value / max) * plot);
          return (
            <g key={b.label}>
              <text x={labelWidth - 8} y={y + 13} textAnchor="end" fontSize="11" fill={INK} className="font-body">{b.label}</text>
              <rect x={labelWidth} y={y + 3} width={w} height={14} rx={3} fill={color}>
                <title>{`${b.label}: ${b.value}${unit}${b.note ? ` (${b.note})` : ''}`}</title>
              </rect>
              <text x={labelWidth + w + 5} y={y + 14} fontSize="11" fill={INK} className="font-body">{`${b.value}${unit}`}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

const BINS = ['1', '2 to 5', '6 to 20', '21 to 100', '101+'];
// Latin, USTC editions printed 1400-1700 grouped into works.
const LATIN_WORKS_PCT = [79.8, 17.5, 2.2, 0.4, 0.02];
const LATIN_EDITIONS_PCT = [49.0, 27.3, 13.0, 8.0, 2.8];
const LATIN_WORKS_N = [244590, 53739, 6839, 1108, 76];
const LATIN_EDITIONS_N = [244590, 136210, 64906, 39863, 14035];

export function EditionsPerWorkChart() {
  return (
    <div className="my-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <HBars
          title="Share of Latin works, by number of editions"
          color={SL}
          max={80}
          bars={BINS.map((b, i) => ({ label: `${b} ed.`, value: LATIN_WORKS_PCT[i], note: `${LATIN_WORKS_N[i].toLocaleString('en-US')} works` }))}
        />
        <HBars
          title="Share of Latin editions, by the same groups"
          color={SL}
          max={80}
          bars={BINS.map((b, i) => ({ label: `${b} ed.`, value: LATIN_EDITIONS_PCT[i], note: `${LATIN_EDITIONS_N[i].toLocaleString('en-US')} editions` }))}
        />
      </div>
      <p className="font-body text-sm text-stone-500 mt-3">
        Latin printed 1400 to 1700: 499,604 editions grouped into 306,352 works. Four works in five
        were printed once, but those single printings are only half of all editions; the 1,184
        works printed more than twenty times account for one edition in nine.
      </p>
    </div>
  );
}

const LANGS = [
  { l: 'Latin', works: 306352, held: 49458, readable: 5243 },
  { l: 'German', works: 221931, held: 22745, readable: 651 },
  { l: 'English', works: 93554, held: 18542, readable: null },
  { l: 'French', works: 124168, held: 1521, readable: 202 },
  { l: 'Italian', works: 68819, held: 861, readable: 193 },
  { l: 'Dutch', works: 74378, held: 339, readable: 223 },
  { l: 'Spanish', works: 59582, held: 176, readable: 28 },
];
const pct = (a: number, b: number) => Math.round((1000 * a) / b) / 10;
const pct2 = (a: number, b: number) => Math.round((10000 * a) / b) / 100;

export function LanguageCoverageChart() {
  return (
    <div className="my-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <HBars
          title="Works held on Source Library, share of each language"
          color={SL}
          max={22}
          bars={LANGS.map((d) => ({ label: d.l, value: pct(d.held, d.works), note: `${d.held.toLocaleString('en-US')} of ${d.works.toLocaleString('en-US')} works` }))}
        />
        <HBars
          title="Works readable here in English, share of each language"
          color={SL}
          max={2}
          bars={LANGS.filter((d) => d.readable != null).map((d) => ({ label: d.l, value: pct2(d.readable as number, d.works), note: `${(d.readable as number).toLocaleString('en-US')} works` }))}
        />
      </div>
      <p className="font-body text-sm text-stone-500 mt-3">
        Each chart has its own scale: the right-hand one runs to 2%. Works printed 1400 to 1700,
        October 2026. English books need no translation, so English appears only on the left.
      </p>
    </div>
  );
}

const CENTURIES = [
  { c: '1400s', works: 7860, sl: 486, ext: 495 },
  { c: '1500s', works: 84232, sl: 1941, ext: 1816 },
  { c: '1600s', works: 214260, sl: 2816, ext: 1938 },
];

export function LatinCenturyChart() {
  const width = 320, labelWidth = 48, plot = width - labelWidth - 44, max = 7, group = 46, top = 4;
  const h = top + CENTURIES.length * group;
  const bar = (v: number) => Math.max(2, (v / max) * plot);
  return (
    <figure className="my-8 m-0">
      <figcaption className="font-body text-sm text-stone-700 font-medium mb-2">
        Latin works by century of first printing: share readable here, and share with a catalogued
        English translation elsewhere
      </figcaption>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-body text-xs text-stone-600 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SL }} />Readable on Source Library</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: ELSEWHERE }} />Catalogued English translation elsewhere</span>
      </div>
      <svg viewBox={`0 0 ${width} ${h}`} className="w-full sm:max-w-sm h-auto text-stone-600" role="img"
        aria-label="Latin works by century: share readable on Source Library and share with a catalogued English translation elsewhere">
        {CENTURIES.map((d, i) => {
          const y = top + i * group;
          const a = pct(d.sl, d.works), b = pct(d.ext, d.works);
          return (
            <g key={d.c} fontSize="11" className="font-body">
              <text x={labelWidth - 8} y={y + 22} textAnchor="end" fill={INK}>{d.c}</text>
              <rect x={labelWidth} y={y + 4} width={bar(a)} height={14} rx={3} fill={SL}>
                <title>{`${d.c}: ${d.sl.toLocaleString('en-US')} of ${d.works.toLocaleString('en-US')} works readable on Source Library (${a}%)`}</title>
              </rect>
              <text x={labelWidth + bar(a) + 5} y={y + 15} fill={INK}>{`${a}%`}</text>
              <rect x={labelWidth} y={y + 20} width={bar(b)} height={14} rx={3} fill={ELSEWHERE}>
                <title>{`${d.c}: ${d.ext.toLocaleString('en-US')} works with a catalogued English translation (${b}%)`}</title>
              </rect>
              <text x={labelWidth + bar(b) + 5} y={y + 31} fill={INK}>{`${b}%`}</text>
            </g>
          );
        })}
      </svg>
      <p className="font-body text-sm text-stone-500 mt-3">
        The blue bars are a floor: the catalogues miss most translations. A sampled search puts the
        true share of Latin works with any English translation at 7% to 15%. October 2026.
      </p>
    </figure>
  );
}
