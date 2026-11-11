/**
 * Librarian follow-up search replay (#8151).
 *
 * PRIOR ART: scripts/eval/librarian-speed-6904/run.ts — the in-process harness
 * and the interleaved arms this copies. It sends first questions with no
 * history and runs the production model. This one replays a thread's real
 * history up to a follow-up, and holds the answer model to flash-lite (below).
 *
 * Arms:
 *   A = today's prompt (followupSearch: false)
 *   B = follow-up search on (followupSearch: true): the prompt lines, and the
 *       first round must call a tool, with no_search_needed as the way to decline
 *
 * Model: Derek's rule allows only flash-lite on the paid Gemini API without
 * asking, so this refuses any other answer model. What that measures is the
 * difference the prompt makes on flash-lite, not gemini-3-flash-preview's own
 * search rate or latency. Tokens are also priced at the production model's
 * rate, as an estimate of what the extra rounds would cost.
 *
 * The questions are readers' words and stay out of this public repo: --questions
 * points at a private file of { id, label, q, lang, history }.
 *
 * Usage:
 *   npx tsx --env-file=<env> scripts/eval/librarian-followup-8151/run.ts \
 *     --questions=<private.json> --out=<private.jsonl> [--only=f01,f02] [--arms=A,B] [--concurrency=2]
 *
 * Resumable: rows already in --out (by id+arm) are skipped.
 * Side effects: one ai_usage row per turn (real spend, metered like any turn),
 * and embassy_errors rows with threadId null when a citation is flagged.
 * No thread, no notebook writes (threadId is undefined).
 */
import fs from 'node:fs';
import path from 'node:path';
import { streamAgenticResponse, type LibrarianStep, type ToolCallRecord } from '@/lib/embassy/librarian';
import { estimateCostUsd } from '@/lib/log-ai-usage';

const REPLAY_MODEL = 'gemini-3.1-flash-lite';
const PRODUCTION_MODEL = 'gemini-3-flash-preview';

const arg = (name: string, def?: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;

const questionsFile = arg('questions');
const outFile = arg('out');
if (!questionsFile || !outFile) throw new Error('--questions=<file.json> and --out=<file.jsonl> are required');
const only = arg('only')?.split(',');
const arms = (arg('arms', 'A,B') as string).split(',');
const concurrency = Number(arg('concurrency', '2'));
const MAX_USD = Number(arg('max-usd', '3'));

type Question = {
  id: string;
  label: 'research' | 'other';
  q: string;
  lang: 'en' | 'es';
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
};
const questions = JSON.parse(fs.readFileSync(questionsFile, 'utf8')) as Question[];

type Job = Question & { arm: 'A' | 'B' };
// Interleave so neither arm always runs first.
const jobs: Job[] = [];
questions.filter(q => !only || only.includes(q.id)).forEach((q, i) => {
  for (const arm of (i % 2 === 0 ? ['A', 'B'] : ['B', 'A']) as Array<'A' | 'B'>) if (arms.includes(arm)) jobs.push({ ...q, arm });
});

const done = new Set<string>();
let spent = 0;
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    done.add(`${r.id}:${r.arm}`);
    spent += r.cost ?? 0;
  }
}

async function runOne(job: Job) {
  const t0 = Date.now();
  let text = '';
  let sourceCount = 0;
  let usage: LibrarianStep['usage'] | null = null;
  let firstTextMs: number | null = null;
  const toolCalls: ToolCallRecord[] = [];
  try {
    const steps = streamAgenticResponse(job.q, job.history, undefined, {
      lang: job.lang,
      followupSearch: job.arm === 'B',
      model: REPLAY_MODEL,
    });
    for await (const s of steps) {
      if (s.toolCall) toolCalls.push(s.toolCall);
      if (s.type === 'text') {
        text += s.text || '';
        if (firstTextMs === null && (s.text || '').trim()) firstTextMs = Date.now() - t0;
      } else if (s.type === 'sources') sourceCount = s.sources?.length ?? 0;
      else if (s.type === 'usage') usage = s.usage ?? null;
    }
  } catch (err) {
    return { id: job.id, arm: job.arm, label: job.label, error: err instanceof Error ? err.message : String(err), doneMs: Date.now() - t0, cost: 0 };
  }
  const u = usage as LibrarianStep['usage'] | null;
  if (u && u.model !== REPLAY_MODEL) throw new Error(`answer model was ${u.model}, not ${REPLAY_MODEL}`);
  const output = (u?.outputTokens ?? 0) + (u?.thinkingTokens ?? 0);
  return {
    id: job.id, arm: job.arm, label: job.label,
    firstTextMs, doneMs: Date.now() - t0,
    rounds: u?.rounds ?? null, toolCalls, sourceCount, usage: u,
    cost: estimateCostUsd(REPLAY_MODEL, u?.promptTokens ?? 0, output),
    costAtProductionRate: estimateCostUsd(PRODUCTION_MODEL, u?.promptTokens ?? 0, output),
    text,
  };
}

async function main() {
  fs.mkdirSync(path.dirname(outFile!), { recursive: true });
  const queue = jobs.filter(j => !done.has(`${j.id}:${j.arm}`));
  console.log(`${queue.length} turns to run, $${spent.toFixed(3)} already spent`);
  let stopped = '';
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (spent >= MAX_USD) { stopped = `spend cap $${MAX_USD}`; return; }
      const row = await runOne(job);
      spent += row.cost ?? 0;
      fs.appendFileSync(outFile!, JSON.stringify(row) + '\n');
      console.log(`${job.id}\t${job.arm}\t${'error' in row ? `ERROR ${row.error}` : `tools=${row.toolCalls?.length} done=${row.doneMs}ms`}\ttotal=$${spent.toFixed(3)}`);
    }
  }));
  console.log(`done: $${spent.toFixed(3)}${stopped ? ` — STOPPED at ${stopped}` : ''}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
