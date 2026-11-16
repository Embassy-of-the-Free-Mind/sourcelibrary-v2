import { buildHeatGrid, MIN_BOOKS, MIN_PAGES, STEP_BOUNDS, type HeatData, type Square } from '@/lib/error-zoo-heat';

/** Colour steps, light to dark, in the page's amber scale (same family as the share bars above). */
const STEP_CLASS = ['bg-amber-100', 'bg-amber-200', 'bg-amber-400', 'bg-amber-600', 'bg-amber-800'];
const STEP_TEXT = ['text-stone-900', 'text-stone-900', 'text-stone-900', 'text-white', 'text-white'];

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Defects per 1,000 words: one decimal under 10, whole numbers above. */
const per1k = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
type Unit = 'share' | 'per1k';
const fmt = (x: number, unit: Unit) => (unit === 'share' ? pct(x) : per1k(x));
const fmtBound = (x: number, unit: Unit) => (unit === 'share' ? pct(x) : String(x));

function stepLabel(i: number, bounds: number[], unit: Unit) {
  const lo = i === 0 ? 0 : bounds[i - 1];
  const hi = bounds[i];
  const tail = unit === 'per1k' ? ' per 1,000 words' : '';
  return hi === undefined ? `${fmtBound(lo, unit)} or more${tail}` : i === 0 ? `under ${fmtBound(hi, unit)}` : `${fmtBound(lo, unit)}–${fmtBound(hi, unit)}`;
}

const sizeText = (pages: number, books?: number) => `${pages} pages${books != null ? ` from ${books} books` : ''}`;

function Cell({ lang, bin, sq, what, unit }: { lang: string; bin: string; sq: Square; what: string; unit: Unit }) {
  if (sq.kind === 'empty') return <div className="h-9" aria-hidden />;
  if (sq.kind === 'thin') {
    return (
      <div className="h-9 rounded-sm bg-stone-100 border border-dashed border-stone-300" title={`${lang}, ${bin}: ${sizeText(sq.pages, sq.books)}, too few for a share`} />
    );
  }
  return (
    <div
      className={`h-9 rounded-sm flex items-center justify-center text-xs font-semibold tabular-nums ${STEP_CLASS[sq.step]} ${STEP_TEXT[sq.step]}`}
      title={unit === 'share'
        ? `${lang}, ${bin}: ${pct(sq.rate)} of ${sizeText(sq.pages, sq.books)} ${what}`
        : `${lang}, ${bin}: ${per1k(sq.rate)} ${what}, over ${sizeText(sq.pages, sq.books)}`}
    >
      {fmt(sq.rate, unit)}
    </div>
  );
}

/**
 * Languages × half-centuries. unit 'share': each square is the share of reviewed pages `what` ("with a serious
 * error"). unit 'per1k': each square is a rate per 1,000 words, `what` naming it ("errors that change the sense
 * per 1,000 words").
 */
export default function ErrorHeatGrid({ data, minPages = MIN_PAGES, minBooks = MIN_BOOKS, bounds = STEP_BOUNDS, what = 'with a serious error', unit = 'share' }: {
  data: HeatData; minPages?: number; minBooks?: number; bounds?: number[]; what?: string; unit?: Unit;
}) {
  const { bins, rows } = buildHeatGrid(data, { minPages, minBooks, bounds });
  const hasBooks = data.cells.some(c => c.books != null);
  const cols = `minmax(5.5rem,7rem) repeat(${bins.length}, minmax(2.75rem,1fr))`;
  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1 pb-2">
        <div className="min-w-max md:min-w-0" role="table" aria-label={unit === 'share' ? `Share of pages ${what}, by language and period` : `${what}, by language and period`}>
          <div className="grid gap-[3px] mb-1" style={{ gridTemplateColumns: cols }} role="row">
            <div role="columnheader" />
            {bins.map(b => (
              <div key={b} role="columnheader" className="text-[0.7rem] leading-tight text-stone-500 text-center">{b}</div>
            ))}
          </div>
          {rows.map(r => (
            <div key={r.lang} className="grid gap-[3px] mb-[3px] items-center" style={{ gridTemplateColumns: cols }} role="row">
              <div role="rowheader" className="text-sm leading-tight pr-2">
                <span className="font-semibold text-stone-900">{r.lang}</span>
                <span className="block text-xs text-stone-500">{r.pages.toLocaleString('en-US')} pages</span>
              </div>
              {r.squares.map((sq, i) => <div key={bins[i]} role="cell"><Cell lang={r.lang} bin={bins[i]} sq={sq} what={what} unit={unit} /></div>)}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-stone-600 flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {STEP_CLASS.map((c, i) => (
          <span key={c}><span className={`inline-block w-3 h-3 rounded-sm ${c} mr-1.5 align-[-1px]`} />{stepLabel(i, bounds, unit)}</span>
        ))}
        <span>
          <span className="inline-block w-3 h-3 rounded-sm bg-stone-100 border border-dashed border-stone-300 mr-1.5 align-[-1px]" />
          fewer than {minPages} pages{hasBooks ? ` or ${minBooks} books` : ''}
        </span>
      </p>
    </div>
  );
}
