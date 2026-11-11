/**
 * The original-text lane's grace (#2049, job within-book-semantic): when do its rows arrive, and
 * what does a reader lose at each grace setting? Samples real global search_translations calls
 * from `mcp_tool_calls` (ok, no book_id, English, one per distinct query, seed 2049) and runs the
 * semantic page lane of /api/search for each as `conceptPageSearch` does, with timestamps:
 *   emb      the query vector both lanes share is ready = the original-text lane's start
 *   english  the English lane's answer (VECTOR_SEARCH_MODE as set: run with serve, as production)
 *   lane     the original-text lane's answer, awaited to the end (its own 4 s abort)
 * All times below are from `emb`.
 *
 * Then it replays the fusion (`fuseConceptLanes`) twice per call, with the lane's rows and
 * without them, and scores each rule by the original-text rows that reach the 15 the route takes:
 *   today      the rows arrive by english + 500 ms (the grace counted after the English answer)
 *   G (from the lane start)  the rows arrive by max(english, G)
 * A rule that includes the lane gives that call's "with" output, otherwise its "without" output,
 * so the overlap of two rules is exact, not estimated.
 *
 *   SEARCH_UNTRANSLATED_LANE=on VECTOR_SEARCH_MODE=serve VECTOR_SEARCH_URL=… VECTOR_SEARCH_TOKEN=… \
 *   node --env-file=/root/sourcelibrary/.env.production.local --import tsx \
 *     scripts/eval/search-evals-2049/untranslated-grace.ts --n 30 [--skip 30] --out $JOB_SCRATCH/grace.json
 * Costs one Gemini query embedding per call (the lanes share it). Read-only.
 *
 * PRIOR ART: scripts/eval/orig-lang-recall/untranslated-lane.mjs measures what the lane FINDS
 * (recall on written-for queries), not when it arrives; within-book-parts.ts is the per-part timing
 * shape this follows. search_queries logs the lane's state (`late`/`ok`) but not its duration.
 */
import { writeFileSync } from 'node:fs';
import { getDb } from '@/lib/mongodb';
import {
  getQueryEmbedding, semanticPageSearchGlobal, semanticPageSearchUntranslated,
  type SemanticPageSearchOptions, type UntranslatedLaneResult,
} from '@/lib/semantic-search';
import { fuseConceptLanes } from '@/lib/search/concept-search';
import { defaultDiversity, parseDiversityParam } from '@/lib/search/diversity';
// @ts-expect-error — plain-JS module, no declarations
import { makeRng } from '../lib/paired-stats.mjs';

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const N = +(opt('n', '30') as string);
const SKIP = +(opt('skip', '0') as string); // a second, disjoint panel: --skip 30
const OUT = opt('out');
const LIMIT = 15; // what /api/search asks of conceptPageSearch
const TODAY_GRACE = 500;
const SETTINGS = [0, 100, 250, 300, 400, 500, 750, 1000];

interface Call { query: string; diversity: string | null }

async function sample(): Promise<Call[]> {
  const db = await getDb();
  const rows = await db.collection('mcp_tool_calls')
    .find({ tool: 'search_translations', ok: true, ts: { $gte: new Date(Date.now() - 14 * 864e5) } })
    .project({ args: 1 }).toArray();
  const seen = new Set<string>();
  const calls: Call[] = [];
  for (const r of rows) {
    const a = r.args as Record<string, unknown>;
    if (a.book_id || (a.lang && a.lang !== 'en') || !a.query) continue;
    const query = String(a.query).trim();
    if (seen.has(query)) continue;
    seen.add(query);
    calls.push({ query, diversity: typeof a.diversity === 'string' ? a.diversity : null });
  }
  const rng = makeRng(2049);
  for (let i = calls.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [calls[i], calls[j]] = [calls[j], calls[i]]; }
  return calls.slice(SKIP, SKIP + N);
}

const ids = (rows: { page_id: string }[]) => rows.map((r) => r.page_id);

