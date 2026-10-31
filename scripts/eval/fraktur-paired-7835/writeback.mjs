#!/usr/bin/env node
// PRIOR ART: scripts/eval/correction-pass-7818/writeback.mjs (one named lane path per page, dry run unless --apply) and
// scripts/batch/cli-ocr-lane.mjs firstReadMain / correctMain (the apply calls the lanes make). Every write goes through
// `cli-ocr.mjs apply` from the arm's own read directory: its guards, writePageText's revision row, its provenance.
/**
 * The #7835 write-back: results/writeback.json's writable pages (the best judged arm, accepted, no arm judged better).
 * Dry run unless --apply. Writes results/writeback-<dry|applied>.json with every page and its outcome.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fraktur-paired-7835/writeback.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OUT, RESULTS, ROOT, J, flag, ENV_FILE, AGY_MODEL } from './lib.mjs';
import { FIRST_READ_LANE, FIRST_READ_CORRECT_LANE, CORRECT_LANE } from '../../batch/cli-ocr-lane.mjs';

const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const APPLY = flag('apply');
const wb = JSON.parse(fs.readFileSync(path.join(RESULTS, 'writeback.json'), 'utf8'));
const node = (args) => spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, AGY_JOB: 'fraktur-7835-writeback' } });
const REASON = {
  t1a: '#7835 write-back: the judged best arm of a paired Fraktur test (T1 (a), the live first read, agy Flash-low 4 pages a call), accepted by the blind Opus judge against the image',
  t1c: '#7835 write-back: the judged best arm of a paired Fraktur test (T1 (c), the first read corrected by agy Flash-low with the image, the #7558 template), accepted by the blind Opus judge',
  t2b: '#7835 write-back: the judged best arm of a paired Fraktur test (T2 (b), the #7558 correction of the Flash-Lite draft), accepted by the blind Opus judge against the image',
  t2c: '#7835 write-back: the judged best arm of a paired Fraktur test (T2 (c), a fresh agy Flash-low read, 4 pages a call), accepted by the blind Opus judge against the image',
};
const summaryAfter = (dir, t0) => { const f = fs.readdirSync(dir).filter((x) => /^apply-summary-(?!refused).*\.json$/.test(x)).map((x) => path.join(dir, x)).filter((x) => fs.statSync(x).mtimeMs >= t0).sort().pop(); return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
function apply(dir, pageId, extra, reason) {
  const only = path.join(dir, `wb-only-${pageId}.json`); fs.writeFileSync(only, JSON.stringify([pageId]));
  const t0 = Date.now() - 1000;
  const r = node([CLI, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=${reason}`, ...extra, ...(APPLY ? ['--apply'] : [])]);
  const s = summaryAfter(dir, t0);
  return { exit: r.status, written: (s.written_page_ids || []).includes(pageId) || (!APPLY && s.written > 0), run: s.run ?? null, skipped: s.skipped_pages?.[pageId] ?? null, tail: r.stdout.split('\n').filter((l) => /WRITE|would write|skip/.test(l)).slice(-3) };
}
const sel = { t1: new Map(J('t1/selected.json').selected.map((s) => [s.page_id, s])), t2: new Map(J('t2/selected.json').selected.map((s) => [s.page_id, s])) };
const log = [];
for (const p of wb.pages) {
  const s = sel[p.set].get(p.page_id);
  if (!p.writable) { log.push({ ...p, result: 'not writable: listed only' }); continue; }
  const dirOf = (arm) => path.join(OUT, p.set, arm, s.book_id);
  let res;
  if (p.set === 't1' && p.arm === 'a') res = { a: apply(dirOf('a'), p.page_id, [`--lane=${FIRST_READ_LANE}`, '--first-read-only', '--print-only'], REASON.t1a) };
  // T1 (c) is NOT writable after all (found 2026-10-31 12:45Z): cli-ocr's kept-read reuse copies the kept meta, so the
  // reused correction still says draft.source 'file' and apply refuses it. The first run wrote arm (a) on the 10 pages and
  // they were reverted with revert-run.mjs (results/writeback-t1c-reverted.json). Listed, not written.
  else if (p.set === 't1' && p.arm === 'c' && !flag('t1c-via-reuse')) { log.push({ ...p, writable: false, result: 'not writable: the reused kept read carries draft.source file, which apply refuses' }); continue; }
  else if (p.set === 't1' && p.arm === 'c') {
    const a = apply(dirOf('a'), p.page_id, [`--lane=${FIRST_READ_LANE}`, '--first-read-only', '--print-only'], REASON.t1a);
    res = { a };
    if (APPLY && a.written) {
      // The lane's own correction on the now-stored draft: the identical request, so cli-ocr reuses the kept read of arm (c).
      const dir = path.join(OUT, 't1', 'wb-c', s.book_id); fs.mkdirSync(dir, { recursive: true });
      const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify([p.page_id]));
      const rd = node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--correct-prompt=${path.join(OUT, 'fc-correct-prompt.txt')}`, `--lane=${FIRST_READ_CORRECT_LANE}`, '--job=fraktur-7835-writeback', '--stop-on-quota']);
      const m = JSON.parse(fs.readFileSync(path.join(dir, `${p.page_id}.meta.json`), 'utf8'));
      const same = fs.readFileSync(path.join(dir, `${p.page_id}.txt`), 'utf8').trim() === fs.readFileSync(path.join(OUT, 'texts', `T1-${p.page_id}.c-read.txt`), 'utf8').trim();
      res.c_read = { exit: rd.status, reused_from: m.reused_from ?? null, same_as_judged_read: same };
      res.c = same ? apply(dir, p.page_id, [], REASON.t1c) : { written: false, skipped: 'the re-requested correction is not the judged read (no kept read reused): not written' };
    }
  } else if (p.set === 't2' && p.arm === 'b') res = { b: apply(dirOf('b'), p.page_id, [`--mark-stale=${CORRECT_LANE}`], REASON.t2b) };
  else if (p.set === 't2' && p.arm === 'c') res = { c: apply(dirOf('c'), p.page_id, ['--mark-stale=fraktur-7835-reread'], REASON.t2c) };   // the page's English is queued for re-translation, as --mark-stale does for (b)
  log.push({ ...p, apply: APPLY, ...res });
  console.log(`${p.set}/${p.arm} ${p.page_id}: ${JSON.stringify(res)}`);
}
fs.writeFileSync(path.join(RESULTS, `writeback-${APPLY ? 'applied' : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), pages: log }, null, 1) + '\n');
console.log(`${log.length} pages; ${APPLY ? 'applied' : 'dry run'}`);
