import type { CSSProperties } from 'react';
import funnel from '../../../../scripts/catalog-coverage/results/language-funnel-2026-10.json';
import { ENGLISH, Figure, HATCH, NO_ENGLISH, Swatch } from './diagrams';

// Per-language funnel (#6256): estimated to survive → catalogued → scanned → in English.
// Static, like the other figures here: exact wording rides on `title` tooltips and on the
// source list under the bars, which is the table view. Every number comes from
// language-funnel-2026-10.json; change the JSON (and re-run language-funnel-check.mjs),
// not this file. CATALOGUED/NO_ENGLISH/ENGLISH pass the dataviz validator on white.
const CATALOGUED = '#3b6fb6';

const STAGES = [
  { key: 'estimated', label: 'Estimated to survive', style: { ...HATCH, outline: '1px solid #a8a29e', outlineOffset: '-1px' } as CSSProperties },
  { key: 'catalogued', label: 'Catalogued', style: { backgroundColor: CATALOGUED } as CSSProperties },
  { key: 'scanned', label: 'Scanned', style: { backgroundColor: NO_ENGLISH } as CSSProperties },
  { key: 'translated', label: 'In English', style: { backgroundColor: ENGLISH } as CSSProperties },
] as const;

type StageKey = (typeof STAGES)[number]['key'];
type Bar = { value?: number; share?: number; share_of?: string; label?: string; figure?: string; missing?: string; partial?: boolean; derived?: boolean };
type Source = {
  id: string;
  stage: string;
  what: string;
  source_title: string;
  body: string;
  year: number | null;
  url: string;
  quote: string | null;
  kind: string;
  caveat?: string;
  produced_by?: string;
};
type Language = { id: string; language: string; scope: string; unit: string; bars: Record<StageKey, Bar>; notes: string[]; figures: Source[]; holdings?: { books: number; pages: number; public_books: number } };

const LANGUAGES = funnel.languages as unknown as Language[];

// A bar's length in its language's own unit. A share-only bar (Latin's translated share)
// is drawn as that share of the bar it is a share of.
function magnitude(lang: Language, key: StageKey): number | null {
  const bar = lang.bars[key];
  if (bar.value != null) return bar.value;
  if (bar.share != null && bar.share_of) {
    const base = lang.bars[bar.share_of as StageKey]?.value;
    return base != null ? base * bar.share : null;
  }
  return null;
}

function Panel({ lang }: { lang: Language }) {
  const sizes = STAGES.map((s) => magnitude(lang, s.key));
  const max = Math.max(...sizes.map((v) => v ?? 0));
  const byId = new Map(lang.figures.map((f) => [f.id, f]));
  return (
    <div className="py-5">
      <div className="font-serif text-lg text-stone-900 leading-tight">{lang.language}</div>
      <div className="font-body text-xs text-stone-500 mb-3">
        {lang.scope}. Counted in {lang.unit}.
      </div>
      <div className="space-y-2">
        {STAGES.map((stage, i) => {
          const bar = lang.bars[stage.key];
          const size = sizes[i];
          const src = bar.figure ? byId.get(bar.figure) : undefined;
          const tip = src ? `${src.what}. Source: ${src.body}${src.year ? `, ${src.year}` : ''}.` : bar.missing;
          return (
            <div key={stage.key} title={tip} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 items-start">
              <div className="font-body text-xs text-stone-600 leading-4 pt-px">{stage.label}</div>
              {size == null ? (
                <div className="font-body text-xs text-stone-500 leading-4 border-l border-dashed border-stone-300 pl-2">
                  <span className="text-stone-700">No published figure.</span> {bar.missing?.replace(/^No published (figure|estimate)[^.]*\.\s*/, '')}
                </div>
              ) : (
                <div className="min-w-0">
                  <div className="h-4 rounded-r" style={{ width: `max(${((size / max) * 100).toFixed(2)}%, 3px)`, ...stage.style }} />
                  <div className="font-body text-xs text-stone-700 leading-4 mt-0.5">
                    {bar.label}
                    {src && (
                      <>
                        {' '}
                        <a href={`#src-${src.id}`} className="text-stone-400 hover:text-amber-800 underline underline-offset-2">
                          {src.kind === 'ours' ? 'our count' : 'source'}
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {lang.holdings && (
        <div className="font-body text-xs text-stone-700 leading-snug mt-3 pt-2 border-t border-dotted border-stone-200">
          <span className="text-stone-500">In Source Library:</span> {lang.holdings.books.toLocaleString('en-US')} books,{' '}
          {lang.holdings.pages.toLocaleString('en-US')} pages scanned; {lang.holdings.public_books.toLocaleString('en-US')} books public.
        </div>
      )}
      {lang.notes.length > 0 && (
        <ul className="font-body text-xs text-stone-500 leading-snug mt-3 space-y-1">
          {lang.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LanguageFunnel({ n }: { n: number }) {
  return (
    <Figure
      n={n}
      title="From what survives to what an English reader can open"
      caption={
        <>
          Bars are to scale within one language and not across languages, because each tradition is counted in its
          own unit (manuscripts, printed editions, copies, pages). The hatched bar is an estimate. &ldquo;No published
          figure&rdquo; means we found no source we could quote, and we did not fill the gap with a guess. Figures
          marked &ldquo;our count&rdquo; come from our own scripts over open catalogues. &ldquo;In Source Library&rdquo; counts the scanned books we hold in that language, one record per volume, so it is not in the same unit as the bars. Compiled {funnel.compiled};
          a script re-fetched every web source and found the quoted sentence on the page.
        </>
      }
    >
      <div className="font-body text-xs text-stone-600 mb-2 flex flex-wrap gap-y-1">
        {STAGES.map((s) => (
          <Swatch key={s.key} style={s.style} label={s.label} />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-x-10 border-b border-stone-200">
        {LANGUAGES.map((lang) => (
          <div key={lang.id} className="border-t border-stone-200">
            <Panel lang={lang} />
          </div>
        ))}
      </div>
      <details className="mt-5">
        <summary className="font-body text-sm text-amber-800 cursor-pointer">Sources, with the sentence each number comes from</summary>
        <div className="mt-3 space-y-5">
          {LANGUAGES.map((lang) => (
            <div key={lang.id}>
              <div className="font-body text-xs tracking-wider uppercase text-stone-500 mb-1.5">{lang.language}</div>
              <ul className="space-y-2.5">
                {lang.figures.map((f) => (
                  <li key={f.id} id={`src-${f.id}`} className="font-body text-sm text-stone-700 leading-snug scroll-mt-24">
                    <span className="text-stone-500">{f.stage}:</span> {f.what}.{' '}
                    <a href={f.url} className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800">
                      {f.source_title}
                    </a>{' '}
                    ({f.body}
                    {f.year ? `, ${f.year}` : ''}).
                    {f.quote && <span className="block text-stone-500 mt-0.5">&ldquo;{f.quote}&rdquo;</span>}
                    {f.kind === 'ours' && f.produced_by && <span className="block text-stone-500 mt-0.5">Our count: {f.produced_by}.</span>}
                    {f.caveat && <span className="block text-stone-500 mt-0.5">{f.caveat}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </Figure>
  );
}
