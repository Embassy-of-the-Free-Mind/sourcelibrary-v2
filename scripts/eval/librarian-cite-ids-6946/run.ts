/**
 * Librarian cite-by-ID A/B/C (#6946) — generation half.
 *
 * PRIOR ART: scripts/eval/librarian-cite-prompt-6946/run.ts (itself #6904's
 * harness: interleaved arms, A2 noise floor, timings, resumable, hard spend
 * cap), copied with the arm switch changed to `citeIds` (cite pages by ID, the
 * top hits shown whole) and `model`, and a third arm.
 *
 * Arms:
 *   A  = today's request (shipped state: citeIds off, gemini-3-flash-preview)
 *   B  = citeIds on, gemini-3-flash-preview
 *   C  = citeIds on, gemini-3.8-flash (thinking LOW on tool rounds, as #6909)
 *   A2 = A again, on the questions in questions.json `aVsA` (noise floor)
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-cite-ids-6946/run.ts --out=<file.jsonl> [--only=q01,q02] [--arms=A,B,C,A2] [--concurrency=2]
 *
 * Resumable: rows already in --out (by id+arm) are skipped.
 * Side effects: one ai_usage row per turn (real spend, metered like any turn).
 * No thread, no notebook writes (threadId is undefined).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as fixesLib from '@/lib/embassy/citation-fixes';
import { streamAgenticResponse, type LibrarianStep, type SourceCard } from '@/lib/embassy/librarian';
import { estimateCostUsd } from '@/lib/log-ai-usage';

const HERE = path.join(path.dirname(new URL(import.meta.url).pathname), '../librarian-speed-6904');
const arg = (name: string, def?: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;

const outFile = arg('out');
if (!outFile) throw new Error('--out=<file.jsonl> is required');
const only = arg('only')?.split(',');
const arms = (arg('arms', 'A,B,C,A2') as string).split(',');
const concurrency = Number(arg('concurrency', '2'));
// Approved envelope (#6946, Derek 2026-10-19): hard cap 170 turns, $6 by the turns' own usage numbers.
const MAX_TURNS = Number(arg('max-turns', '170'));
const MAX_USD = Number(arg('max-usd', '6'));
const ARM: Record<string, { citeIds: boolean; model?: string }> = {
  A: { citeIds: false }, A2: { citeIds: false }, B: { citeIds: true }, C: { citeIds: true, model: 'gemini-3.8-flash' },
};

const { questions, aVsA } = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8')) as {
  questions: Array<{ id: string; q: string; lang: 'en' | 'es' }>;
  aVsA: string[];
};

type Job = { id: string; q: string; lang: 'en' | 'es'; arm: string };

// Interleave: the arm order rotates per question (ABC, BCA, CAB), so no arm
// always runs first; the A2 repeats go after their question's arms.
const jobs: Job[] = [];
questions.filter(q => !only || only.includes(q.id)).forEach((q, i) => {
  const pair = [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']][i % 3];
  for (const arm of pair) if (arms.includes(arm)) jobs.push({ ...q, arm });
  if (arms.includes('A2') && aVsA.includes(q.id)) jobs.push({ ...q, arm: 'A2' });
});

const done = new Set<string>();
let turns = 0;
let spent = 0;
if (fs.existsSync(outFile)) {
  for (const line of fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    done.add(`${r.id}:${r.arm}`);
    turns++;
    spent += r.cost ?? 0;
  }
}

async function runOne(job: Job) {
  const t0 = Date.now();
  let raw = '';
  let sources: SourceCard[] = [];
  let fixes: fixesLib.CitationFix[] = [];
  let removals: string[] = [];
  let groundingEdits: Array<{ find: string; replace: string; at?: number }> = [];
  let groundingReport: unknown = null;
  let usage: LibrarianStep['usage'] | null = null;
  let firstTextMs: number | null = null;
  let lastTextMs: number | null = null;
  const toolCalls: Array<{ name?: string; query?: string; ms: number }> = [];
  const toolResults: Array<{ name?: string; query?: string; summary?: string; found?: number; ms: number }> = [];
  try {
    const { citeIds, model } = ARM[job.arm];
    for await (const step of streamAgenticResponse(job.q, [], undefined, { lang: job.lang, fastToolRounds: true, citeIds, model })) {
      const ms = Date.now() - t0;
      const s = step as LibrarianStep & { edits?: typeof groundingEdits; report?: unknown };
      if (s.type === 'text') {
        raw += s.text || '';
        if (firstTextMs === null && (s.text || '').trim()) firstTextMs = ms;
        lastTextMs = ms;
      } else if (s.type === 'sources') sources = s.sources || [];
      else if (s.type === 'citation_fixes') fixes = s.fixes || [];
      else if (s.type === 'image_removals') removals = s.removeUrls || [];
      else if (s.type === 'grounding_edits') { groundingEdits = s.edits || []; groundingReport = s.report ?? null; }
      else if (s.type === 'tool_call') toolCalls.push({ name: s.name, query: s.query, ms });
      else if (s.type === 'tool_result') toolResults.push({ name: s.name, query: s.query, summary: s.summary, found: s.found, ms });
      else if (s.type === 'usage') usage = s.usage ?? null;
    }
  } catch (err) {
    return { ...job, error: err instanceof Error ? err.message : String(err), doneMs: Date.now() - t0, cost: 0 };
  }
  // Same order as route.ts finalizeText.
  const final = fixesLib.applyImageRemovals(
    fixesLib.applyCitationFixes(fixesLib.applyGroundingEdits(raw, groundingEdits), fixes),
    removals,
  );
  const cost = usage ? estimateCostUsd(usage.model, usage.promptTokens, usage.outputTokens + usage.thinkingTokens) : 0;
  return {
    ...job,
    firstTextMs, lastTextMs, doneMs: Date.now() - t0,
    rounds: usage?.rounds ?? null, toolCalls, toolResults, usage, cost,
    final, raw, sources, fixes, removals, groundingEdits, groundingReport,
    finishedAt: new Date().toISOString(),
  };
}

async function main() {
  fs.mkdirSync(path.dirname(outFile!), { recursive: true });
  const queue = jobs.filter(j => !done.has(`${j.id}:${j.arm}`));
  console.log(`${queue.length} turns to run (${turns} already in ${outFile}, $${spent.toFixed(3)})`);
  let stopped = '';
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (turns >= MAX_TURNS) { stopped = `turn cap ${MAX_TURNS}`; return; }
      if (spent >= MAX_USD) { stopped = `spend cap $${MAX_USD}`; return; }
      turns++;
      const row = await runOne(job);
      spent += row.cost ?? 0;
      fs.appendFileSync(outFile!, JSON.stringify(row) + '\n');
      const r = row as { firstTextMs?: number | null; doneMs: number; rounds?: number | null; error?: string };
      console.log(`${job.id}\t${job.arm}\t${r.error ? `ERROR ${r.error}` : `first=${r.firstTextMs}ms done=${r.doneMs}ms rounds=${r.rounds}`}\t$${(row.cost ?? 0).toFixed(4)}\ttotal=$${spent.toFixed(3)} turns=${turns}`);
    }
  }));
  console.log(`done: ${turns} turns in file, $${spent.toFixed(3)}${stopped ? ` — STOPPED at ${stopped}` : ''}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
