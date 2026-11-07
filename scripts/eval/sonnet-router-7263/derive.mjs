#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-next-7263/script-type.mjs classifyPages (the print / manuscript split, imported);
// router-table/evidence/derive_backfill_all.py writes score.json from verdict files that already exist in the repo, and
// router-next-7263/split_evidence.py needs the whole evidence_pages.py run: neither reads this job's scratch verdicts.
/**
 * This job's verdicts -> scripts/eval/results/sonnet-router-7263/verdicts.json (ids only, no text) and the router's
 * evidence files: evidence/sonnet-router-7263.score.json, evidence/by-script/sonnet-router-7263.score.json.
 *   node --env-file=<env> scripts/eval/sonnet-router-7263/derive.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { classifyPages } from '../router-next-7263/script-type.mjs';
const J = process.env.JOB_SCRATCH + '/test/', RT = 'scripts/eval/estimator/router-table/evidence/';
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ARMS = { 'latin-flash3': { route: 'sonnet-read', paired: '3flash' }, 'chinese-flash3': { route: 'sonnet-read', paired: '3flash' }, 'latin-lite': { route: 'lite>sonnet', paired: 'lite' } };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const per = {}, unsplit = { source: '#7263 sonnet-router', generated_at: new Date().toISOString(), cells: {} }, split = { source: '#7263 sonnet-router', generated_at: new Date().toISOString(), cells: {} };
const routeOf = (rows) => {
  const cl = {};
  for (const r of rows) for (const k of new Set((r.defects || []).map((d) => d.class))) cl[k] = (cl[k] || 0) + 1;
  return { n: rows.length, books: new Set(rows.map((r) => r.book_id)).size, accept: `${rows.filter((r) => r.accept).length}/${rows.length}`, wrong_text_pages: `${rows.filter((r) => r.wrong).length}/${rows.length}`,
    classes_k_of_n: Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, `${v}/${rows.length}`])), not_delivered: 0 };
};
const pair = (rows, b) => ({ n: rows.length, books: new Set(rows.map((r) => r.book_id)).size, both: rows.filter((r) => r.accept && r.stored[b]?.accept).length, a_only: rows.filter((r) => r.accept && !r.stored[b]?.accept).length, b_only: rows.filter((r) => !r.accept && r.stored[b]?.accept).length, neither: rows.filter((r) => !r.accept && !r.stored[b]?.accept).length });
for (const [cell, A] of Object.entries(ARMS)) {
  const rows = jsonl(`${J}${cell}/verdicts.jsonl`);
  const cls = await classifyPages(c.db('bookstore'), rows.map((r) => r.page_id));
  for (const r of rows) r.script = cls.get(r.page_id)?.cls || 'unknown';
  per[cell] = rows.map(({ defects, judge_usd, sonnet_usd, ...r }) => ({ ...r, severe: (defects || []).filter((d) => d.severity !== 'cosmetic').map((d) => d.class) }));
  unsplit.cells[cell] = { routes: { [A.route]: routeOf(rows) }, paired: { [`${A.route}|${A.paired}`]: pair(rows, A.paired) } };
  for (const s of ['print', 'manuscript', 'unknown']) {
    const x = rows.filter((r) => r.script === s);
    if (x.length) split.cells[`${cell}|${s}`] = { routes: { [A.route]: routeOf(x) }, paired: { [`${A.route}|${A.paired}`]: pair(x, A.paired) } };
  }
  console.log(cell, Object.fromEntries(['print', 'manuscript', 'unknown'].map((s) => [s, rows.filter((r) => r.script === s).length])));
}
await c.close();
fs.writeFileSync('scripts/eval/results/sonnet-router-7263/verdicts.json', JSON.stringify(per, null, 1) + '\n');
fs.writeFileSync(path.join(RT, 'sonnet-router-7263.score.json'), JSON.stringify(unsplit, null, 1) + '\n');
fs.writeFileSync(path.join(RT, 'by-script/sonnet-router-7263.score.json'), JSON.stringify(split, null, 1) + '\n');
