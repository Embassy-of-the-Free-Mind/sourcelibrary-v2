#!/usr/bin/env node
// PRIOR ART: bench2-run-model.mjs — runs any API model over an exported image directory
// with the same <slug>.txt contract. It does not set thinkingConfig (Gemini 3.x thinks by
// default and bills it at the output rate — CLAUDE.md "AI Models"), does not record
// thoughtsTokenCount, and walks one directory; this benchmark has several strata under one
// root and needs the metering line per stratum. Same runner (lib/runners.mjs), same prompt.
/**
 * benchmark-run-api.mjs — run an API model over every stratum directory that
 * benchmark-seal.mjs exported, writing <root>/<stratum>/out/<engine>/<slug>.txt and a
 * metering row per page ( tokens incl. thoughts, $ ).
 *
 *   node --env-file=.env.production.local scripts/eval/benchmark-run-api.mjs \
 *     --root=/path/bench-images --model=lite [--stratum=chinese,greek] [--concurrency=3]
 *     [--engine=<out dir name>] [--prompt=production --prompt-hash=<hash>] [--refusal-retry=1] [--slugs=<file>] [--cap=<usd>]
 *
 * Resumable: a page with an existing non-empty .txt is never re-paid.
 */
import fs from 'fs';
import path from 'path';
import { runModel, resolveModel } from './lib/runners.mjs';
import { REFUSAL_REASONS } from './lib/refusals.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
const MODEL = argOf('model', 'lite');
const ONLY = argOf('stratum') ? argOf('stratum').split(',') : null;
const CONC = parseInt(argOf('concurrency', '3'), 10);
const ENGINE = argOf('engine', resolveModel(MODEL));
if (!ROOT) { console.error('--root=<bench-images dir> required'); process.exit(1); }

// Generic transcription prompt, identical to bench2-run-model.mjs so results are on the
// same footing as the 2026-09-03 print arms. The production prompt is not the default: it asks
// for tags and metadata that no specialist emits, and most comparisons are engine vs engine.
const GENERIC_PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. '
  + 'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';
// --prompt=production (#5126): the question "should production route this period to flash" is about the
// engines AS PRODUCTION RUNS THEM, so the live OCR prompt is loaded from the same place the pipeline reads
// it (lib/production-prompt.mjs) and its hash is asserted against --prompt-hash, which the preregistration
// fixes: a prompt that changed between preregistration and run stops the run.
// --refusal-retry=N: re-ask a refused page N times (production retries once); every attempt is metered.
// --slugs=<file>: one slug per line — run only these (the seeded A-vs-A repeat subset).
// --cap=<usd>: stop cleanly when this invocation has spent that much.
const PROMPT_MODE = argOf('prompt', 'generic');
const REFUSAL_RETRY = parseInt(argOf('refusal-retry', '0'), 10);
const SLUGS = argOf('slugs') ? new Set(fs.readFileSync(argOf('slugs'), 'utf8').split('\n').map(x => x.trim()).filter(Boolean)) : null;
const CAP = argOf('cap') ? parseFloat(argOf('cap')) : Infinity;
let PROMPT = GENERIC_PROMPT, promptInfo = { mode: 'generic' };
if (PROMPT_MODE === 'production') {
  const { MongoClient } = await import('mongodb');
  const { getProductionOcrPrompt } = await import('./lib/production-prompt.mjs');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const p = await getProductionOcrPrompt(client.db('bookstore')); await client.close();
  const want = argOf('prompt-hash');
  if (!want) { console.error(`--prompt=production needs --prompt-hash=<content_hash> (live: ${p.content_hash}, v${p.version})`); process.exit(1); }
  if (p.content_hash !== want) { console.error(`production OCR prompt hash is ${p.content_hash} (v${p.version}), expected ${want} — the prompt changed; stop`); process.exit(1); }
  PROMPT = p.text; promptInfo = { mode: 'production', version: p.version, content_hash: p.content_hash };
  console.log(`prompt: production OCR v${p.version} (${p.content_hash})`);
} else if (PROMPT_MODE !== 'generic') { console.error('--prompt=generic|production'); process.exit(1); }
const isRefusal = res => !!res && !(res.text || '').trim() && REFUSAL_REASONS.test(res.finishReason || '');
let spent = 0;

