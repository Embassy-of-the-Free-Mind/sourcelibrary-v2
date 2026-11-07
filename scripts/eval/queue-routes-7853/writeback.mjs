#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/writeback.mjs (one lane apply per page from the arm's own read directory,
// dry run unless --apply, every outcome listed; its T2 (b) and (c) paths are arms 1 and 3 here) and
// scripts/batch/cli-ocr-lane.mjs armcRun (arm 2's apply: --only, --mark-stale=ARMC_LANE, the E3 diff guard).
/**
 * The #7853 write-back: results/writeback.json's pages (the best judged arm, accepted, nothing judged better, not the
 * stored text). Every write goes through `cli-ocr.mjs apply` from the arm's own read directory: its guards,
 * writePageText's revision row, its provenance. Dry run unless --apply. Writes results/writeback-<dry|applied>.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/queue-routes-7853/writeback.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OUT, RESULTS, ROOT, J, flag, ENV_FILE } from './lib.mjs';
import { CORRECT_LANE, ARMC_LANE } from '../../batch/cli-ocr-lane.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const APPLY = flag('apply');
const RE_READ = 'queue-routes-7853-reread';
const wb = JSON.parse(fs.readFileSync(path.join(RESULTS, 'writeback.json'), 'utf8'));
const node = (args) => spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, AGY_JOB: 'queue-routes-7853-writeback' } });
const why = '#7853 write-back: the judged best arm of a paired test on the #7558 correction queue, accepted by the blind Opus judge against the image';
const PATH = {
  corr: { dir: 'corr', extra: [`--mark-stale=${CORRECT_LANE}`], reason: `${why} (arm 1: the #7558 correction of the Flash-Lite draft by agy Flash-low with the image)` },
  read4: { dir: 'read4', extra: [`--mark-stale=${RE_READ}`], reason: `${why} (arm 3: a fresh agy Flash-low read, 4 pages a call, the live first-read prompt)` },
  read1: { dir: 'read1', extra: [`--mark-stale=${RE_READ}`], reason: `${why} (arm 4: a fresh agy Flash-low read, 1 page a call, the live first-read prompt)` },
  gpu: { dir: 'gpu-arm', extra: [`--mark-stale=${ARMC_LANE}`], reason: `${why} (arm 2: a GPU draft, PERO or LightOnOCR, corrected by agy Flash-low with the image on template 0601ef30e816f7a7, E3 diff guard)` },
};
const summaryAfter = (dir, t0) => { const f = fs.readdirSync(dir).filter((x) => /^apply-summary-(?!refused).*\.json$/.test(x)).map((x) => path.join(dir, x)).filter((x) => fs.statSync(x).mtimeMs >= t0).sort().pop(); return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const sel = new Map(J('selected.json').selected.map((s) => [s.page_id, s]));
const log = [];
for (const p of wb.pages) {
  const s = sel.get(p.page_id), P = PATH[p.arm];
  const dir = path.join(OUT, P.dir, s.book_id);
  const only = path.join(dir, `wb-only-${p.page_id}.json`); fs.writeFileSync(only, JSON.stringify([p.page_id]));
  const t0 = Date.now() - 1000;
  const r = node([CLI, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=${P.reason}`, ...P.extra, ...(APPLY ? ['--apply'] : [])]);
  const sm = summaryAfter(dir, t0);
  const res = { exit: r.status, written: (sm.written_page_ids || []).includes(p.page_id) || (!APPLY && sm.written > 0), run: sm.run ?? null, skipped: sm.skipped_pages?.[p.page_id] ?? null };
  log.push({ ...p, apply: APPLY, ...res });
  console.log(`${p.arm} ${p.page_id}: ${JSON.stringify(res)}`);
}
fs.writeFileSync(path.join(RESULTS, `writeback-${APPLY ? 'applied' : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), pages: log }, null, 1) + '\n');
console.log(`${log.length} pages; ${APPLY ? 'applied' : 'dry run'}; written ${log.filter((x) => x.written).length}`);
