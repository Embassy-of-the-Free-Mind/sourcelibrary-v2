#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-write-guard-5902/live-dry.mjs — the live 3-page run; this is its $0 twin over
// stored text. scripts/maintenance/translation-cleanup-a2-5700.mjs scans stored text for #5901's shape 1, not brackets.
/**
 * #5902 precision check for the bracket rule: a random draw of pages, kept where the translation has a <term>,
 * each run through bracketDefinitionsToNotes, every new <note> printed with its context to be read by eye.
 * Read-only.  node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-write-guard-5902/stored-draw.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { bracketDefinitionsToNotes } from '../../lib/translation-write-guard.mjs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const rows = await db.collection('pages').aggregate([
  { $sample: { size: 40000 } },
  { $match: { 'translation.data': { $type: 'string', $regex: '</term>' } } },
  { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'translation.prompt_version': 1 } },
], { allowDiskUse: true, maxTimeMS: 240000 }).toArray();
const tot = { pages: rows.length, changed: 0, bracket: 0 };
const ex = [];
for (const r of rows) {
  const t = r.translation.data; const b = bracketDefinitionsToNotes(t); const g = { text: b.text, n: { bracket: b.n } };
  if (g.text !== t) { tot.changed++; tot.bracket += g.n.bracket;
    for (const m of g.text.matchAll(/<note>[^<]*<\/note>/g)) { const ctx = g.text.slice(Math.max(0, m.index - 70), m.index + m[0].length + 25).replace(/\n/g, ' '); if (!t.includes(m[0]) && ex.length < 80) ex.push(`${r.book_id} p${r.page_number} v${r.translation.prompt_version}: ${ctx}`); } }
}
console.log(JSON.stringify(tot)); console.log(ex.join('\n'));
const out = new URL('../results/translation-write-guard-5902/stored-draw.json', import.meta.url).pathname;
fs.writeFileSync(out, JSON.stringify({ run_at: new Date().toISOString(), ...tot, fires: ex }, null, 1));
await c.close();
