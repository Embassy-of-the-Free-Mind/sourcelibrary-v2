#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-levers/build-packet.mjs renders review items (renderEnglish, opaque ids,
// batches of 10) from a sample plus controls, and analyze.py scores plant recall; #6121's re-plant path
// (build-controls.mjs --calib) was registered but never had to run, so it has no packet or scorer. This is
// both, for a calibration attempt only: 12 reversal/agent plants + 8 unplanted pages, the same item shape.
/**
 * calib.mjs — $0. #6182 reviewer gate, re-plant attempt N.
 *   node scripts/eval/pareto-6182/calib.mjs --attempt 2 --build   # /root/pareto-6182/rev/calib-N/{A,B}-0{1,2}.jsonl + results key
 *   node scripts/eval/pareto-6182/calib.mjs --attempt 2 --score   # recall per reviewer (analyze.py's match rule)
 */
import fs from 'node:fs';
import path from 'node:path';
import { rng as mkRng, shuffle, renderEnglish } from '../tengyur-characterize/common.mjs';

const N = Number(process.argv[process.argv.indexOf('--attempt') + 1]);
const work = `/root/pareto-6182/rev/calib-${N}`, out = `scripts/eval/results/pareto-6182/tib-rev/calib-${N}`;
fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(path.join(out, 'reviews'), { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (process.argv.includes('--build')) {
  const R = mkRng(6182 * 17 + N);
  const items = [], key = {};
  for (const [i, x] of shuffle(read(`/root/pareto-6182/rev/controls-${N}.jsonl`), R).entries()) {
    const id = `K${N}${String(i + 1).padStart(2, '0')}`;
    items.push({ id, where: `Derge Tengyur vol. ${x.vol} (${x.section}), folio ${x.folio || '?'}`, tibetan: x.bo, previous_side_last_line: x.prev_last || '', next_side_first_line: x.next_first || '', english: renderEnglish(x.en) });
    key[id] = { ctype: x.ctype, plant_kind: x.plant_kind, plant: x.plant, page_id: x.page_id };
  }
  fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(key, null, 1));
  for (const [rv, seed] of [['A', 1], ['B', 2]]) {
    const o = shuffle(items, mkRng(6182 * 19 + N * 10 + seed));
    for (let b = 0; b < 2; b++) fs.writeFileSync(path.join(work, `${rv}-0${b + 1}.jsonl`), o.slice(b * 10, b * 10 + 10).map((x) => JSON.stringify(x)).join('\n') + '\n');
  }
  console.log(`attempt ${N}: ${items.length} items`, Object.values(key).reduce((m, k) => ((m[k.plant_kind] = (m[k.plant_kind] || 0) + 1), m), {}));
}
if (process.argv.includes('--score')) {
  const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9ༀ-ྼ]+/g, ' ').trim();
  const overlap = (a, b, k = 20) => { a = norm(a); b = norm(b); if (!a || !b) return false; if (a.includes(b) || b.includes(a)) return true; for (let i = 0; i < Math.max(1, a.length - k + 1); i += 3) if (b.includes(a.slice(i, i + k))) return true; return false; };
  const res = {};
  for (const rv of ['A', 'B']) {
    const got = Object.fromEntries(['01', '02'].flatMap((b) => JSON.parse(fs.readFileSync(path.join(out, 'reviews', `${rv}-${b}.json`), 'utf8'))).map((x) => [x.id, x]));
    const pl = Object.entries(key).filter(([, k]) => k.ctype === 'PLANT');
    const found = pl.filter(([id, k]) => (got[id].errors || []).some((e) => ['reversal', 'agent'].includes(e.type) && (overlap(e.english, k.plant.new) || overlap(k.plant.new, e.english))));
    const fp = Object.entries(key).filter(([id, k]) => k.ctype === 'REAL' && (got[id].errors || []).some((e) => ['reversal', 'agent'].includes(e.type))).length;
    res[rv] = { rev_agent_found: found.length, of: pl.length, missed: pl.filter((p) => !found.includes(p)).map(([, k]) => k.plant.how), unplanted_pages_flagged: fp, pass: found.length >= 10 };
  }
  fs.writeFileSync(path.join(out, 'gate.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
}
