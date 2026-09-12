#!/usr/bin/env node
// PRIOR ART: qa-eval.mjs `scorecard` runs API models, but only over ground-truth/ pages
// pinned to a book we hold (it calls getPage(book_id)). The Wikisource tier has no
// book_id — its images come from Commons — so scorecard cannot reach it. This runs any
// API model over an already-exported image directory, emitting the same <slug>.txt
// contract the self-hosted engines use, so every arm is scored by one code path.
/**
 * bench2-run-model.mjs — run an API model over a bench2-export.mjs image directory.
 *
 *   node --env-file=.env.production.local scripts/eval/bench2-run-model.mjs \
 *     --dir=<images> --model=lite --out=<outdir> [--limit=N] [--concurrency=3]
 *
 * Then: score-transcripts.mjs --dir=<outdir> --gt-dir=ground-truth-ws --engine=<name>
 */
import fs from 'fs';
import path from 'path';
import { runModel, resolveModel } from './lib/runners.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DIR = argOf('dir');
const OUT = argOf('out');
const MODEL = argOf('model', 'lite');
const LIMIT = parseInt(argOf('limit', '0'), 10);
const CONC = parseInt(argOf('concurrency', '3'), 10);
if (!DIR || !OUT) { console.error('--dir=<image dir> and --out=<dir> required'); process.exit(1); }

const PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. '
  + 'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(DIR, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).pages : null;
let slugs = manifest ? manifest.map(p => p.slug)
  : fs.readdirSync(DIR).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, ''));
slugs = slugs.filter(s => fs.existsSync(path.join(DIR, `${s}.jpg`)));
if (LIMIT) slugs = slugs.slice(0, LIMIT);

// Resume: never re-pay for a page already transcribed. The first Greek harvest lost
// completed work to a crash; a paid arm must not be able to repeat that.
const todo = slugs.filter(s => !fs.existsSync(path.join(OUT, `${s}.txt`)));
console.log(`${resolveModel(MODEL)}: ${todo.length} pages to run (${slugs.length - todo.length} already done)\n`);

let done = 0, failed = 0, costUsd = 0;
async function worker(queue) {
  while (queue.length) {
    const slug = queue.shift();
    const buf = fs.readFileSync(path.join(DIR, `${slug}.jpg`));
    try {
      const res = await runModel(MODEL, buf, PROMPT, { maxTokens: 16000 });
      const text = res?.text ?? '';
      if (!text.trim()) { failed++; console.log(`  ! ${slug}: empty (${res?.finishReason || 'no reason'})`); continue; }
      fs.writeFileSync(path.join(OUT, `${slug}.txt`), text);
      costUsd += res?.costUsd || 0;
      done++;
      if (done % 10 === 0) console.log(`  … ${done}/${todo.length} ($${costUsd.toFixed(3)})`);
    } catch (e) {
      failed++;
      console.log(`  ! ${slug}: ${e.message.slice(0, 90)}`);
    }
  }
}
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, () => worker(queue)));
console.log(`\nDone: ${done} transcribed, ${failed} failed. Measured cost $${costUsd.toFixed(4)}.`);
