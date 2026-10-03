import type { CSSProperties, ReactNode } from 'react';

// Static (server-rendered) diagrams for /research/canon-gap. No client JS: exact values
// ride on `title` tooltips and on the per-canon rows further down the page, which act as
// the table view. Chart colours were run through the dataviz validator (light surface):
// ENGLISH #0b9488 / NO_ENGLISH #c2610c pass every check; "unknown" is deliberately a
// neutral hatch, because it is an absence of data, not a third category.
export const ENGLISH = '#0b9488';
export const NO_ENGLISH = '#c2610c';
const HATCH: CSSProperties = {
  backgroundColor: '#e7e5e4',
  backgroundImage: 'repeating-linear-gradient(135deg, #a8a29e 0 1.5px, transparent 1.5px 6px)',
};
const HATCH_AMBER: CSSProperties = {
  backgroundColor: '#fde7d3',
  backgroundImage: `repeating-linear-gradient(135deg, ${NO_ENGLISH} 0 1.5px, transparent 1.5px 6px)`,
};

const fmt = (n: number) => n.toLocaleString('en-US');
export function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${n >= 1e7 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

function Swatch({ style, label }: { style: CSSProperties; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 mr-4">
      <span className="inline-block w-3 h-3 rounded-[2px]" style={style} />
      {label}
    </span>
  );
}

function Figure({ n, title, caption, children }: { n: number; title: string; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="my-8">
      <div className="font-body text-xs tracking-wider uppercase text-stone-500 mb-1">Figure {n}</div>
      <div className="font-serif text-xl text-stone-900 mb-4">{title}</div>
      {children}
      <figcaption className="font-body text-sm text-stone-500 mt-3 leading-snug">{caption}</figcaption>
    </figure>
  );
}

/* ---------- Figure 1: the two routes from a canon to English ---------- */

function Step({ label, sub, skipped, tone }: { label: string; sub?: string; skipped?: boolean; tone?: 'source' | 'review' }) {
  const base = 'rounded-sm px-3 py-2 font-body text-sm leading-tight min-w-0';
  const cls = skipped
    ? `${base} border border-dashed border-stone-300 text-stone-400 bg-transparent`
    : tone === 'review'
      ? `${base} bg-stone-800 text-white`
      : tone === 'source'
        ? `${base} bg-white border border-stone-300 text-stone-900`
        : `${base} bg-amber-50 border border-amber-300 text-stone-900`;
  return (
    <div className={cls}>
      <div className={skipped ? 'line-through' : 'font-semibold'}>{label}</div>
      {sub && <div className={`text-xs mt-0.5 ${skipped ? '' : tone === 'review' ? 'text-stone-300' : 'text-stone-500'}`}>{sub}</div>}
    </div>
  );
}

const Arrow = () => (
  <div aria-hidden className="text-stone-400 text-center md:self-center leading-none max-md:rotate-90 max-md:my-0.5">→</div>
);

export function RoutesDiagram() {
  return (
    <Figure
      n={1}
      title="Two routes from a canon to English"
      caption="Where a canon exists only as page images, a model must read every page and the reading must be checked before any English can be drafted. Where it is already typed and openly licensed, those two steps fall away; an open scan of the same edition keeps every page checkable. Scholarly review is the same on both routes, and it is the expensive step."
    >
      <div className="space-y-5">
        {[
          {
            name: 'Scanned only',
            steps: [
              <Step key="a" tone="source" label="Page images" sub="scans of a printed or manuscript edition" />,
              <Step key="b" label="AI reading (OCR)" sub="every page, every script" />,
              <Step key="c" label="Check the reading" sub="second reads, by-eye samples" />,
              <Step key="d" label="Draft English" sub="cents per page" />,
              <Step key="e" tone="review" label="Scholarly review" sub="where the money should go" />,
            ],
          },
          {
            name: 'Typed and open',
            steps: [
              <Step key="a" tone="source" label="Open typed text + open scan" sub="e.g. Esukhia text, BDRC images" />,
              <Step key="b" skipped label="AI reading (OCR)" sub="already done by the typists" />,
              <Step key="c" skipped label="Check the reading" sub="page image stays beside the text" />,
              <Step key="d" label="Draft English" sub="cents per page" />,
              <Step key="e" tone="review" label="Scholarly review" sub="where the money should go" />,
            ],
          },
        ].map((lane) => (
          <div key={lane.name}>
            <div className="font-body text-xs uppercase tracking-wider text-amber-700 font-semibold mb-2">{lane.name}</div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] gap-1 md:gap-2">
              {lane.steps.flatMap((s, i) => (i === 0 ? [s] : [<Arrow key={`ar${i}`} />, s]))}
            </div>
          </div>
        ))}
      </div>
    </Figure>
  );
}

