#!/usr/bin/env node
// PRIOR ART: scripts/eval/untagged-additions/draw.mjs fetched the 450-page draw's texts into a gitignored work/ dir that
// no longer exists on any machine; this re-reads only the 60 by-eye-labelled pages (40 flagged + 20 unflagged) by id, read-only.
/** #5982 Jev screen, step 1: node --env-file=<prod env> scripts/eval/jev/additions-screen-fetch.mjs  -> results/untagged-additions-2026-10/work/live-items.jsonl */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const DIR = new URL('../results/untagged-additions-2026-10/', import.meta.url).pathname;
const jl = (f) => fs.readFileSync(DIR + f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const res = JSON.parse(fs.readFileSync(DIR + 'results.json', 'utf8'));
const labelled = [...res.draw_pages.map((p) => ({ id: p.id, label: p.confirmed ? 1 : 0, group: 'flagged' })), ...jl('by-eye/unflagged-a1.jsonl').map((u) => ({ id: u.id, label: 0, group: 'unflagged' }))];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const P = c.db('bookstore').collection('pages');
const out = [];
for (const l of labelled) {
  const m = l.id.match(/^([0-9a-f]{24})_(.*)$/); // negative page numbers are padded oddly: "00-75" is -75
  const p = await P.findOne({ book_id: m[1], page_number: Number(m[2].replace(/^0+(?=-)/, '')) }, { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1 } });
  if (!p?.ocr?.data || !p?.translation?.data) { console.log('missing', l.id); continue; }
  out.push({ ...l, source: p.ocr.data, translation: p.translation.data });
}
fs.mkdirSync(DIR + 'work', { recursive: true });
fs.writeFileSync(DIR + 'work/live-items.jsonl', out.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log('fetched', out.length, 'of', labelled.length);
await c.close();
