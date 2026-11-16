#!/usr/bin/env node
// PRIOR ART: scripts/eval/sanskrit-gex45-7243/confirm-classify.py (by-eye script/kind sort, done by a person in a
// session, not a runner); scripts/batch/cli-ocr.mjs and scripts/eval/stale-gate-6567 (spawn `claude -p` on the
// subscription, but to READ or JUDGE text, with a text answer); scripts/lib/claude-cli-env.mjs (the env strip, reused).
// None asks a model to look at a book's leaves and name the script with nothing else in front of it.
//
// tag — by-eye script and kind for each book of the #254 frame, from three leaves, blind (#254).
//
// The tagger sees only the leaf images (files named <book id>/<page>.jpg) and the instructions below: no title, no
// identifier, no stored tag, no transcription. One `claude -p --model <m>` call per batch of books, on the subscription
// (claudeSubscriptionEnv strips the API key), Read as the only tool. Rows land in <out>/tags-<arm>.jsonl; a book
// already there is skipped, so a rerun resumes. A batch whose answer is missing a book leaves it for the next run.
//
//   node scripts/eval/sa-script-tags-254/tag.mjs --dir $JOB_SCRATCH/w --arm opus --model opus [--first 100] [--ids f] [--batch 8] [--par 2]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { claudeSubscriptionEnv } from '../../lib/claude-cli-env.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir'); const ARM = arg('--arm'); const MODEL = arg('--model');
const BATCH = Number(arg('--batch', 8)); const PAR = Number(arg('--par', 2));
const FIRST = arg('--first') ? Number(arg('--first')) : null; const IDS = arg('--ids');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity;
if (!DIR || !ARM || !MODEL) throw new Error('--dir, --arm, --model required');
const OUTF = path.join(DIR, `tags-${ARM}.jsonl`);
const LOG = path.join(DIR, `calls-${ARM}.jsonl`);

export const SCRIPTS = ['Devanagari', 'Sharada', 'Newar', 'Nandinagari', 'Grantha', 'Bengali', 'Oriya', 'Telugu', 'Kannada', 'Malayalam', 'Tamil', 'Gujarati', 'Gurmukhi', 'Tibetan', 'Arabic-Persian', 'Latin', 'mixed', 'none', 'unclear'];
export const KINDS = ['print', 'manuscript', 'lithograph', 'unclear'];

export const INSTRUCTIONS = `You are tagging books by the script and the kind of writing on their leaves, from page images only.
Each book below is a Sanskrit-catalogued item. For each book you get up to three leaf images from the middle of the book.
Open every image with the Read tool and look at it. Do not open any other file and do not guess from file names.

For each book decide:
- kind: "print" (movable type or a typeset/digital face), "manuscript" (written by hand), "lithograph" (a printed
  reproduction of handwriting: a hand-written page multiplied by a press, uniform ink, often a printed frame or ruling),
  or "unclear".
- script: the script of the main text. One of: ${SCRIPTS.join(', ')}. Use "other:<name>" for a script not listed,
  "mixed" when the leaves carry two scripts in substance (name both in note), "none" when no leaf carries writing,
  "unclear" when you cannot tell.
  Telling Devanagari from Sharada (Śāradā, the Kashmiri script) matters most here. Look at the letter forms themselves,
  not the material: birch bark and paper carry both. Name Sharada only when the letter forms are Sharada, and say
  "unclear" rather than forcing a choice.
- leaves: for each image, its page number, whether it carries writing (blank, cover, colour card, label = false), and
  the script you see on it.
- agree: true when every leaf with writing shows the same script and kind.
- confidence: "sure" or "unsure".
- note: at most 15 words (e.g. "accented Vedic", "almanac tables", "Devanagari headings over Sharada text").

Answer with ONLY a JSON array, one object per book, in this shape and nothing else:
[{"book":"<id>","kind":"...","script":"...","agree":true,"confidence":"sure","leaves":[{"page":12,"writing":true,"script":"..."}],"note":"..."}]`;

function prompt(batch) {
  const lines = batch.map((b) => `Book ${b.id}:\n${b.leaves.map((l) => `  page ${l.page}: ${l.file}`).join('\n')}`);
  return `${INSTRUCTIONS}\n\n${lines.join('\n\n')}\n`;
}

