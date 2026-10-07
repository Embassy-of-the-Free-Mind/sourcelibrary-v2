#!/usr/bin/env node
// #5935 arm (a): body CER of the PaddleOCR Siku Quanshu reading against Kanripo's typed WYG text, one
// seeded interior page per book, ≥ 1,000 books. READ-ONLY: Mongo reads (books, pages by book_id),
// Kanripo raw files from GitHub (cached in the #5568 cache dir). $0, no model call.
//
// PRIOR ART: scripts/eval/zh-skqs-5568-kanripo.mjs (workInfo / pbPages / fold: imported) and the #5600
// lane's QA screen (/root/paddle-zh-5600/code/scripts/workers/paddle-zh-lane.mjs), which stored on every
// page `ocr.qa_screen` = the best-matching Kanripo page by char-bigram Dice. Dice is an order-free
// screen, not an error rate: it says WHICH Kanripo page, this measures how many characters differ.
// lib/sampling.mjs sampleOnePagePerBook uses $sample (biased toward big books) and is not used.
//
// Leaf rule. A page's own Kanripo page is trusted when its Dice ≥ 0.6. Below that, the page's reading
// may be the problem, so the Kanripo page is taken from its two neighbours (both ≥ 0.6 and exactly two
// Kanripo pages apart); one trusted neighbour gives a lower-confidence leaf. A page with neither is
// `unaligned`: counted, never scored, so a garbled reading is charged rather than dropped.
//
//   nice -n 10 node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ground-truth-5935/kanripo.mjs [--books=1200] [--conc=3]
// Writes /root/ground-truth-5935/kanripo.jsonl (append, resumable: one line per book attempted).

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { bodyText, foldHan, bodyCer, makeRng, engineOf, kindOf, periodOf, resBand, isInterior, CATASTROPHIC_CER, NORMALISER_VERSION } from './lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WORK = argOf('work', '/root/ground-truth-5935');
const TARGET = Number(argOf('books', 1200));
const CONC = Number(argOf('conc', 3));
const SEED = 5935;
const OUT = `${WORK}/kanripo.jsonl`;
const QA_TRUST = 0.6;
fs.mkdirSync(WORK, { recursive: true });

const seedOf = (id) => SEED ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);
const done = new Map();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); done.set(r.book_id, r); } catch { /* torn line */ } }
const scoredSoFar = () => [...done.values()].filter((r) => r.status === 'scored').length;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Frame: every book with a Kanripo work id, in a seeded order (the id list is materialised first).
const frame = (await db.collection('books').find({ work_id: /^kr:/ }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean).sort();
const rng = makeRng(SEED);
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }
console.log(`frame ${frame.length} books with a Kanripo work id; ${done.size} attempted, ${scoredSoFar()} scored; target ${TARGET}`);

