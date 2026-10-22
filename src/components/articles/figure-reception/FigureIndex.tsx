'use client';

// The browsable list of every work in the library that names a figure (Pythagoras, Philolaus, Archytas…).
// The data is a static file (<out>/passages.json, up to ~4 MB) built from the corpus mirror by
// scripts/eval/figure-reception/build-list.mjs (#7073); how it was built is in each page's source note.
// It loads after the article text, so the essay above it renders at once.
//
// Row shape (kept terse because there are ~3,900 rows):
//   y   when the work was written (negative = BCE), or null: the earliest catalogue year of its editions, or, for an
//       old text in a later edition, its author's death year (wb = 1; shown as "by 474")
//   t/a/l  title, author, language of the edition shown
//   id  book id of the edition shown; np = its pages naming the figure; q = of those, pages reporting a saying
//   pub the edition's free-text `published` field (shown when it differs from y)
//   P   up to 10 passages from that edition: [page, sentence, reportsSaying 0|1], best first
//   E   other editions of the same work: [id, year, language, title-if-different, pages, bestPage, sentence]

import { useEffect, useMemo, useState } from 'react';

type Passage = [number, string, 0 | 1];
type Edition = [string, number | null, string, string, number, number, string];
type Work = {
  y: number | null; wb?: 1; t: string; a: string; l: string; id: string; np: number; q: number;
  pub?: string; P: Passage[]; E: Edition[];
};
type Era = { key: string; name: string; label: string; from: number | null; to: number | null };

const ERAS: Era[] = [
  { key: 'antiquity', name: 'Antiquity', label: 'Ant.', from: -10000, to: 599 },
  { key: '600', name: '600–1199', label: '600', from: 600, to: 1199 },
  { key: '1200', name: '1200–1449', label: '1200', from: 1200, to: 1449 },
  { key: '1450', name: '1450–1500', label: '1450', from: 1450, to: 1500 },
  { key: '1501', name: '1501–1550', label: '1501', from: 1501, to: 1550 },
  { key: '1551', name: '1551–1600', label: '1551', from: 1551, to: 1600 },
  { key: '1601', name: '1601–1650', label: '1601', from: 1601, to: 1650 },
  { key: '1651', name: '1651–1700', label: '1651', from: 1651, to: 1700 },
  { key: '1701', name: '1701–1750', label: '1701', from: 1701, to: 1750 },
  { key: '1751', name: '1751–1800', label: '1751', from: 1751, to: 1800 },
  { key: '1801', name: '1801–1850', label: '1801', from: 1801, to: 1850 },
  { key: '1851', name: '1851–1900', label: '1851', from: 1851, to: 1900 },
  { key: '1901', name: '1901 onward', label: '1901', from: 1901, to: 10000 },
  { key: 'undated', name: 'Undated', label: 'n.d.', from: null, to: null },
];

const BATCH = 30;

const fmtYear = (y: number | null) => (y == null ? 'n.d.' : y < 0 ? `${-y} BCE` : String(y));
const eraOf = (w: Work) =>
  w.y == null ? 'undated' : ERAS.find((e) => e.from != null && e.to != null && w.y! >= e.from && w.y! <= e.to)!.key;
