/**
 * Librarian quote requests (v3#249): does a reader who asks for an author's
 * words get a quotation that is on a page, on the first turn?
 *
 * PRIOR ART: scripts/eval/librarian-followup-8151/run.ts — the in-process
 * harness with interleaved arms, held to flash-lite, that this copies. It
 * replays private follow-ups with their history and counts searches; this one
 * sends first messages from a fixed public set (questions.json here) and counts
 * the quotations left in the answer after the grounding pass.
 * scripts/eval/librarian-grounding/run.ts records the same post-turn rewrites
 * for one arm; it has no arms and runs the production model.
 *
 * Arms:
 *   A = quote requests off (quoteRequests: false): the turn as it ran before
 *   B = quote requests on: the prompt lines, and the first round must call
 *       find_passages. (results/run1.jsonl recorded B when get_book_page and
 *       read_nearby_pages were allowed in round one too; results/run2-b2.jsonl
 *       is B as it ships.)
 *
 * Model: the production answer model, gemini-3-flash-preview. Only flash-lite
 * may run on the paid Gemini API without asking; Derek authorised up to 60
 * production-model Librarian turns for v3#249 on 2026-11-13, and --max-turns
 * holds a run to that. Any later run needs its own yes, or
 * --model=gemini-3.1-flash-lite (which measures the routing on flash-lite, not
 * production's own rate).
 *
 * Usage:
 *   npx tsx --env-file=<env> scripts/eval/librarian-quote-requests-249/run.ts \
 *     --out=scripts/eval/librarian-quote-requests-249/results/run1.jsonl [--repeats=2] [--only=id,id] [--arms=A,B] [--concurrency=2]
 *   npx tsx scripts/eval/librarian-quote-requests-249/run.ts --out=<same file> --summary
 *
 * Resumable: rows already in --out (by id+arm+rep) are skipped.
 * Side effects: one ai_usage row per turn (real spend, metered like any turn),
 * one question-search re-rank per find_passages call (its own daily cap), and
 * embassy_errors rows with threadId null when a citation or quotation is
 * flagged. No thread, no notebook writes (threadId is undefined).
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyCitationFixes, applyGroundingEdits, applyImageRemovals, type CitationFix } from '@/lib/embassy/citation-fixes';
import { answerUnits, type GroundingReport } from '@/lib/embassy/grounding';
import { asksForQuotation, streamAgenticResponse, type LibrarianStep, type ToolCallRecord } from '@/lib/embassy/librarian';
import { estimateCostUsd } from '@/lib/log-ai-usage';

const PRODUCTION_MODEL = 'gemini-3-flash-preview';
const HERE = path.dirname(new URL(import.meta.url).pathname);

const arg = (name: string, def?: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const flag = (name: string) => process.argv.includes(`--${name}`);

const outFile = arg('out');
if (!outFile) throw new Error('--out=<file.jsonl> is required');
const only = arg('only')?.split(',');
const arms = (arg('arms', 'A,B') as string).split(',');
const repeats = Number(arg('repeats', '2'));
const concurrency = Number(arg('concurrency', '2'));
const MAX_USD = Number(arg('max-usd', '3'));
const MAX_TURNS = Number(arg('max-turns', '48'));
const REPLAY_MODEL = arg('model', PRODUCTION_MODEL) as string;

type Question = { id: string; q: string };
type Arm = 'A' | 'B';
type Job = Question & { arm: Arm; rep: number };
type Row = {
  id: string; arm: Arm; rep: number; error?: string;
  firstTextMs?: number | null; doneMs: number; rounds?: number | null;
  toolCalls?: ToolCallRecord[]; report?: GroundingReport | null;
  /** Blockquotes left in the answer the reader sees. */
  blockquotesKept?: number;
  /** Distinct books the answer's page links point into. */
  booksCited?: number;
  usage?: LibrarianStep['usage'] | null;
  cost: number; costAtProductionRate?: number; final?: string; raw?: string;
};

