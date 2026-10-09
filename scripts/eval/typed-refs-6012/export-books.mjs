#!/usr/bin/env node
// #6012 step 3 input: a read-only projection of `books` (identity and source fields only) for matching.
// PRIOR ART: /data/scratch latin-5126 books.jsonl (job-local, Latin only, not in the repo);
// scripts/lib/book-docs.mjs is for sweeps that write. This reads and writes one local JSONL.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/typed-refs-6012/export-books.mjs --work=/data/scratch/sl/typed-refs-6012
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const cur = c.db('bookstore').collection('books').find({ pages_count: { $gt: 0 } }, { projection: {
  id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1, original_language: 1, languages: 1, pages_count: 1, pages_ocr: 1,
  pages_translated: 1, visible: 1, work_id: 1, edition_key: 1, edition_external_ids: 1, author_id: 1, text_role: 1, ia_identifier: 1,
  'image_source.provider': 1, 'image_source.identifier': 1, 'image_source.source_url': 1, 'image_source.shelfmark': 1, ustc_id: 1, duplicate_of: 1,
  place_of_publication: 1, publisher: 1, translator: 1, categories: 1 } });
const out = fs.createWriteStream(`${WORK}/books.jsonl`); let n = 0;
for await (const b of cur) { b._id = String(b._id); out.write(JSON.stringify(b) + '\n'); n++; }
out.end(); await new Promise((r) => out.on('finish', r)); console.log('books', n); await c.close();
