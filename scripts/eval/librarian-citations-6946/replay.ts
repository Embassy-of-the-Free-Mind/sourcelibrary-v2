/**
 * Librarian citations (#6946) — replay the citation-page pass over the recorded
 * #6904 answers. No answer-model turns: the raw streamed text, the grounding
 * edits and the link fixes are the recorded ones.
 *
 * Per answer, interleaved so neither arm always runs first:
 *   1. latency — the production post-stream path, `groundTurn`, twice against
 *      production Mongo: router off (today) and router on (one
 *      gemini-3.1-flash-lite call, fired at "stream end" on the prefetched
 *      pages). Added latency after the last text chunk = on − off.
 *   2. text — the citation pass over the RECORDED grounding edits, with the
 *      verdicts the router-on run had in hand when its pass ran (so a verdict
 *      that missed the wait is not applied here either).
 *
 * Known differences from a live turn: the tool-result text was not recorded,
 * so the early groundAnswer in (1) runs without it; the neighbour pages search
 * hands over were not recorded either (see load-support.ts). The prefetch is
 * loaded before the clock starts, as it is during streaming in production.
 *
 * PRIOR ART: scripts/eval/librarian-speed-6904/run.ts (generates the answers
 * and applies the edits in route.ts order — reused here, minus the turn).
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-citations-6946/replay.ts --in=<main.jsonl.gz> --support=<support.json.gz> \
 *     --out=<after.jsonl> [--arms=B] [--only=q01,q02] [--no-router] [--max-usd=1]
 *     [--direct]            the router on the full support set, no clock (quality ceiling)
 *     [--reapply=<prior>]   the pass again over a prior run's saved verdicts (no model calls);
 *                           with --no-router, the deterministic pass alone
 * Writes one row per answer: {key, q, text, before, report, latency, routerUsage, cost}.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as fixesLib from '@/lib/embassy/citation-fixes';
import { checkCitationPages, type RoutedClaims } from '@/lib/embassy/citation-pages';
import { CitationRoutingStream } from '@/lib/embassy/citation-routing';
import { flashLiteCitationRouter, CITATION_ROUTER_MODEL, type RouterUsage } from '@/lib/embassy/citation-router';
import { groundAnswer, type GroundingEdit, type GroundingImage, type GroundingPage } from '@/lib/embassy/grounding';
import { groundTurn, loadSupportPages, resolveBookIds } from '@/lib/embassy/librarian';
import { estimateCostUsd } from '@/lib/log-ai-usage';
import type { Locale } from '@/lib/locale-path';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const flag = (name: string) => process.argv.includes(`--${name}`);
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');

const arms = (arg('arms', 'B') as string).split(',');
const only = arg('only')?.split(',');
const MAX_USD = Number(arg('max-usd', '1'));
/** Characters per second the answer is fed at: the p75 of the recorded turns (fast side). */
const STREAM_CHARS_PER_S = Number(arg('chars-per-s', '900'));
const CHUNK = 60;
const siteBaseFor = (lang: Locale) => (lang === 'en' ? 'https://sourcelibrary.org' : `https://sourcelibrary.org/${lang}`);

type Row = {
  id: string; q: string; arm: string; lang: Locale; raw: string; final: string; error?: string;
  sources: Array<{ book_id: string; pageNumber?: number }>;
  groundingEdits: GroundingEdit[]; fixes: fixesLib.CitationFix[]; removals: string[];
};

