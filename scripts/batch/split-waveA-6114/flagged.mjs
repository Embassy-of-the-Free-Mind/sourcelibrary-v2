#!/usr/bin/env node
// PRIOR ART: before.mjs (this directory) — the seeded BEFORE sample; this adds the spreads where the leaves hold
//   the FEWEST Han characters relative to the old whole-spread read, so the by-eye review also sees the likely losses.
// Usage: node --env-file=… flagged.mjs <book_id> <bookdir> [n=2]   → <bookdir>/flagged.json (before.json's shape; read-only)
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const [id, D, N = '2'] = process.argv.slice(2);
// Centre markers first: `->text<-` is not a tag, and a tag-stripping regex eats everything from `<-` to the next `>`.
const han = (s) => ((s || '').replace(/->|<-/g, '').replace(/<[^>]+>/g, '').match(/[\u3400-\u9fff]/g) || []).length;
const c = await MongoClient.connect(process.env.MONGODB_URI);
const ps = await c.db('bookstore').collection('pages').find({ book_id: id }).toArray();
await c.close();
const sampled = new Set(JSON.parse(fs.readFileSync(`${D}/before.json`, 'utf8')).spreads.map((s) => s.page_number));
const pos = JSON.parse(fs.readFileSync(`${D}/positions.final.json`, 'utf8'));
const rows = [];
for (const a of ps.filter((p) => p.page_type === 'archived-spread')) {
  const n = Number((a.archived_photo || '').match(/\/(\d+)\.jpg$/)?.[1]);
  const leaves = ps.filter((p) => p.page_number > 0 && p.spread_source?.endsWith(`/${n}.jpg`));
  const old = han(a.ocr?.data), neu = leaves.reduce((s, p) => s + han(p.ocr?.data), 0);
  // A looping old read (thousands of repeated characters) is not a loss; cap the comparison at plausible page sizes.
  if (pos[n] != null && old >= 150 && old < 2000 ) rows.push({ a, n, old, neu, ratio: neu / old, sampled: sampled.has(n) });
}
rows.sort((x, y) => x.ratio - y.ratio);
const spreads = rows.filter((r) => !r.sampled).slice(0, Number(N)).map(({ a, n, old, neu }) => ({ page_number: n, fold_pct: pos[n], image_url: a.archived_photo, archived_photo: a.archived_photo, han_old: old, han_new: neu,
  ocr: { data: a.ocr.data, model: a.ocr.model }, translation: { data: a.translation?.data || "(no translation)", model: a.translation?.model || "none" } }));
fs.writeFileSync(`${D}/han-by-spread.json`, JSON.stringify(rows.map(({ n, old, neu }) => ({ spread: n, han_old: old, han_new: neu })).sort((x, y) => x.spread - y.spread)));
fs.writeFileSync(`${D}/flagged.json`, JSON.stringify({ book_id: id, rule: 'lowest new/old Han-character ratio, not in the seeded sample', spreads }, null, 1));
const tot = (k) => rows.reduce((t, r) => t + r[k], 0);
console.log(id, `comparable spreads ${rows.length}: han ${tot('old')} -> ${tot('neu')}; leaves >10% more: ${rows.filter((r) => r.ratio > 1.1).length}, >10% fewer: ${rows.filter((r) => r.ratio < 0.9).length}`);
console.log(id, spreads.map((s) => `s${s.page_number}: han ${s.han_old}→${s.han_new}`).join(' | '));
