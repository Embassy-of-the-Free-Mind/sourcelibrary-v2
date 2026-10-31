/**
 * /platform/admin/ocr-evidence/read-surface — the Box-Behnken tuning of the agy first read (#6740).
 *
 * Renders src/data/ocr-read-surface-6740.json, written by scripts/eval/read-surface-6740/fit.mjs from the scored runs.
 * The page computes nothing but scales and contour lines; every number, interval and verdict comes from that script,
 * under the rule preregistered in scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md.
 * Gated by the protected layout (requireSuperAdmin).
 */
import Link from 'next/link';
import data from '@/data/ocr-read-surface-6740.json';
import { SurfacePanels, DesignPareto, RoutePareto, type LangSurface, type Route } from './SurfaceCharts';

export const metadata = { title: 'Read settings by response surface (#6740)' };

const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';
const LANG: Record<string, string> = { de: 'German (DTA references)', la: 'Latin (CAMENA references)', fr: 'French' };
const pct = (v: number, d = 2) => `${(100 * v).toFixed(d)}%`;
const pp = (v: number) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(2)} pp`;

type Confirmation = { lang: string; n_drawn: number; passes: boolean; planted: string; routes: Record<string, { written: string; wrong_text: string; p_acc_ge_080: number; calls: number; eligible: boolean; not_written: Record<string, number> }>; paired: { a_only: number; b_only: number; n: number; p: number } | null };
type Lang = LangSurface & { status?: string; face_counts?: Record<string, number>; excluded: { slug: string; why: string }[]; c1: number };

export default function ReadSurfacePage() {
  const langs = data.langs as unknown as Record<string, Lang>;
  const routes = data.routes as Route[];
  const conf = (data as unknown as { confirmation: Confirmation | null }).confirmation;
  return (
    <main className="max-w-5xl mx-auto px-4 py-8 text-[#e6edf3]">
      <p className="text-sm text-[#8b949e]"><Link href="/platform/admin/ocr-evidence" className="underline decoration-[#30363d] hover:text-[#58a6ff]">OCR evidence</Link> / read settings</p>
      <h1 className="text-2xl font-semibold text-[#f0f6fc] mt-1">Which read settings give the fewest agy calls a page without losing accuracy?</h1>
      <p className="mt-3 max-w-3xl">
        The agy Flash first read has three settings: how many pages go in one call, how large the image is, and how much the
        model thinks. Each run below read the same target page of every book, against a human-typed edition of that page
        (DTA for German, CAMENA for Latin). Fifteen runs a language were planned (a Box-Behnken design over the three settings at three levels each); after the
        first runs the rest were chosen one batch at a time where a quadratic surface, with earlier reads as a weighted prior,
        was least sure near the cheap end, and ten a language were made. The rule for choosing was fixed before any call: the
        setting with the fewest calls a page whose CER is no more than 1 percentage point above the live setting at the 95%
        bound (the surface and, for a setting that was run, its own paired difference), and at least 10% cheaper than the live
        run on the same agy account.
      </p>
      <p className="mt-2 text-sm text-[#8b949e] max-w-3xl">
        <code>measure</code>: accuracy (CER against a typed reference, windowed) for the surfaces; judged (a blind Opus
        verdict against the image) for #7701&apos;s routes. n is books, one target page each. Preregistration: commit{' '}
        <code>{data.prereg_commit}</code>, <a className="underline decoration-[#30363d] hover:text-[#58a6ff]" href={`${GH}${data.experiment}`}>experiment file</a>. Fitted {data.fitted_at.slice(0, 16).replace('T', ' ')} UTC, {data.boot} bootstrap resamples by book.
      </p>

      {Object.entries(langs).map(([lang, L]) => (
        <section key={lang} className="mt-10 rounded-lg border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="text-xl font-semibold text-[#f0f6fc]">{LANG[lang] ?? lang}</h2>
          {L.status ? <p className="mt-2 text-[#c9d1d9]">{L.status}</p> : (
            <>
              <p className="mt-2 max-w-3xl">
                <strong>{L.optimum.verdict}.</strong>{' '}
                {conf && conf.lang === lang && <strong>{conf.passes ? 'Confirmed on queue pages (below). ' : 'Not confirmed on queue pages (below): nothing switches. '}</strong>}
                {L.optimum.setting && <>Cheapest non-inferior setting: {L.optimum.setting.ppc} pages a call, {L.optimum.setting.edge} px, thinking {L.optimum.setting.think}:{' '}
                  {(L.optimum.setting.measured?.calls ?? L.optimum.setting.calls).toFixed(2)} agy calls a page (cost),{' '}
                  {L.optimum.saving != null ? `${Math.round(100 * L.optimum.saving)}% fewer than the live run on the same agy account` : `against live's ${L.live.calls?.toFixed(2)}`}; predicted CER {pp(L.optimum.setting.delta)} vs live
                  [{pp(L.optimum.setting.delta_lo)}, {pp(L.optimum.setting.delta_hi)}] (accuracy).</>}
              </p>
              <p className="mt-1 text-sm text-[#8b949e] max-w-3xl">
                n = {L.books} books{L.face_counts ? ` (${Object.entries(L.face_counts).map(([f, k]) => `${k} ${f}`).join(', ')} by eye)` : ''}.
                Live CER {pct(L.live.cer)} (accuracy, mean of the two live runs). Noise floor (A-vs-A, {L.noise.from ?? 'centre runs'},
                paired by book): {(100 * L.noise.band).toFixed(2)} pp. Savings are judged against the live run on the same agy
                account: the two accounts&apos; filters cut different shares of the same blocks. {L.excluded.length ? `Left out of every run: ${L.excluded.length} target page(s), the image another leaf than the typed page.` : ''}
              </p>
              <h3 className="mt-5 font-semibold text-[#f0f6fc]">Before this design: what earlier reads said (prior only)</h3>
              <p className="text-sm text-[#8b949e] max-w-3xl">
                Earlier agy first reads on typed pages, all at 1 a call, image as served, thinking low
                ({L.prior?.cer.map((p) => p.label).join('; ') || 'none'}), and #7701&apos;s calls a page on queue pages
                ({L.prior?.calls.map((p) => p.label).join('; ') || 'none'}). Weighted by a power prior: a0 = {L.prior?.a0.cer.a0 ?? '–'} for CER,
                {' '}{L.prior?.a0.calls.a0 ?? '–'} for calls, chosen by how well the earlier results agree with this design&apos;s own runs at the nearest setting.
                Far from that one corner the prior says little: the surface is flat and its intervals wide.
              </p>
              <SurfacePanels L={L} which="cer" prior />
              <h3 className="mt-5 font-semibold text-[#f0f6fc]">After: predicted CER (accuracy), posterior</h3>
              <SurfacePanels L={L} which="cer" />
              <h3 className="mt-4 font-semibold text-[#f0f6fc]">Predicted agy calls a page (cost)</h3>
              <SurfacePanels L={L} which="calls" />
              <h3 className="mt-4 font-semibold text-[#f0f6fc]">Cost against accuracy, every setting</h3>
              <DesignPareto L={L} />
              <details className="mt-2">
                <summary className="cursor-pointer text-[#c9d1d9] hover:text-[#58a6ff]">The {L.runs.length} runs as measured (table view)</summary>
                <div className="overflow-x-auto">
                  <table className="mt-2 text-sm w-full">
                    <thead><tr className="text-left text-[#8b949e] border-b border-[#30363d]">
                      <th className="py-1 pr-3 font-normal">run</th><th className="pr-3 font-normal">pages a call</th><th className="pr-3 font-normal">long edge</th><th className="pr-3 font-normal">thinking</th>
                      <th className="pr-3 font-normal">CER (accuracy)</th><th className="pr-3 font-normal">agy calls a page</th><th className="pr-3 font-normal">wall s a page</th><th className="pr-3 font-normal">wrong text</th><th className="font-normal">targets read alone (imputed)</th>
                    </tr></thead>
                    <tbody>{L.runs.map((r) => (
                      <tr key={r.id} className="border-b border-[#21262d]">
                        <td className="py-1 pr-3">{r.id}{r.live ? ' (live)' : ''}</td><td className="pr-3">{r.ppc}</td><td className="pr-3">{r.edge ?? 'as served'}</td><td className="pr-3">{r.think}</td>
                        <td className="pr-3">{pct(r.cer)}</td><td className="pr-3">{r.calls.toFixed(3)}</td><td className="pr-3">{r.secs.toFixed(1)}</td><td className="pr-3">{r.wrong} of {L.books} books</td><td>{r.imputed}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <p className="text-sm text-[#8b949e] mt-2 max-w-3xl">
                  agy calls a page = (calls made + {L.c1.toFixed(2)} × pages a refused block left unread) ÷ pages in the run: production reads such a page
                  alone, at the 1-a-call rate measured here. Its target&apos;s CER is taken from the 1-a-call run at the same size and thinking, else the mean of the 1-a-call runs.
                </p>
              </details>
              <h3 className="mt-5 font-semibold text-[#f0f6fc]">The routes #7701 tested{lang === 'la' ? ' (Latin)' : ' (German)'}, judged</h3>
              <p className="text-sm text-[#8b949e] max-w-3xl">A different measure and other pages: accepted share of written pages by a blind Opus judge against the image. Read beside the surface, not on its axis.</p>
              <RoutePareto routes={routes} lang={lang} />
            </>
          )}
        </section>
      ))}
      {conf && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-[#f0f6fc]">Confirmation on queue pages: Latin</h2>
          <p className="mt-2 max-w-3xl">
            The Latin optimum against the live knobs on the same {conf.n_drawn} new pages waiting in the first-read queue
            (one per book), each route as the lane would run and write it, judged blind by Opus against the page image
            (<code>measure</code>: judged). <strong>{conf.passes ? 'It passes the router rule.' : 'It does not pass the router rule: nothing switches.'}</strong>{' '}
            Planted errors caught: {conf.planted}.
          </p>
          <table className="mt-2 text-sm">
            <thead><tr className="text-left text-[#8b949e] border-b border-[#30363d]"><th className="py-1 pr-4 font-normal">route</th><th className="pr-4 font-normal">written pages accepted (judged)</th><th className="pr-4 font-normal">wrong text</th><th className="pr-4 font-normal">P(accept ≥ 0.8)</th><th className="pr-4 font-normal">agy calls a page</th><th className="font-normal">not written</th></tr></thead>
            <tbody>{Object.entries(conf.routes).map(([r, x]) => (
              <tr key={r} className="border-b border-[#21262d]"><td className="py-1 pr-4">{r}</td><td className="pr-4">{x.written}</td><td className="pr-4">{x.wrong_text}</td><td className="pr-4">{x.p_acc_ge_080}</td><td className="pr-4">{x.calls}</td><td>{Object.entries(x.not_written).map(([k, v]) => `${v} ${k}`).join('; ')}</td></tr>
            ))}</tbody>
          </table>
          {conf.paired && <p className="mt-2 text-sm text-[#8b949e]">Paired on the {conf.paired.n} pages both wrote (books): optimum only {conf.paired.a_only}, live only {conf.paired.b_only}; P(acc_optimum ≥ acc_live − 0.08) = {conf.paired.p} (the rule needs 0.9).</p>}
        </section>
      )}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-[#f0f6fc]">French</h2>
        <p className="mt-2 max-w-3xl">Not in the design: no library French page has a typed reference (#7567&apos;s 40 French pages are Wikisource&apos;s own scans). The #7701 routes, judged:</p>
        <RoutePareto routes={routes} lang="fr" />
      </section>
    </main>
  );
}