const pageHref = (id: string, page?: number) => (page ? `/book/${id}?page=${page}` : `/book/${id}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// Bold the name wherever it occurs in a passage.
function Highlighted({ text, name }: { text: string; name: RegExp }) {
  const parts = text.split(name);
  return <>{parts.map((s, i) => (i % 2 ? <strong key={i} className="font-semibold text-primary">{s}</strong> : s))}</>;
}

function PassageQuote({ id, p, name }: { id: string; p: Passage; name: RegExp }) {
  return (
    <blockquote className={`border-l-2 pl-4 font-body text-secondary leading-relaxed ${p[2] ? 'border-accent-gold' : 'border-stone-300'}`}>
      <Highlighted text={p[1]} name={name} />{' '}
      <a href={pageHref(id, p[0])} className="whitespace-nowrap text-xs font-mono text-muted no-underline hover:underline">
        p.&nbsp;{p[0]}&nbsp;&rarr;
      </a>
    </blockquote>
  );
}

function WorkCard({ w, name }: { w: Work; name: RegExp }) {
  const best = w.P[0];
  const rest = w.P.slice(1);
  const pub = w.pub ? String(w.pub).trim() : '';
  const showPub = pub && w.y != null && !pub.includes(String(Math.abs(w.y)));
  return (
    <article className="rounded-md border border-stone-200 bg-white/70 p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-[5.5rem_1fr] gap-x-4 gap-y-1">
        <div className="font-mono text-sm text-accent-gold tabular-nums">
          {w.wb ? 'by ' : ''}{fmtYear(w.y)}
          {showPub && <span className="block text-[11px] text-muted">ed. {pub.slice(0, 18)}</span>}
        </div>
        <div className="min-w-0">
          <a href={pageHref(w.id)} className="font-body font-semibold text-primary text-lg leading-snug no-underline hover:underline">
            {w.t}
          </a>
          {w.a && <div className="text-sm text-muted">{w.a}</div>}
          <div className="flex flex-wrap gap-1.5 mt-1.5 font-mono text-[11px]">
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-muted">{w.l || '?'}</span>
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-muted">{plural(w.np, 'page')}</span>
            {w.q > 0 && (
              <span className="rounded bg-accent-gold/15 px-1.5 py-0.5 text-primary">reports his words on {plural(w.q, 'page')}</span>
            )}
            {w.E.length > 0 && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-muted">{w.E.length + 1} editions</span>}
          </div>
        </div>
      </div>
      <PassageQuote id={w.id} p={best} name={name} />
      {rest.length > 0 && (
        <details className="border-t border-stone-200 pt-2 group">
          <summary className="cursor-pointer font-mono text-xs text-muted hover:text-primary">
            {plural(rest.length, 'more passage')} in this book{w.np > w.P.length ? ` (of ${w.np - 1})` : ''}
          </summary>
          <div className="flex flex-col gap-3 mt-3">
            {rest.map((p) => <PassageQuote key={p[0]} id={w.id} p={p} name={name} />)}
            {w.np > w.P.length && (
              <a href={pageHref(w.id)} className="font-mono text-xs text-muted">
                {plural(w.np - w.P.length, 'more page')} in the book &rarr;
              </a>
            )}
          </div>
        </details>
      )}
      {w.E.length > 0 && (
        <details className="border-t border-stone-200 pt-2">
          <summary className="cursor-pointer font-mono text-xs text-muted hover:text-primary">
            Also in {plural(w.E.length, 'other edition')}
          </summary>
          <div className="flex flex-col gap-4 mt-3">
            {w.E.map((e) => (
              <div key={e[0]} className="grid grid-cols-1 sm:grid-cols-[5.5rem_1fr] gap-x-4 gap-y-1 text-sm">
                <div className="font-mono text-accent-gold">{fmtYear(e[1])}</div>
                <div className="min-w-0 flex flex-col gap-1.5">
                  <div>
                    <a href={pageHref(e[0])}>{e[3] || 'Same work'}</a>{' '}
                    <span className="font-mono text-[11px] text-muted">· {e[2] || '?'} · {plural(e[4], 'page')}</span>
                  </div>
                  <PassageQuote id={e[0]} p={[e[5], e[6], 0]} name={name} />
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

type Props = {
  /** URL of the passages.json that build-list.mjs wrote. */
  dataUrl: string;
  /** Prefix of the name to bold in passages, e.g. "Pythagor" (matches Pythagoras, Pythagorean…). */
  namePrefix: string;
  /** Example filter words for the search box. */
  placeholder: string;
  /** Optional sentence under a period heading, keyed by era key ("antiquity", "600", … "undated"). */
  eraIntros?: Record<string, string>;
};

export default function FigureIndex({ dataUrl, namePrefix, placeholder, eraIntros = {} }: Props) {
  const name = useMemo(() => new RegExp(`(${namePrefix}\\w*)`, 'gi'), [namePrefix]);
  const [data, setData] = useState<Work[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState('');
  const [onlyQuotes, setOnlyQuotes] = useState(false);
  const [shown, setShown] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch(dataUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Work[]) => setData(d))
      .catch(() => setFailed(true));
  }, [dataUrl]);

  const indexed = useMemo(
    () => (data ?? []).map((w) => ({ w, era: eraOf(w), text: `${w.t} ${w.a} ${w.P.map((p) => p[1]).join(' ')}`.toLowerCase() })),
    [data],
  );

  const languages = useMemo(() => {
    const n: Record<string, number> = {};
    for (const { w } of indexed) if (w.l) n[w.l] = (n[w.l] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }, [indexed]);

  const totals = useMemo(() => {
    const t: Record<string, { all: number; q: number }> = {};
    for (const e of ERAS) t[e.key] = { all: 0, q: 0 };
    for (const { w, era } of indexed) { t[era].all++; if (w.q) t[era].q++; }
    return t;
  }, [indexed]);

  const byEra = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Record<string, Work[]> = {};
    for (const e of ERAS) out[e.key] = [];
    for (const r of indexed) {
      if (onlyQuotes && !r.w.q) continue;
      if (lang && r.w.l !== lang) continue;
      if (q && !r.text.includes(q)) continue;
      out[r.era].push(r.w);
    }
    return out;
  }, [indexed, query, lang, onlyQuotes]);

  if (failed) return <p className="text-muted italic">The list could not be loaded. Reload the page to try again.</p>;
  if (!data) return <p className="text-muted italic">Loading the list of works…</p>;

  const max = Math.max(...Object.values(totals).map((v) => v.all));
  const shownCount = Object.values(byEra).reduce((a, ws) => a + ws.length, 0);
  const resetPaging = () => setShown({});
  const jump = (key: string) => document.getElementById(`era-${key}`)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="not-prose flex flex-col gap-6">
      <figure className="rounded-md border border-stone-200 bg-white/60 p-4">
        <figcaption className="font-mono text-[11px] uppercase tracking-wider text-muted">Works by period · select a bar to jump</figcaption>
        <div className="grid grid-flow-col auto-cols-fr gap-1 items-end h-32 mt-5">
          {ERAS.map((e) => {
            const v = totals[e.key];
            return (
              <button key={e.key} type="button" onClick={() => jump(e.key)} className="relative h-full flex flex-col justify-end"
                aria-label={`${e.name}: ${plural(v.all, 'work')}, ${v.q.toLocaleString()} report his words`}>
                <div className="relative rounded-t-sm bg-accent-gold/25 hover:bg-accent-gold/40" style={{ height: `${(v.all / max) * 100}%` }}>
                  <span className="absolute -top-4 inset-x-0 text-center font-mono text-[10px] text-muted">{v.all}</span>
                  <div className="absolute bottom-0 inset-x-0 rounded-t-sm bg-accent-gold" style={{ height: `${v.all ? (v.q / v.all) * 100 : 0}%` }} />
                </div>
              </button>
            );
          })}
        </div>
        <div className="grid grid-flow-col auto-cols-fr gap-1 mt-1.5">
          {ERAS.map((e) => <span key={e.key} className="text-center font-mono text-[9px] sm:text-[10px] text-muted truncate">{e.label}</span>)}
        </div>
        <div className="flex flex-wrap gap-4 mt-3 font-mono text-[11px] text-muted">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-gold mr-1.5 align-[-1px]" />reports a saying or teaching</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-gold/25 mr-1.5 align-[-1px]" />mentions him</span>
        </div>
      </figure>

      <div className="sticky top-14 z-10 bg-cream/95 backdrop-blur py-3 border-b border-stone-200 flex flex-wrap gap-2.5 items-center">
        <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); resetPaging(); }}
          placeholder={placeholder} aria-label="Filter works and passages"
          className="flex-1 basis-56 min-w-0 rounded border border-stone-300 bg-white px-3 py-2 font-body text-base text-primary" />
        <select value={lang} onChange={(e) => { setLang(e.target.value); resetPaging(); }} aria-label="Language of the edition"
          className="rounded border border-stone-300 bg-white px-2 py-2 text-sm text-primary">
          <option value="">All languages</option>
          {languages.map(([l, n]) => <option key={l} value={l}>{l} ({n})</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-secondary cursor-pointer">
          <input type="checkbox" checked={onlyQuotes} onChange={(e) => { setOnlyQuotes(e.target.checked); resetPaging(); }} />
          Only works that report his words
        </label>
        <span className="basis-full font-mono text-xs text-muted">{plural(shownCount, 'work')} shown</span>
      </div>

      {shownCount === 0 && <p className="text-muted italic">No works match that filter.</p>}
      {ERAS.map((e) => {
        const ws = byEra[e.key];
        if (!ws.length) return null;
        const n = shown[e.key] ?? BATCH;
        return (
          <section key={e.key} id={`era-${e.key}`} className="flex flex-col gap-3.5 scroll-mt-32">
            <h3 className="text-2xl text-primary mt-6 flex flex-wrap items-baseline gap-3">
              {e.name}<span className="font-mono text-xs text-muted">{plural(ws.length, 'work')}</span>
            </h3>
            {eraIntros[e.key] && <p className="text-muted italic font-body">{eraIntros[e.key]}</p>}
            {ws.slice(0, n).map((w) => <WorkCard key={w.id} w={w} name={name} />)}
            {ws.length > n && (
              <button type="button" onClick={() => setShown((s) => ({ ...s, [e.key]: n + BATCH * 4 }))}
                className="rounded-md border border-dashed border-stone-300 py-2.5 font-mono text-xs text-muted hover:text-primary">
                Show {Math.min(BATCH * 4, ws.length - n)} more of {(ws.length - n).toLocaleString()} remaining
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
