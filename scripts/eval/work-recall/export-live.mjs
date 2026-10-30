#!/usr/bin/env node
// PRIOR ART: scripts/eval/build-work-gold-set.mjs reads the same books but only translated ones and keeps no
// external ids; this export is the shared input for every step in this directory (#7761).
// usage: node --env-file=.env.production.local scripts/eval/work-recall/export-live.mjs <out live-books.jsonl>
import { MongoClient } from 'mongodb';
import fs from 'fs';

const out = process.argv[2];
if (!out) { console.error('usage: export-live.mjs <out.jsonl>'); process.exit(2); }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = c.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const cur = books.find({ visible: true, pages_count: { $gt: 0 } }, { projection: {
  _id: 0, id: 1, work_id: 1, work_id_source: 1, title: 1, display_title: 1, author: 1, author_id: 1, language: 1,
  published: 1, year: 1, ia_identifier: 1, ustc_id: 1, edition_key: 1, pages_count: 1, edition_external_ids: 1 } }).batchSize(1000);
const w = fs.createWriteStream(out); let n = 0;
for await (const b of cur) { w.write(JSON.stringify(b) + '\n'); n++; }
w.end(); console.log('live books', n); await c.close();
