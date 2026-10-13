#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/paddle-zh-lane.mjs `status` (whole-run QA screen totals, no window, no sample) and
 * scripts/eval/zh-skqs-5568-kanripo.mjs (the Kanripo WYG alignment, its `cer` and `wilson`, imported). Neither
 * measures a GATE: the books written since the last gate, a screen rate with its CI against the #5600 baseline,
 * CER against the typed text on one page per book, and a by-eye packet. This does, for job gpu-backlog-5660 (#5660).
 *
 *   node --env-file=… scripts/eval/gpu-backlog-5660-gate.mjs zh --dir=/root/gpu-backlog-5660/zh --tag=gate0 \
 *        [--n-acc=40] [--n-eye=10] [--used=<file of book ids used by earlier gates>] [--all]
 *
 * Window = books in <dir>/applied-books.jsonl not listed in --used (or every applied book with --all).
 * Out: <dir>/gates/<tag>/{summary.json, acc.jsonl, eye/<bid>-p<pn>.{jpg,txt}, eye/list.json, books.txt}.
 * measure words: the screen is `agreement` with Kanripo's WYG transcription (a screen); CER vs the matched WYG <pb>
 * page is `accuracy`; the eye packet is read by a model, `read-from-image`.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { makeRng } from './lib/paired-stats.mjs';
import { fold, cer, wilson, pbPages } from './zh-skqs-5568-kanripo.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/gpu-backlog-5660/zh');
const TAG = argOf('tag', 'gate');
const N_ACC = +argOf('n-acc', 40), N_EYE = +argOf('n-eye', 10);
const BASE = { flagged: 65011, screened: 992881, rate: 0.0655, src: '#5600 fleet final (Kanripo WYG, Dice < 0.6)' };
const jsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const seedOf = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 5660);

