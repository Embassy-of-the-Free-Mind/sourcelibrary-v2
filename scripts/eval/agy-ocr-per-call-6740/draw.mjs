#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/draw.mjs (PR #7518: consecutive pages of a book for a block arm, but for
// TRANSLATION, of pages that already carry OCR); scripts/eval/route-judge-6740/judge.mjs drawRouterTests (the de-lite
// cell, one page per book, no neighbour); scripts/eval/ground-truth-5935/kanripo.mjs (one Kanripo leaf per book).
// None draws ADJACENT PAIRS whose both pages carry a reference (T1) or a Flash-Lite draft (T2), which a 2/call arm needs.
/**
 * #6740 agy OCR pages-per-call draw. Two tasks, 15 books x 2 adjacent pages = 30 pages each, seeded (salt 6740-ppc).
 *
 *   T1 fresh read, Siku Chinese. Books: the 57 Kanripo-scored books of scripts/eval/paddle-zh-qa-6388/kanripo.jsonl
 *      (the #6443 context arm's frame). Anchor: that file's page; partner: the next page, else the previous one. Both
 *      pages need their own trusted Kanripo screen (ocr.qa_screen screened, dice >= 0.6, the #5935 leaf rule) on
 *      ADJACENT Kanripo pages of one juan, and >= 40 Han in the reference leaf. The Kanripo leaf text goes in the draw
 *      (folded Han, the scoring window: the leaf and its two neighbours), so CER is model-free and fixed now.
 *   T2 correction, German Flash-Lite drafts. Books: the 30 de-lite pages of the router tests
 *      (route-judge-6740/results/router-tests-2026-10-26/sample.json, #7434). Anchor: that page, its stored draft still
 *      the one the router test read (draft_sha). Partner: the next page, else the previous one, also a Flash-Lite draft
 *      of >= 300 characters, not handwritten. The drafts are frozen into the draw (DIR/drafts.jsonl.gz) so every arm
 *      corrects the same text even if the page is rewritten meanwhile.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/agy-ocr-per-call-6740/draw.mjs --scratch=DIR
 * Writes draw.json here (no texts) and DIR/drafts.jsonl.gz + DIR/kanripo.jsonl.gz (texts). Read-only on Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
if (!S) { console.error('usage: draw.mjs --scratch=DIR'); process.exit(2); }
fs.mkdirSync(S, { recursive: true });
const SALT = '6740-ppc';
const BOOKS = 15;
const LITE = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const h = (s) => createHash('sha256').update(String(s)).digest('hex');
const order = (xs, key) => [...xs].sort((a, b) => h(SALT + key(a)).localeCompare(h(SALT + key(b))));
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.qa_screen': 1 };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const pagesOf = (bookId, nums) => db.collection('pages').find({ book_id: bookId, page_number: { $in: nums } }, { projection: PROJ }).toArray();

// ── T1 ───────────────────────────────────────────────────────────────────────
const kr = fs.readFileSync(path.join(ROOT, 'scripts/eval/paddle-zh-qa-6388/kanripo.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === 'scored');
const t1 = [], t1Refs = [], t1Tally = { books: kr.length, walked: 0, no_partner: 0 };
for (const r of order(kr, (x) => x.uid)) {
  if (t1.length >= BOOKS) break;
  t1Tally.walked++;
  const [, bookId, pnS] = r.uid.split('|'); const pn = Number(pnS);
  const ps = await pagesOf(bookId, [pn - 1, pn, pn + 1]);
  const at = (n) => ps.find((p) => p.page_number === n);
  const krId = String(r.repo).replace(/^kanripo\//, '');
  const w = await workInfo(krId);
  const juanOf = (pb) => Number(String(pb || '').match(/_(\d{3})-\d+[ab]$/)?.[1]);
  const trusted = (p) => p?.ocr?.qa_screen?.status === 'screened' && p.ocr.qa_screen.dice >= 0.6 && p.ocr.qa_screen.pb;
  const a = at(pn);
  if (!trusted(a) || !getPageSource(a)) { t1Tally.no_partner++; continue; }
  const j = juanOf(a.ocr.qa_screen.pb);
  const pbs = await pbPages(krId, w.witness || 'WYG', (w.juan_files || []).filter((x) => Math.abs(x - j) <= 1));
  const idx = (p) => pbs.findIndex((x) => x.pb === p.ocr.qa_screen.pb);
  let pair = null;
  for (const n of [pn + 1, pn - 1]) {
    const b = at(n);
    if (!trusted(b) || !getPageSource(b)) continue;
    const [first, second] = n > pn ? [a, b] : [b, a];
    const i1 = idx(first), i2 = idx(second);
    if (i1 < 0 || i2 !== i1 + 1) continue;
    if (pbs[i1].text.length < 40 || pbs[i2].text.length < 40) continue;
    pair = [[first, i1], [second, i2]]; break;
  }
  if (!pair) { t1Tally.no_partner++; continue; }
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, title: 1 } });
  t1.push({ book_id: bookId, title: String(book?.title || '').slice(0, 80), kanripo: `kanripo/${krId}`, witness_sha: w.witness_sha || null,
    pages: pair.map(([p, k]) => ({ page_id: p.id, page_number: p.page_number, image: getPageSource(p), ref_pb: pbs[k].pb, ref_chars: pbs[k].text.length, dice: p.ocr.qa_screen.dice, anchor: p.page_number === pn })) });
  for (const [p, k] of pair) t1Refs.push({ page_id: p.id, ref_pb: pbs[k].pb, leaf: pbs[k].text, window: pbs.slice(Math.max(0, k - 1), k + 2).map((x) => x.text).join(''), raw: pbs[k].raw });
}

// ── T2 ───────────────────────────────────────────────────────────────────────
const rt = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/route-judge-6740/results/router-tests-2026-10-26/sample.json'), 'utf8')).cells['de-lite'].pages;
const ok2 = (p) => LITE.includes(p?.ocr?.model) && typeof p.ocr.data === 'string' && p.ocr.data.length >= 300 && !/<script>\s*handwritten/i.test(p.ocr.data) && getPageSource(p);
const t2 = [], t2Drafts = [], t2Tally = { router_test_pages: rt.length, walked: 0, draft_changed: 0, no_partner: 0 };
for (const r of order(rt, (x) => x.page_id)) {
  if (t2.length >= BOOKS) break;
  t2Tally.walked++;
  const ps = await pagesOf(r.book_id, [r.page_number - 1, r.page_number, r.page_number + 1]);
  const at = (n) => ps.find((p) => p.page_number === n);
  const a = at(r.page_number);
  if (!a || contentHash(a.ocr?.data) !== r.draft_sha || !ok2(a)) { t2Tally.draft_changed++; continue; }
  const b = [at(r.page_number + 1), at(r.page_number - 1)].find(ok2);
  if (!b) { t2Tally.no_partner++; continue; }
  const pair = [a, b].sort((x, y) => x.page_number - y.page_number);
  const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { _id: 0, title: 1 } });
  t2.push({ book_id: r.book_id, title: String(book?.title || '').slice(0, 80),
    pages: pair.map((p) => ({ page_id: p.id, page_number: p.page_number, image: getPageSource(p), draft_model: p.ocr.model, draft_sha: contentHash(p.ocr.data), draft_chars: p.ocr.data.length, anchor: p.id === a.id })) });
  for (const p of pair) t2Drafts.push({ page_id: p.id, draft: p.ocr.data, draft_model: p.ocr.model, draft_sha: contentHash(p.ocr.data) });
}
await c.close();

const gzw = (f, rows) => fs.writeFileSync(path.join(S, f), zlib.gzipSync(rows.map((x) => JSON.stringify(x)).join('\n') + '\n'));
gzw('kanripo.jsonl.gz', t1Refs);
gzw('drafts.jsonl.gz', t2Drafts);
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify({ drawn_at: new Date().toISOString(), salt: SALT,
  T1: { task: 'fresh OCR read', lang: 'Chinese', frame: { ...t1Tally, rule: 'paddle-zh-qa-6388/kanripo.jsonl scored books, seeded; anchor = its page; partner = next else previous page; both with own trusted qa_screen (dice >= 0.6) on adjacent Kanripo pages, >= 40 Han each' }, books: t1 },
  T2: { task: 'correction of a Flash-Lite draft', lang: 'German', frame: { ...t2Tally, rule: 'router-tests de-lite pages (#7434), seeded; anchor draft unchanged; partner = next else previous page with a Flash-Lite draft >= 300 chars, not handwritten' }, books: t2 },
}, null, 1) + '\n');
console.log(`T1 ${t1.length} books (${t1.length * 2} pages) ${JSON.stringify(t1Tally)}`);
console.log(`T2 ${t2.length} books (${t2.length * 2} pages) ${JSON.stringify(t2Tally)}`);
