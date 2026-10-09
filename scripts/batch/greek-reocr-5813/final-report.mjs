#!/usr/bin/env node
// PRIOR ART: scripts/audit/paid-vs-got.mjs — one UTC day, all lanes, from usage rows and job status;
// scripts/audit/ocr-trust-gate-status.mjs — books the gate REFUSED. Neither gives one job's page-level
// outcome against its own in-scope list, its spend from the raw token counts, or the gate verdict of
// every book the job touched.
//
// #5813 — the closing ledger. For every in-scope page (stage3-pick's list): what it serves now and why.
//   flash        re-read on gemini-3-flash-preview by this job and served
//   refused:*    tried, Gemini or a collector guard refused, lite text kept (reason from the raw answer)
//   restored     re-read, then put back to the lite text by restore-pages.mjs (reason on the page)
//   not_reached  never answered (not submitted, or still in flight)
// Spend: OCR from the raw answers' token counts (raw-parts.jsonl, Batch prices); retranslation from the
// gemini_usage rows realtime-translate.mjs wrote for these books since --s4-since (tokens × list price).
// Trust gate: the verdict of every in-scope book in a gated row. Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/final-report.mjs --dir=DIR --s4-since=ISO [--out=final.json]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { ocrTrustStratum, ocrTrustVerdict, loadOcrProfile } from '../../lib/ocr-trust-gate.mjs';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = arg('dir');
const rows = fs.readFileSync(`${DIR}/stage3-rows.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const raw = fs.readFileSync(`${DIR}/raw-parts.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).filter((r) => !r.gone);
const lastRaw = new Map(); let ocrUsd = 0; const finish = {};
for (const r of raw) { ocrUsd += r.in * 0.25e-6 + r.out * 1.5e-6; const k = `${r.finish}${r.text_parts > 1 ? '|2parts' : ''}`; finish[k] = (finish[k] || 0) + 1; if (r.page_id) lastRaw.set(r.page_id, r); }
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await c.connect();
const db = c.db('bookstore');
const P = db.collection('pages');
const out = {}; const cell = {}; const retr = { retranslated: 0, stale_left: 0, untranslated: 0 };
const ids = rows.map((r) => r.page_id); const meta = new Map(rows.map((r) => [r.page_id, r]));
const flashBooks = new Set();
for (let i = 0; i < ids.length; i += 5000) {
  for (const p of await P.find({ id: { $in: ids.slice(i, i + 5000) } }, { projection: { _id: 0, id: 1, book_id: 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.restored.reason': 1, 'ocr.recitation_count': 1, 'translation.updated_at': 1, 'translation.restored': 1, hasTr: { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 20] } } }).toArray()) {
    const m = meta.get(p.id), r = lastRaw.get(p.id);
    let o;
    if (p.ocr?.model === 'gemini-3-flash-preview') { o = 'flash'; flashBooks.add(p.book_id); if (!p.hasTr) retr.untranslated++; else if (p.translation.updated_at > p.ocr.updated_at) retr.retranslated++; else retr.stale_left++; }
    else if (p.ocr?.restored?.reason && !/truncated/.test(p.ocr.restored.reason)) o = `restored:${p.ocr.restored.reason}`;
    else if (r && r.text_parts <= 1) o = `refused:${r.finish === 'STOP' ? 'collector-guard' : r.finish}`;
    else if (r) o = 'restored:cut-off-not-yet-reread';
    else o = 'not_reached';
    out[o] = (out[o] || 0) + 1;
    const g = m.released_hold ? 'C released-hold' : m.visible ? 'A visible' : 'D hidden';
    (cell[g] ??= {})[o.split(':')[0]] = ((cell[g][o.split(':')[0]]) || 0) + 1;
  }
}
// Stage 4 spend
const s4since = new Date(arg('s4-since'));
const bookIds = [...new Set(rows.map((r) => r.book_id))];
const u = await db.collection('gemini_usage').aggregate([{ $match: { book_id: { $in: bookIds }, endpoint: 'scripts/realtime-translate.mjs', timestamp: { $gte: s4since } } }, { $group: { _id: '$model', n: { $sum: 1 }, i: { $sum: '$input_tokens' }, o: { $sum: '$output_tokens' } } }]).toArray();
const price = (m) => /flash-lite/.test(m || '') ? [0.25e-6, 1.5e-6] : [0.5e-6, 3e-6];
const s4 = u.map((x) => ({ model: x._id, calls: x.n, usd: +(x.i * price(x._id)[0] + x.o * price(x._id)[1]).toFixed(2) }));
// Trust gate
const books = await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, slug: 1, title: 1, language: 1, year: 1, published: 1, visible: 1 } }).toArray();
const gate = { released: [], still_gated: [], other_row: {} };
for (const b of books) {
  if (!/^\s*(ancient\s+)?greek\b/i.test(String(b.language ?? ''))) continue;
  const profile = await loadOcrProfile(db, b.id);
  const row = ocrTrustStratum(b, profile);
  if (!row?.gated) continue;
  const v = ocrTrustVerdict(b, profile);
  const item = { id: b.id, slug: b.slug, title: (b.title || '').slice(0, 70), year: b.year ?? b.published, visible: b.visible === true, reread: profile.reread?.[row.id] || 0, ocr: profile.ocr };
  if (row.id !== 'greek-print-1450-1599') { gate.other_row[row.id] = (gate.other_row[row.id] || 0) + 1; continue; }
  (v.ok ? gate.released : gate.still_gated).push(item);
}
await c.close();
const report = { at: new Date().toISOString(), in_scope: rows.length, outcomes: out, by_group: cell, raw_answers: raw.length, raw_finish: finish, ocr_usd: +ocrUsd.toFixed(2), s4, s4_usd: +s4.reduce((s, x) => s + x.usd, 0).toFixed(2), translation_state_of_flash_pages: retr, gate: { released: gate.released.length, still_gated: gate.still_gated.length, other_row: gate.other_row } };
console.log(JSON.stringify(report, null, 1));
fs.writeFileSync(arg('out', `${DIR}/final.json`), JSON.stringify({ ...report, gate_books: gate }, null, 1));
