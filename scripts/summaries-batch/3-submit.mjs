#!/usr/bin/env node
/**
 * Submit a JSONL from 2-build-jsonl.mjs to the Gemini Batch API. DRY-RUN by default: prints what
 * would be sent and the estimated cost. --execute uploads the file, creates the batch job (the
 * input is deleted straight after create, gemini-batch-input-file.mjs), writes one gemini_usage row
 * per book AT SUBMIT with the estimate (#4567: the spend dial must see committed spend), and
 * appends the job to a local jobs file for 4-collect.mjs.
 *
 *   node --env-file=.env.production.local scripts/summaries-batch/3-submit.mjs --in=summaries-trial.jsonl [--execute]
 *
 * Run on Hetzner (large File API uploads fail from a residential Mac, #3974). Never through a Vercel function.
 * Spend needs Laura's yes for this run; the trial is meant to be --limit=500 first.
 */
import fs from 'node:fs';
import { MODEL, tokensOf, OUT_TOKENS_PER_BOOK, arg, flag } from './lib.mjs';
import { uploadBatchInputFile, createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';
import { logUsage, calculateUsageCost } from '../workers/lib/supabase-usage-logger.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const inFile = arg('in');
const jobsFile = arg('jobs', 'summaries-batch-jobs.json');
if (!inFile || !fs.existsSync(inFile)) { console.error('--in=<jsonl from 2-build-jsonl.mjs> required'); process.exit(2); }

const body = fs.readFileSync(inFile, 'utf8');
const lines = body.split('\n').filter((l) => l.trim());
const keys = lines.map((l) => JSON.parse(l).key);
const perBook = lines.map((l) => calculateUsageCost(MODEL, tokensOf(JSON.stringify(JSON.parse(l).request)), OUT_TOKENS_PER_BOOK, true));
const est = perBook.reduce((a, b) => a + b, 0);
console.log(`${lines.length} requests · ${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB · estimate $${est.toFixed(2)} on ${MODEL} (batch price)`);
if (!flag('execute')) { console.log('DRY-RUN. Nothing uploaded. Pass --execute to submit.'); process.exit(0); }

const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('No Gemini API key in the environment (see README: credentials)'); process.exit(2); }
const displayName = `summaries-${new Date().toISOString().slice(0, 16)}`;
const fileName = await uploadBatchInputFile(body, displayName, apiKey);
const job = await createThenDeleteInput({
  fileName, apiKey,
  create: async () => {
    const r = await fetch(`${API}/models/${MODEL}:batchGenerateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`batch create ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
    return b;
  },
});
const name = job.name;
console.log(`submitted ${name}`);
for (let i = 0; i < keys.length; i++) {
  await logUsage({ type: 'summary', mode: 'batch', model: MODEL, book_id: keys[i], batch_job_id: `${name}:${keys[i]}`,
    input_tokens: 0, output_tokens: 0, status: 'submitted', cost_usd: +perBook[i].toFixed(6), endpoint: 'scripts/summaries-batch' });
}
const jobs = fs.existsSync(jobsFile) ? JSON.parse(fs.readFileSync(jobsFile, 'utf8')) : [];
jobs.push({ name, displayName, submitted_at: new Date().toISOString(), in: inFile, books: keys.length, estUsd: +est.toFixed(4) });
fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 1));
console.log(`recorded in ${jobsFile}; collect with 4-collect.mjs (results within 24 h; Gemini expires jobs at 48 h)`);
