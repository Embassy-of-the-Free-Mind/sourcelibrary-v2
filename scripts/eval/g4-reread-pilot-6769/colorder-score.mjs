#!/usr/bin/env node
// PRIOR ART: scripts/eval/g4-reread-pilot-6769/score.mjs (maps the judge's verdicts through draw.mjs's key, incl. the
// order_A/order_B report) — it scores G4L against the served text; this scores colorder.mjs's order verdict against
// that same judge order report, on the pilot's and the colfix run's reads of the same Zohar Chadash pages.
/**
 *   node scripts/eval/g4-reread-pilot-6769/colorder-score.mjs --sheets=SHEETS --run=rashi:READDIR --run=rashi-colfix:READDIR [--out=F]
 * For each run: judge label (results/g4-reread-pilot-6769/{key,verdicts}-<run>) vs check verdict, per page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseStrips, orderVerdict } from './colorder.mjs';

const RES = new URL('../results/g4-reread-pilot-6769/', import.meta.url).pathname;
const args = process.argv.slice(2);
const SHEETS = args.find((a) => a.startsWith('--sheets='))?.slice(9);
const OUT = args.find((a) => a.startsWith('--out='))?.slice(6);
const MIN = Number(args.find((a) => a.startsWith('--min-score='))?.slice(12) ?? 0.25);
const rows = [];
for (const r of args.filter((a) => a.startsWith('--run=')).map((a) => a.slice(6))) {
  const [tag, dir] = r.split(':');
  const { key } = JSON.parse(fs.readFileSync(path.join(RES, `key-${tag}.json`), 'utf8'));
  const last = new Map();
  for (const l of fs.readFileSync(path.join(RES, `verdicts-${tag}.jsonl`), 'utf8').split('\n').filter(Boolean)) { const v = JSON.parse(l); if (v.verdict) last.set(v.uid, v.verdict); }
  for (const [uid, k] of Object.entries(key)) {
    if (k.kind !== 'sample' || !last.get(uid)) continue;
    const v = last.get(uid), judge = v.columns >= 2 ? v[k.A === 'g4l' ? 'order_A' : 'order_B'] : 'single';
    const sd = path.join(SHEETS, k.page_id);
    const n = JSON.parse(fs.readFileSync(path.join(sd, 'cols.json'), 'utf8')).strips.length;
    const strips = parseStrips(fs.readFileSync(path.join(sd, 'strips.raw.txt'), 'utf8'), n);
    const c = orderVerdict(strips, fs.readFileSync(path.join(dir, `${k.page_id}.txt`), 'utf8'), { minScore: MIN });
    rows.push({ run: tag, page: k.page_number, page_id: k.page_id, judge, columns: v.columns, check: c.verdict, located: c.located.map((x) => ({ n: x.n, at: x.at, score: +x.score.toFixed(2) })), strips: n });
  }
}
const tab = {};
for (const r of rows) { const j = r.judge === 'reversed' || r.judge === 'interleaved' ? 'bad' : r.judge; tab[`${j} -> ${r.check}`] = (tab[`${j} -> ${r.check}`] || 0) + 1; }
console.log(JSON.stringify(tab, null, 1));
for (const r of rows.filter((x) => (x.judge === 'reversed') !== (x.check === 'reversed'))) console.log(JSON.stringify(r));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ min_score: MIN, table: tab, rows }, null, 1));