const strata = fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'manifest.json')) && (!ONLY || ONLY.includes(d)));
let total = { done: 0, failed: 0, cost: 0, inTok: 0, outTok: 0, thoughtTok: 0 };
for (const stratum of strata) {
  const dir = path.join(ROOT, stratum);
  const out = path.join(dir, 'out', ENGINE);
  fs.mkdirSync(out, { recursive: true });
  const meterPath = path.join(out, '_meter.jsonl');
  const slugs = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, '')).filter(x => !SLUGS || SLUGS.has(x)).sort();
  const todo = slugs.filter(s => !(fs.existsSync(path.join(out, `${s}.txt`)) && fs.statSync(path.join(out, `${s}.txt`)).size > 0));
  console.log(`${stratum}: ${ENGINE} — ${todo.length} to run (${slugs.length - todo.length} done)`);
  const queue = [...todo];
  let done = 0, failed = 0, cost = 0;
  async function worker() {
    while (queue.length) {
      if (spent >= CAP) { console.log(`  spend cap $${CAP} reached — stopping with ${queue.length} pages unread`); queue.length = 0; break; }
      const slug = queue.shift();
      const buf = fs.readFileSync(path.join(dir, `${slug}.jpg`));
      let res = null, err = null;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try { res = await runModel(MODEL, buf, PROMPT, { maxTokens: 16000, thinkingBudget: 0, temperature: 0 }); }
        catch (e) { err = e; await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); }
      }
      // Production re-asks a refused page; the first refusal is kept in the meter so it stays countable.
      for (let r = 0; r < REFUSAL_RETRY && isRefusal(res); r++) {
        fs.appendFileSync(meterPath, JSON.stringify({ slug, engine: ENGINE, attempt: `refused-${r + 1}`, finishReason: res.finishReason, inputTokens: res.inputTokens || 0, outputTokens: res.outputTokens || 0, thinkingTokens: res.thinkingTokens || 0, costUsd: res.costUsd || 0, chars: 0, at: new Date().toISOString() }) + '\n');
        spent += res.costUsd || 0; cost += res.costUsd || 0;
        try { res = await runModel(MODEL, buf, PROMPT, { maxTokens: 16000, thinkingBudget: 0, temperature: 0 }); } catch (e) { err = e; break; }
      }
      const text = res?.text ?? '';
      const row = { ...(promptInfo.mode === 'production' ? { prompt: `production-v${promptInfo.version}`, prompt_hash: promptInfo.content_hash } : {}), slug, engine: ENGINE, ...(res?.route ? { route: res.route } : {}), finishReason: res?.finishReason || null, inputTokens: res?.inputTokens || 0, outputTokens: res?.outputTokens || 0, thinkingTokens: res?.thinkingTokens || 0, costUsd: res?.costUsd || 0, durationMs: res?.durationMs || null, chars: text.length, error: res ? null : (err?.message || 'unknown').slice(0, 120), at: new Date().toISOString() };
      fs.appendFileSync(meterPath, JSON.stringify(row) + '\n');
      if (!res) { failed++; console.log(`  ! ${slug}: ${row.error}`); continue; }
      // An empty transcription is a result (a blank page, a refusal): write it so the page
      // is not silently re-run, and let the scorer see it as empty.
      fs.writeFileSync(path.join(out, `${slug}.txt`), text);
      cost += row.costUsd; spent += row.costUsd; done++;
      total.inTok += row.inputTokens; total.outTok += row.outputTokens; total.thoughtTok += row.thinkingTokens;
      if (done % 10 === 0) console.log(`  … ${done}/${todo.length} ($${cost.toFixed(3)})`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, worker));
  console.log(`  ${stratum}: ${done} done, ${failed} failed, $${cost.toFixed(4)}`);
  total.done += done; total.failed += failed; total.cost += cost;
}
console.log(`\nTOTAL ${ENGINE}: ${total.done} pages, ${total.failed} failed, $${total.cost.toFixed(4)} (in ${total.inTok}, out ${total.outTok}, thoughts ${total.thoughtTok} tokens)`);