async function main() {
  const calls = await sample();
  const out = [];
  for (const c of calls) {
    const isPhrase = /^".*"$/.test(c.query);
    const q = isPhrase ? c.query.slice(1, -1) : c.query;
    const diversity = parseDiversityParam(c.diversity) ?? defaultDiversity(q, { phrase: isPhrase, intent: '', bookScoped: false });
    const opts: SemanticPageSearchOptions = { scope: { kind: 'global' } };
    const t0 = performance.now();
    const emb = getQueryEmbedding(q).then(() => performance.now());
    let laneAt = 0;
    const pending = semanticPageSearchUntranslated(q, 20, opts).then((r) => { laneAt = performance.now(); return r; });
    const english = await semanticPageSearchGlobal(q, 40, opts);
    const englishAt = performance.now();
    const lane: UntranslatedLaneResult = await pending;
    const embAt = await emb;
    const e = englishAt - embAt, u = laneAt - embAt;
    const withLane = await fuseConceptLanes(english, lane, LIMIT, { diversity });
    const without = await fuseConceptLanes(english, { rows: [], state: 'late' }, LIMIT, { diversity });
    const orig = withLane.rows.filter((r) => r.text_lane === 'original' && !without.rows.some((w) => w.page_id === r.page_id));
    const row = {
      query: c.query, diversity, emb_ms: Math.round(embAt - t0), english_ms: Math.round(e), lane_ms: Math.round(u),
      lane_state: lane.state, lane_rows: lane.rows.length, orig_in_output: orig.length,
      with_ids: ids(withLane.rows), without_ids: ids(without.rows),
    };
    out.push(row);
    const { query: _q, with_ids: _w, without_ids: _wo, ...printable } = row; // no user queries on stdout
    console.log(JSON.stringify(printable));
  }

  // Which rule includes the lane's rows on a call.
  const rules: Record<string, (r: typeof out[number]) => boolean> = {
    today: (r) => r.lane_ms <= r.english_ms + TODAY_GRACE,
    ...Object.fromEntries(SETTINGS.map((g) => [`G${g}`, (r: typeof out[number]) => r.lane_ms <= Math.max(r.english_ms, g)])),
  };
  const okCalls = out.filter((r) => r.lane_state === 'ok');
  const todayRows = out.filter(rules.today).reduce((s, r) => s + r.orig_in_output, 0);
  const pick = (rule: string, r: typeof out[number]) => (rules[rule](r) ? r.with_ids : r.without_ids);
  const overlap = (a: string[], b: string[]) => { const s = new Set(b); const d = Math.max(a.length, b.length); return d ? a.filter((x) => s.has(x)).length / d : 1; };
  const table = Object.keys(rules).map((rule) => {
    const incl = out.filter(rules[rule]);
    const rows = incl.reduce((s, r) => s + r.orig_in_output, 0);
    const kept = out.filter((r) => rules.today(r) && rules[rule](r)).reduce((s, r) => s + r.orig_in_output, 0);
    // How long the answer waits for the lane, from the lane start, beyond the English answer.
    const waits = out.map((r) => {
      if (r.lane_state !== 'ok') return 0; // off / failed / unavailable resolve at once
      const deadline = rule === 'today' ? r.english_ms + TODAY_GRACE : Math.max(r.english_ms, +rule.slice(1));
      return Math.max(0, Math.min(r.lane_ms, deadline) - r.english_ms);
    }).sort((a, b) => a - b);
    return {
      rule, calls_with_lane: incl.filter((r) => r.lane_state === 'ok').length, orig_rows_shown: rows,
      of_today_kept: todayRows ? +(kept / todayRows).toFixed(3) : null,
      overlap_vs_today: +(out.reduce((s, r) => s + overlap(pick(rule, r), pick('today', r)), 0) / out.length).toFixed(3),
      added_wait_p50: Math.round(waits[Math.floor(waits.length / 2)]), added_wait_p90: Math.round(waits[Math.floor(waits.length * 0.9)]),
    };
  });
  const arrivals = Object.fromEntries([0, 100, 250, 500, 750, 1000, 2000].map((t) => [`<=${t}`, okCalls.filter((r) => r.lane_ms <= t).length]));
  console.table(table);
  console.log({ n: out.length, lane_ok: okCalls.length, arrivals_from_lane_start: arrivals, today_orig_rows: todayRows });
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), table, arrivals, rows: out }, null, 1));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
