'use client';

/**
 * The top of the live read-surface page (#6740): the finding at a glance. One measured sentence per language with a
 * screen, the confirmation line, a rotatable 3D surface of the 3 × 3 screen (Surface3D, loaded client-only) and the
 * same nine cells as a grid. Everything is computed from the live doc in lead.ts; the fitting tools follow below.
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RAMP, LIVE, TEAL } from '../SurfaceCharts';
import type { LiveDoc } from './shape';
import { LANG_NAME, MARGIN_PP, PPC, THINKS, buildLead, cerColour, fmtPp, fmtUsd, hex, readConfirmation, screenLangs, sentence, type Cell, type Lead } from './lead';

const Surface3D = dynamic(() => import('./Surface3D'), { ssr: false, loading: () => <div className="h-[320px] sm:h-[440px] grid place-items-center text-sm text-[#8b949e]">loading the 3D view…</div> });

const btn = (on: boolean) => `px-2 py-1 text-sm rounded border ${on ? 'border-[#58a6ff] text-[#f0f6fc] bg-[#1f6feb33]' : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`;
const card = 'mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-3 sm:p-5';
const h2 = 'text-lg font-semibold text-[#f0f6fc]';
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(100 * v)} %`);
const ivTxt = (iv: [number, number] | null, f: (v: number) => string) => (iv ? `[${f(iv[0])}, ${f(iv[1])}]` : '');

export default function SurfaceLead({ doc }: { doc: LiveDoc }) {
  const langs = useMemo(() => screenLangs(doc), [doc]);
  const leads = useMemo(() => Object.fromEntries(langs.map((l) => [l, buildLead(doc, l)])) as Record<string, Lead>, [doc, langs]);
  const [lang, setLang] = useState(langs[0] ?? 'de');
  const [swap, setSwap] = useState(false);
  const [reset, setReset] = useState(0);
  const [pick, setPick] = useState<Cell | null>(null);
  // No WebGL: three's renderer throws in Surface3D, which calls onFail, and the grid carries the page.
  const [gl, setGl] = useState(true);
  const L = leads[lang] ?? leads[langs[0]];   // a poll can drop the language on show
  if (!langs.length || !L) return <section className={card}><h2 className={h2}>The screen</h2><p className="mt-2 text-sm text-[#8b949e]">No screen run (stage “screen”) has scored rows in the live doc yet.</p></section>;
  const conf = readConfirmation(doc, L.lang);
  const costs = L.cells.map((c) => c.usd_1k_accepted).filter((v): v is number => v !== null && v > 0);
  const [cLo, cHi] = [Math.log10(Math.min(...costs)), Math.log10(Math.max(...costs))];
  const shade = (v: number | null) => (v === null ? '#0d1117' : RAMP[Math.round(((Math.log10(v) - cLo) / Math.max(1e-9, cHi - cLo)) * 5)]);
  const glOn = gl && costs.length > 0;   // nothing costed yet (a screen just started): the grid says so cell by cell

  return (
    <section className={card} aria-labelledby="lead-h">
      <h2 id="lead-h" className={h2}>What the screen found</h2>
      <ul className="mt-2 space-y-1 text-[#e6edf3]">
        {langs.map((l) => <li key={l} className={l === L.lang ? '' : 'text-[#8b949e]'}>{sentence(leads[l])}</li>)}
      </ul>
      <p className="mt-2 text-sm">
        <span className="text-[#8b949e]">Confirmation on fresh queue pages, {LANG_NAME[L.lang] ?? L.lang}: </span>
        {conf.state === 'ok' ? (
          <span>{conf.c.route}: {conf.c.queue_pages.toLocaleString('en')} queue pages, n {conf.c.n}, {conf.c.accepted} accepted, {conf.c.wrong_text} wrong text, {fmtUsd(conf.c.usd_1k_accepted)} per 1,000 accepted · <b className={conf.c.passes ? 'text-[#3fb950]' : 'text-[#d29922]'}>{conf.c.passes ? 'passes' : 'fails'}</b>: {conf.c.why}</span>
        ) : conf.state === 'bad' ? (
          <span className="text-[#d29922]">the doc&apos;s confirmation field does not match the contract ({conf.problems.join('; ')})</span>
        ) : (
          <span className="text-[#8b949e]">not in the live doc for this language (publish-live.mjs --confirm writes it); read the confirmations on the<Link className="underline decoration-[#30363d] hover:text-[#58a6ff]" href="/platform/admin/ocr-evidence/read-surface">static page</Link>.</span>
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 items-center text-sm">
        <span className="inline-flex flex-wrap gap-1">{langs.map((l) => <button key={l} type="button" className={btn(l === L.lang)} onClick={() => { setLang(l); setPick(null); }}>{LANG_NAME[l] ?? l}</button>)}</span>
        {glOn && <>
          <span className="inline-flex items-center gap-1" role="group" aria-label="Surface height">
            <span className="text-[#8b949e]">height:</span>
            <button type="button" className={btn(!swap)} onClick={() => setSwap(false)} aria-pressed={!swap}>cost</button>
            <button type="button" className={btn(swap)} onClick={() => setSwap(true)} aria-pressed={swap}>quality (CER vs live)</button>
            <span className="text-[#8b949e]">· colour: {swap ? 'cost' : 'quality'}</span>
          </span>
          <button type="button" className={btn(false)} onClick={() => setReset((r) => r + 1)}>reset view</button>
        </>}
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">
        <div>
          {glOn ? (
            <div className="rounded border border-[#21262d] bg-[#0d1117]">
              <Surface3D cells={L.cells} swap={swap} resetKey={reset} onPick={setPick} onFail={() => setGl(false)} />
            </div>
          ) : !gl ? <p className="text-sm text-[#d29922]">This browser has no WebGL, so the 3D view is off; the grid has the same nine cells.</p>
            : <p className="text-sm text-[#8b949e]">No cell has a cost yet, so there is nothing to draw in 3D.</p>}
          {glOn && <>
            <Legend swap={swap} lo={Math.min(...costs)} hi={Math.max(...costs)} />
            <div className="min-h-[2.75rem] text-sm mt-1" aria-live="polite">
              {pick ? <CellLines c={pick} /> : <span className="text-[#8b949e]">Drag to rotate. Tap a point for its numbers. Whiskers are 95 % intervals (bootstrap by book).</span>}
            </div>
          </>}
        </div>
        <Grid L={L} shade={shade} />
      </div>
      <p className="mt-3 text-xs text-[#8b949e] max-w-3xl">
        Computed in your browser from the live doc: each of the {L.books} books is compared with itself at live (4 a call, low),
        weighted to the queue where the doc has a weight. Quota cost at list rates; accepted means read, not wrong text, not
        looped, not cut. Non-inferior: the 95 % interval of the CER difference stays under {MARGIN_PP} pp. What the doc does not carry:
        the screen&apos;s per-page rows (it has one scored row per book and setting), so these intervals are wider than the
        experiment&apos;s page-level analysis, and its numbers differ from the static page in the second digit.
      </p>
    </section>
  );
}

function CellLines({ c }: { c: Cell }) {
  return (
    <div className="rounded border border-[#21262d] bg-[#161b22] px-2 py-1 inline-block">
      <div className="text-[#f0f6fc] font-semibold">{c.ppc} a call, {c.think} thinking{c.live ? ' (live)' : ''}{c.optimum ? ' (optimum)' : ''} · {c.books} books</div>
      <div className="text-[#8b949e]">{fmtUsd(c.usd_1k_accepted)} per 1,000 accepted {ivTxt(c.cpa_iv, fmtUsd)} · CER {c.live ? 'reference' : `${fmtPp(c.d_cer_pp)} ${ivTxt(c.d_cer_iv, (v) => fmtPp(v))}`} · yield {pct(c.yield)}</div>
    </div>
  );
}

function Legend({ swap, lo, hi }: { swap: boolean; lo: number; hi: number }) {
  const stops = swap ? RAMP.slice(1) : [-1, -0.5, 0, 0.5, 1].map((t) => hex(cerColour(t * MARGIN_PP)));
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-[#8b949e]">
      <span>{swap ? fmtUsd(lo) : `−${MARGIN_PP} pp (better)`}</span>
      <span className="h-2 w-40 rounded" style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} />
      <span>{swap ? `${fmtUsd(hi)} per 1,000 accepted` : `+${MARGIN_PP} pp (worse)`}</span>
      <span className="ml-2">{swap ? 'colour: cost' : 'colour: CER vs live, grey = no change'}</span>
    </div>
  );
}

function Grid({ L, shade }: { L: Lead; shade: (v: number | null) => string }) {
  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-1 text-sm">
        <div />
        {PPC.map((p) => <div key={p} className="text-center text-[#8b949e]">{p} a call</div>)}
        {THINKS.map((t) => (
          <Row key={t} t={t} cells={L.cells.filter((c) => c.think === t)} shade={shade} />
        ))}
      </div>
      <p className="mt-1 text-xs text-[#8b949e]">Per 1,000 accepted pages, shaded by cost (darker is cheaper). Outlined: non-inferior to live; dashed: could lose more than {MARGIN_PP} pp. <span style={{ color: LIVE }}>live</span>, <span style={{ color: TEAL }}>optimum</span>.</p>
    </div>
  );
}

function Row({ t, cells, shade }: { t: string; cells: Cell[]; shade: (v: number | null) => string }) {
  return (
    <>
      <div className="text-[#8b949e] self-center pr-1 [writing-mode:vertical-rl] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0">{t}</div>
      {PPC.map((p) => {
        const c = cells.find((x) => x.ppc === p)!;
        const border = c.non_inferior === null ? 'border border-[#30363d]' : c.non_inferior ? 'border-2 border-[#c9d1d9]' : 'border-2 border-dashed border-[#f85149]';
        return (
          <div key={p} className={`rounded p-1.5 sm:p-2 ${border}`} style={{ background: shade(c.usd_1k_accepted) }}>
            <div className="flex justify-between gap-1 text-[11px] leading-none h-3">
              {c.live && <span style={{ color: LIVE }}>live</span>}
              {c.optimum && <span style={{ color: TEAL }} className="ml-auto">optimum</span>}
            </div>
            {c.usd_1k_accepted === null ? <div className="text-[#8b949e] py-3 text-center">{c.status === 'absent' ? 'not in the screen' : c.status}</div> : <>
              <div className="text-[#f0f6fc] font-semibold text-base">{fmtUsd(c.usd_1k_accepted)}</div>
              {c.cpa_iv && <div className="text-[11px] text-[#c9d1d9]">{ivTxt(c.cpa_iv, fmtUsd)}</div>}
              <div className="text-[12px] text-[#e6edf3] mt-0.5">CER {c.live ? 'ref.' : fmtPp(c.d_cer_pp)}</div>
              {c.d_cer_iv && <div className="text-[11px] text-[#c9d1d9]">{ivTxt(c.d_cer_iv, (v) => fmtPp(v).replace(' pp', ''))}</div>}
              <div className="text-[11px] text-[#c9d1d9]">yield {pct(c.yield)}</div>
              <div className="text-[11px] text-[#8b949e]">{c.books} books</div>
            </>}
          </div>
        );
      })}
    </>
  );
}
