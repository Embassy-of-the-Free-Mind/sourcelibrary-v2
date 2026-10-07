#!/usr/bin/env node
/**
 * Read each book's split-book dry-run log (#6114 wave 1) and say what it decided: plate / mixed / portrait /
 * would-park / detector positions. For a book the detector did not park, write its per-page positions as
 * positions.detector.json ({page_number: pct|null}) so spread-folds verify can draw them. Read-only on Mongo.
 * PRIOR ART: none — split-book.mjs prints these decisions but does not export them (looked in scripts/batch, scripts/lib).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const ROOT = '/root/split-wave1-6114';
const ids = fs.readFileSync(`${ROOT}/todo-ids.txt`, 'utf8').trim().split('\n');
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const out = [];
for (const id of ids) {
  const D = `${ROOT}/books/${id}`;
  if (!fs.existsSync(`${D}/dryrun.done`)) { out.push({ id, cls: 'pending' }); continue; }
  const log = fs.readFileSync(`${D}/dryrun.log`, 'utf8');
  const row = { id };
  const cons = log.match(/Book consensus: median (\d+)\/1000, MAD (\d+)\/1000, (\d+) confident\/(\d+) landscape/);
  if (cons) Object.assign(row, { median: +cons[1], mad: +cons[2], confident: +cons[3], landscape: +cons[4] });
  row.imgFrac = +(log.match(/imgFrac (\d\.\d+)/)?.[1] ?? -1);
  if (/PLATE\/MAP BOOK/.test(log)) row.cls = 'plate';
  else if (/MIXED BOOK/.test(log)) row.cls = 'mixed';
  else if (/portrait pages, not spreads/.test(log)) row.cls = 'portrait';
  else if (/WOULD PARK: (.*?) —/.test(log)) { row.cls = 'park'; row.park = log.match(/WOULD PARK: (.*?) — real/)[1]; }
  else if (/DRY RUN — would create/.test(log)) {
    row.cls = 'detector';
    const pages = await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { page_number: 1 } }).sort({ page_number: 1 }).toArray();
    const pos = {}; const methods = {};
    for (const m of log.matchAll(/^\s+p\.\d+ (\w+)\s+source:(\d+) split:(\S+)(?: \[(.*?)\])?/gm)) {
      const pn = pages[+m[2] - 1]?.page_number; if (pn == null) continue;
      pos[pn] = m[3] === '-' ? null : +m[3] / 10; methods[pn] = m[4] || m[1];
    }
    row.n = Object.keys(pos).length; row.singles = Object.values(pos).filter((v) => v == null).length; row.pages = pages.length;
    row.uncertain = Object.values(methods).filter((v) => /UNCERTAIN|median|center/.test(v)).length;
    fs.writeFileSync(`${D}/positions.detector.json`, JSON.stringify(pos)); fs.writeFileSync(`${D}/detector-methods.json`, JSON.stringify(methods));
  } else row.cls = 'error', row.tail = log.slice(-200);
  out.push(row);
}
await client.close();
fs.writeFileSync(`${ROOT}/classify.json`, JSON.stringify(out, null, 1));
const c = {}; for (const r of out) c[r.cls] = (c[r.cls] || 0) + 1; console.log(c);
