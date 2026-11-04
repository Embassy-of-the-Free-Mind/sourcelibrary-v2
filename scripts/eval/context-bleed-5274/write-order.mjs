#!/usr/bin/env node
// PRIOR ART: scripts/eval/wrong-leaf-find-5021/walk.mjs (write-time groups for BLOCK calls, 2 s chains); this asks a
// different question of one page: was page n written AFTER page n-1 (a chained single-page lane that could send n-1's
// English as context) or in the same stamp as a whole job (the Batch API collector, no context)?
/**
 * For each page of the #5274 near-blank predicate (verdicts.jsonl), the write time of the English the screen judged
 * (translation_withheld / translation / page_revisions.original_date) and of page n-1's English of the same vintage, and
 * the gap n − (n−1). Tabulated against the screen's verdict.
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/write-order.mjs --out=FILE.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const V = fs.readFileSync(path.join(ROOT, 'scripts/eval/results/zh-near-blank-screen-5274/verdicts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await c.connect();
const db = c.db('bookstore');
async function febTime(p, model) {
  for (const t of [p?.translation, p?.translation_withheld]) if (t?.model === model && t.updated_at) return new Date(t.updated_at);
  if (!p) return null;
  const r = await db.collection('page_revisions').find({ page_id: p.id, field: 'translation', model }).project({ original_date: 1 }).sort({ created_at: 1 }).limit(1).toArray();
  return r[0]?.original_date ? new Date(r[0].original_date) : null;
}
const rows = [];
for (const v of V) {
  const ps = await db.collection('pages').find({ book_id: v.book_id, page_number: { $in: [v.page_number - 1, v.page_number] } }, { projection: { id: 1, page_number: 1, translation: { model: 1, updated_at: 1 }, translation_withheld: { model: 1, updated_at: 1 } } }).toArray();
  const me = ps.find((p) => p.page_number === v.page_number), prev = ps.find((p) => p.page_number === v.page_number - 1);
  const model = v.translation_model;
  const t = await febTime(me, model), t1 = await febTime(prev, model);
  const gap = t && t1 ? (t - t1) / 1000 : null;
  const cls = gap == null ? 'no-prev-time' : Math.abs(gap) < 1 ? 'same-stamp' : gap > 0 && gap <= 600 ? 'after-prev<=10min' : gap > 600 ? 'after-prev>10min' : 'before-prev';
  rows.push({ book_id: v.book_id, page: v.page_number, verdict: v.verdict, model, at: t?.toISOString() ?? null, gap_s: gap, cls });
}
const tab = {};
for (const r of rows) { const k = `${r.model} | ${r.cls}`; tab[k] = tab[k] || {}; tab[k][r.verdict] = (tab[k][r.verdict] || 0) + 1; }
fs.writeFileSync(OUT, JSON.stringify({ tab, rows }, null, 1));
console.log(JSON.stringify(tab, null, 1));
await c.close();
