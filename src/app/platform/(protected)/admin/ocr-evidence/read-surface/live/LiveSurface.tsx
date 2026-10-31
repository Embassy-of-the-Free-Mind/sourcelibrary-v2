'use client';

/**
 * The live read-surface instrument (#6740): progress, design, and a response surface refitted in the browser on every
 * poll and every control change (rsm.ts), with a by-book bootstrap in a web worker (boot.worker.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { assertLiveDoc, type LiveDoc, type LiveRow } from './shape';
import {
  BASES, FACTORS, MAXIMISE, autoKind, SERVED_PX, THINK_X, adjustedRunMeans, bootstrap, candidates, code, fitAll, frontierGap, objectiveOf,
  optimum, predictAll, qnorm, quantile, regionOf, termsFor, toObs,
  type Base, type FitSet, type ModelKind, type Point, type Response,
} from './rsm';
import { Contour, DesignView, EDGE_RANGE, RampLegend, Scatter, Tip, fmtPct, type DesignPoint, type ScatterPt } from './LiveCharts';

const POLL_MS = 30_000;
const B = 200;
const LANG: Record<string, string> = { de: 'German', la: 'Latin', en: 'English' };
const THINK_NAME = ['low', 'medium', 'high'];

const RESP: Record<Response, { label: string; short: string; fmt: (v: number) => string; base: Base[] }> = {
  cer: { label: 'CER (accuracy against the typed page)', short: 'CER', fmt: (v) => fmtPct(v, 2), base: ['cer'] },
  quota_cost: { label: 'quota cost, $ per 1,000 pages (list rates)', short: 'cost', fmt: (v) => `$${(1000 * v).toFixed(2)}`, base: ['quota_cost'] },
  cost_per_accepted: { label: 'quota cost per accepted page, $ per 1,000', short: 'cost / accepted', fmt: (v) => `$${(1000 * v).toFixed(2)}`, base: ['quota_cost', 'accepted'] },
  calls: { label: 'agy calls a page', short: 'calls', fmt: (v) => v.toFixed(2), base: ['calls'] },
  accepted_per_hour: { label: 'accepted pages an hour, one read stream', short: 'accepted / h', fmt: (v) => v.toFixed(0), base: ['wall_s', 'accepted'] },
};
const BASE_FMT: Record<Base, (v: number) => string> = {
  cer: (v) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(2)} pp`, quota_cost: (v) => `${v >= 0 ? '+' : ''}$${(1000 * v).toFixed(2)}/1k`,
  calls: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`, wall_s: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} s`, accepted: (v) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)} pp`,
};
const BASE_NAME: Record<Base, string> = { cer: 'CER', quota_cost: 'cost a page', calls: 'calls a page', wall_s: 'wall s a page', accepted: 'accepted share' };

interface RunInfo { key: string; run_id: string; pool: string; completed_at: string; n: number; setting: LiveDoc['design']['settings'][number] | undefined }

const sel = 'bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm text-[#e6edf3]';
const btn = (on: boolean) => `px-2 py-1 text-sm rounded border ${on ? 'border-[#58a6ff] text-[#f0f6fc] bg-[#1f6feb33]' : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`;
const card = 'mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-3 sm:p-5';
const h2 = 'text-lg font-semibold text-[#f0f6fc]';

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <span className="inline-flex flex-wrap gap-1">{options.map(([v, l]) => <button key={v} type="button" className={btn(v === value)} onClick={() => onChange(v)}>{l}</button>)}</span>;
}

export default function LiveSurface({ initial }: { initial: unknown }) {
  const [raw, setRaw] = useState<unknown>(initial);
  const [polledAt, setPolledAt] = useState<string | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/admin/read-surface-live', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        // An unchanged doc is not re-rendered: every memo and the bootstrap would restart for nothing.
        setRaw((prev: unknown) => ((prev as { updated_at?: string } | null)?.updated_at === j.doc?.updated_at ? prev : j.doc)); setPolledAt(new Date().toISOString()); setPollErr(null);
      } catch (e) { setPollErr(String(e)); }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);
  const shape = useMemo(() => assertLiveDoc(raw), [raw]);
  if (!shape.ok) {
    return (
      <div className="mt-6 rounded-lg border border-[#d29922] bg-[#161b22] p-5" role="alert">
        <h2 className={h2}>Data shape changed</h2>
        <p className="mt-2 text-sm">The live doc (ops_reports <code>read-surface-6740:live</code>) does not match the contract this page reads, so nothing is drawn rather than an empty chart. What is wrong:</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-[#c9d1d9]">{shape.problems.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
        <p className="mt-2 text-sm text-[#8b949e]">The writer is scripts/eval/read-surface-6740/publish-live.mjs; the contract is live/shape.ts. {pollErr ? `Last poll failed: ${pollErr}.` : ''}</p>
      </div>
    );
  }
  return <Instrument doc={shape.doc} polledAt={polledAt} pollErr={pollErr} />;
}

function Instrument({ doc, polledAt, pollErr }: { doc: LiveDoc; polledAt: string | null; pollErr: string | null }) {
  const langs = useMemo(() => [...new Set(doc.rows.map((r) => r.lang))].sort((a, b) => ['de', 'la', 'en'].indexOf(a) - ['de', 'la', 'en'].indexOf(b)), [doc]);
  const [lang, setLang] = useState(langs[0] ?? 'de');
  const [kindSel, setKind] = useState<ModelKind | 'auto'>('auto');
  const [resp, setResp] = useState<Response>('quota_cost');
  const [weighted, setWeighted] = useState(false);
  const [james, setJames] = useState(false);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [replay, setReplay] = useState<number | null>(null);
  const [think, setThink] = useState(-1);
  const [line, setLine] = useState(false);
  const [margin, setMargin] = useState(0.01);
  const [tip, setTip] = useState<string[] | null>(null);
  const [tip2, setTip2] = useState<string[] | null>(null);
  const [tip3, setTip3] = useState<string[] | null>(null);

  // ── runs of this language, in completion order ──
  const runs: RunInfo[] = useMemo(() => {
    const m = new Map<string, RunInfo>();
    for (const r of doc.rows) {
      if (r.lang !== lang) continue;
      const key = `${r.lang}:${r.run_id}`;
      const x = m.get(key);
      if (x) { x.n++; if ((r.completed_at ?? '') > x.completed_at) x.completed_at = r.completed_at ?? ''; }
      else m.set(key, { key, run_id: r.run_id, pool: r.pool, completed_at: r.completed_at ?? '', n: 1, setting: doc.design.settings.find((s) => (s.lang ?? lang) === lang && s.id === r.setting_id) });
    }
    return [...m.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.run_id.localeCompare(b.run_id));
  }, [doc, lang]);
  const eligible = useMemo(() => runs.filter((r) => james || r.pool === 'default'), [runs, james]);
  const upTo = replay === null ? eligible.length : Math.min(replay, eligible.length);
  const active = useMemo(() => new Set(eligible.slice(0, upTo).filter((r) => !dropped.has(r.key)).map((r) => r.key)), [eligible, upTo, dropped]);

  const weightOf = useMemo(() => {
    const w = doc.weights?.[lang] ?? {};
    return (b: string) => (weighted ? w[b] ?? 1 : 1);
  }, [doc, lang, weighted]);
  const unweighted = useMemo(() => (weighted ? new Set(doc.rows.filter((r) => r.lang === lang && doc.weights?.[lang]?.[r.book_id] === undefined).map((r) => r.book_id)).size : 0), [doc, lang, weighted]);

  const rowsL = useMemo(() => doc.rows.filter((r) => r.lang === lang), [doc, lang]);
  const rowsFor = (keys: Set<string>): LiveRow[] => rowsL.filter((r) => keys.has(`${r.lang}:${r.run_id}`));
  const settingsL = useMemo(() => doc.design.settings.map((s) => ({ ...s, lang: s.lang ?? lang })), [doc, lang]);
  const obs = useMemo(() => toObs(rowsL.filter((r) => active.has(`${r.lang}:${r.run_id}`)), settingsL, weightOf), [rowsL, active, settingsL, weightOf]);
  const kind: ModelKind = useMemo(() => (kindSel === 'auto' ? autoKind(obs) : kindSel), [kindSel, obs]);
  const terms = useMemo(() => termsFor(obs, kind), [obs, kind]);
  const nRuns = useMemo(() => new Set(obs.map((o) => o.run)).size, [obs]);
  const fits = useMemo(() => fitAll(obs, terms), [obs, terms]);
  const region = useMemo(() => regionOf({ ...doc, design: { ...doc.design, settings: settingsL.filter((s) => s.lang === lang) } }, lang, obs), [doc, settingsL, lang, obs]);
  const cands = useMemo(() => candidates(region), [region]);
  const liveEdge = useMemo(() => {
    const xs = doc.rows.filter((r) => r.lang === lang && settingsL.find((s) => s.id === r.setting_id && s.lang === lang)?.live && r.long_edge_px).map((r) => r.long_edge_px as number).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : SERVED_PX;
  }, [doc, lang, settingsL]);
  const livePt: Point = useMemo(() => ({ ppc: 4, edge: liveEdge, think: -1, line: false }), [liveEdge]);
  const fitSet: FitSet = fits;
  const opt = useMemo(() => (obs.length ? optimum(fitSet, terms, cands, livePt, resp, margin) : null), [fitSet, terms, cands, livePt, resp, margin, obs.length]);

  // ── the bootstrap, in a worker; a new request replaces the old worker outright ──
  const [boot, setBoot] = useState<{ sig: string; fits: FitSet[] | null; progress: number }>({ sig: '', fits: null, progress: 0 });
  const workerRef = useRef<Worker | null>(null);
  const sig = useMemo(() => `${doc.updated_at}|${kind}|${[...active].sort().join(',')}|${weighted}|${lang}`, [doc.updated_at, kind, active, weighted, lang]);
  useEffect(() => {
    if (!obs.length) return;
    const t = setTimeout(() => {
      workerRef.current?.terminate();
      setBoot({ sig, fits: null, progress: 0 });
      // No worker (old browser, blocked, chunk missing): run it here, a moment of jank rather than no intervals.
      const runHere = () => setBoot({ sig, fits: bootstrap(obs, terms, B).fits, progress: B });
      try {
        const w = new Worker(new URL('./boot.worker.ts', import.meta.url));
        workerRef.current = w;
        w.onmessage = (e: MessageEvent<{ id: number; progress?: number; fits?: FitSet[] }>) => {
          if (e.data.fits) setBoot({ sig, fits: e.data.fits, progress: B });
          else if (e.data.progress) setBoot((b) => (b.sig === sig ? { ...b, progress: e.data.progress! } : b));
        };
        // A worker chunk that fails to load errors here, not in the constructor.
        w.onerror = () => { w.terminate(); runHere(); };
        w.postMessage({ id: 1, obs, kind, B });
      } catch {
        runHere();
      }
    }, 250);
    return () => clearTimeout(t);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => workerRef.current?.terminate(), []);
  const bootFits = boot.sig === sig ? boot.fits : null;

  const interval = (f: (fs: FitSet) => number): [number, number] | null => {
    if (!bootFits) return null;
    const xs = bootFits.map(f);
    return [quantile(xs, 0.05), quantile(xs, 0.95)];
  };
  const bootOpts = useMemo(() => (bootFits ? bootFits.map((f) => optimum(f, terms, cands, livePt, resp, margin)).filter((o): o is NonNullable<typeof o> => !!o) : []), [bootFits, terms, cands, livePt, resp, margin]);

  // ── contour grid ──
  const N = 33;
  const ppcHi = Math.max(8, region.ppc[1]);
  const edgeLo = Math.min(EDGE_RANGE[0], region.edge[0] * 0.9), edgeHi = Math.max(EDGE_RANGE[1], region.edge[1] * 1.1);
  const ppcRange: [number, number] = [1, ppcHi];
  const edgeRange: [number, number] = [edgeLo, edgeHi];
  const grid = useMemo(() => {
    const ppcRange = [1, ppcHi], edgeRange = [edgeLo, edgeHi];
    const z: number[][] = [], feas: boolean[][] = [], inR: boolean[][] = [];
    const bound = predictAll(fitSet, terms, livePt).cer + margin;
    for (let r = 0; r < N; r++) {
      const edge = Math.pow(2, Math.log2(edgeRange[0]) + (r / (N - 1)) * (Math.log2(edgeRange[1]) - Math.log2(edgeRange[0])));
      z.push([]); feas.push([]); inR.push([]);
      for (let c = 0; c < N; c++) {
        const ppc = ppcRange[0] + (c / (N - 1)) * (ppcRange[1] - ppcRange[0]);
        const v = predictAll(fitSet, terms, { ppc, edge, think, line });
        z[r].push(v[resp]); feas[r].push(v.cer <= bound);
        inR[r].push(ppc >= region.ppc[0] - 0.01 && ppc <= region.ppc[1] + 0.01 && edge >= region.edge[0] * 0.98 && edge <= region.edge[1] * 1.02);
      }
    }
    const inside = z.flatMap((row, r) => row.filter((_, c) => inR[r][c]));
    const all = (inside.length ? inside : z.flat()).filter(Number.isFinite);
    const range: [number, number] = [quantile(all, 0.02), quantile(all, 0.98)];
    return { z, feas, inR, range };
  }, [fitSet, terms, livePt, margin, think, line, resp, region, ppcHi, edgeLo, edgeHi]);

  // ── book-adjusted run means, for the scatter and the design points ──
  const obj = objectiveOf(resp);
  const adj = useMemo(() => Object.fromEntries(BASES.map((b) => [b, adjustedRunMeans(obs, b)])) as Record<Base, Map<string, number>>, [obs]);
  const runVal = (run: string, r: Response) => {
    const g = (b: Base) => adj[b].get(run) ?? NaN;
    if (r === 'cost_per_accepted') return g('quota_cost') / Math.max(0.01, g('accepted'));
    if (r === 'accepted_per_hour') return (3600 * Math.max(0.01, g('accepted'))) / Math.max(1, g('wall_s'));
    return g(r as Base);
  };

  // ── fit history: the optimum after each successive run (completion order, the current filters) ──
  const history = useMemo(() => {
    const ks = eligible.filter((r) => !dropped.has(r.key));
    const out: { k: number; run: string; o: ReturnType<typeof optimum> }[] = [];
    for (let k = 3; k <= ks.length; k++) {
      const set = new Set(ks.slice(0, k).map((r) => r.key));
      const ob = toObs(rowsFor(set), settingsL, weightOf);
      const tm = termsFor(ob, kind);
      const ft = fitAll(ob, tm);
      const rg = regionOf({ ...doc, design: { ...doc.design, settings: settingsL.filter((s) => s.lang === lang) } }, lang, ob);
      out.push({ k, run: ks[k - 1].run_id, o: optimum(ft, tm, candidates(rg, 8), livePt, resp, margin) });
    }
    return out;
  }, [eligible, dropped, settingsL, weightOf, kind, lang, livePt, resp, margin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── what if ──
  const [wi, setWi] = useState<Point>({ ppc: 4, edge: 2350, think: -1, line: false });
  const wiPred = predictAll(fitSet, terms, wi);
  const wiGap = obs.length ? frontierGap(fitSet, terms, cands, wi, resp) : null;

  // ── progress ──
  const progress = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const s of doc.design.settings) {
      const k = `${s.lang ?? '–'} · ${s.stage}`;
      const c = m.get(k) ?? { done: 0, running: 0, planned: 0, aborted: 0 };
      c[s.status]++; m.set(k, c);
    }
    return [...m.entries()].sort();
  }, [doc]);
  const lastRun = doc.rows.reduce((a, r) => ((r.completed_at ?? '') > a ? r.completed_at ?? '' : a), '');

  const designPts: DesignPoint[] = useMemo(() => settingsL.filter((s) => s.lang === lang).map((s) => {
    const rs = doc.rows.filter((r) => r.lang === lang && r.setting_id === s.id && r.long_edge_px);
    const med = rs.length ? rs.map((r) => r.long_edge_px as number).sort((a, b) => a - b)[Math.floor(rs.length / 2)] : SERVED_PX;
    return { s, edge: s.long_edge ?? med, served: s.long_edge === null, runs: rs.length };
  }), [settingsL, lang, doc]);
  const maxPpc = Math.max(8, ...designPts.map((d) => d.s.pages_a_call));

  const R = RESP[resp];
  const primary: Base = R.base[0];
  const fitP = fits[primary];
  const ci = (j: number, b: Base) => interval((f) => f[b].beta[j]);
  const halfNormal = useMemo(() => {
    if (!bootFits) return [];
    const zs = terms.map((t, j) => {
      const sd = Math.sqrt(variance(bootFits.map((f) => f[primary].beta[j])));
      return { name: t.name, z: fitP.estimable[j] && sd > 0 ? Math.abs(fitP.beta[j] / sd) : NaN };
    }).filter((x) => Number.isFinite(x.z)).sort((a, b) => a.z - b.z);
    return zs.map((x, i) => ({ ...x, q: qnorm(0.5 + 0.5 * ((i + 0.5) / zs.length)) }));
  }, [bootFits, terms, primary, fitP]);

  const optPtOnSlice = opt && opt.point.think === think && opt.point.line === line ? opt.point : null;
  const designOnSlice = designPts.filter((d) => d.s.status === 'done' && THINK_X[d.s.thinking] === think && (d.s.prompt_line !== 'live') === line && (james || runs.some((r) => r.run_id === d.s.id && r.pool === 'default')));
  const ptName = (p: Point) => `${p.ppc} a call · ${Math.round(p.edge).toLocaleString('en')} px · thinking ${THINK_NAME[p.think + 1]}${p.line ? ' · prompt line' : ''}`;

  // frontier among the run points
  const scatterPts: ScatterPt[] = eligible.filter((r) => active.has(r.key)).map((r) => {
    const s = r.setting;
    return { x: runVal(r.run_id, obj), y: runVal(r.run_id, 'cer'), tone: s?.live ? 'live' : 'ink',
      tip: [`${r.run_id}${s?.live ? ' (live)' : ''}: ${s ? `${s.pages_a_call} a call · ${s.long_edge ?? 'as served'} · ${s.thinking}` : ''} · ${r.pool} pool`, `CER ${fmtPct(runVal(r.run_id, 'cer'))} · ${RESP[obj].short} ${RESP[obj].fmt(runVal(r.run_id, obj))} (book-adjusted)`] } as ScatterPt;
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const sgn = MAXIMISE[obj] ? -1 : 1;
  const front = scatterPts.filter((p) => !scatterPts.some((o) => o !== p && sgn * o.x <= sgn * p.x && o.y <= p.y && (sgn * o.x < sgn * p.x || o.y < p.y))).sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y }));

  const liveCer = predictAll(fitSet, terms, livePt).cer;
  const noData = obs.length === 0;

  return (
    <div>
      {/* ── progress strip ── */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={h2}>Progress</h2>
          <span className="text-sm text-[#8b949e]">doc updated {doc.updated_at.slice(0, 16).replace('T', ' ')} UTC · last run finished {lastRun ? lastRun.slice(0, 16).replace('T', ' ') : '–'} UTC · {pollErr ? <span className="text-[#d29922]">poll failed ({pollErr})</span> : polledAt ? `polled ${polledAt.slice(11, 19)}` : 'polls every 30 s'}</span>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-[#8b949e]">agy calls used</div>
            <div className="text-[#f0f6fc] text-lg">{doc.budget.calls_used.toLocaleString('en')} <span className="text-[#8b949e] text-sm">of {doc.budget.calls_max.toLocaleString('en')}</span></div>
            <div className="h-2 mt-1 rounded bg-[#21262d] overflow-hidden"><div className="h-full bg-[#58a6ff]" style={{ width: `${Math.min(100, (100 * doc.budget.calls_used) / doc.budget.calls_max)}%` }} /></div>
          </div>
          <div>
            <div className="text-[#8b949e]">pool left this week</div>
            {doc.budget.pool_weekly ? Object.entries(doc.budget.pool_weekly).map(([p, v]) => (
              <div key={p} className="flex items-center gap-2"><span className="w-20 text-[#c9d1d9]">{p}</span><div className="flex-1 h-2 rounded bg-[#21262d] overflow-hidden"><div className="h-full" style={{ width: `${100 * v}%`, background: v < 0.3 ? '#d29922' : '#3fb950' }} /></div><span className="w-10 text-right">{Math.round(100 * v)}%</span></div>
            )) : <div>–</div>}
            <div className="text-xs text-[#8b949e] mt-1">the experiment stops a pool under 30%</div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm w-full"><thead><tr className="text-[#8b949e] text-left"><th className="font-normal pr-2">settings</th><th className="font-normal pr-2">done</th><th className="font-normal pr-2">running</th><th className="font-normal pr-2">planned</th><th className="font-normal">dropped</th></tr></thead>
              <tbody>{progress.map(([k, c]) => <tr key={k} className="border-t border-[#21262d]"><td className="pr-2">{k}</td><td className="pr-2">{c.done}</td><td className="pr-2">{c.running ? <span className="text-[#58a6ff]">{c.running}</span> : 0}</td><td className="pr-2">{c.planned}</td><td className="text-[#6e7681]">{c.aborted}</td></tr>)}</tbody></table>
          </div>
        </div>
        <h3 className="mt-4 font-semibold text-[#f0f6fc]">The design, {LANG[lang] ?? lang}</h3>
        <p className="text-sm text-[#8b949e]">Every setting the experiment has planned or made. Filled: done; hollow: planned; pulsing: running now; faint: dropped by a later amendment. Circle: the live prompt; square: with the prompt line. Amber: the live setting.</p>
        <DesignView points={designPts} maxPpc={maxPpc} onTip={setTip3} />
        <Tip lines={tip3} />
      </section>

      {/* ── controls ── */}
      <section className={`${card} lg:sticky lg:top-0 z-10`}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 items-center text-sm">
          <label className="flex items-center gap-2"><span className="text-[#8b949e]">language</span><Seg value={lang} options={langs.map((l) => [l, LANG[l] ?? l])} onChange={(v) => { setLang(v); setDropped(new Set()); setReplay(null); }} /></label>
          <label className="flex items-center gap-2"><span className="text-[#8b949e]">model</span><Seg value={kindSel} options={[['auto', `auto (${kind === 'quad' ? 'quadratic' : kind === 'twofi' ? 'interactions' : 'main'})`], ['main', 'main effects'], ['twofi', '+ interactions'], ['quad', 'full quadratic']]} onChange={setKind} /></label>
          <label className="flex items-center gap-2 w-full sm:w-auto"><span className="text-[#8b949e]">response</span>
            <select className={`${sel} w-0 flex-1 sm:w-auto sm:flex-none`} value={resp} onChange={(e) => setResp(e.target.value as Response)}>{(Object.keys(RESP) as Response[]).map((r) => <option key={r} value={r}>{RESP[r].label}</option>)}</select></label>
          <label className="flex items-center gap-2"><span className="text-[#8b949e]">books</span><Seg value={weighted ? 'w' : 'p'} options={[['p', 'panel as drawn'], ['w', 'weighted to the queue']]} onChange={(v) => setWeighted(v === 'w')} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={james} onChange={(e) => setJames(e.target.checked)} /><span>include the .agy-james pool runs</span></label>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 items-center text-sm">
          <label className="flex items-center gap-2 grow max-w-xl"><span className="text-[#8b949e] whitespace-nowrap">replay: first</span>
            <input type="range" min={1} max={Math.max(1, eligible.length)} value={upTo} onChange={(e) => { const v = Number(e.target.value); setReplay(v >= eligible.length ? null : v); }} className="grow" />
            <span className="whitespace-nowrap">{upTo} of {eligible.length} runs{replay !== null ? '' : ' (all)'}</span></label>
          <span className="text-[#8b949e]">{obs.length.toLocaleString('en')} page rows · {new Set(obs.map((o) => o.book)).size} books · {terms.length} terms{boot.sig === sig && !bootFits ? ` · bootstrap ${boot.progress}/${B}` : bootFits ? ` · ${B} bootstrap resamples by book` : ''}</span>
          {terms.length >= nRuns - 1 && <span className="text-[#d29922]">{terms.length} terms on {nRuns} runs: the surface passes through the runs and its shape between them is a guess</span>}
          {weighted && unweighted > 0 && <span className="text-[#d29922]">{unweighted} books have no queue weight: weight 1</span>}
        </div>
      </section>

      {noData ? <p className={card}>No scored runs for this language under these filters yet.</p> : (<>
        {/* ── the surface ── */}
        <section className={card}>
          <h2 className={h2}>Predicted {R.short} over pages a call × long edge</h2>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 items-center text-sm">
            <label className="flex items-center gap-2"><span className="text-[#8b949e]">thinking</span><input type="range" min={-1} max={1} step={1} value={think} onChange={(e) => setThink(Number(e.target.value))} /><span className="w-14">{THINK_NAME[think + 1]}</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={line} onChange={(e) => setLine(e.target.checked)} /><span>with the prompt line</span></label>
            <label className="flex items-center gap-2"><span className="text-[#8b949e]">CER margin over live</span><input type="range" min={0} max={0.03} step={0.001} value={margin} onChange={(e) => setMargin(Number(e.target.value))} /><span className="w-16">+{(100 * margin).toFixed(1)} pp</span></label>
          </div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_1fr] gap-4">
            <div>
              <Contour z={grid.z} feasible={grid.feas} inRegion={grid.inR} n={N} ppcRange={ppcRange} edgeRange={edgeRange} range={grid.range} fmt={R.fmt}
                points={designOnSlice.map((d) => ({ ppc: d.s.pages_a_call, edge: d.edge, live: !!d.s.live, label: [d.s.id] }))}
                live={think === -1 && !line ? livePt : null} opt={optPtOnSlice}
                cloud={bootOpts.filter((o) => o.point.think === think && o.point.line === line).map((o) => o.point)} onTip={setTip}
                probe={(ppc, edge) => { const v = predictAll(fitSet, terms, { ppc, edge, think, line }); return [`${ppc.toFixed(1)} a call · ${Math.round(edge).toLocaleString('en')} px · ${THINK_NAME[think + 1]}`, `CER ${fmtPct(v.cer)} · cost ${RESP.quota_cost.fmt(v.quota_cost)} · ${v.calls.toFixed(2)} calls · ${v.accepted_per_hour.toFixed(0)} accepted/h`]; }} />
              <RampLegend range={grid.range} fmt={R.fmt} label={R.label} />
              <Tip lines={tip} />
            </div>
            <div className="text-sm">
              <p><span className="text-[#d29922]">Live</span> (4 a call, as served, low): predicted CER {fmtPct(liveCer)}{(() => { const iv = interval((f) => predictAll(f, terms, livePt).cer); return iv ? ` [${fmtPct(iv[0])}, ${fmtPct(iv[1])}]` : ''; })()}, {R.short} {R.fmt(predictAll(fitSet, terms, livePt)[resp])}.</p>
              {opt ? <>
                <p className="mt-2"><span className="text-[#58a6ff]">Optimum</span> by {MAXIMISE[obj] ? 'highest' : 'lowest'} {RESP[obj].short} with predicted CER within +{(100 * margin).toFixed(1)} pp of live: <strong>{ptName(opt.point)}</strong>; {RESP[obj].short} {RESP[obj].fmt(opt.value)}{(() => { const iv = interval((f) => predictAll(f, terms, opt.point)[obj]); return iv ? ` [${RESP[obj].fmt(iv[0])}, ${RESP[obj].fmt(iv[1])}]` : ''; })()}, CER {fmtPct(opt.cer)}{(() => { const iv = interval((f) => predictAll(f, terms, opt.point).cer); return iv ? ` [${fmtPct(iv[0])}, ${fmtPct(iv[1])}]` : ''; })()}. {opt.feasible} of {cands.length} candidate points inside the region pass the margin.</p>
                {bootOpts.length > 0 && <p className="mt-2 text-[#8b949e]">Where the optimum lands across {bootOpts.length} resamples: pages a call {quantile(bootOpts.map((o) => o.point.ppc), 0.05)}–{quantile(bootOpts.map((o) => o.point.ppc), 0.95)}, long edge {Math.round(quantile(bootOpts.map((o) => o.point.edge), 0.05)).toLocaleString('en')}–{Math.round(quantile(bootOpts.map((o) => o.point.edge), 0.95)).toLocaleString('en')} px (90%); thinking {THINK_NAME.map((n, i) => `${n} ${Math.round((100 * bootOpts.filter((o) => o.point.think === i - 1).length) / bootOpts.length)}%`).join(', ')}.</p>}
                {!optPtOnSlice && <p className="mt-2 text-[#8b949e]">The optimum is at thinking {THINK_NAME[opt.point.think + 1]}{opt.point.line ? ', with the prompt line' : ''}: move the slider to see it.</p>}
              </> : <p className="mt-2">No point inside the region is predicted within the margin.</p>}
              <p className="mt-2 text-[#8b949e]">Intervals: 5th–95th percentile over {B} resamples of books. A surface over runs that read different books leans on the book blocks: a pair of settings that never shared a book is compared only through the others.</p>
            </div>
          </div>
        </section>

        {/* ── what if ── */}
        <section className={card}>
          <h2 className={h2}>What if</h2>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <label className="flex items-center gap-2"><span className="w-28 text-[#8b949e]">pages a call</span><input type="range" min={1} max={12} step={1} value={wi.ppc} onChange={(e) => setWi({ ...wi, ppc: Number(e.target.value) })} className="grow" /><span className="w-16">{wi.ppc}</span></label>
              <label className="flex items-center gap-2"><span className="w-28 text-[#8b949e]">long edge</span><input type="range" min={Math.log2(edgeRange[0])} max={Math.log2(edgeRange[1])} step={0.01} value={Math.log2(wi.edge)} onChange={(e) => setWi({ ...wi, edge: Math.round(Math.pow(2, Number(e.target.value))) })} className="grow" /><span className="w-16">{wi.edge.toLocaleString('en')} px</span></label>
              <label className="flex items-center gap-2"><span className="w-28 text-[#8b949e]">thinking</span><input type="range" min={-1} max={1} step={1} value={wi.think} onChange={(e) => setWi({ ...wi, think: Number(e.target.value) })} className="grow" /><span className="w-16">{THINK_NAME[wi.think + 1]}</span></label>
              <label className="flex items-center gap-2"><span className="w-28 text-[#8b949e]">prompt line</span><input type="checkbox" checked={wi.line} onChange={(e) => setWi({ ...wi, line: e.target.checked })} /><span>{wi.line ? 'on' : 'live prompt'}</span></label>
              <div className="flex gap-2"><button type="button" className={btn(false)} onClick={() => setWi(livePt)}>set to live</button>{opt && <button type="button" className={btn(false)} onClick={() => setWi(opt.point)}>set to optimum</button>}</div>
              {(wi.ppc < region.ppc[0] || wi.ppc > region.ppc[1] || wi.edge < region.edge[0] * 0.98 || wi.edge > region.edge[1] * 1.02 || !region.think.includes(wi.think) || (wi.line && !region.line.includes(true))) && <p className="text-[#d29922]">Outside what the runs cover: an extrapolation.</p>}
            </div>
            <table className="text-sm self-start"><tbody>
              {(['cer', 'quota_cost', 'cost_per_accepted', 'calls', 'accepted_per_hour'] as Response[]).map((r) => {
                const iv = interval((f) => predictAll(f, terms, wi)[r]);
                return <tr key={r} className="border-b border-[#21262d]"><td className="py-1 pr-3 text-[#8b949e]">{RESP[r].label}</td><td className="pr-3 text-[#f0f6fc]">{RESP[r].fmt(wiPred[r])}</td><td className="text-[#8b949e]">{iv ? `[${RESP[r].fmt(iv[0])}, ${RESP[r].fmt(iv[1])}]` : '…'}</td></tr>;
              })}
              <tr><td className="py-1 pr-3 text-[#8b949e]">from the frontier ({RESP[obj].short} against the best point at equal or lower CER)</td><td colSpan={2} className="text-[#f0f6fc]">{wiGap === null ? '–' : wiGap <= 0.005 ? 'on it' : `${Math.round(100 * wiGap)}% ${MAXIMISE[obj] ? 'below' : 'above'}`}</td></tr>
            </tbody></table>
          </div>
        </section>

        {/* ── cost against CER ── */}
        <section className={card}>
          <h2 className={h2}>{RESP[obj].short} against CER, every run</h2>
          <p className="text-sm text-[#8b949e]">Book-adjusted run means: each run&apos;s mean of (page − that book&apos;s mean over the runs shown) plus the overall mean, so runs that read different books stand on one scale. Grey line: the efficiency frontier (no run beats it on both). Dashed: live&apos;s predicted CER + the margin.</p>
          <Scatter pts={scatterPts} line={front} hline={liveCer + margin} xLabel={RESP[obj].label} yLabel="CER, lower is better" fx={RESP[obj].fmt} fy={(v) => fmtPct(v, 1)} onTip={setTip2} />
          <Tip lines={tip2} />
        </section>

        {/* ── coefficients ── */}
        <section className={card}>
          <h2 className={h2}>Coefficients</h2>
          <p className="text-sm text-[#8b949e]">Change in the response for a step of one coded unit: pages a call a factor of 2.8 (1 → 2.8 → 8, in log pages), long edge a factor of 1.8 in pixels (768 → 1,357 → 2,400), thinking one level, the prompt line half its on/off contrast. Within book; 90% intervals by bootstrap. A dash (–) means the runs cannot separate that term from the others.</p>
          <div className="overflow-x-auto">
            <table className="mt-2 text-sm w-full"><thead><tr className="text-left text-[#8b949e] border-b border-[#30363d]"><th className="py-1 pr-3 font-normal">term</th>{R.base.map((b) => <th key={b} className="pr-3 font-normal">{BASE_NAME[b]}</th>)}</tr></thead>
              <tbody>{terms.map((t, j) => (
                <tr key={t.name} className="border-b border-[#21262d]"><td className="py-1 pr-3">{t.name}</td>{R.base.map((b) => {
                  const f = fits[b]; const iv = ci(j, b);
                  const sig0 = iv && (iv[0] > 0 || iv[1] < 0);
                  return <td key={b} className={`pr-3 ${sig0 ? 'text-[#f0f6fc] font-semibold' : ''}`}>{f.estimable[j] ? <>{BASE_FMT[b](f.beta[j])}{iv ? <span className="text-[#8b949e] font-normal"> [{BASE_FMT[b](iv[0])}, {BASE_FMT[b](iv[1])}]</span> : ''}</> : '–'}</td>;
                })}</tr>
              ))}</tbody></table>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-[#f0f6fc]">Half-normal plot, {BASE_NAME[primary]}</h3>
              <p className="text-sm text-[#8b949e]">|coefficient ÷ its bootstrap sd| against half-normal quantiles. Terms that are noise fall on the dashed line; a real effect stands above it, top right.</p>
              {halfNormal.length ? <Scatter pts={halfNormal.map((h) => ({ x: h.q, y: h.z, tip: [h.name, `|z| ${h.z.toFixed(2)}`], tone: h.z > 2 ? 'opt' : 'ink' }))} diag zeroX xLabel="half-normal quantile" yLabel="|estimate ÷ sd|" fx={(v) => v.toFixed(1)} fy={(v) => v.toFixed(1)} w={400} h={240} onTip={setTip2} /> : <p className="text-sm text-[#8b949e]">Waiting for the bootstrap…</p>}
            </div>
            <div>
              <h3 className="font-semibold text-[#f0f6fc]">Residuals against fitted, {BASE_NAME[primary]}</h3>
              <p className="text-sm text-[#8b949e]">One point a page row, within book. A funnel or a curve says the model is missing something.</p>
              <Scatter pts={fitP.resid.slice(0, 2500).map((r) => ({ x: r.fitted, y: r.resid, tip: [`fitted ${r.fitted.toFixed(4)}`, `residual ${r.resid.toFixed(4)}`], r: 2, tone: 'ink' }))} xLabel={`fitted ${BASE_NAME[primary]}`} yLabel="residual" fx={(v) => (primary === 'cer' || primary === 'accepted' ? fmtPct(v, 1) : primary === 'quota_cost' ? `$${(1000 * v).toFixed(1)}` : v.toFixed(2))} fy={(v) => (primary === 'cer' || primary === 'accepted' ? fmtPct(v, 1) : primary === 'quota_cost' ? `$${(1000 * v).toFixed(1)}` : v.toFixed(2))} w={400} h={240} />
            </div>
          </div>
        </section>

        {/* ── fit history ── */}
        <section className={card}>
          <h2 className={h2}>Fit history: where the optimum sat after each run</h2>
          <p className="text-sm text-[#8b949e]">Refit on the first k runs in the order they finished (the filters and dropped runs above apply). A surface that has found something settles; one still learning wanders.</p>
          {history.length ? <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Scatter pts={history.filter((h) => h.o).map((h) => ({ x: h.k, y: h.o!.point.ppc, tip: [`after ${h.k} runs (last ${h.run})`, ptName(h.o!.point)], tone: 'opt' }))} line={history.filter((h) => h.o).map((h) => ({ x: h.k, y: h.o!.point.ppc }))} xLabel="runs fitted" yLabel="optimum: pages a call" fx={(v) => v.toFixed(0)} fy={(v) => v.toFixed(0)} w={300} h={200} onTip={setTip2} />
            <Scatter pts={history.filter((h) => h.o).map((h) => ({ x: h.k, y: h.o!.point.edge, tip: [`after ${h.k} runs (last ${h.run})`, ptName(h.o!.point)], tone: 'opt' }))} line={history.filter((h) => h.o).map((h) => ({ x: h.k, y: h.o!.point.edge }))} xLabel="runs fitted" yLabel="optimum: long edge px" fx={(v) => v.toFixed(0)} fy={(v) => Math.round(v).toLocaleString('en')} w={300} h={200} onTip={setTip2} />
            <Scatter pts={history.filter((h) => h.o).map((h) => ({ x: h.k, y: h.o!.value, tip: [`after ${h.k} runs (last ${h.run})`, `${RESP[obj].short} ${RESP[obj].fmt(h.o!.value)} at thinking ${THINK_NAME[h.o!.point.think + 1]}`], tone: h.o!.point.think === -1 ? 'ink' : 'opt' }))} line={history.filter((h) => h.o).map((h) => ({ x: h.k, y: h.o!.value }))} xLabel="runs fitted" yLabel={`optimum: ${RESP[obj].short}`} fx={(v) => v.toFixed(0)} fy={RESP[obj].fmt} w={300} h={200} onTip={setTip2} />
          </div> : <p className="text-sm text-[#8b949e]">Needs at least three runs.</p>}
          <Tip lines={tip2} />
        </section>

        {/* ── runs ── */}
        <section className={card}>
          <h2 className={h2}>Runs in the fit</h2>
          <p className="text-sm text-[#8b949e]">Untick a run to drop it and watch how far the surface moves. Order: when each finished.</p>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 text-sm">
            {runs.map((r, i) => {
              const s = r.setting; const inPool = james || r.pool === 'default'; const inReplay = eligible.indexOf(r) < upTo;
              return <label key={r.key} className={`flex items-center gap-2 py-0.5 ${inPool && inReplay ? '' : 'text-[#6e7681]'}`}>
                <input type="checkbox" checked={!dropped.has(r.key)} disabled={!inPool} onChange={(e) => { const d = new Set(dropped); if (e.target.checked) d.delete(r.key); else d.add(r.key); setDropped(d); }} />
                <span className="w-8 text-right text-[#6e7681]">{i + 1}</span><span className="w-10">{r.run_id}</span>
                <span className="truncate">{s ? `${s.pages_a_call}/call · ${s.long_edge ?? 'served'} · ${s.thinking}${s.prompt_line !== 'live' ? ' · line' : ''}` : ''} · {r.pool}{s?.live ? ' · live' : ''} · {r.n} books{!inPool ? ' (pool off)' : !inReplay ? ' (after replay point)' : ''}</span>
              </label>;
            })}
          </div>
        </section>
      </>)}
      <p className="mt-6 text-xs text-[#6e7681]">Fitted at the default pool. Rows per response: {BASES.map((b) => `${BASE_NAME[b]} ${fits[b].n}`).join(' · ')}. Live coded at [{code(livePt).map((v) => v.toFixed(2)).join(', ')}] ({FACTORS.join(', ')}).</p>
    </div>
  );
}

function variance(xs: number[]) {
  const v = xs.filter(Number.isFinite); if (v.length < 2) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1);
}