async function main() {
  const rows: Row[] = readMaybeGz(arg('in')!).split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter((r: Row) => !r.error && arms.includes(r.arm) && (!only || only.includes(r.id)));
  const support: Record<string, { pages: GroundingPage[]; images: GroundingImage[] }> = JSON.parse(readMaybeGz(arg('support')!));
  const reapplied = new Map<string, { verdicts: Array<[string, { to: string | null; evidence?: string }]>; verdictsAll: Array<[string, { to: string | null; evidence?: string }]> }>(
    arg('reapply') ? fs.readFileSync(arg('reapply')!, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(x => [x.key, x]) : [],
  );
  const outFile = arg('out')!;
  fs.writeFileSync(outFile, '');
  let spent = 0;
  for (const [n, r] of rows.entries()) {
    const key = `${r.id}:${r.arm}`;
    const s = support[key] ?? { pages: [], images: [] };
    if (arg('reapply')) {
      // The pass again over a previous run's verdicts (no model calls): for a guard change.
      const prior = reapplied.get(key);
      if (!prior) continue;
      const edits = (r.groundingEdits ?? []).map(e => ({ ...e, reasons: e.reasons ?? [] })) as GroundingEdit[];
      const pass = (v: Array<[string, { to: string | null; evidence?: string }]>) => checkCitationPages({
        text: r.raw, edits, pages: s.pages, supportLoaded: true, images: s.images, routed: Promise.resolve(new Map(v)), routedWaitMs: 0,
      });
      const finalize = (m: GroundingEdit[]) => fixesLib.applyImageRemovals(fixesLib.applyCitationFixes(fixesLib.applyGroundingEdits(r.raw, m), r.fixes ?? []), r.removals ?? []);
      // --no-router with --reapply: the deterministic pass alone (what ships by default).
      const res = await pass(flag('no-router') ? [] : prior.verdicts);
      const resAll = await pass(prior.verdictsAll);
      fs.appendFileSync(outFile, JSON.stringify({ ...prior, text: finalize(res.edits), report: res.report, textAll: finalize(resAll.edits), reportAll: resAll.report, cost: 0, reappliedFrom: arg('reapply') }) + '\n');
      continue;
    }
    if (flag('direct')) {
      // Quality only: the router on the full support set, no clock (what the pass can do at best).
      let du: RouterUsage | null = null;
      const edits = (r.groundingEdits ?? []).map(e => ({ ...e, reasons: e.reasons ?? [] })) as GroundingEdit[];
      const res = await checkCitationPages({
        text: r.raw, edits, pages: s.pages, supportLoaded: true, images: s.images,
        router: flag('no-router') ? undefined : flashLiteCitationRouter({ timeoutMs: 15000, onUsage: u => { du = u; } }),
      });
      const text = fixesLib.applyImageRemovals(fixesLib.applyCitationFixes(fixesLib.applyGroundingEdits(r.raw, res.edits), r.fixes ?? []), r.removals ?? []);
      const u = du as RouterUsage | null;
      const cost = u ? estimateCostUsd(CITATION_ROUTER_MODEL, u.inputTokens, u.outputTokens) : 0;
      spent += cost;
      fs.appendFileSync(outFile, JSON.stringify({ key, q: r.q, text, before: r.final, report: res.report, routerUsage: u, cost }) + '\n');
      const rep = res.report;
      console.log(`${key}\tqOK=${rep.quotesOnCitedPage} qMoved=${rep.quotesRepointed} stitched=${rep.quotesStitched} routed=${rep.claimsRouted} moved=${rep.claimsRepointed} dropped=${rep.linksDropped} unch=${rep.uncheckable} call=${u?.ms ?? '-'}ms in=${u?.inputTokens ?? 0} total=$${spent.toFixed(4)}`);
      continue;
    }
    // Latency + text: the production path, with the answer fed to the router at
    // STREAM_CHARS_PER_S as it streamed (the replay has no chunk timings).
    const retrieved = new Set(r.sources.filter(x => x.pageNumber).map(x => `${x.book_id}:${x.pageNumber}`));
    const usages: RouterUsage[] = [];
    const useRouter = !flag('no-router') && spent < MAX_USD;
    const routing = new CitationRoutingStream({
      router: flashLiteCitationRouter({ timeoutMs: 4000, onUsage: u => { usages.push(u); } }),
      loadPages: keys => loadSupportPages(keys, r.lang),
      resolveSlugs: slugs => resolveBookIds(slugs, r.sources as never),
      retrievedKeys: () => [...retrieved],
      ground: (unit, pages) => fixesLib.applyGroundingEdits(unit, groundAnswer({
        text: unit, pages, supportLoaded: true, extraSupport: '', images: [], question: r.q, siteBase: siteBaseFor(r.lang),
      }).edits),
    });
    const base = {
      rawText: r.raw, history: [], retrievedPageKeys: retrieved, images: s.images, lang: r.lang,
      toolSupportText: [], userMessage: r.q, notebookSaved: false,
    };
    const runOff = () => groundTurn({ ...base, routing: null });
    const runOn = async () => {
      for (let at = 0; at < r.raw.length; at += CHUNK) {
        const chunk = r.raw.slice(at, at + CHUNK);
        await new Promise(res => setTimeout(res, (chunk.length / STREAM_CHARS_PER_S) * 1000));
        if (useRouter && chunk.includes('\n')) routing.feed(r.raw.slice(0, at + CHUNK));
      }
      if (useRouter) routing.finish(r.raw);
      return groundTurn({ ...base, routing: useRouter ? routing : null });
    };
    const offFirst = n % 2 === 0;
    const first = await (offFirst ? runOff() : runOn());
    const second = await (offFirst ? runOn() : runOff());
    const [off, on] = offFirst ? [first, second] : [second, first];
    const inTime = on.verdicts ?? new Map();
    const all = await routing.settled();

    // Text: the citation pass over the edits production actually sent.
    const edits = (r.groundingEdits ?? []).map(e => ({ ...e, reasons: e.reasons ?? [] })) as GroundingEdit[];
    const pass = (v: RoutedClaims) => checkCitationPages({ text: r.raw, edits, pages: s.pages, supportLoaded: true, images: s.images, routed: Promise.resolve(v), routedWaitMs: 0 });
    const finalize = (m: GroundingEdit[]) => fixesLib.applyImageRemovals(fixesLib.applyCitationFixes(fixesLib.applyGroundingEdits(r.raw, m), r.fixes ?? []), r.removals ?? []);
    const res = await pass(inTime);
    // Sensitivity arm: every verdict applied, however late it came (not what ships).
    const resAll = await pass(all);
    const cost = usages.reduce((sum, u) => sum + estimateCostUsd(CITATION_ROUTER_MODEL, u.inputTokens, u.outputTokens), 0);
    spent += cost;
    const latency = {
      offMs: off.timings.totalMs, onMs: on.timings.totalMs, addedMs: on.timings.totalMs - off.timings.totalMs,
      supportMs: on.timings.supportMs, batches: routing.stats.batches, batchMs: routing.stats.batchMs,
      verdictsInTime: inTime.size, verdictsAll: all.size,
    };
    fs.appendFileSync(outFile, JSON.stringify({
      key, q: r.q, before: r.final, text: finalize(res.edits), report: res.report, textAll: finalize(resAll.edits), reportAll: resAll.report,
      latency, routerUsage: usages, cost, verdicts: [...inTime], verdictsAll: [...all],
    }) + '\n');
    const rep = res.report;
    console.log(`${key}\tqOK=${rep.quotesOnCitedPage} qMoved=${rep.quotesRepointed} stitched=${rep.quotesStitched} routed=${rep.claimsRouted} moved=${rep.claimsRepointed} dropped=${rep.linksDropped} | off=${latency.offMs} on=${latency.onMs} added=${latency.addedMs}ms batches=${latency.batches} [${latency.batchMs.join(',')}] inTime=${inTime.size}/${all.size} $${cost.toFixed(4)} total=$${spent.toFixed(4)}`);
  }
  console.log(`spent $${spent.toFixed(4)} on ${CITATION_ROUTER_MODEL}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
