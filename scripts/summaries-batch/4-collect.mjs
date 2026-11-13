#!/usr/bin/env node
/**
 * Collect finished jobs from 3-submit.mjs and write each result ONLY to book.summary_candidate,
 * the holding place the existing review (/platform/admin/summary-review) and promotion
 * (scripts/maintenance/promote-summaries.mjs, reversible with --restore) already read. Never writes
 * summary, reading_summary, index or book_indexes. DRY-RUN by default.
 *
 *   node --env-file=.env.production.local scripts/summaries-batch/4-collect.mjs [--execute]
 *
 * Candidate shape matches resynthesize-summaries.mjs: { brief, abstract, detailed, generated_at,
 * model, prompt_version, status: 'pending' } plus source, evidence and job. No book revision is
 * written: candidates are not live fields (data-provenance.md requires createBookRevision before
 * overwriting summary / reading_summary / index / chapters, which promotion does by stashing
 * `replaced`).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { MODEL, SOURCE, PROMPT_VERSION, NO_SUMMARY, hasIndexSummary, arg, flag } from './lib.mjs';
import { streamBatchResponses } from '../lib/gemini-batch-input-file.mjs';
import { completeBatchUsage, outputTokensFrom } from '../workers/lib/supabase-usage-logger.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const EXECUTE = flag('execute');
const jobsFile = arg('jobs', 'summaries-batch-jobs.json');
if (!fs.existsSync(jobsFile)) { console.error(`no ${jobsFile}; submit first`); process.exit(2); }
const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!apiKey || !process.env.MONGODB_URI) { console.error('Gemini key and MONGODB_URI needed (see README: credentials)'); process.exit(2); }

const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

for (const job of jobs.filter((j) => !j.collected_at)) {
  const r = await (await fetch(`${API}/${job.name}?key=${apiKey}`)).json();
  const state = r.metadata?.state || r.state || 'UNKNOWN';
  console.log(`${job.name}: ${state}`);
  if (!/SUCCEEDED/.test(state)) continue;
  const file = r.response?.responsesFile || r.metadata?.output?.responsesFile || r.dest?.fileName;
  if (!file) { console.log('  no results file yet'); continue; }
  let ok = 0, skipped = 0, bad = 0;
  for await (const line of streamBatchResponses(file, apiKey)) {
    const id = line.key;
    const usage = line.response?.usageMetadata;
    if (EXECUTE) await completeBatchUsage({ batch_job_id: `${job.name}:${id}`, model: MODEL, input_tokens: usage?.promptTokenCount || 0, output_tokens: outputTokensFrom(usage), status: line.error ? 'failed' : 'success' });
    let parsed = null;
    try { parsed = JSON.parse(line.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''); } catch { /* bad JSON */ }
    if (!parsed?.brief) { bad++; continue; }
    // The book may have gained a summary while the job ran: re-check at write time, as enrich-batch-lane does.
    const still = await books.countDocuments({ id, ...NO_SUMMARY });
    if (!still || await hasIndexSummary(db, id)) { skipped++; continue; }
    const cand = { brief: parsed.brief.trim(), abstract: (parsed.abstract || '').trim(), detailed: '', evidence: parsed.evidence || [],
      generated_at: new Date(), model: MODEL, prompt_version: PROMPT_VERSION, source: SOURCE, job: job.name, status: 'pending' };
    if (EXECUTE) await books.updateOne({ id, ...NO_SUMMARY }, { $set: { summary_candidate: cand } });
    else if (ok < 5) console.log(`  [dry] ${id}: ${cand.brief.slice(0, 140)}`);
    ok++;
  }
  console.log(`  ${EXECUTE ? 'wrote' : 'would write'} ${ok} candidates · ${skipped} skipped (summarised meanwhile) · ${bad} unusable responses`);
  if (EXECUTE) { job.collected_at = new Date().toISOString(); fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 1)); }
}
if (!EXECUTE) console.log('DRY-RUN. Nothing written. Pass --execute to save candidates (status pending, never live).');
await client.close();
