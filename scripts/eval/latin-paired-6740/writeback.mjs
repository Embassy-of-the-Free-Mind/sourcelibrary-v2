#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/writeback.mjs (one lane apply per page from the arm's own read directory,
// dry run unless --apply, every outcome listed) and scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs apply (the
// first-read writes: a fresh read with --first-read-only --print-only --lane, a GPU-draft correction with
// --diff-guard=gpu-draft --print-only, its lane taken from the read's meta). No --mark-stale: the page has no translation.
/**
 * The write-back: results/writeback.json's pages (the best judged arm, accepted, written by its own dry apply). Every
 * write goes through `cli-ocr.mjs apply` from the arm's own read directory: first reads only (a page read since by a
 * lane is skipped), printed only, the GPU-draft put-back, writePageText's revision row, provenance and lane stamp.
 * Dry run unless --apply. Writes results/writeback-<dry|applied>.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-paired-6740/writeback.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OUT, RESULTS, ROOT, J, flag, ENV_FILE, LANES } from './lib.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const APPLY = flag('apply');
const wb = JSON.parse(fs.readFileSync(path.join(RESULTS, 'writeback.json'), 'utf8'));
const node = (args) => spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, AGY_JOB: 'latin-paired-6740-writeback' } });
const why = '#6740 Latin first-read paired test write-back: the judged best arm on a page with no OCR in a book published as scans (the hold stays), accepted by the blind Opus judge against the image';
const PATH = {
  live: { extra: ['--diff-guard=gpu-draft', '--print-only'], reason: `${why} (arm 1, the live route: PERO-OCR draft corrected by agy Flash-low with the image, one page a call, template 0601ef30e816f7a7, #7695 put-back against the draft)` },
  pero4: { extra: ['--diff-guard=gpu-draft', '--print-only'], reason: `${why} (arm 2: PERO-OCR draft corrected by agy Flash-low with the images, four pages a call, template 0601ef30e816f7a7, #7695 put-back against the draft)` },
  read4: { extra: ['--first-read-only', '--print-only', `--lane=${LANES.read4}`], reason: `${why} (arm 3: a fresh agy Flash-low read, four pages a call, the live first-read prompt)` },
};
const summaryAfter = (dir, t0) => { const f = fs.readdirSync(dir).filter((x) => /^apply-summary-(?!refused).*\.json$/.test(x)).map((x) => path.join(dir, x)).filter((x) => fs.statSync(x).mtimeMs >= t0).sort().pop(); return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const sel = new Map(J('selected.json').selected.map((s) => [s.page_id, s]));
const log = [];
for (const p of wb.pages) {
  const s = sel.get(p.page_id), P = PATH[p.arm];
  const dir = path.join(OUT, p.arm, s.book_id);
  const only = path.join(dir, `wb-only-${p.page_id}.json`); fs.writeFileSync(only, JSON.stringify([p.page_id]));
  const t0 = Date.now() - 1000;
  const r = node([CLI, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=${P.reason}`, ...P.extra, ...(APPLY ? ['--apply'] : [])]);
  const sm = summaryAfter(dir, t0);
  const res = { exit: r.status, written: (sm.written_page_ids || []).includes(p.page_id) || (!APPLY && sm.written > 0), run: sm.run ?? null, skipped: sm.skipped_pages?.[p.page_id] ?? null, lane: LANES[p.arm] };
  log.push({ ...p, apply: APPLY, ...res });
  console.log(`${p.arm} ${p.page_id}: ${JSON.stringify(res)}`);
}
fs.writeFileSync(path.join(RESULTS, `writeback-${APPLY ? 'applied' : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), pages: log }, null, 1) + '\n');
console.log(`${log.length} pages; ${APPLY ? 'applied' : 'dry run'}; written ${log.filter((x) => x.written).length}`);
