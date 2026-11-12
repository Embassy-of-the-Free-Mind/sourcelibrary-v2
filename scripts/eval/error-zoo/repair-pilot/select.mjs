#!/usr/bin/env node
/**
 * PRIOR ART: scripts/batch/ocr-convergence/driver.mjs `select` — picks pages of the most-read books by page views and a
 * seeded spread; it knows nothing of audit findings. This picks pages an AUDIT already found a serious transcription
 * error on (the error-zoo label table), so the repair pilot repairs known-bad pages and can be measured against them.
 * Same manifest row shape, so correct.mjs and judge-6694.mjs decide-b read it unchanged. Read-only.
 *
 * Repair pilot (#6420 decision 4, Derek 2026-11-12, the #7809 go): Opus corrects the stored Flash-Lite transcription
 * in place, on the router cell whose live route IS that: german-lite / print → lite>Opus (router table
 * 2026-11-01-validated-7263). Latin and French print route to agy, so they are not in this pilot.
 *
 * Eligible page: a label row in <labels> that is fresh (text unchanged since the judgment), served, not a correction
 * row, with at least one serious finding in the OCR stage (or wrong leaf); the live page has a Flash-Lite OCR, not
 * human-edited, not manual, ≥ 200 characters, an archived image, page_script printed; the book is German, visible,
 * not held, not in a translate lane (translationLaneReason). One page per book, seeded.
 *
 *   node --env-file=… scripts/eval/error-zoo/repair-pilot/select.mjs --labels=/root/jobs/error-zoo-v2/labels.jsonl
 *        --out=DIR [--n=40] [--seed=7809]
 * Writes DIR/manifest.jsonl, DIR/pages.json, DIR/findings.jsonl (the audit findings each page was picked for).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { translationLaneReason } from '../../../batch/ocr-convergence/lib.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const LABELS = arg('labels'), OUT = path.resolve(arg('out', '')), N = Number(arg('n', 40)), SEED = arg('seed', '7809');
if (!LABELS || !arg('out')) { console.error('usage: select.mjs --labels=FILE --out=DIR [--n=40]'); process.exit(2); }

const cand = new Map(); // page_id -> {label rows}
for (const l of fs.readFileSync(LABELS, 'utf8').split('\n')) {
  if (!l.trim()) continue; const r = JSON.parse(l);
  if (r.positive_only || r.stale || r.exposure !== 'served' || !r.page_id) continue;
  const ser = (r.errors || []).filter((e) => (e.severity || 'serious') === 'serious' && (e.stage === 'ocr' || e.kind === 'wrong_leaf'));
  if (!ser.length) continue;
  if (!cand.has(r.page_id)) cand.set(r.page_id, []);
  cand.get(r.page_id).push({ source: r.source, method: r.method, run_id: r.run_id, reader: r.reader, judged_at: r.judged_at, errors: ser });
}
console.log('label pages with a fresh serious OCR finding:', cand.size);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const ids = [...cand.keys()];
const pages = [];
for (let i = 0; i < ids.length; i += 1000) {
  pages.push(...await db.collection('pages').find({ id: { $in: ids.slice(i, i + 1000) } }, { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, archived_photo: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.updated_at': 1, len: { $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } }, translation_withheld: 1, 'translation.data': { $substrCP: [{ $ifNull: ['$translation.data', ''] }, 0, 1] } } }).toArray());
}
const why = {}; const bump = (k) => { why[k] = (why[k] || 0) + 1; };
const ok = pages.filter((p) => {
  if (!/lite/i.test(p.ocr?.model || '')) return bump('ocr not Flash-Lite'), false;
  if (p.ocr?.edited_by || p.ocr?.source === 'manual') return bump('human-edited'), false;
  if ((p.len || 0) < 200) return bump('under 200 chars'), false;
  if (typeof p.archived_photo !== 'string') return bump('no archived image'), false;
  if (p.script_type !== 'printed') return bump(`script ${p.script_type || 'unknown'}`), false;
  if (p.translation_withheld) return bump('English withheld'), false;
  return true;
});
const books = new Map();
const bids = [...new Set(ok.map((p) => p.book_id))];
for (let i = 0; i < bids.length; i += 500) for (const b of await db.collection('books').find({ id: { $in: bids.slice(i, i + 500) } }, { projection: { id: 1, slug: 1, title: 1, language: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, pipeline_auto: 1 } }).toArray()) books.set(b.id, b);
const elig = ok.filter((p) => {
  const b = books.get(p.book_id);
  if (!b) return bump('book missing'), false;
  if (String(b.language || '').trim() !== 'German') return bump(`book language ${b.language}`), false;
  if (b.visible !== true || !(b.pages_count > 0)) return bump('book not live'), false;
  const t = translationLaneReason(b); if (t) return bump(`lane: ${t.split(':')[0]}`), false;
  return true;
});
console.log('excluded:', JSON.stringify(why));
const h = (s) => createHash('sha1').update(`${SEED}:${s}`).digest('hex');
// One page per book first (rates are by book), then a second and third page per book only if the first pass is short.
const PER_BOOK = Number(arg('per-book', 1));
const sorted = elig.sort((a, b) => h(a.id).localeCompare(h(b.id)));
const taken = new Map(); const pick = [];
for (let round = 1; round <= PER_BOOK && pick.length < N; round++) for (const p of sorted) {
  if (pick.length >= N) break;
  if (pick.includes(p) || (taken.get(p.book_id) || 0) >= round) continue;
  pick.push(p); taken.set(p.book_id, (taken.get(p.book_id) || 0) + 1);
}
console.log(`eligible pages ${elig.length} in ${new Set(elig.map((p) => p.book_id)).size} books; picked ${pick.length} pages in ${taken.size} books (≤ ${PER_BOOK} a book)`);
fs.mkdirSync(OUT, { recursive: true });
const man = pick.map((p) => { const b = books.get(p.book_id); return { page_id: p.id, book_id: p.book_id, slug: b.slug, page_number: p.page_number, group: 'german', language: 'German', why: 'audit-serious-ocr', ocr_model: p.ocr?.model, ocr_updated_at: p.ocr?.updated_at, has_english: !!p.translation?.data }; });
fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), man.map((m) => JSON.stringify(m)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(man.map((m) => m.page_id)));
fs.writeFileSync(path.join(OUT, 'findings.jsonl'), man.map((m) => JSON.stringify({ page_id: m.page_id, labels: cand.get(m.page_id) })).join('\n') + '\n');
await client.close();
