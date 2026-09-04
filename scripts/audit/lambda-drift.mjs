#!/usr/bin/env node
/**
 * PRIOR ART: none — searched scripts/audit/ (no lambda/aws/worker-drift script),
 * scripts/aws-lambda/ (build/package/deploy only — they SHIP code, none READ BACK what is
 * running), and scripts/lib/. The closest neighbour is scripts/audit/spend-perimeter.mjs,
 * which classifies our own spenders from source and never asks the vendor what is deployed.
 *
 * lambda-drift — is the deployed Lambda actually running the commit we think it is?
 *
 * WHY THIS EXISTS (#4600)
 * -----------------------
 * The four workers are hand-deployed. Merging a PR does NOT deploy them — it ships the Vercel
 * side only. So the deployed code and `main` drift silently, and every diagnosis made by reading
 * `src/workers/` is then wrong in a way that reads exactly like being right.
 *
 * On 2026-09-04 this check found `db-write` one commit stale, missing #4523's
 * `{ $ne: ["$ocr.unreadable", true] }` — so it was counting attempted-but-unreadable pages as
 * OCR'd. Nothing was failing. Nothing would have failed. The number was just wrong.
 *
 * HOW IT WORKS
 * ------------
 * `aws lambda get-function` returns a presigned URL to the deployed zip. Unzip it, and compare
 * its `index.js` byte-for-byte against a fresh esbuild of the same worker entry point from the
 * current checkout. Identical bytes mean the deployed artifact IS this tree's build. This works
 * because the build is deterministic — same esbuild invocation, same input, same output.
 *
 * TRAPS (both cost time on 2026-09-04)
 * ------------------------------------
 * A. Run this from the MAIN CHECKOUT. esbuild embeds each module's resolved path in a comment,
 *    and a worktree has no local `node_modules` — so it resolves `../../../node_modules/...` and
 *    every byte comparison fails on a difference that means nothing. This script refuses to run
 *    from a worktree rather than report false drift.
 * B. "Deployed" is a claim about bytes, not about a timestamp. LastModified tells you when
 *    someone last uploaded, never what they uploaded.
 *
 * REQUIRES: lambda:GetFunction (granted, scoped to the four sourcelibrary-*-processor functions).
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/lambda-drift.mjs [--json]
 *
 * EXIT CODES: 0 all current · 1 drift found · 2 could not check (missing creds/permission)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const JSON_OUT = process.argv.includes('--json');

/** worker entry point -> deployed function name. The mapping is NOT uniform: write -> db-write. */
const WORKERS = [
  { entry: 'ocr-processor', fn: 'sourcelibrary-ocr-processor' },
  { entry: 'translation-processor', fn: 'sourcelibrary-translation-processor' },
  { entry: 'image-extraction-processor', fn: 'sourcelibrary-image-extraction-processor' },
  { entry: 'write-processor', fn: 'sourcelibrary-db-write-processor' },
];

const REGION = process.env.AWS_REGION || 'eu-central-1';
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts });

// ── Trap A: refuse to produce false drift from a worktree build.
const gitDir = sh('git', ['rev-parse', '--git-dir']).trim();
if (gitDir.includes('.git/worktrees') || !existsSync('node_modules')) {
  console.error('Run this from the MAIN checkout (~/sourcelibrary), not a worktree.');
  console.error('A worktree has no local node_modules, so esbuild embeds different module paths');
  console.error('and every comparison reports drift that is not there.');
  process.exit(2);
}

const head = sh('git', ['rev-parse', '--short', 'HEAD']).trim();
const dirty = sh('git', ['status', '--porcelain', '--', 'src/']).trim();

const tmp = mkdtempSync(join(tmpdir(), 'lambda-drift-'));
const results = [];
let failed = false;

try {
  for (const w of WORKERS) {
    const localPath = join(tmp, `${w.entry}.js`);
    sh('npx', ['esbuild', `src/workers/${w.entry}.ts`, '--bundle', '--platform=node',
      '--target=node24', '--external:@aws-sdk/*', `--outfile=${localPath}`]);
    const localSha = createHash('sha256').update(readFileSync(localPath)).digest('hex');

    let deployedSha = null, lastModified = null, error = null;
    try {
      const cfg = JSON.parse(sh('aws', ['lambda', 'get-function', '--function-name', w.fn,
        '--region', REGION, '--query', '{loc:Code.Location,mod:Configuration.LastModified}',
        '--output', 'json']));
      lastModified = cfg.mod;
      const zipPath = join(tmp, `${w.entry}.zip`);
      sh('curl', ['-sS', '-o', zipPath, cfg.loc]);
      sh('unzip', ['-oq', zipPath, 'index.js', '-d', join(tmp, w.entry)]);
      deployedSha = createHash('sha256').update(readFileSync(join(tmp, w.entry, 'index.js'))).digest('hex');
    } catch (e) {
      error = String(e.stderr || e.message).trim().split('\n').pop().slice(0, 160);
    }

    const current = deployedSha !== null && deployedSha === localSha;
    if (error || !current) failed = true;
    results.push({ fn: w.fn, current, error, lastModified,
      localSha: localSha.slice(0, 12), deployedSha: deployedSha?.slice(0, 12) ?? null });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ head, dirty: Boolean(dirty), results }, null, 2));
} else {
  console.log(`\nLambda drift vs local build @ ${head}${dirty ? ' (WORKING TREE DIRTY — comparing against uncommitted code)' : ''}\n`);
  for (const r of results) {
    const status = r.error ? `COULD NOT CHECK — ${r.error}` : r.current ? 'current' : 'DRIFTED';
    console.log(`  ${r.fn.padEnd(45)} ${status}`);
    if (!r.error && !r.current) console.log(`      deployed ${r.deployedSha}  local ${r.localSha}  (uploaded ${r.lastModified})`);
  }
  console.log(failed
    ? '\nDrift or an unchecked function is NOT a failure of the pipeline — it is a failure of\nknowledge. Redeploy with `npm run lambda:prepare && npm run lambda:deploy -- <entry>`,\nthen re-run this. See scripts/aws-lambda/BUILD-AND-DEPLOY.md.'
    : '\nAll four workers are running this commit.');
}

process.exit(failed ? 1 : 0);