const { questions } = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8')) as { questions: Question[] };

function readRows(): Row[] {
  if (!fs.existsSync(outFile!)) return [];
  return fs.readFileSync(outFile!, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Row);
}

async function runOne(job: Job): Promise<Row> {
  const t0 = Date.now();
  let raw = '';
  let usage: LibrarianStep['usage'] | null = null;
  let firstTextMs: number | null = null;
  let fixes: CitationFix[] = [];
  let removals: string[] = [];
  let edits: Array<{ find: string; replace: string; at?: number }> = [];
  let report: GroundingReport | null = null;
  const toolCalls: ToolCallRecord[] = [];
  try {
    const steps = streamAgenticResponse(job.q, [], undefined, { lang: 'en', quoteRequests: job.arm === 'B', model: REPLAY_MODEL });
    for await (const step of steps) {
      const s = step as LibrarianStep & { edits?: typeof edits; report?: GroundingReport };
      if (s.toolCall) toolCalls.push(s.toolCall);
      if (s.type === 'text') {
        raw += s.text || '';
        if (firstTextMs === null && (s.text || '').trim()) firstTextMs = Date.now() - t0;
      } else if (s.type === 'citation_fixes') fixes = s.fixes || [];
      else if (s.type === 'image_removals') removals = s.removeUrls || [];
      else if (s.type === 'grounding_edits') { edits = s.edits || []; report = s.report ?? null; }
      else if (s.type === 'usage') usage = s.usage ?? null;
    }
  } catch (err) {
    return { id: job.id, arm: job.arm, rep: job.rep, error: err instanceof Error ? err.message : String(err), doneMs: Date.now() - t0, cost: 0 };
  }
  const u = usage as LibrarianStep['usage'] | null;
  if (u && u.model !== REPLAY_MODEL) throw new Error(`answer model was ${u.model}, not ${REPLAY_MODEL}`);
  // Same order as route.ts finalizeText: what the reader ends up seeing.
  const final = applyImageRemovals(applyCitationFixes(applyGroundingEdits(raw, edits), fixes), removals);
  const output = (u?.outputTokens ?? 0) + (u?.thinkingTokens ?? 0);
  const books = new Set([...final.matchAll(/sourcelibrary\.org\/book\/([a-z0-9-]+)(?:\/page-number\/|\?page=)\d+/g)].map(m => m[1]));
  return {
    id: job.id, arm: job.arm, rep: job.rep,
    firstTextMs, doneMs: Date.now() - t0, rounds: u?.rounds ?? null, toolCalls, report,
    blockquotesKept: answerUnits(final).filter(x => x.kind === 'blockquote').length,
    booksCited: books.size,
    usage: u,
    cost: estimateCostUsd(REPLAY_MODEL, u?.promptTokens ?? 0, output),
    costAtProductionRate: estimateCostUsd(PRODUCTION_MODEL, u?.promptTokens ?? 0, output),
    final, raw,
  };
}

