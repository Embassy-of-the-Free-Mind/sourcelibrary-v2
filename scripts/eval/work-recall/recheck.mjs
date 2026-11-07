#!/usr/bin/env node
// Re-score the uniform frame against today's work_ids, without re-judging (#7761).
// The judge's verdicts don't change when work_ids do, so after a merge or a re-key the
// question "does this book still have an unlinked same-work sibling?" is a database read.
// PRIOR ART: score.mjs scores the judge's output as it stood at judge time; this re-reads work_id.
//
// usage:
//   node scripts/eval/work-recall/recheck.mjs pairs <j-frame.jsonl> <frame-pairs.jsonl>   # once, slim the judged frame
//   node --env-file=.env.production.local scripts/eval/work-recall/recheck.mjs score <frame-pairs.jsonl>
//   frame-pairs rows: {t, c, rel}  t = frame book, c = candidate the judge called same edition / work / translation
import fs from 'fs';

const [,, mode, a, b] = process.argv;
const LINK = new Set(['same_edition', 'same_work', 'translation']);
const wilson = (k, n, z = 1.96) => { const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [((c - m) / d * 100).toFixed(1), ((c + m) / d * 100).toFixed(1)]; };

if (mode === 'pairs') {
  const rows = fs.readFileSync(a, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const out = [];
  for (const r of rows) { out.push({ t: r.target.id }); for (const c of r.calls || []) if (LINK.has(c.rel)) out.push({ t: r.target.id, c: c.id, rel: c.rel }); }
  fs.writeFileSync(b, out.map(o => JSON.stringify(o)).join('\n') + '\n');
  console.log(`${rows.length} frame books, ${out.filter(o => o.c).length} linking pairs -> ${b}`);
  process.exit(0);
}
if (mode !== 'score') { console.error('usage: recheck.mjs pairs <j-frame> <out> | score <frame-pairs>'); process.exit(2); }

const { MongoClient } = await import('mongodb');
const rows = fs.readFileSync(a, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const frame = [...new Set(rows.map(r => r.t))];
const ids = [...new Set(rows.flatMap(r => [r.t, r.c].filter(Boolean)))];
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const books = await client.db('bookstore').collection('books').find({ id: { $in: ids } }).project({ _id: 0, id: 1, work_id: 1 }).batchSize(1000).toArray();
await client.close();
const wid = new Map(books.map(x => [x.id, x.work_id]));
let pairs = 0, linked = 0, gone = 0; const missed = new Set();
for (const r of rows.filter(r => r.c)) {
  pairs++;
  if (!wid.has(r.t) || !wid.has(r.c)) { gone++; continue; }
  if (wid.get(r.t) && wid.get(r.t) === wid.get(r.c)) linked++; else missed.add(r.t);
}
const k = missed.size, n = frame.length;
console.log(`judged linking pairs ${pairs}: now share a work_id ${linked}, missing book ${gone}`);
console.log(`frame books with an unlinked same-work sibling: ${k}/${n} = ${(100 * k / n).toFixed(1)}% [${wilson(k, n).join('–')}]`);
