import type { CSSProperties, ReactNode } from 'react';

// Static (server-rendered) diagrams for /research/canon-gap. No client JS: exact values
// ride on `title` tooltips and on the per-canon rows further down the page, which act as
// the table view. Chart colours were run through the dataviz validator (light surface):
// ENGLISH #0b9488 / NO_ENGLISH #c2610c pass every check; "unknown" is deliberately a
// neutral hatch, because it is an absence of data, not a third category.
export const ENGLISH = '#0b9488';
export const NO_ENGLISH = '#c2610c';
export const HATCH: CSSProperties = {
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

export function Swatch({ style, label }: { style: CSSProperties; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 mr-4">
      <span className="inline-block w-3 h-3 rounded-[2px]" style={style} />
      {label}
    </span>
  );
}

export function Figure({ n, title, caption, children }: { n: number; title: string; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="my-10 rounded-sm border border-stone-200 bg-white px-4 py-6 md:px-8 md:py-8">
      <div className="font-body text-xs tracking-wider uppercase text-stone-400 mb-1">Figure {n}</div>
      <div className="font-serif text-xl text-stone-900 mb-5">{title}</div>
      {children}
      <figcaption className="font-body text-sm text-stone-500 mt-5 pt-4 border-t border-stone-100 leading-snug">{caption}</figcaption>
    </figure>
  );
}

/* ---------- The two routes from a canon to English ---------- */

export function Step({ label, sub, skipped, tone }: { label: string; sub?: string; skipped?: boolean; tone?: 'source' | 'review' | 'planned' }) {
  const base = 'rounded-sm px-3 py-2 font-body text-sm leading-tight min-w-0';
  const cls = skipped
    ? `${base} border border-dashed border-stone-300 text-stone-400 bg-transparent`
    : tone === 'review'
      ? `${base} bg-stone-800 text-white`
      : tone === 'planned'
        ? `${base} border border-dashed border-amber-400 bg-white text-stone-900`
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

export const Arrow = () => (
  <div aria-hidden className="text-stone-400 text-center md:self-center leading-none max-md:rotate-90 max-md:my-0.5">→</div>
);

export function RoutesDiagram({ n }: { n: number }) {
  return (
    <Figure
      n={n}
      title="Two routes from a canon to English"
      caption="A canon that exists only as page images has to be read page by page, and the reading checked, before any English can be drafted. A canon that is already typed and openly licensed skips both steps, and an open scan of the same edition lets every page still be checked against its image. Scholarly review is needed on both routes and costs the most."
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
              <Step key="e" tone="review" label="Scholarly review" sub="the main cost" />,
            ],
          },
          {
            name: 'Typed and open',
            steps: [
              <Step key="a" tone="source" label="Open typed text + open scan" sub="e.g. Esukhia text, BDRC images" />,
              <Step key="b" skipped label="AI reading (OCR)" sub="already done by the typists" />,
              <Step key="c" skipped label="Check the reading" sub="page image stays beside the text" />,
              <Step key="d" label="Draft English" sub="cents per page" />,
              <Step key="e" tone="review" label="Scholarly review" sub="the main cost" />,
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

/* ---------- Size and English coverage, and draft cost, per canon ---------- */

export type CanonBar = {
  id: string;
  name: string;
  chars: number;
  english: number | null; // fraction with published English, null = unknown
  usd: number;
  upper: boolean; // cost prices the whole corpus because English coverage is unknown
};

export function CanonBars({ rows, n }: { rows: CanonBar[]; n: number }) {
  const maxChars = Math.max(...rows.map((r) => r.chars));
  const maxUsd = Math.max(...rows.map((r) => r.usd));
  const pct = (v: number, max: number) => `max(${((v / max) * 100).toFixed(2)}%, 3px)`;
  return (
    <Figure
      n={n}
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
              <a href={`#${r.id}`} className="col-span-2 md:col-span-1 font-body text-sm text-stone-800 leading-tight hover:text-amber-800 hover:underline underline-offset-2">
                {r.name}
              </a>
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

/* ---------- What we hold, tradition by tradition ---------- */

export type TraditionProgressRow = {
  id: string;
  name: string;
  books: number;
  readable_books: number;
  pages_scanned: number;
  pages_transcribed: number;
  pages_translated: number;
  canon_page_equivalents: number;
  /** [model or source, pages], from the page records */
  ocr_engines: [string, number][];
  translation_models: [string, number][];
  /** [id, title, public, pages scanned, transcribed, translated], most-translated first */
  book_pages: [string, string, boolean, number, number, number][];
  /** our shelf for this tradition, when one exists */
  href?: string;
};

// Plain names for the engine ids the page records carry.
const ENGINE_NAMES: [RegExp, string][] = [
  [/^esukhia-derge/, 'Esukhia typed Derge text'],
  [/^bdrc-yigdzin/, 'BDRC Yigdzin (Tibetan manuscript OCR)'],
  [/^bdrc-woodblock/, 'BDRC woodblock OCR'],
  [/^cbeta/, 'CBETA typed text'],
  [/^sefaria/, 'Sefaria typed text'],
  [/^gemini-3-flash/, 'Gemini 3 Flash'],
  [/^gemini-3\.1-flash-lite/, 'Gemini 3.1 Flash-Lite'],
  [/^gemini-2\.5-flash/, 'Gemini 2.5 Flash'],
  [/^PaddleOCR-VL/i, 'PaddleOCR-VL'],
  [/^kraken/, 'Kraken'],
  [/^ia-/, 'Internet Archive OCR'],
  [/^mineru/, 'MinerU'],
  [/^manual$/, 'hand-entered'],
  [/^unrecorded$/, 'model not recorded'],
];
const engineName = (id: string) => ENGINE_NAMES.find(([re]) => re.test(id))?.[1] ?? id;

/** "Gemini 3 Flash 62% · BDRC Yigdzin 31% · other 7%": merged by plain name, top three, shares of pages. */
function engineLine(rows: [string, number][]) {
  const merged = new Map<string, number>();
  for (const [id, n] of rows) merged.set(engineName(id), (merged.get(engineName(id)) ?? 0) + n);
  const total = [...merged.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  const pct = (n: number) => { const p = (n / total) * 100; return p < 1 ? '<1%' : `${Math.round(p)}%`; };
  const top = sorted.slice(0, 3).map(([name, n]) => `${name} ${pct(n)}`);
  const rest = sorted.slice(3).reduce((a, [, n]) => a + n, 0);
  return [...top, ...(rest ? [`other ${pct(rest)}`] : [])].join(' · ');
}

type Stage = 'translated' | 'transcribed' | 'scanned only';
/**
 * Lay a stage's squares over the books that hold its pages, in order, so square k opens the book
 * whose pages it stands for: the book under the square's midpoint, pages scaled to the squares.
 */
function booksForSquares(books: TraditionProgressRow['book_pages'], stage: Stage, count: number) {
  const pagesOf = (b: TraditionProgressRow['book_pages'][number]) =>
    stage === 'translated' ? b[5] : stage === 'transcribed' ? Math.max(b[4] - b[5], 0) : Math.max(b[3] - Math.max(b[4], b[5]), 0);
  const withPages = books.map((b) => [b, pagesOf(b)] as const).filter(([, n]) => n > 0);
  const total = withPages.reduce((a, [, n]) => a + n, 0);
  const out: (TraditionProgressRow['book_pages'][number] | null)[] = [];
  let i = 0;
  let cum = withPages[0]?.[1] ?? 0;
  for (let k = 0; k < count; k++) {
    const mid = ((k + 0.5) / count) * total;
    while (i < withPages.length - 1 && mid > cum) cum += withPages[++i][1];
    out.push(withPages[i]?.[0] ?? null);
  }
  return out;
}

const UNIT = 1000; // pages per square
const SCANNED_ONLY = '#d6d3d1';
// A stage with any pages gets at least one square, so a small start is visible rather than rounded away.
const squares = (n: number) => (n > 0 ? Math.max(1, Math.round(n / UNIT)) : 0);

export function TraditionProgress({ rows, n }: { rows: TraditionProgressRow[]; n: number }) {
  return (
    <Figure
      n={n}
      title="What we hold, tradition by tradition"
      caption={
        <>
          Each square is {fmt(UNIT)} pages of scanned books in our library, any edition, published or still held for checking, rounded to the nearest square;
          squares are the same size in every tradition, so the areas compare directly. A page is transcribed when we
          hold its text (read from the image, or matched from an open typed edition) and translated when it has a
          draft English translation. &ldquo;Open typed text&rdquo; is the size of the openly licensed typed canon for
          that tradition in the canon table, converted to pages at our average page length in that language.
          Each square opens a book whose pages it stands for; squares for books not yet public have no
          link. &ldquo;Read by&rdquo; and &ldquo;English by&rdquo; are shares of pages, from the engine each
          page records.
        </>
      }
    >
      <div className="font-body text-xs text-stone-600 mb-4 flex flex-wrap gap-y-1">
        <Swatch style={{ backgroundColor: ENGLISH }} label="translated" />
        <Swatch style={{ backgroundColor: NO_ENGLISH }} label="transcribed, not yet translated" />
        <Swatch style={{ backgroundColor: SCANNED_ONLY }} label="scanned only" />
      </div>
      <div className="divide-y divide-stone-200 border-y border-stone-200">
        {rows.map((t) => {
          const total = squares(t.pages_scanned);
          const tr = Math.min(squares(t.pages_translated), total);
          const tx = Math.min(Math.max(squares(t.pages_transcribed) - tr, 0), total - tr);
          const pct = (v: number) => (t.pages_scanned ? `${Math.round((v / t.pages_scanned) * 100)}%` : '—');
          return (
            <div key={t.id} className="py-5 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-6">
              <div className="font-body text-sm mb-3 md:mb-0">
                <div className="font-serif text-lg text-stone-900 leading-tight">
                  {t.href ? (
                    <a href={t.href} className="hover:text-amber-800 hover:underline underline-offset-2">
                      {t.name}
                    </a>
                  ) : (
                    t.name
                  )}
                </div>
                <div className="text-stone-600 mt-1 tabular-nums">
                  {fmt(t.books)} books · {fmt(t.pages_scanned)} pages
                </div>
                <div className="text-stone-500 text-xs mt-1 leading-snug tabular-nums">
                  {pct(t.pages_translated)} translated · {pct(t.pages_transcribed)} transcribed
                  <br />
                  {fmt(t.readable_books)} books readable in English
                </div>
              </div>
              <div className="min-w-0">
              <div
                className="flex flex-wrap gap-[2px] content-start"
                role="img"
                aria-label={`${t.name}: ${fmt(t.pages_scanned)} pages scanned, ${fmt(t.pages_transcribed)} transcribed, ${fmt(t.pages_translated)} translated`}
              >
                {([['translated', tr, ENGLISH], ['transcribed', tx, NO_ENGLISH], ['scanned only', total - tr - tx, SCANNED_ONLY]] as const).flatMap(
                  ([stage, count, bg]) =>
                    booksForSquares(t.book_pages, stage, count).map((b, i) => {
                      const cls = 'block w-[9px] h-[9px] rounded-[1.5px]';
                      const key = `${stage}-${i}`;
                      if (!b) return <span key={key} className={cls} style={{ backgroundColor: bg }} title={`${t.name}: ${stage}`} />;
                      const label = `${b[1]}: ${stage}${b[2] ? '' : ' (not yet public)'}`;
                      return b[2] ? (
                        <a key={key} href={`/book/${b[0]}`} className={`${cls} hover:outline hover:outline-2 hover:outline-amber-700`} style={{ backgroundColor: bg }} title={label} aria-label={label} />
                      ) : (
                        <span key={key} className={cls} style={{ backgroundColor: bg }} title={label} />
                      );
                    }),
                )}
              </div>
              <div className="font-body text-xs text-stone-500 mt-3 leading-relaxed space-y-0.5">
                {t.canon_page_equivalents > 0 && (
                  <div>
                    <span className="text-stone-700">Open typed text:</span> ≈ {short(t.canon_page_equivalents)} pages
                  </div>
                )}
                {engineLine(t.ocr_engines) && (
                  <div>
                    <span className="text-stone-700">Read by:</span> {engineLine(t.ocr_engines)}
                  </div>
                )}
                {engineLine(t.translation_models) && (
                  <div>
                    <span className="text-stone-700">English by:</span> {engineLine(t.translation_models)}
                  </div>
                )}
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </Figure>
  );
}

/* ---------- The Tengyur, volume by volume ---------- */

export function TengyurProgress({
  n,
  perVolume,
  pagesImaged,
  pagesWithText,
  pagesTranslated,
  spendUsd,
}: {
  n: number;
  /** [volume, pages with text, pages with a draft English], in volume order */
  perVolume: [number, number, number][];
  pagesImaged: number;
  pagesWithText: number;
  pagesTranslated: number;
  spendUsd: number;
}) {
  // A volume is drafted when ≥ 95% of its pages with text have English (blank and refused pages never will).
  const stateOf = ([, text, tr]: [number, number, number]) => (text && tr >= 0.95 * text ? 'done' : tr > 0 ? 'partly' : 'none');
  const drafted = perVolume.filter((v) => stateOf(v) === 'done').length;
  const partly = perVolume.filter((v) => stateOf(v) === 'partly').length;
  const COLOR = { done: ENGLISH, partly: `${ENGLISH}66`, none: '#d6d3d1' } as const;
  const TITLE = { done: 'draft English for the whole volume', partly: 'draft English for part of the volume', none: 'imported and aligned, not yet translated' } as const;
  const stages: { n: string; label: string; href?: string }[] = [
    { n: fmt(pagesImaged), label: 'page images imported from BDRC (W23703)', href: 'https://library.bdrc.io/show/bdr:W23703' },
    { n: fmt(pagesWithText), label: 'pages carrying the Esukhia public-domain text, aligned folio by folio', href: 'https://github.com/Esukhia/derge-tengyur' },
    { n: fmt(pagesTranslated), label: `pages with a draft English translation, for $${fmt(Math.round(spendUsd))} in model costs` },
    { n: `${drafted} / ${perVolume.length}`, label: 'volumes drafted in full; no page has yet been reviewed by a scholar' },
  ];
  return (
    <Figure
      n={n}
      title="The Derge Tengyur, volume by volume"
      caption={`Each square is one of the ${perVolume.length} volumes we imported, in volume order. All have been public since 7 October 2026, labelled as AI translations not yet reviewed by a scholar. ${drafted} have a draft English translation for the whole volume${partly ? ` and ${partly} for part of it` : ''}.`}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-[3px] max-w-xl" role="img" aria-label={`${perVolume.length} volumes, ${drafted} drafted in English${partly ? `, ${partly} in part` : ''}`}>
        {perVolume.map((v) => (
          <div key={v[0]} className="aspect-square rounded-[2px]" style={{ backgroundColor: COLOR[stateOf(v)] }} title={`vol. ${v[0]}: ${TITLE[stateOf(v)]}`} />
        ))}
      </div>
      <div className="font-body text-xs text-stone-600 mt-3">
        <Swatch style={{ backgroundColor: COLOR.done }} label="drafted in English" />
        {partly > 0 && <Swatch style={{ backgroundColor: COLOR.partly }} label="partly drafted" />}
        <Swatch style={{ backgroundColor: COLOR.none }} label="imported and aligned, not yet translated" />
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-px bg-stone-200 border border-stone-200 rounded-sm mt-6">
        {stages.map((s, i) => (
          <li key={i} className="bg-stone-50 px-4 py-4">
            <div className="font-body text-[11px] uppercase tracking-wider text-stone-400">Step {i + 1}</div>
            <div className="font-serif text-2xl text-stone-900 mt-1">{s.n}</div>
            <div className="font-body text-sm text-stone-600 leading-snug mt-1">
              {s.href ? (
                <a href={s.href} className="underline decoration-stone-300 underline-offset-2 hover:text-amber-800">
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </div>
          </li>
        ))}
      </ol>
    </Figure>
  );
}

/* ---------- Where each canon stands ---------- */

const STATUS_ORDER = ['done', 'running', 'next', 'blocked'] as const;
export const STATUS_STYLE: Record<(typeof STATUS_ORDER)[number], { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'bg-stone-800 text-white' },
  running: { label: 'Under way', cls: 'bg-amber-700 text-white' },
  next: { label: 'Next', cls: 'bg-amber-100 text-amber-900 border border-amber-300' },
  blocked: { label: 'Blocked', cls: 'bg-stone-100 text-stone-600 border border-stone-300' },
};

export function StatusBoard({ items, n }: { items: { id: string; name: string; status: string }[]; n: number }) {
  // An empty "Done" column reads as a hole; it appears once the first canon is done.
  const shown = STATUS_ORDER.filter((s) => s !== 'done' || items.some((i) => i.status === 'done'));
  return (
    <Figure
      n={n}
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

/* ---------- What the measured fixes changed ---------- */

export type Improvement = {
  change: string;
  measure: string;
  /** both on a 0–100 scale (a rate per 100 pages, or a percentage) */
  before: number;
  after: number;
  /** true when lower is better */
  lowerBetter: boolean;
  inUse: boolean;
  status: string;
  /** what was measured on what, against what, by whom, when: the row's provenance in one line */
  basis: string;
  /** the write-up the numbers are copied from (a file pinned to a commit, or the issue comment that reports them) */
  source: string;
};

export function ImprovementChart({ rows, n }: { rows: Improvement[]; n: number }) {
  const BEFORE = '#a8a29e';
  return (
    <Figure
      n={n}
      title="What each measured change did"
      caption="Each row is one change tested on the same pages against the same reference, old method and new. The grey dot is the old method, the coloured dot the new one, on a scale of 0 to 100 (a percentage, or a count per 100 pages). Solid rows are in use; faded rows were tested and not adopted. Under each row: the sample, the reference, who judged it and when, and a link to the write-up the numbers are copied from. These are measured samples, not a census of the corpus."
    >
      <div className="font-body text-xs text-stone-600 mb-4 flex flex-wrap gap-y-1">
        <Swatch style={{ backgroundColor: BEFORE }} label="before" />
        <Swatch style={{ backgroundColor: ENGLISH }} label="after" />
      </div>
      <div className="divide-y divide-stone-200 border-y border-stone-200">
        {rows.map((r) => {
          const lo = Math.min(r.before, r.after);
          const hi = Math.max(r.before, r.after);
          return (
            <div key={r.change} className={`py-4 md:grid md:grid-cols-[18rem_minmax(0,1fr)] md:gap-6 ${r.inUse ? '' : 'opacity-60'}`}>
              <div className="font-body text-sm mb-2 md:mb-0">
                <div className="font-serif text-base text-stone-900 leading-tight">{r.change}</div>
                <div className="text-stone-600 mt-1 leading-snug">{r.measure} ({r.lowerBetter ? 'lower is better' : 'higher is better'})</div>
                <div className="text-xs mt-1">
                  <span className={r.inUse ? 'text-teal-800 font-semibold' : 'text-stone-500'}>{r.status}</span>
                </div>
                <div className="text-[11px] text-stone-500 mt-1 leading-snug">
                  {r.basis}.{' '}
                  <a href={r.source} className="text-amber-800 underline underline-offset-2">Source</a>
                </div>
              </div>
              <div className="relative h-10 self-center mx-4" role="img" aria-label={`${r.measure}: ${r.before} before, ${r.after} after`}>
                <div className="absolute inset-x-0 top-1/2 h-px bg-stone-200" />
                <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded" style={{ left: `${lo}%`, width: `${hi - lo}%`, backgroundColor: ENGLISH, opacity: 0.35 }} />
                {([[r.before, BEFORE, 'before'], [r.after, ENGLISH, 'after']] as const).map(([v, c, k]) => (
                  <div key={k} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${v}%` }}>
                    <div className="w-3 h-3 rounded-full ring-2 ring-white" style={{ backgroundColor: c }} />
                    <div className={`absolute ${k === 'before' ? '-top-5' : 'top-4'} font-body text-xs tabular-nums ${k === 'after' ? 'text-stone-900 font-semibold' : 'text-stone-500'}`}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden md:flex justify-between font-body text-[11px] text-stone-400 mt-1 md:ml-[20.5rem] md:mr-4">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </Figure>
  );
}

/* ---------- How a translation is checked: the loop behind the improvement chart ---------- */

function LoopStation({ k, title, what, example }: { k: number; title: string; what: string; example: ReactNode }) {
  return (
    <div className="rounded-sm bg-amber-50 border border-amber-300 px-3 py-3 font-body min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-lg text-amber-800 tabular-nums leading-none">{k}</span>
        <span className="text-sm font-semibold text-stone-900 leading-tight">{title}</span>
      </div>
      <div className="text-sm text-stone-700 mt-1.5 leading-snug">{what}</div>
      <div className="text-xs text-stone-500 mt-2 pt-2 border-t border-amber-200 leading-snug">{example}</div>
    </div>
  );
}

export function QualityLoop({ n, adopted, tested, issueUrl, resultsHref }: { n: number; adopted: number; tested: number; issueUrl: string; resultsHref: string }) {
  const stations = [
    {
      title: 'Compare with an outside text',
      what: 'Set our English beside a published human translation of the same passage, and our reading beside a typed edition.',
      example: '84000, SuttaCentral, GRETIL, Ganjoor, the Derge e-text',
    },
    {
      title: 'Judge blind',
      what: 'Two AI judges score fidelity from 1 to 5 without knowing which version is ours.',
      example: 'A defect counts only when both judges flag it.',
    },
    {
      title: 'Open the page',
      what: 'Trace every low score on the page image: was the page misread, or mistranslated?',
      example: '6 of the 20 worst Sanskrit, Pali and Chinese pages were misread, not mistranslated.',
    },
    {
      title: 'Change one thing, retest',
      what: 'Run the new method and the old one side by side on the same pages, with the same reference.',
      example: 'Tengyur, one page at a time: English on the wrong page fell from 13.3 to 0.9 per 100.',
    },
  ];
  return (
    <Figure
      n={n}
      title="How we check the English"
      caption={
        <>
          The same four steps run for each language and script, and again after every change. A change becomes the
          default only when it beats the old method on the same pages;{' '}
          <a href={resultsHref} className="text-amber-800 underline underline-offset-2">each result is charted here</a>. AI judges find
          errors quickly and cheaply, but they are not scholars: a scholar&rsquo;s reading is the test the machine
          checks are calibrated against, and the first one, on the Tengyur draft, is planned.{' '}
          <a href={`${issueUrl}5800`} className="text-amber-800 underline underline-offset-2">#5800</a>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-1 md:gap-2">
        {stations.flatMap((s, i) => {
          const card = <LoopStation key={s.title} k={i + 1} {...s} />;
          return i === 0 ? [card] : [<Arrow key={`ar${i}`} />, card];
        })}
      </div>
      <div aria-hidden className="hidden md:block mx-[12%] h-5 border-x border-b border-stone-300 rounded-b-md" />
      <div className="font-body text-xs text-stone-500 text-center mt-1 md:mt-1.5">
        then repeat with the next change
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
        <div className="rounded-sm border border-teal-700/40 bg-teal-50 px-3 py-3 font-body text-sm">
          <div className="font-semibold text-teal-900">Better: it becomes the default</div>
          <div className="text-stone-700 mt-1 leading-snug">
            {adopted} of the {tested} changes tested so far passed and are in use.
          </div>
        </div>
        <div className="rounded-sm border border-stone-300 bg-stone-50 px-3 py-3 font-body text-sm">
          <div className="font-semibold text-stone-900">Not good enough: we hold back or withdraw</div>
          <div className="text-stone-700 mt-1 leading-snug">
            Persian manuscripts are not translated until a reading matches 90% of a typed text. English for the
            Bhutanese Kangyur manuscripts was taken down when a reading model was found writing text that is not on
            the page.
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-sm bg-stone-800 text-white px-3 py-3 font-body text-sm leading-snug">
        <span className="font-semibold">On every page, for the reader:</span>{' '}
        <span className="text-stone-300">
          the scan, the reading and the English side by side, so any sentence can be checked against the original.
        </span>
      </div>
    </Figure>
  );
}
