#!/usr/bin/env node
// PRIOR ART: none — rescue.mjs and cut-pass.mjs write to scratch; this folds their records into the one committed
// file per arm (looked in scripts/eval/cli-rescue-6523/ and results/ocr-pareto-6293/, which holds 6523c's rescore).
/**
 * Step 4b of the #6523 rescue: one committed record per rescued (or rescue-rejected) row, BESIDE the raw output,
 * which is never rewritten. Reads $JOB_SCRATCH/cli-rescue-6523/{<arm>.jsonl, cut-residual.jsonl, cut-control.json,
 * inventory.json}; writes scripts/eval/results/cli-rescue-6523/:
 *   rescued/<arm>.jsonl.gz  per row that failed the checks: key, raw path + sha, raw problem, method
 *                           (deterministic | cli-restructure | failed), extractor version, for the CLI pass its model,
 *                           CLI version and prompt version, the verbatim-guard result, and the rescued text
 *   inventory.json          counts per arm (rows, failing, rescued each way, rejected, unrescuable)
 *   cut-control.json        the 20-item control of the CLI pass
 *
 *   node scripts/eval/cli-rescue-6523/publish.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ARMS } from './arms.mjs';
import { readJsonl } from './rescue.mjs';

const SCR = path.join(process.env.JOB_SCRATCH || '/tmp', 'cli-rescue-6523');
const OUT = 'scripts/eval/results/cli-rescue-6523';
fs.mkdirSync(path.join(OUT, 'rescued'), { recursive: true });
const inv = JSON.parse(fs.readFileSync(path.join(SCR, 'inventory.json'), 'utf8'));
const cut = new Map(readJsonl(path.join(SCR, 'cut-residual.jsonl')).map((r) => [`${r.arm}|${r.key}`, r]));
const totals = { rows: 0, failing: 0, deterministic: 0, cli_restructure: 0, cli_rejected: 0, unrescuable: 0 };
for (const arm of ARMS) {
  const a = inv.arms[arm.id];
  if (!a || a.missing) continue;
  const recs = readJsonl(path.join(SCR, `${arm.id.replace(/[:/]/g, '__')}.jsonl`)).filter((r) => r.raw_problem);
  const out = recs.map((r) => {
    const base = { arm: arm.id, key: r.key, raw: { path: arm.path, sha256_16: r.raw_sha, chars: r.raw_chars }, raw_problem: r.raw_problem };
    if (r.method === 'deterministic') return { ...base, method: 'deterministic', extractor: r.extractor, steps: r.steps, guard: r.guard, text: r.text };
    if (r.method === 'needs-cli') {
      const c = cut.get(`${arm.id}|${r.key}`);
      const pass = c && { model: c.model, cli: c.cli, prompt: c.prompt, at: c.at, reason: c.reason, guard: c.guard };
      return c?.accepted
        ? { ...base, method: 'cli-restructure', deterministic_attempt: { extractor: r.extractor, steps: r.steps, after: r.after_problem, guard: r.guard }, second_pass: pass, guard: { version: c.guard_version ?? r.guard?.version ?? 'verbatim-cut/2', ...c.guard }, text: c.text }
        : { ...base, method: 'failed', why: c ? `cli pass rejected: ${c.reason}` : 'cli pass not run', deterministic_attempt: { extractor: r.extractor, steps: r.steps, after: r.after_problem, guard: r.guard }, second_pass: pass };
    }
    return { ...base, method: 'failed', why: r.why || 'unrescuable' };
  });
  const n = (m) => out.filter((o) => o.method === m).length;
  a.rescued_deterministic = n('deterministic');
  a.rescued_cli_restructure = n('cli-restructure');
  a.cli_rejected = out.filter((o) => o.method === 'failed' && o.second_pass).length;
  a.failed_total = n('failed');
  totals.rows += a.rows; totals.failing += a.failing_raw; totals.deterministic += a.rescued_deterministic;
  totals.cli_restructure += a.rescued_cli_restructure; totals.cli_rejected += a.cli_rejected; totals.unrescuable += a.failed_total - a.cli_rejected;
  // drop scratch-only fields
  delete a.deterministic; delete a.needs_cli; delete a.unrescuable; delete a.guard_rejected; delete a.unchanged;
  a.clean_but_extractor_would_cut = a.deterministic_cosmetic; delete a.deterministic_cosmetic;
  if (out.length) fs.writeFileSync(path.join(OUT, 'rescued', `${arm.id.replace(/[:/]/g, '__')}.jsonl.gz`), zlib.gzipSync(out.map((o) => JSON.stringify(o)).join('\n') + '\n', { mtime: 0 }));
}
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify({ issue: 6523, generated_by: 'scripts/eval/cli-rescue-6523/{rescue,cut-pass,publish}.mjs', extractor: inv.extractor, guard: inv.guard, totals, arms: inv.arms }, null, 1) + '\n');
fs.copyFileSync(path.join(SCR, 'cut-control.json'), path.join(OUT, 'cut-control.json'));
console.log(totals);
