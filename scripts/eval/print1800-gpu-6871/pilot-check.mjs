#!/usr/bin/env node
// PRIOR ART: none — the #6871 pilot's own read-back: every page the lane wrote, checked with missingProvenance, and a
// seeded draw of 10 written pages (image URL + stored text) for the by-eye check. Read-only.
//   node --env-file=… pilot-check.mjs <lane dir> <out dir>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { missingProvenance } from '../../lib/write-provenance.mjs';
const [LANE, OUT, SEED = "6871pilot"] = process.argv.slice(2);
const applied = fs.readFileSync(`${LANE}/applied.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const pages = await db.collection('pages').find({ id: { $in: applied.map((a) => a.pid) } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1 } }).toArray();
const bad = pages.filter((p) => missingProvenance('ocr', p.ocr).missing.length);
const books = await db.collection('books').find({ id: { $in: [...new Set(applied.map((a) => a.bid))] } }, { projection: { id: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1, pages_ocr: 1, pages_count: 1 } }).toArray();
console.log(`${pages.length}/${applied.length} written pages found; source lightonocr: ${pages.filter((p) => p.ocr?.source === 'lightonocr').length}; missing provenance: ${bad.length}${bad.length ? ' ' + JSON.stringify(missingProvenance('ocr', bad[0].ocr)) : ''}`);
for (const b of books) console.log(`  ${b.id} ${b.pipeline_auto?.status} hold=${b.pipeline_auto?.hold?.reason} ocr ${b.pages_ocr}/${b.pages_count}`);
const pick = [...pages].sort((a, b) => crypto.createHash('sha256').update(`${SEED}${a.id}`).digest('hex').localeCompare(crypto.createHash('sha256').update(`${SEED}${b.id}`).digest('hex'))).slice(0, 10);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/pick.json`, JSON.stringify(pick.map((p) => ({ id: p.id, book_id: p.book_id, page_number: p.page_number, image: p.ocr.engine.input.image_url, text: p.ocr.data })), null, 1));
await c.close();
