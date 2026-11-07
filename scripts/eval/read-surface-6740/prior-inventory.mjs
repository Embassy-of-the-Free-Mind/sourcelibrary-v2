#!/usr/bin/env node
// #6740 read-surface, STEER 1 (Derek, 2026-10-30 20:52Z: "can existing data be the prior?"): inventory every stored
// agy first read whose settings are known on a page that has a typed reference (#6012 DTA / CAMENA, congruent, one typed
// page), so it can enter the surface as a power-prior design point.
//
// PRIOR ART: scripts/lib/candidate-reads.mjs (the kept-read store and its key layout, read here with its own client
//   shape); scripts/eval/typed-refs-6012/align.mjs (the aligned pages). Nothing lists kept reads by the settings they
//   were made with.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-surface-6740/prior-inventory.mjs --work=DIR
// Writes DIR/prior/inventory.json (counts by source × setting) and DIR/prior/reads.jsonl (one row per usable read:
// page, setting, text path). Reads R2 and Mongo; writes nothing else.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '../typed-refs-6012/lib.mjs';

const WORK = path.resolve(process.argv.find((a) => a.startsWith('--work='))?.slice(7));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(WORK, 'prior'); fs.mkdirSync(OUT, { recursive: true });
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const aligned = [];
for (const [lang, src] of [['de', 'dta'], ['la', 'camena']]) for (const r of readGz(path.join(HERE, '..', 'output', `typed-refs-6012-2026-10-06.${src}.aligned-pages.jsonl.gz`))) if (r.congruent && r.ref_page_idx[0] === r.ref_page_idx[1]) aligned.push({ lang, ...r });
const byBook = new Map();
for (const a of aligned) { if (!byBook.has(a.book_id)) byBook.set(a.book_id, new Map()); byBook.get(a.book_id).set(a.page_number, a); }

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const tally = {}; const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
const rows = fs.createWriteStream(path.join(OUT, 'reads.jsonl'));
const s3 = r2();
let books = 0;
for (const [bookId, pages] of byBook) {
  books++;
  const docs = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [...pages.keys()] } }, { projection: { id: 1, page_number: 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.engine': 1 } }).toArray();
  const idOf = new Map(docs.map((d) => [d.id, d]));
  for (const d of docs) {
    const e = d.ocr?.engine;
    bump(`stored:${d.ocr?.model ?? 'none'}:${e?.api ?? '-'}:${d.ocr?.pipeline ?? '-'}`);
  }
  // Kept reads of this book (all pages; filtered to aligned pages by id).
  let token; const keys = [];
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: 'sl-corpus-snapshots', Prefix: `candidate-reads/${bookId}/`, ContinuationToken: token }));
    keys.push(...(r.Contents || []).map((o) => o.Key)); token = r.NextContinuationToken;
  } while (token);
  const todo = keys.filter((k) => { const [, , pageId, field] = k.split('/'); return field === 'ocr' && idOf.has(pageId); });
  if (books % 10 === 0) console.log(`book ${books}/${byBook.size}: ${todo.length} kept OCR reads on aligned pages`);
  await Promise.all(Array.from({ length: 24 }, async () => { while (todo.length) await one(todo.shift()); }));
  async function one(k) {
    const [, , pageId] = k.split('/');
    const obj = await s3.send(new GetObjectCommand({ Bucket: 'sl-corpus-snapshots', Key: k }));
    const chunks = []; for await (const c of obj.Body) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const m = body.meta || {};
    const job = body.job || m.job || '?';
    const mine = /^read-surface-6740/.test(job);
    const setting = { model: body.model || m.model, per_call: m.call_pages ?? m.per_call ?? 1, image_fit: m.image_fit ?? null, prompt_variant: m.prompt_variant ?? null, prompt_hash: m.prompt_sent_hash ?? null };
    bump(`kept:${mine ? 'this-design' : job}:${setting.model}:@${setting.per_call}`);
    if (mine) return;
    const p = idOf.get(pageId), a = pages.get(p.page_number);
    rows.write(JSON.stringify({ key: k, book_id: bookId, page_id: pageId, page_number: p.page_number, lang: a.lang, source_id: a.source_id, job, read_at: body.read_at ?? m.finished_at ?? null, ...setting, chatter: m.chatter ?? null, write_guard: m.write_guard ?? null, image_bytes: m.image_bytes ?? null, text: body.text ?? null }) + '\n');
  }
}
rows.end();
await client.close();
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify({ at: new Date().toISOString(), aligned_pages: aligned.length, books, tally: Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])) }, null, 1));
console.log(`${aligned.length} aligned pages in ${books} books`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(v).padStart(7), k);
