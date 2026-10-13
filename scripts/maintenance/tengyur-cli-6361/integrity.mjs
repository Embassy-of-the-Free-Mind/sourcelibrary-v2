#!/usr/bin/env node
// PRIOR ART: /root/tengyur-cli-6361/driver.mjs (stage 1, the writer of every file checked here) records the hashes
// but never re-reads them; scripts/eval/typed-refs-6012/lib.mjs verifies an R2 copy, not a run directory. Nothing
// checked a staged CLI run end to end, so this reads the run back from disk and compares it with its own manifest.
//
// #6361 stage 2, step 1: is the stage-1 run directory whole? Files only, no Mongo, no network.
//   - pages.jsonl and manifest.jsonl name the same pages, each exactly once
//   - every page's prompt file hashes to the prompt_sha256 recorded twice (pages.jsonl, manifest)
//   - a staged page has out/<id>.json, class null, and sha256(response.trim()) = response_sha256, length = response_chars
//   - a failed page has its 3 attempt files and 3 failures.jsonl rows, each with a class (the reason)
//   - every failures.jsonl row has its attempt file
//
//   node scripts/maintenance/tengyur-cli-6361/integrity.mjs [--run=/root/tengyur-cli-6361] [--out=summary.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const W = arg('run', '/root/tengyur-cli-6361');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const jl = (f) => fs.readFileSync(path.join(W, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const problems = [];
const bad = (id, what) => { if (problems.length < 200) problems.push(`${id}: ${what}`); problems.n = (problems.n || 0) + 1; };
const pages = jl('pages.jsonl'), manifest = jl('manifest.jsonl'), failures = jl('failures.jsonl');
const byPage = new Map();
for (const p of pages) { if (byPage.has(p.page_id)) bad(p.page_id, 'twice in pages.jsonl'); byPage.set(p.page_id, p); }
const seen = new Set();
const fails = new Map();
for (const f of failures) (fails.get(f.page_id) ?? fails.set(f.page_id, []).get(f.page_id)).push(f);
const tally = { pages: pages.length, manifest_rows: manifest.length, staged: 0, failed: 0, failure_rows: failures.length, reasons: {}, attempts_to_stage: {} };

for (const m of manifest) {
  if (seen.has(m.page_id)) bad(m.page_id, 'staged twice (two manifest rows)');
  seen.add(m.page_id);
  const p = byPage.get(m.page_id);
  if (!p) { bad(m.page_id, 'in manifest, not in pages.jsonl'); continue; }
  for (const k of ['book_id', 'page_number', 'ocr_sha256', 'prompt_sha256']) if (p[k] !== m[k]) bad(m.page_id, `${k} differs between pages.jsonl and manifest`);
  const pf = path.join(W, 'prompts', `${m.page_id}.txt`);
  if (!fs.existsSync(pf)) bad(m.page_id, 'prompt file missing');
  else if (sha(fs.readFileSync(pf, 'utf8')) !== m.prompt_sha256) bad(m.page_id, 'prompt sha256 mismatch');
  const fr = fails.get(m.page_id) || [];
  for (const f of fr) if (!fs.existsSync(path.join(W, 'out', `${m.page_id}.a${f.attempt}.json`))) bad(m.page_id, `attempt file a${f.attempt} missing`);
  if (m.status === 'staged') {
    tally.staged++;
    tally.attempts_to_stage[m.attempts] = (tally.attempts_to_stage[m.attempts] || 0) + 1;
    const of = path.join(W, 'out', `${m.page_id}.json`);
    if (!fs.existsSync(of)) { bad(m.page_id, 'out file missing'); continue; }
    const rec = JSON.parse(fs.readFileSync(of, 'utf8'));
    if (rec.class !== null) bad(m.page_id, `out file class ${rec.class}`);
    const resp = (rec.agy?.response || '').trim();
    if (sha(resp) !== m.response_sha256) bad(m.page_id, 'response sha256 mismatch');
    if (resp.length !== m.response_chars) bad(m.page_id, 'response length mismatch');
    if (rec.agy?.status !== 'SUCCESS') bad(m.page_id, `agy status ${rec.agy?.status}`);
    if (fr.length !== m.attempts - 1) bad(m.page_id, `${fr.length} failure rows for attempt ${m.attempts}`);
  } else if (m.status === 'failed') {
    tally.failed++;
    if (fr.length !== 3) bad(m.page_id, `failed with ${fr.length} failure rows, not 3`);
    if (fr.some((f) => !f.class)) bad(m.page_id, 'failure row without a class');
    const reason = m.last_class || 'unrecorded';
    tally.reasons[reason] = (tally.reasons[reason] || 0) + 1;
  } else bad(m.page_id, `status ${m.status}`);
}
for (const p of pages) if (!seen.has(p.page_id)) bad(p.page_id, 'no manifest row');
for (const id of fails.keys()) if (!byPage.has(id)) bad(id, 'failure row for a page not in scope');

const hashFile = (f) => sha(fs.readFileSync(path.join(W, f)));
const summary = {
  run: W, checked_at: new Date().toISOString(), ...tally,
  file_sha256: Object.fromEntries(['scope.json', 'pages.jsonl', 'manifest.jsonl', 'failures.jsonl', 'excluded.jsonl', 'quota.log', 'driver.mjs', 'build-prompts.mjs'].map((f) => [f, hashFile(f)])),
  problems: problems.n || 0, problem_examples: problems,
};
const out = arg('out');
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, problem_examples: problems.slice(0, 20) }, null, 1));
process.exit(problems.n ? 1 : 0);
