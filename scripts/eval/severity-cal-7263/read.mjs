#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs correct() (a FRESH route: cli-ocr.mjs read on the image alone,
// --keep-reads so every read is kept through candidate-reads; the first QUOTA/LOCKED line stops it) — restated here
// because that stage is keyed to its own sample.json cells. cli-ocr.mjs apply's failure checks (exit, cut wrapper,
// empty, refusal, loop) are restated as the read classes below, since apply is a writer and is not run.
/**
 * #7263 severity calibration, stage 2: the fresh agy Flash-low read of each drawn page, one page a call, kept.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/severity-cal-7263/read.mjs run
 *   node scripts/eval/severity-cal-7263/read.mjs classify     → OUT/reads.json (per page: class, text)
 * Writes no page or book (cli-ocr.mjs read writes only its lane_job_books row and the kept read).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { OUT, ROOT, FRESH_MODEL, J, W } from './lib.mjs';

const DIR = path.join(OUT, 'fresh');
const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text/im;

/** A text's read class: ok, or why it is counted apart from misreads. `meta` is cli-ocr's, absent for a stored text. */
export function readClass(text, meta) {
  if (meta && meta.exit !== 0) return 'failed: cli exit';
  if (meta?.wrapper) return /end|cut|missing/i.test(meta.wrapper) ? 'filter cut: reply cut before its end marker' : `failed: wrapper ${meta.wrapper}`;
  if (!String(text).trim() || String(text).trim().length < 5) return 'failed: empty';
  if (REFUSAL.test(text)) return 'failed: refusal';
  if (loopVerdict(text).refuse) return 'loop';
  return 'ok';
}

if (process.argv[2] === 'run') {
  const s = J('sample.json');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'ids.json'), JSON.stringify(s.map((x) => x.page_id)));
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/batch/cli-ocr.mjs'), 'read', `--page-ids-file=${path.join(DIR, 'ids.json')}`, `--out=${DIR}`, `--model=${FRESH_MODEL}`, '--job=severity-cal-7263', '--concurrency=3'],
      { env: process.env, cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (d) => { process.stdout.write(d); if (/QUOTA at|LOCKED at/.test(String(d))) { fs.writeFileSync(path.join(OUT, 'agy-stopped.txt'), `${new Date().toISOString()} ${String(d).trim()}\n`); child.kill('SIGTERM'); } });
    child.on('close', resolve);
  });
}
if (process.argv[2] === 'classify') {
  const s = J('sample.json'), out = {};
  for (const x of s) {
    const mf = path.join(DIR, `${x.page_id}.meta.json`);
    const meta = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
    const text = meta ? fs.readFileSync(path.join(DIR, `${x.page_id}.txt`), 'utf8') : '';
    out[x.page_id] = { S: { class: readClass(x.stored, null) }, F: { class: meta ? readClass(text, meta) : 'failed: not read', text, calls: meta?.calls ?? 0, rereads: meta?.rereads ?? 0, wrapper: meta?.wrapper ?? null } };
  }
  W('reads.json', out);
  const t = {}; for (const [k, v] of Object.entries(out)) for (const a of ['S', 'F']) { const key = `${s.find((x) => x.page_id === k).lang} ${a}: ${v[a].class}`; t[key] = (t[key] ?? 0) + 1; }
  console.log(t);
}