/* ---------- Figure 2: size and English coverage, and draft cost, per canon ---------- */

export type CanonBar = {
  id: string;
  name: string;
  chars: number;
  english: number | null; // fraction with published English, null = unknown
  usd: number;
  upper: boolean; // cost prices the whole corpus because English coverage is unknown
};

export function CanonBars({ rows }: { rows: CanonBar[] }) {
  const maxChars = Math.max(...rows.map((r) => r.chars));
  const maxUsd = Math.max(...rows.map((r) => r.usd));
  const pct = (v: number, max: number) => `max(${((v / max) * 100).toFixed(2)}%, 3px)`;
  return (
    <Figure
      n={2}
      title="How big each canon is, how much has English, and what a draft costs"
      caption={
        <>
          Bars are to scale across canons. Left: characters of typed source text, split by the share a catalogue
          reports as published in English (84000, SuttaCentral, Sefaria). Right: the cost of a first AI draft of what
          has no English, at the rate we measure on our own translation runs. Hatched cost bars price the whole corpus
          because nobody publishes its English coverage, so they are upper bounds. Hover a bar for exact figures.
        </>
      }
    >
      <div className="font-body text-xs text-stone-600 mb-3 flex flex-wrap gap-y-1">
        <Swatch style={{ backgroundColor: ENGLISH }} label="has published English" />
        <Swatch style={{ backgroundColor: NO_ENGLISH }} label="no English" />
        <Swatch style={HATCH} label="English share unknown" />
      </div>
      <div className="hidden md:grid grid-cols-[11rem_minmax(0,3fr)_minmax(0,1fr)] gap-x-4 font-body text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-300 pb-1.5 mb-1">
        <div />
        <div>Typed source text (characters)</div>
        <div>Draft English ($)</div>
      </div>
      <div>
        {rows.map((r) => {
          const tip = `${r.name}: ${fmt(r.chars)} characters; ${
            r.english == null ? 'English share unknown' : `${(r.english * 100).toFixed(1)}% has published English`
          }; draft $${fmt(r.usd)}${r.upper ? ' (upper bound)' : ''}`;
          return (
            <div
              key={r.id}
              title={tip}
              className="grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)] md:grid-cols-[11rem_minmax(0,3fr)_minmax(0,1fr)] gap-x-4 items-center py-1.5 border-b border-stone-100"
            >
              <div className="col-span-2 md:col-span-1 font-body text-sm text-stone-800 leading-tight">{r.name}</div>
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-4 gap-[2px]" style={{ width: pct(r.chars, maxChars) }}>
                  {r.english == null ? (
                    <div className="h-full w-full rounded-r" style={HATCH} />
                  ) : (
                    <>
                      {r.english > 0 && <div className="h-full" style={{ width: `${r.english * 100}%`, backgroundColor: ENGLISH }} />}
                      <div className="h-full rounded-r flex-1" style={{ backgroundColor: NO_ENGLISH }} />
                    </>
                  )}
                </div>
                <span className="font-body text-xs text-stone-600 whitespace-nowrap">
                  {short(r.chars)}
                  {r.english != null && <span className="text-stone-400"> · {Math.round(r.english * 100)}% Eng.</span>}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-4 rounded-r" style={{ width: pct(r.usd, maxUsd), ...(r.upper ? HATCH_AMBER : { backgroundColor: NO_ENGLISH }) }} />
                <span className="font-body text-xs text-stone-700 whitespace-nowrap">${fmt(r.usd)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Figure>
  );
}

/* ---------- Figure 3: the Tengyur, volume by volume ---------- */

export function TengyurProgress({
  volumes,
  pilotVolumes,
  pagesImaged,
  pagesWithText,
  pilotPages,
  pilotUsd,
  fullUsd,
}: {
  volumes: number;
  pilotVolumes: number;
  pagesImaged: number;
  pagesWithText: number;
  pilotPages: number;
  pilotUsd: number;
  fullUsd: number;
}) {
  const stages = [
    { n: fmt(pagesImaged), label: 'page images imported from BDRC (W23703)' },
    { n: fmt(pagesWithText), label: 'pages carrying the Esukhia public-domain text, aligned folio by folio' },
    { n: fmt(pilotPages), label: `pages drafted in English in the ${pilotVolumes}-volume pilot, for $${pilotUsd.toFixed(2)}` },
    { n: `≈ $${fmt(fullUsd)}`, label: 'to draft all 213 volumes at the pilot’s measured cost per page' },
  ];
  return (
    <Figure
      n={3}
      title="The Derge Tengyur, volume by volume"
      caption={`Each square is one of the ${volumes} volumes we imported. All are held from public view until their English has been checked; the ${pilotVolumes} teal squares are the pilot volumes, one from each major section, whose first pages were drafted to measure real cost and quality before the full run.`}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-[3px] max-w-xl" role="img" aria-label={`${volumes} volumes, ${pilotVolumes} in the translation pilot`}>
        {Array.from({ length: volumes }, (_, i) => (
          <div
            key={i}
            className="aspect-square rounded-[2px]"
            style={{ backgroundColor: i < pilotVolumes ? ENGLISH : '#d6d3d1' }}
            title={i < pilotVolumes ? 'pilot volume: first pages drafted in English' : 'imported, text aligned, awaiting translation'}
          />
        ))}
      </div>
      <div className="font-body text-xs text-stone-600 mt-3">
        <Swatch style={{ backgroundColor: ENGLISH }} label="translation pilot" />
        <Swatch style={{ backgroundColor: '#d6d3d1' }} label="imported and aligned, not yet translated" />
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-px bg-stone-200 border border-stone-200 rounded-sm mt-6">
        {stages.map((s, i) => (
          <li key={i} className="bg-stone-50 px-4 py-4">
            <div className="font-body text-[11px] uppercase tracking-wider text-stone-400">Step {i + 1}</div>
            <div className="font-serif text-2xl text-stone-900 mt-1">{s.n}</div>
            <div className="font-body text-sm text-stone-600 leading-snug mt-1">{s.label}</div>
          </li>
        ))}
      </ol>
    </Figure>
  );
}

/* ---------- Figure 4: where each canon stands ---------- */

const STATUS_ORDER = ['done', 'running', 'next', 'blocked'] as const;
export const STATUS_STYLE: Record<(typeof STATUS_ORDER)[number], { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'bg-stone-800 text-white' },
  running: { label: 'Under way', cls: 'bg-amber-700 text-white' },
  next: { label: 'Next', cls: 'bg-amber-100 text-amber-900 border border-amber-300' },
  blocked: { label: 'Blocked', cls: 'bg-stone-100 text-stone-600 border border-stone-300' },
};

export function StatusBoard({ items }: { items: { id: string; name: string; status: string }[] }) {
  // An empty "Done" column reads as a hole; it appears once the first canon is done.
  const shown = STATUS_ORDER.filter((s) => s !== 'done' || items.some((i) => i.status === 'done'));
  return (
    <Figure
      n={4}
      title="Where each canon stands"
      caption="“Blocked” means the open text’s licence does not let us publish it, or no open typed text exists. Each canon’s next step and its public work log are in the rows below."
    >
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${shown.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {shown.map((s) => {
          const list = items.filter((i) => i.status === s);
          return (
            <div key={s} className="border border-stone-200 rounded-sm bg-white">
              <div className={`px-3 py-2 font-body text-xs uppercase tracking-wider flex justify-between ${STATUS_STYLE[s].cls}`}>
                <span>{STATUS_STYLE[s].label}</span>
                <span>{list.length}</span>
              </div>
              <ul className="px-3 py-2 font-body text-sm text-stone-700 space-y-1">
                {list.map((i) => (
                  <li key={i.id}>
                    <a href={`#${i.id}`} className="hover:underline underline-offset-2">
                      {i.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Figure>
  );
}
