#!/usr/bin/env node
// PRIOR ART: none — a 30-row snapshot of the stored reads the test judges (looked in scripts/eval/*/ for a snapshot helper).
/** Snapshot the stored (looping) OCR of the drawn pages, before any write: node ... old-texts.mjs DRAW.json OUT.json */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const [DRAW, OUT] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(DRAW, 'utf8')).drawn.map((d) => d.page_id);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = await c.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray();
fs.writeFileSync(OUT, JSON.stringify(Object.fromEntries(pages.map((p) => [p.id, p.ocr?.data ?? ''])), null, 1));
console.log(pages.length, 'stored reads');
await c.close();
