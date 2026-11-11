#!/usr/bin/env node
// PRIOR ART: scripts/eval/regression-from-almeida-2026-11.mjs builds the labelled findings this reads;
// scripts/audit/translation-page-boundary.mjs fetchTriple reads one page with its neighbours (same shape here).
/**
 * defect-detectors snapshot — the labelled page set every detector in detectors.mjs is scored on.
 * READ-ONLY on Mongo; writes one local JSONL (page text: keep it OUT of the repo).
 *
 *   node --env-file=.env.production.local scripts/eval/defect-detectors/snapshot.mjs --out /root/jobs/defect-detectors/snapshot.jsonl
 *
 * Positives: every page the member's findings (regression/almeida-2026-11-findings.jsonl) name in a
 * page-level class (O*, T*, D1). Controls: pages 9 before, 7 after and 13 before each positive in the
 * same book that no finding names. A control is "not reported", not "verified clean" — the member did
 * not read every page — so AUCs here are a floor on what a detector could show against true labels.
 * Each row carries prev/page/next (OCR, English, type) and, once per book, the book's OCR word counts
 * (folded), which the long-s rule needs. page.changed is the later of the OCR and translation update times:
 * run.mjs --unchanged-since drops pages rewritten after the report, whose reported defect may be gone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg('--out', '/root/jobs/defect-detectors/snapshot.jsonl');
const FINDINGS = arg('--findings', 'scripts/eval/regression/almeida-2026-11-findings.jsonl');
const PAGE_CLASS = /^(O\d+|T\d+|D1)$/;
const CONTROL_OFFSETS = [-9, 7, -13];

const rows = fs.readFileSync(FINDINGS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const flagged = new Set(rows.flatMap((r) => (r.pages || []).map((p) => `${p.book_id}:${p.page_number}`)));
const pos = new Map();
for (const r of rows) if (PAGE_CLASS.test(r.class)) for (const p of r.pages || []) {
  const k = `${p.book_id}:${p.page_number}`; (pos.get(k) || pos.set(k, new Set()).get(k)).add(`${r.class}/${r.category}`);
}
const ctrl = new Set();
for (const k of pos.keys()) { const [b, n] = k.split(':'); for (const d of CONTROL_OFFSETS) { const m = +n + d, kk = `${b}:${m}`; if (m > 2 && !flagged.has(kk)) ctrl.add(kk); } }

const client = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const pages = client.db('bookstore').collection('pages');
const PROJ = { _id: 0, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'ocr.updated_at': 1, 'translation.updated_at': 1 };
const as = (r) => r && { p: r.page_number, type: r.page_type || null, ocr: r.ocr?.data || '', tr: r.translation?.data || '',
  changed: [r.ocr?.updated_at, r.translation?.updated_at].filter(Boolean).map((d) => new Date(d).toISOString()).sort().pop() || null };
const fold = (t) => String(t).normalize('NFC').toLowerCase().replace(/ſ/g, 's').match(/\p{L}+/gu) || [];
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT);
const items = [...[...pos].map(([k, c]) => ({ k, label: 1, classes: [...c] })), ...[...ctrl].map((k) => ({ k, label: 0, classes: [] }))];
const books = [...new Set(items.map((i) => i.k.split(':')[0]))];
let n = 0;
for (const b of books) {
  // Raw OCR words (ſ folded to s, so a printed long s counts as s): what the book prints most often.
  const freq = {};
  for await (const r of pages.find({ book_id: b }, { projection: { _id: 0, 'ocr.data': 1 } })) for (const w of fold(r.ocr?.data || '')) freq[w] = (freq[w] || 0) + 1;
  out.write(JSON.stringify({ kind: 'book', book_id: b, freq }) + '\n');
  for (const it of items.filter((i) => i.k.startsWith(b + ':'))) {
    const p = +it.k.split(':')[1];
    const got = await pages.find({ book_id: b, page_number: { $in: [p - 1, p, p + 1] } }, { projection: PROJ }).toArray();
    const by = new Map(got.map((r) => [r.page_number, as(r)]));
    if (!by.get(p)?.tr) continue;
    out.write(JSON.stringify({ kind: 'page', key: it.k, book_id: b, label: it.label, classes: it.classes, page: by.get(p), prev: by.get(p - 1) || null, next: by.get(p + 1) || null }) + '\n'); n++;
  }
}
out.end(); await client.close();
console.log(`${n} pages (${pos.size} reported, ${ctrl.size} controls) over ${books.length} books → ${OUT}`);
