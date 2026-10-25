#!/usr/bin/env node
// PRIOR ART: scripts/audit/page-integrity.mjs — the corpus walk that found the 66,525 truncated translations (#5055);
// it reads the local corpus mirror, which this box does not hold, and judges stored text with the census thresholds,
// not the write guard's. scripts/eval/quality-census-score.mjs — the census draw; it scores leaks, not verdicts.
// This asks the WRITE GUARD's question (scripts/lib/write-text-guard.mjs) of stored text, read-only, so the guard is
// tuned on what the corpus holds before it is wired into a writer.
/**
 * Backlog sizing for the write-time truncation + tag-balance guard (#5055). READ-ONLY: no write of any kind.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/write-guard-5055/backlog.mjs \
 *        --n=5000 --seed=5055 --out=$JOB_SCRATCH/backlog
 *   node ... backlog.mjs --labelled   # the #5055 hand-read (page-integrity-handread-2026-09-24.json, truncated/final)
 *
 * Draw: every book with pages_count > 0, a seeded shuffle, one page per book (a seeded page number, up to 4 tries for a
 * page with OCR). Each page: the guard over its OCR (kind 'ocr') and, if it has one, its translation (kind
 * 'translation', source = the OCR, lang = books.language). Stored translations have been through
 * sanitizeTranslationTags, which closes a tail tag, so only the length rule can fire on them; stored OCR has had no tag
 * repair, so the tag rules see it as written. Projection: Horvitz-Thompson on book weight (books / n × Σ pages_count ×
 * flag), a page-weighted estimate from a book-weighted draw.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { checkWrittenText } from '../../lib/write-text-guard.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const N = Number(arg('n', 5000));
const SEED = Number(arg('seed', 5055));
const OUT = path.resolve(arg('out', path.join(process.env.JOB_SCRATCH || '/tmp', 'write-guard-backlog')));
fs.mkdirSync(OUT, { recursive: true });

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db('bookstore');
const PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1 };
const judge = (p, book) => {
  const o = p.ocr?.data ? checkWrittenText(p.ocr.data, { kind: 'ocr' }) : null;
  const t = p.translation?.data ? checkWrittenText(p.translation.data, { kind: 'translation', source: p.ocr?.data, lang: book?.language, type: p.page_type }) : null;
  return { o, t };
};
const row = (p, book, { o, t }) => ({ book_id: p.book_id, page_number: p.page_number, page_id: p.id, lang: book?.language ?? null, pages_count: book?.pages_count ?? null,
  ocr_model: p.ocr?.model ?? null, ocr_verdict: o?.verdict ?? null, ocr_reasons: o?.reasons ?? [], ocr_unclosed: o?.unclosed ?? [], ocr_chars: p.ocr?.data?.length ?? 0,
  tr_model: p.translation?.model ?? null, tr_verdict: t?.verdict ?? null, tr_reasons: t?.reasons ?? [], tr_unclosed: t?.unclosed ?? [], tr_chars: p.translation?.data?.length ?? 0 });

if (process.argv.includes('--labelled')) {
  const hr = JSON.parse(fs.readFileSync(new URL('../results/page-integrity-handread-2026-09-24.json', import.meta.url), 'utf8'));
  const out = [];
  for (const [bookId, pn, label, note] of hr.cases['truncated/final']) {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, language: 1, pages_count: 1 } });
    const p = await db.collection('pages').findOne({ book_id: bookId, page_number: pn }, { projection: PROJ });
    if (!p) { out.push({ book_id: bookId, page_number: pn, label, note, missing: true }); continue; }
    out.push({ ...row(p, book, judge(p, book)), label, note });
  }
  fs.writeFileSync(path.join(OUT, 'labelled.json'), JSON.stringify(out, null, 1));
  for (const r of out) console.log(`${r.label.padEnd(8)} ${r.tr_verdict ?? '-'} ${JSON.stringify(r.tr_reasons)}  ${r.lang}  ${r.note}`);
  await client.close();
  process.exit(0);
}

const books = await db.collection('books').find({ pages_count: { $gt: 0 } }, { projection: { id: 1, language: 1, pages_count: 1 } }).toArray();
books.sort((a, b) => (a.id < b.id ? -1 : 1));
const r = rng(SEED);
for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
console.log(`${books.length} books with pages; drawing ${N}, seed ${SEED}`);
const rows = [];
for (const book of books) {
  if (rows.length >= N) break;
  let p = null;
  for (let k = 0; k < 4 && !p?.ocr?.data; k++) p = await db.collection('pages').findOne({ book_id: book.id, page_number: 1 + Math.floor(r() * book.pages_count) }, { projection: PROJ });
  if (!p?.ocr?.data) continue;
  rows.push(row(p, book, judge(p, book)));
  if (rows.length % 500 === 0) console.log(`  ${rows.length}`);
}
fs.writeFileSync(path.join(OUT, 'sample.jsonl.gz'), zlib.gzipSync(rows.map((x) => JSON.stringify(x)).join('\n') + '\n'));

const scale = books.length / rows.length; // only books that yielded a page count as drawn: approximate
const tab = (kind) => {
  const by = {};
  let hit = 0, judged = 0;
  for (const x of rows) {
    const v = x[`${kind}_verdict`]; if (!v) continue;
    judged++;
    const m = x[`${kind}_model`] || '(none)';
    const c = (by[m] ||= { n: 0, ok: 0, repaired_mid: 0, truncated: 0, empty: 0, w_repaired_mid: 0, w_truncated: 0 });
    c.n++; c[v]++; if (v !== 'ok' && v !== 'empty') c[`w_${v}`] += x.pages_count || 0;
    if (v === 'truncated') hit++;
  }
  const total = { n: judged, ok: 0, repaired_mid: 0, truncated: 0, empty: 0, w_repaired_mid: 0, w_truncated: 0 };
  for (const c of Object.values(by)) for (const k of Object.keys(total)) if (k !== 'n') total[k] += c[k];
  const reasons = {};
  for (const x of rows) for (const re of x[`${kind}_reasons`] || []) { const k = re.replace(/[:(].*$/, ''); reasons[k] = (reasons[k] || 0) + 1; }
  return { judged, by_model: by, total, reasons, projected_pages: { repaired_mid: Math.round(total.w_repaired_mid * scale), truncated: Math.round(total.w_truncated * scale) } };
};
const summary = { at: new Date().toISOString(), seed: SEED, drawn: rows.length, books_with_pages: books.length, ocr: tab('ocr'), translation: tab('tr') };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, ocr: { ...summary.ocr, by_model: undefined }, translation: { ...summary.translation, by_model: undefined } }, null, 1));
await client.close();