async function zh() {
  const OUT = path.join(DIR, 'gates', TAG); fs.mkdirSync(path.join(OUT, 'eye'), { recursive: true });
  const used = new Set(argOf('used') ? fs.readFileSync(argOf('used'), 'utf8').split('\n').filter(Boolean) : []);
  const rows = jsonl(path.join(DIR, 'applied-books.jsonl')).filter(r => process.argv.includes('--all') || !used.has(r.bid));
  const byBook = new Map(); for (const r of rows) byBook.set(r.bid, r);   // last row per book
  const books = [...byBook.keys()].sort();
  fs.writeFileSync(path.join(OUT, 'books.txt'), books.join('\n') + '\n');
  const written = rows.reduce((s, r) => s + (r.written || 0), 0);
  const screened = rows.reduce((s, r) => s + (r.qa_screened || 0), 0), flagged = rows.reduce((s, r) => s + (r.qa_flagged || 0), 0);
  // book-clustered bootstrap CI on the pooled rate (flags cluster in a few books)
  const rng = makeRng(seedOf(TAG));
  const per = [...byBook.values()].filter(r => r.qa_screened);
  const boots = [];
  for (let i = 0; i < 4000; i++) { let f = 0, s = 0; for (let j = 0; j < per.length; j++) { const r = per[Math.floor(rng() * per.length)]; f += r.qa_flagged; s += r.qa_screened; } boots.push(s ? f / s : 0); }
  boots.sort((a, b) => a - b);
  const screen = { measure: 'agreement (screen)', books: books.length, written, screened, flagged, rate: screened ? +(flagged / screened).toFixed(4) : null, wilson95: wilson(flagged, screened), book_cluster95: per.length > 1 ? [+boots[100].toFixed(4), +boots[3899].toFixed(4)] : null, baseline: BASE };
  screen.worse_than_baseline = screen.book_cluster95 ? screen.book_cluster95[0] > BASE.rate : null;

  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const meta = new Map((await db.collection('books').find({ id: { $in: books } }, { projection: { id: 1, title: 1, work_id: 1 } }).toArray()).map(b => [b.id, b]));
  // accuracy: one random screened page per book (any Dice — flagged pages are kept and listed for the hand check)
  const order = [...books]; const r2 = makeRng(seedOf(TAG + 'acc'));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const acc = [];
  for (const bid of order) {
    if (acc.length >= N_ACC) break;
    const b = meta.get(bid); if (!/^kr:/.test(b?.work_id || '')) continue;
    const ps = await db.collection('pages').find({ book_id: bid, 'ocr.pipeline': 'paddle-zh-2026-10', 'ocr.engine.run': { $exists: true }, 'ocr.qa_screen.pb': { $exists: true } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.qa_screen': 1, 'ocr.engine.issue': 1, archived_photo: 1 } }).toArray();
    const mine = ps.filter(p => p.ocr?.engine?.issue === 5660 || p.ocr?.engine?.issue == null);
    if (!mine.length) continue;
    const p = mine[Math.floor(r2() * mine.length)];
    const pb = p.ocr.qa_screen.pb, krId = b.work_id.slice(3), juan = +(pb.match(/_(\d{3})-/) || [])[1];
    const pages = await pbPages(krId, 'WYG', [juan]);
    const ref = pages.find(x => x.pb === pb);
    if (!ref) continue;
    const hyp = fold(p.ocr.data);
    acc.push({ bid, title: b.title, pn: p.page_number, pb, dice: p.ocr.qa_screen.dice, flagged: !!p.ocr.qa_screen.flagged, hyp_len: hyp.length, ref_len: ref.text.length, cer: +cer(hyp, ref.text).toFixed(4), image: p.archived_photo, link: `https://sourcelibrary.org/book/${bid}?page=${p.page_number}` });
  }
  fs.writeFileSync(path.join(OUT, 'acc.jsonl'), acc.map(a => JSON.stringify(a)).join('\n') + '\n');
  const accuracy = { measure: 'accuracy', ref: 'Kanripo WYG <pb> page matched by the screen', n_books: acc.length, median_cer: median(acc.map(a => a.cer)), unflagged_median_cer: median(acc.filter(a => !a.flagged).map(a => a.cer)), flagged_in_sample: acc.filter(a => a.flagged).map(a => a.link), catastrophic: acc.filter(a => a.cer > 0.5).length };

  // by eye: N_EYE other books, one random written page each, image + our text
  const r3 = makeRng(seedOf(TAG + 'eye')); const accBooks = new Set(acc.map(a => a.bid));
  const pool = order.filter(b => !accBooks.has(b)).concat(order.filter(b => accBooks.has(b)));
  const eye = [];
  for (const bid of pool) {
    if (eye.length >= N_EYE) break;
    const ps = await db.collection('pages').find({ book_id: bid, 'ocr.pipeline': 'paddle-zh-2026-10' }, { projection: { page_number: 1, 'ocr.data': 1, archived_photo: 1 } }).toArray();
    if (!ps.length) continue;
    const p = ps[Math.floor(r3() * ps.length)];
    const stem = `${bid}-p${p.page_number}`;
    fs.writeFileSync(path.join(OUT, 'eye', `${stem}.txt`), p.ocr.data);
    try { execFileSync('curl', ['-s', '-m', '60', '-o', path.join(OUT, 'eye', `${stem}.jpg`), p.archived_photo]); } catch { /* listed without image */ }
    eye.push({ stem, bid, title: meta.get(bid)?.title, pn: p.page_number, link: `https://sourcelibrary.org/book/${bid}?page=${p.page_number}` });
  }
  fs.writeFileSync(path.join(OUT, 'eye', 'list.json'), JSON.stringify(eye, null, 1));
  await c.close();
  const summary = { issue: 5660, lane: 'zh', tag: TAG, at: new Date().toISOString(), screen, accuracy, eye_packet: eye.length };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

if (CMD === 'zh') await zh();
else { console.error('zh'); process.exit(2); }
