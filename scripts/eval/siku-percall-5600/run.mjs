#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503 ran its four arms by hand from the shell (no runner kept). This one runs one
// arm over the draw's 120 block pages in parallel groups of whole books, on the james pool, and brackets the arm with
// two `agy -p /quota` readings so the arm's quota draw can be read against the lane's rate between arms.
/**
 * #5600 per-call / prompt-line test, one arm:
 *
 *   node scripts/eval/siku-percall-5600/run.mjs --arm=A|B|C|D --scratch=DIR [--groups=5]
 *
 *   A  cli-translate.mjs read, 1 page per call (the lane's route)
 *   B  claude-translate.mjs read --cli=agy --per-call=4
 *   C  A + LINES (instructions-file, every page)
 *   D  B + LINES
 *
 * Every arm is --fresh (the quota is what is measured), gemini-3.8-flash-low, AGY_HOME=/root/.agy-james. Reads are
 * kept (candidate-reads) as usual. JOB_NAME is prefixed `siku-lane-5600` so the lane does not treat these 30 books as
 * another job's (siku-translate-lane exclusions()). Writes DIR/<arm>/ (reads), DIR/<arm>.json (start/end, readings).
 * Nothing is written to pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const ENV_FILE = process.env.SL_ENV_FILE || '/data/scratch/sl/sourcelibrary/.env.production.local';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ARM = arg('arm'), S = path.resolve(arg('scratch')), G = Number(arg('groups') || 5);
const MODEL = 'gemini-3.8-flash-low', AGY_HOME = '/root/.agy-james', JOB = 'siku-lane-5600-percall-test';
export const LINES = [
  'The leaf\'s margin text (欽定四庫全書, the juan number, the folio number) is not part of the text: leave it out of the English.',
  'Translate only what is on this leaf. If the last sentence breaks off, stop where the leaf stops; do not complete it.',
].join('\n');
if (!['A', 'B', 'C', 'D'].includes(ARM) || !arg('scratch')) { console.error('usage: run.mjs --arm=A|B|C|D --scratch=DIR'); process.exit(2); }

const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const out = path.join(S, ARM);
fs.mkdirSync(out, { recursive: true });
const withLines = ARM === 'C' || ARM === 'D';
const block = ARM === 'B' || ARM === 'D';
const instr = path.join(S, 'instructions.json');
fs.writeFileSync(instr, JSON.stringify(Object.fromEntries(draw.books.flatMap((b) => b.block.map((p) => [p.page_id, LINES]))), null, 1));

function quota() {
  const r = spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { cwd: '/tmp', encoding: 'utf8', timeout: 120e3, env: { ...process.env, AGY_HOME } });
  try {
    const b = JSON.parse(r.stdout).command.data.groups[0].buckets;
    const w = b.find((x) => x.window === 'weekly'), h = b.find((x) => x.window === '5h');
    return { at: new Date().toISOString(), weekly: w.remaining_fraction, weekly_reset: w.reset_time, h5: h.remaining_fraction, h5_reset: h.reset_time };
  } catch { return { at: new Date().toISOString(), error: (r.stderr || r.stdout || '').slice(0, 200) }; }
}

// Whole books per group, round robin, so every block keeps its seed order.
const groups = Array.from({ length: G }, () => []);
draw.books.forEach((b, i) => groups[i % G].push(...b.block.map((p) => p.page_id)));
const before = quota();
if (before.error) { const again = quota(); if (again.error) { console.error(`quota read failed twice: ${again.error}`); process.exit(4); } Object.assign(before, again); }
const t0 = new Date();
const codes = await Promise.all(groups.map((ids, k) => new Promise((resolve) => {
  const f = path.join(out, `group-${k}.json`);
  fs.writeFileSync(f, JSON.stringify(ids));
  const args = block
    ? [path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', `--page-ids-file=${f}`, `--out=${out}`, '--cli=agy', `--model=${MODEL}`, '--per-call=4', `--job=${JOB}`, '--fresh']
    : [path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'read', `--page-ids-file=${f}`, `--out=${out}`, `--model=${MODEL}`, '--fresh'];
  if (withLines) args.push(`--instructions-file=${instr}`);
  const fd = fs.openSync(path.join(out, `group-${k}.log`), 'a');
  const child = spawn(process.execPath, ['--no-warnings', `--env-file=${ENV_FILE}`, ...args], { cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, AGY_HOME, JOB_NAME: JOB, CLI_JOB_NAME: JOB } });
  child.on('close', (code) => { fs.closeSync(fd); resolve(code); });
})));
const t1 = new Date();
const after = quota();
const metas = fs.readdirSync(out).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')));
const rec = { arm: ARM, model: MODEL, pool: AGY_HOME, groups: G, exit_codes: codes, started_at: t0.toISOString(), finished_at: t1.toISOString(), secs: (t1 - t0) / 1000, quota_before: before, quota_after: after, reads: metas.length, ok: metas.filter((m) => m.exit === 0).length };
fs.writeFileSync(path.join(S, `${ARM}.json`), JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec, null, 1));
if (codes.some((c) => c === 3)) process.exit(3);
