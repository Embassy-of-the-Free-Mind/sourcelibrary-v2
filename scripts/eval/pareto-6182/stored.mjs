#!/usr/bin/env node
// PRIOR ART: tengyur-levers/ref-pages.mjs and sample.mjs read pages.translation.data as arm S for their own
// page sets; this reads it for every Tengyur unit of #6182 in one pass and records its model and prompt.
/** stored.mjs — read-only, $0. Writes /root/pareto-6182/arms/S.jsonl (the stored English, read today) for the Tengyur units.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pareto-6182/stored.mjs */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const W = '/root/pareto-6182';
const units = fs.readFileSync(`${W}/units.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((u) => u.set.startsWith('tib'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const docs = await c.db('bookstore').collection('pages').find({ id: { $in: units.map((u) => u.page_id) } }, { projection: { _id: 0, id: 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1 } }).toArray();
await c.close();
const by = new Map(docs.map((d) => [d.id, d]));
const date = new Date().toISOString().slice(0, 10);
const rows = units.map((u) => { const t = by.get(u.page_id)?.translation || {}; return { uid: u.uid, arm: 'S', model: `${t.model || '?'} (stored, prompt ${t.prompt_version || '?'})`, text: t.data || '', date, set: u.set }; });
fs.writeFileSync(`${W}/arms/S.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const tally = {}; for (const r of rows) { const k = `${r.set} ${r.model}${r.text ? '' : ' EMPTY'}`; tally[k] = (tally[k] || 0) + 1; }
console.log(tally);