function summary() {
  const rows = readRows();
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  for (const arm of ['A', 'B'] as Arm[]) {
    const ok = rows.filter(r => r.arm === arm && !r.error);
    const errors = rows.filter(r => r.arm === arm && r.error).length;
    const firstRound = (r: Row) => (r.toolCalls ?? []).filter(t => t.round === 1).map(t => t.name);
    console.log(JSON.stringify({
      arm, turns: ok.length, errors,
      model: [...new Set(ok.map(r => r.usage?.model))].join(','),
      // Support text failed to load: nothing was judged, so a kept quote proves nothing.
      uncheckable: ok.filter(r => r.usage?.grounding && !r.usage.grounding.checkable).length,
      // The headline: a quotation in a blockquote that survived the grounding pass.
      withKeptBlockquote: ok.filter(r => (r.blockquotesKept ?? 0) >= 1).length,
      withBlockquoteRemoved: ok.filter(r => (r.report?.blockquotesRemoved ?? 0) >= 1).length,
      blockquotesKept: ok.reduce((n, r) => n + (r.blockquotesKept ?? 0), 0),
      blockquotesRemoved: ok.reduce((n, r) => n + (r.report?.blockquotesRemoved ?? 0), 0),
      inlineQuotesUnquoted: ok.reduce((n, r) => n + (r.report?.quotesUnquoted ?? 0), 0),
      leadInsRemoved: ok.reduce((n, r) => n + (r.report?.leadInsRemoved ?? 0), 0),
      openingRemoved: ok.filter(r => r.report?.openingRemoved).length,
      firstRoundFindPassages: ok.filter(r => firstRound(r).includes('find_passages')).length,
      firstRoundSearchOnly: ok.filter(r => firstRound(r).length > 0 && firstRound(r).every(n => n === 'search')).length,
      moreThanOneBookCited: ok.filter(r => (r.booksCited ?? 0) > 1).length,
      medianDoneMs: median(ok.map(r => r.doneMs)),
      medianFirstTextMs: median(ok.map(r => r.firstTextMs ?? r.doneMs)),
      costAtProductionRate: Number(ok.reduce((n, r) => n + (r.costAtProductionRate ?? 0), 0).toFixed(3)),
    }));
  }
  // Paired by question: in how many did the arm produce a kept blockquote in every repeat?
  const byQ = new Map<string, Record<Arm, number[]>>();
  for (const r of rows.filter(x => !x.error)) {
    const e = byQ.get(r.id) ?? { A: [], B: [] };
    e[r.arm].push(r.blockquotesKept ?? 0);
    byQ.set(r.id, e);
  }
  for (const [id, e] of byQ) console.log(`${id.padEnd(20)} A kept ${JSON.stringify(e.A)}  B kept ${JSON.stringify(e.B)}`);
}

async function main() {
  if (flag('summary')) return summary();
  const missed = questions.filter(q => !asksForQuotation(q.q));
  if (missed.length) throw new Error(`the detector misses: ${missed.map(q => q.id).join(', ')}`);
  fs.mkdirSync(path.dirname(outFile!), { recursive: true });
  const prior = readRows();
  const done = new Set(prior.map(r => `${r.id}:${r.arm}:${r.rep}`));
  let spent = prior.reduce((n, r) => n + (r.cost ?? 0), 0);
  // Interleave so neither arm always runs first.
  const jobs: Job[] = [];
  for (let rep = 1; rep <= repeats; rep++) {
    questions.filter(q => !only || only.includes(q.id)).forEach((q, i) => {
      for (const arm of ((i + rep) % 2 === 0 ? ['A', 'B'] : ['B', 'A']) as Arm[]) if (arms.includes(arm)) jobs.push({ ...q, arm, rep });
    });
  }
  const queue = jobs.filter(j => !done.has(`${j.id}:${j.arm}:${j.rep}`));
  console.log(`${queue.length} turns to run, $${spent.toFixed(3)} already spent`);
  let stopped = '';
  // Every turn already recorded in --out counts toward the cap, errors included.
  let turns = prior.length;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (spent >= MAX_USD) { stopped = `spend cap $${MAX_USD}`; return; }
      if (turns >= MAX_TURNS) { stopped = `turn cap ${MAX_TURNS}`; return; }
      turns++;
      const row = await runOne(job);
      spent += row.cost ?? 0;
      fs.appendFileSync(outFile!, JSON.stringify(row) + '\n');
      console.log(`${job.id}\t${job.arm}${job.rep}\t${row.error ? `ERROR ${row.error}` : `kept=${row.blockquotesKept} removed=${row.report?.blockquotesRemoved ?? 0} tools=${row.toolCalls?.map(t => t.name).join(',')} done=${row.doneMs}ms`}\ttotal=$${spent.toFixed(3)}`);
    }
  }));
  console.log(`done: ${turns} turns recorded, $${spent.toFixed(3)}${stopped ? ` — STOPPED at ${stopped}` : ''}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