const PROJ = { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.engine.model': 1, 'ocr.qa_screen': 1, image_width: 1, image_height: 1, script_type: 1 };
const append = (r) => { done.set(r.book_id, r); fs.appendFileSync(OUT, JSON.stringify(r) + '\n'); };

async function one(bookId) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, title: 1, published: 1, year: 1, visible: 1, pages_count: 1, work_id: 1, 'image_source.provider': 1, language: 1 } });
  const base = { book_id: bookId, title: String(book?.title || '').slice(0, 80), at: new Date().toISOString() };
  const screened = await db.collection('pages').find({ book_id: bookId, 'ocr.qa_screen.status': 'screened' }, { projection: { _id: 0, page_number: 1 } }).toArray();
  if (!screened.length) return append({ ...base, status: 'no-screened-page' });
  const n = book.pages_count || Math.max(...screened.map((p) => p.page_number));
  let pool = screened.map((p) => p.page_number).filter((pn) => isInterior(pn, n)).sort((a, b) => a - b);
  if (!pool.length) pool = screened.map((p) => p.page_number).sort((a, b) => a - b);
  const r = makeRng(seedOf(bookId));
  const pn = pool[Math.floor(r() * pool.length)];
  const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [pn - 1, pn, pn + 1] } }, { projection: PROJ }).toArray();
  const at = (k) => pages.find((p) => p.page_number === k);
  const p = at(pn);
  const qa = p.ocr.qa_screen;
  const krId = String(qa.repo || '').replace(/^kanripo\//, '');
  const w = await workInfo(krId);
  const juanOf = (pb) => Number(String(pb || '').match(/_(\d{3})-\d+[ab]$/)?.[1]);
  const j = juanOf(qa.pb);
  const juans = (w.juan_files || []).filter((x) => Math.abs(x - j) <= 1);
  const pbs = await pbPages(krId, 'WYG', juans);
  const idx = (pb) => pbs.findIndex((x) => x.pb === pb);
  const trusted = (q) => q?.ocr?.qa_screen?.status === 'screened' && q.ocr.qa_screen.dice >= QA_TRUST ? idx(q.ocr.qa_screen.pb) : -1;
  let k = -1, leaf = null;
  if (qa.dice >= QA_TRUST) { k = idx(qa.pb); leaf = 'own'; }
  else {
    const a = trusted(at(pn - 1)), b = trusted(at(pn + 1));
    if (a >= 0 && b >= 0 && b - a === 2) { k = a + 1; leaf = 'neighbours'; }
    else if (a >= 0 && b < 0) { k = a + 1; leaf = 'one-neighbour'; }
    else if (b >= 0 && a < 0) { k = b - 1; leaf = 'one-neighbour'; }
  }
  const book_cov = {
    // The scans are of the Siku Quanshu manuscript copies (1773–1782); `published` is blank on nearly all.
    ...(() => { const pd = periodOf(book.published, book.year); return pd === 'unknown' ? { period: '1700s', period_src: 'edition: Siku Quanshu copy, 1773–1782' } : { period: pd, period_src: 'books.published' }; })(),
    provider: book.image_source?.provider || null, visible: !!book.visible,
    language: book.language, work_id: book.work_id,
  };
  const page_cov = { page_id: p.id, page_number: pn, engine: engineOf(p.ocr), model: p.ocr.model || null, ocr_source: p.ocr.source || null, kind: kindOf(p.script_type, 'handwritten'), script_type: p.script_type || null, res_band: resBand(p.image_width, p.image_height), long_edge: Math.max(p.image_width || 0, p.image_height || 0) || null };
  const match = { dice: qa.dice, runner_up: qa.runner_up, own_pb: qa.pb, scope: qa.scope };
  if (k < 0 || k >= pbs.length) return append({ ...base, ...book_cov, ...page_cov, status: 'unaligned', match });
  const W = pbs.slice(Math.max(0, k - 1), k + 2).map((x) => x.text).join('');
  const Q = foldHan(bodyText(p.ocr.data));
  const s = bodyCer(Q, W, { expected: pbs[k].text.length });
  append({
    ...base, ...book_cov, ...page_cov, status: 'scored', primary: true,
    ref: 'kanripo-wyg', ref_edition: 'Kanripo transcription of the Wenyuange (文淵閣) Siku Quanshu copy, WYG branch', ref_repo: `kanripo/${krId}`, ref_sha: w.witness_sha || qa.sha || null,
    ref_pb: pbs[k].pb, leaf, match: { ...match, confidence: leaf === 'own' ? (qa.dice >= 0.8 ? 'high' : 'medium') : leaf === 'neighbours' ? 'medium' : 'low' },
    script: 'cjk', language: 'Chinese', normaliser: `han+kanripo-variants@${NORMALISER_VERSION}`,
    q_chars: s.q_chars, expected: pbs[k].text.length, span: s.span, d: s.d, omitted: s.omitted, cer: +s.cer.toFixed(4), catastrophic: s.cer > CATASTROPHIC_CER,
  });
}

let next = 0, active = 0;
const queue = frame.filter((id) => !done.has(id));
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < queue.length && scoredSoFar() < TARGET) {
    const id = queue[next++];
    active++;
    try { await one(id); } catch (e) { append({ book_id: id, status: 'error', error: String(e.message).slice(0, 160), at: new Date().toISOString() }); }
    active--;
    if (done.size % 50 === 0) console.log(`${new Date().toISOString().slice(11, 19)} attempted ${done.size}, scored ${scoredSoFar()}`);
  }
}));
const all = [...done.values()];
const st = all.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
console.log('status', JSON.stringify(st));
await client.close();
