#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/revert-run.mjs (revertRun, scripts/lib/page-text-writer.mjs) — the lanes' named undo
// ("Undo: scripts/maintenance/revert-run.mjs --run-id <run>", cli-ocr-lane.mjs): restores a page from the run's
// revision row only while the page still holds what the run wrote, and writes its own revision row. Used per page.
/**
 * The #7818 write-back: restore the Flash-Lite draft on the Arm P pages results/writeback.json lists (the judge accepted
 * the draft, rejected the correction, and found wrong text in it). Dry run unless --apply. Nothing else is written.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/correction-pass-7818/writeback.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OUT, RESULTS, ROOT, flag } from './lib.mjs';

const wb = JSON.parse(fs.readFileSync(path.join(RESULTS, 'writeback.json'), 'utf8'));
const log = [];
for (const p of wb.pages) {
  if (!p.run_id) { log.push({ ...p, result: 'no run id on the revision row: not restored' }); continue; }
  const f = path.join(OUT, `writeback-${p.page_id}.json`);
  fs.writeFileSync(f, JSON.stringify([p.page_id]));
  const r = spawnSync(process.execPath, ['--env-file=/root/sourcelibrary/.env.production.local', path.join(ROOT, 'scripts/maintenance/revert-run.mjs'), '--run-id', p.run_id, `--page-ids-file=${f}`, ...(flag('apply') ? ['--apply'] : [])], { encoding: 'utf8' });
  console.log(r.stdout, r.stderr);
  log.push({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, run_id: p.run_id, apply: flag('apply'), exit: r.status, restorable: /restorable \(page still holds the run's text\): 1/.test(r.stdout), out: r.stdout.split('\n').filter((l) => /restor|changed since|recount/.test(l)) });
}
fs.writeFileSync(path.join(RESULTS, `writeback-${flag('apply') ? 'applied' : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), pages: log }, null, 1) + '\n');
console.log(`${log.length} pages; ${flag('apply') ? 'applied' : 'dry run'}`);
