#!/usr/bin/env node
// PRIOR ART: onset.py (finds the onset pages; it has only lengths and edges, not the source's last line);
// scripts/lib/block-drift.mjs sourceProse (reused). Read-only.
/**
 *   node --env-file=.env.production.local scripts/eval/wrong-leaf-find-5021/onset-tails.mjs LABELS.jsonl OUT.json
 * For the onset page of every labelled slide (the page before the first `next` inside a 2-s write group) and every other
 * unlabelled page of the same groups: does the source's prose end mid-word (a hyphen), mid-sentence (no . ! ? : ; or a
 * closing bracket/quote after it), or with a catchword tag? Wilson intervals; within-group control.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { sourceProse } from '../../lib/block-drift.mjs';
const [LAB, OUT] = process.argv.slice(2);
const rows = fs.readFileSync(LAB, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const want = new Map();
for (const b of rows) {
  const ps = b.pages.filter((p) => p.t != null).sort((a, z) => a.n - z.n);
  const groups = []; let cur = [];
  for (const p of ps) { if (cur.length && p.n === cur.at(-1).n + 1 && Math.abs(p.t - cur.at(-1).t) <= 2000) cur.push(p); else { if (cur.length) groups.push(cur); cur = [p]; } }
  if (cur.length) groups.push(cur);
  for (const g of groups) {
    const ys = g.map((p) => p.y ?? null); const f = ys.indexOf('next');
    if (f <= 0 || ys[f - 1] === 'next') continue;
    for (let j = 0; j < g.length; j++) { if (j === f - 1) want.set(`${b.b}:${g[j].n}`, 'onset'); else if (g[j].y == null) want.set(`${b.b}:${g[j].n}`, 'ctrl'); }
  }
}
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const byBook = new Map();
for (const k of want.keys()) { const [b, n] = k.split(':'); (byBook.get(b) || byBook.set(b, []).get(b)).push(Number(n)); }
const tally = { onset: {}, ctrl: {} }; const N = { onset: 0, ctrl: 0 };
const bump = (g, k) => { tally[g][k] = (tally[g][k] || 0) + 1; };
for (const [b, ns] of byBook) {
  const ps = await db.collection('pages').find({ book_id: b, page_number: { $in: ns } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  for (const p of ps) {
    const g = want.get(`${b}:${p.page_number}`); if (!g) continue;
    const raw = String(p.ocr?.data || '');
    const prose = sourceProse(raw).replace(/\s+$/u, '');
    if (prose.length < 50) continue;
    N[g]++;
    if (/[-‐‑⸗=¬]$/u.test(prose)) bump(g, 'ends mid-word (hyphen)');
    else if (!/[.!?:;。！？」』）)\]»"'”’]$/u.test(prose)) bump(g, 'ends mid-sentence');
    if (/<catchword\b/i.test(raw)) bump(g, 'has catchword tag');
  }
}
await c.close();
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, m = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [k, n, +(p).toFixed(3), +((m - h) / d).toFixed(3), +((m + h) / d).toFixed(3)]; };
const res = Object.fromEntries(['ends mid-word (hyphen)', 'ends mid-sentence', 'has catchword tag'].map((k) => [k, { onset: wilson(tally.onset[k] || 0, N.onset), same_calls_other_pages: wilson(tally.ctrl[k] || 0, N.ctrl) }]));
fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1));
