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
 *
 * Resumable: a page with an existing non-empty .txt is never re-paid.
 */
import fs from 'fs';
import path from 'path';
import { runModel, resolveModel } from './lib/runners.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
const MODEL = argOf('model', 'lite');
const ONLY = argOf('stratum') ? argOf('stratum').split(',') : null;
const CONC = parseInt(argOf('concurrency', '3'), 10);
const ENGINE = argOf('engine', resolveModel(MODEL));
if (!ROOT) { console.error('--root=<bench-images dir> required'); process.exit(1); }

// Generic transcription prompt, identical to bench2-run-model.mjs so results are on the
// same footing as the 2026-09-03 print arms. The production prompt is not used: it asks
// for tags and metadata that no specialist emits, and the comparison is engine vs engine.
const PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. '
  + 'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';

const strata = fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'manifest.json')) && (!ONLY || ONLY.includes(d)));
let total = { done: 0, failed: 0, cost: 0, inTok: 0, outTok: 0, thoughtTok: 0 };
for (const stratum of strata) {
  const dir = path.join(ROOT, stratum);
  const out = path.join(dir, 'out', ENGINE);
  fs.mkdirSync(out, { recursive: true });
  const meterPath = path.join(out, '_meter.jsonl');
  const slugs = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, '')).sort();
  const todo = slugs.filter(s => !(fs.existsSync(path.join(out, `${s}.txt`)) && fs.statSync(path.join(out, `${s}.txt`)).size > 0));
  console.log(`${stratum}: ${ENGINE} — ${todo.length} to run (${slugs.length - todo.length} done)`);
  const queue = [...todo];
  let done = 0, failed = 0, cost = 0;
  async function worker() {
    while (queue.length) {
      const slug = queue.shift();
      const buf = fs.readFileSync(path.join(dir, `${slug}.jpg`));
      let res = null, err = null;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try { res = await runModel(MODEL, buf, PROMPT, { maxTokens: 16000, thinkingBudget: 0, temperature: 0 }); }
        catch (e) { err = e; await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); }
      }
      const text = res?.text ?? '';
      const row = { slug, engine: ENGINE, finishReason: res?.finishReason || null, inputTokens: res?.inputTokens || 0, outputTokens: res?.outputTokens || 0, thinkingTokens: res?.thinkingTokens || 0, costUsd: res?.costUsd || 0, durationMs: res?.durationMs || null, chars: text.length, error: res ? null : (err?.message || 'unknown').slice(0, 120), at: new Date().toISOString() };
      fs.appendFileSync(meterPath, JSON.stringify(row) + '\n');
      if (!res) { failed++; console.log(`  ! ${slug}: ${row.error}`); continue; }
      // An empty transcription is a result (a blank page, a refusal): write it so the page
      // is not silently re-run, and let the scorer see it as empty.
      fs.writeFileSync(path.join(out, `${slug}.txt`), text);
      cost += row.costUsd; done++;
      total.inTok += row.inputTokens; total.outTok += row.outputTokens; total.thoughtTok += row.thinkingTokens;
      if (done % 10 === 0) console.log(`  … ${done}/${todo.length} ($${cost.toFixed(3)})`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, worker));
  console.log(`  ${stratum}: ${done} done, ${failed} failed, $${cost.toFixed(4)}`);
  total.done += done; total.failed += failed; total.cost += cost;
}
console.log(`\nTOTAL ${ENGINE}: ${total.done} pages, ${total.failed} failed, $${total.cost.toFixed(4)} (in ${total.inTok}, out ${total.outTok}, thoughts ${total.thoughtTok} tokens)`);