function runClaude(text) {
  return new Promise((resolve) => {
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Glob,Grep,Write,Edit,NotebookEdit,WebFetch,WebSearch,Agent,Task', '--strict-mcp-config', '--add-dir', path.join(DIR, 'img')];
    const t0 = Date.now();
    const ch = spawn('claude', args, { cwd: path.join(DIR, 'img'), env: claudeSubscriptionEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const kill = setTimeout(() => ch.kill('SIGTERM'), 25 * 60 * 1000);
    ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (err += d));
    ch.on('close', (code) => { clearTimeout(kill); resolve({ code, out, err, ms: Date.now() - t0 }); });
    ch.stdin.end(text);
  });
}

function parseAnswer(stdout) {
  let env; try { env = JSON.parse(stdout); } catch { return { err: 'envelope not json' }; }
  const r = String(env.result ?? '');
  const m = r.match(/\[[\s\S]*\]/);
  if (!m) return { err: `no array: ${r.slice(0, 200)}`, env };
  try { return { rows: JSON.parse(m[0]), env }; } catch (e) { return { err: `array not json: ${e.message}`, env }; }
}

async function main() {
  const frame = JSON.parse(fs.readFileSync(path.join(DIR, 'frame.json'))).books;
  let want = frame.filter((b) => b.leaves?.length);
  if (FIRST) want = want.filter((b) => b.order < FIRST);
  if (IDS) { const s = new Set(fs.readFileSync(IDS, 'utf8').split(/\s+/).filter(Boolean)); want = FIRST ? frame.filter((b) => b.leaves?.length && (b.order < FIRST || s.has(b.id))) : want.filter((b) => s.has(b.id)); }
  const done = new Set(fs.existsSync(OUTF) ? fs.readFileSync(OUTF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book) : []);
  const todo = want.filter((b) => !done.has(b.id)).slice(0, LIMIT);
  console.error(`${ARM}: ${want.length} books wanted, ${done.size} done, ${todo.length} to tag, batch ${BATCH}, par ${PAR}`);
  const batches = []; for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  let nb = 0;
  async function worker() {
    while (batches.length) {
      const batch = batches.shift(); const ids = new Set(batch.map((b) => b.id));
      const r = await runClaude(prompt(batch));
      const a = parseAnswer(r.out);
      const at = new Date().toISOString();
      let kept = 0;
      for (const row of a.rows || []) {
        if (!row || !ids.has(row.book)) continue;
        ids.delete(row.book);
        const b = batch.find((x) => x.id === row.book);
        fs.appendFileSync(OUTF, JSON.stringify({ ...row, arm: ARM, model: a.env?.modelUsage ? Object.keys(a.env.modelUsage).join(',') : MODEL, at, shown: b.leaves.map((l) => l.page) }) + '\n');
        kept++;
      }
      fs.appendFileSync(LOG, JSON.stringify({ at, code: r.code, ms: r.ms, books: batch.length, kept, missing: [...ids], err: a.err ?? null, cost_usd: a.env?.total_cost_usd ?? null, usage: a.env?.usage ?? null, stderr: r.err.slice(0, 300) }) + '\n');
      console.error(`${ARM} batch ${++nb}: kept ${kept}/${batch.length} in ${Math.round(r.ms / 1000)}s${a.err ? ` ERR ${a.err.slice(0, 120)}` : ''}${r.code ? ` exit ${r.code} ${r.err.slice(0, 200)}` : ''}`);
      if (/session limit|rate limit|usage limit/i.test(r.out + r.err)) { console.error('limit hit: stopping'); batches.length = 0; }
      // An instant failure is the CLI not starting (seen: the pace guard found no real binary mid-update, exit 127):
      // put the batch back once or twice after a pause rather than leave its books for a rerun.
      else if (!kept && r.ms < 10000 && (batch.tries = (batch.tries || 0) + 1) <= 3) { await new Promise((s) => setTimeout(s, 30000)); batches.push(batch); }
    }
  }
  await Promise.all(Array.from({ length: PAR }, worker));
}
await main();
