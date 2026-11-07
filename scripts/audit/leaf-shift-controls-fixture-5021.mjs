#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-leaf-shift.mjs --book --as-of (rebuilds one book's English from page_revisions;
// this does the same for four page windows and keeps only the numbers the classifier reads, so the fixture holds no text).
/**
 * Writes tests/fixtures/leaf-shift-controls-5021.json: the four by-eye leaf-shift controls (#5021) as they stood before
 * containment, each page reduced to its running-head numbers (<header>) and body numbers. Read-only.
 *   node --env-file=.env.production.local scripts/audit/leaf-shift-controls-fixture-5021.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { splitLayer, numbersIn } from '../lib/leaf-shift.mjs';
const C = [
  ['karl', '69b51e05768235dc6598b5c1', '2026-11-02T00:00:00Z', 13, 23, 'EN(n) = DE(n+1) on pp.16-19; p.20 EN = p.19 footnotes (by eye, #7968, 2026-11-03)'],
  ['corpus-medicorum', '69af49c4d6be7ec9cc3246fd', '2026-11-02T00:00:00Z', 79, 87, 'p.83 EN = p.84 Latin; p.84 EN a model note (by eye, #7968, 2026-11-03)'],
  ['postel', '69b51e39768235dc6598dede', '2026-10-20T00:00:00Z', 176, 187, 'scans 179-184: EN(n) = Latin(n+1) (by eye, #5021, 2026-10-21)'],
  ['sakuntala', '69dea23c4d19ec2e9ba75f5e', '2026-10-12T00:00:00Z', 288, 297, 'pp.291-294 EN = next leaf, verse numbers 171-174 (by eye, #6672)'],
];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const out = {};
const enc = t => { const { head, body } = splitLayer(t); const h = [...numbersIn(head, { brackets: false })]; const b = [...numbersIn(body)]; return `${h.length ? `<header>${h.join(' ')}</header>\n` : ''}text\n${b.join(' ')}`; };
for (const [k, book, asOf, lo, hi, what] of C) {
  const pages = await db.collection('pages').find({ book_id: book, page_number: { $gte: lo, $lte: hi } }, { projection: { id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const revs = await db.collection('page_revisions').find({ page_id: { $in: pages.map(p => p.id) }, field: 'translation', created_at: { $gt: new Date(asOf) } }).sort({ created_at: 1 }).toArray();
  const first = new Map(); for (const r of revs) if (!first.has(r.page_id)) first.set(r.page_id, r);
  out[k] = { book_id: book, as_of: asOf, by_eye: what, pages: pages.map(p => { const tr = first.get(p.id)?.data ?? p.translation?.data ?? ''; return { page_number: p.page_number, ocr: enc(p.ocr?.data || ''), tr: tr.trim() ? enc(tr) : '' }; }) };
}
fs.writeFileSync('tests/fixtures/leaf-shift-controls-5021.json', JSON.stringify(out, null, 1) + '\n');
await c.close();
