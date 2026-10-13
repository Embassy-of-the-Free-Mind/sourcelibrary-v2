/**
 * Librarian grounding eval (#5904) — generation half.
 *
 * PRIOR ART: scripts/eval/librarian-search/ measures RETRIEVAL (precision@5 of
 * hybridSearch against a golden set); it never runs the agent or reads an
 * answer. tests/integration/embassy-api.test.ts drives the HTTP route with a
 * mocked model. Neither produces real answers to score for citations, so this
 * runs the production agent (streamAgenticResponse, same model config) against
 * production data, and score.ts reads what it wrote.
 *
 * Runs every question in questions.json once, in-process, and writes one JSONL
 * row per answer with the text EXACTLY as the reader ends up seeing it: the
 * streamed text with the post-turn rewrites applied in the same order the chat
 * route applies them (route.ts finalizeText).
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-grounding/run.ts --label=before [--only=id,id] [--concurrency=4]
 *
 * Writes scripts/eval/librarian-grounding/results/<label>.jsonl
 * Side effects: one ai_usage row per turn (real spend, metered like any turn),
 * and embassy_errors rows with threadId null when a citation is flagged.
 * No thread, no notebook writes (threadId is undefined).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as fixesLib from '@/lib/embassy/citation-fixes';
import { streamAgenticResponse, type LibrarianStep, type SourceCard } from '@/lib/embassy/librarian';
import { estimateCostUsd } from '@/lib/log-ai-usage';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (name: string, def?: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;

const label = arg('label');
if (!label) throw new Error('--label=<name> is required');
const only = arg('only')?.split(',');
const concurrency = Number(arg('concurrency', '4'));

const { questions } = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8')) as {
  questions: Array<{ id: string; tradition: string; q: string }>;
};
const todo = questions.filter(q => !only || only.includes(q.id));

// The grounding edits only exist after #5904; read them if the module has them
// so the same harness measures both sides.
type Lib = typeof fixesLib & { applyGroundingEdits?: (t: string, e: unknown[]) => string };
const lib = fixesLib as Lib;

async function runOne(item: { id: string; tradition: string; q: string }) {
  const t0 = Date.now();
  let raw = '';
  let sources: SourceCard[] = [];
  let fixes: fixesLib.CitationFix[] = [];
  let removals: string[] = [];
  let groundingEdits: unknown[] = [];
  let groundingReport: unknown = null;
  let usage: LibrarianStep['usage'] | null = null;
  const tools: Array<{ name?: string; query?: string; summary?: string }> = [];
  try {
    for await (const step of streamAgenticResponse(item.q, [], undefined, { lang: 'en' })) {
      const s = step as LibrarianStep & { edits?: unknown[]; report?: unknown };
      if (s.type === 'text') raw += s.text || '';
      else if (s.type === 'sources') sources = s.sources || [];
      else if (s.type === 'citation_fixes') fixes = s.fixes || [];
      else if (s.type === 'image_removals') removals = s.removeUrls || [];
      else if ((s.type as string) === 'grounding_edits') { groundingEdits = s.edits || []; groundingReport = s.report ?? null; }
      else if (s.type === 'tool_result') tools.push({ name: s.name, query: s.query, summary: s.summary });
      else if (s.type === 'usage') usage = s.usage ?? null;
    }
  } catch (err) {
    return { id: item.id, q: item.q, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
  // Same order as route.ts finalizeText.
  const grounded = lib.applyGroundingEdits ? lib.applyGroundingEdits(raw, groundingEdits) : raw;
  const final = fixesLib.applyImageRemovals(fixesLib.applyCitationFixes(grounded, fixes), removals);
  const cost = usage ? estimateCostUsd(usage.model, usage.promptTokens, usage.outputTokens + usage.thinkingTokens) : null;
  return {
    id: item.id, tradition: item.tradition, q: item.q, label,
    final, raw, sources, fixes, removals, groundingEdits, groundingReport, tools, usage, cost, ms: Date.now() - t0,
  };
}

async function main() {
  const outDir = path.join(HERE, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${label}.jsonl`);
  fs.writeFileSync(outFile, '');
  const queue = [...todo];
  let total = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const row = await runOne(item);
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      total += (row as { cost?: number | null }).cost ?? 0;
      console.log(`${item.id}\t${'error' in row ? `ERROR ${row.error}` : `${row.ms}ms $${(row.cost ?? 0).toFixed(4)} prompt=${row.usage?.promptTokens}`}`);
    }
  }));
  console.log(`done: ${todo.length} questions, est. $${total.toFixed(3)} → ${outFile}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
