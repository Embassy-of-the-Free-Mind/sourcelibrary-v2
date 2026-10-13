#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/draw.mjs (seeded one-page-per-book draw over the Paddle lane's books,
// isInterior rule), scripts/eval/paddle-stale-english-6388/census.mjs (the stored second read: the superseded Gemini
// reading the lane snapshotted, and its old-vs-new CER) and scripts/eval/paddle-table-pilot-6388/sample.mjs (image =
// the exact image Paddle read). None draws "ordinary Paddle pages with a Kanripo leaf aligned own", so this composes them.
//
// #6561 set B: 60 ordinary Paddle pages whose own Kanripo leaf is trusted (ocr.qa_screen screened, dice >= 0.6).
//   B-rand (30): Frame = books with a book_events {type: paddle_zh_reocr, pages_written > 0} row, sorted by id,
//                Fisher-Yates with makeRng(6561). Walk in order; per book, the eligible pages, one chosen with
//                makeRng(6561 ^ h(book id)). First 30 books with an eligible page.
//   B-dis  (30): Frame = the english-eval-6388 census (pages with a stored second read: the superseded Gemini reading),
//                eligible pages whose old-vs-new CER >= 0.10 (about the top 30% of that census), one per book (the
//                first in seeded order, makeRng(6562)), books not already in B-rand. First 30.
//   Eligible   = ocr.source paddle, not ocr.unreadable, qa_screen screened with dice >= 0.6, interior page, NOT flagged
//                by paddleTableRisk (that is set A's lane), >= 40 Han characters of body text.
// READ-ONLY. Usage (cwd = $JOB_SCRATCH/w):
//   node --env-file=/root/sourcelibrary/.env.production.local <repo>/scripts/eval/paddle-correct-6561/draw.mjs <census.jsonl.gz>
// Out: setB.json (pages with Paddle text and the stored second read), img/<pid>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { isInterior, bodyText, foldHan } from '../ground-truth-5935/lib.mjs';
import { paddleTableRisk } from '../../lib/paddle-table-detect.mjs';

const [, , CENSUS] = process.argv;
const SEED = 6561, N = 30, MIN_HAN = 40, QA_TRUST = 0.6, DIS_CER = 0.10;
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const bookSeed = (id) => SEED ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);
const hanLen = (t) => [...foldHan(bodyText(t))].length;

const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.source': 1, 'ocr.unreadable': 1, 'ocr.data': 1, 'ocr.engine.input.image_url': 1, 'ocr.engine.issue': 1, 'ocr.qa_screen': 1 };
const bookCache = new Map();
async function book(id) {
  if (!bookCache.has(id)) bookCache.set(id, await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, pages_count: 1 } }));
  return bookCache.get(id);
}
function eligible(p, b) {
  const q = p.ocr?.qa_screen;
  if (p.ocr?.source !== 'paddle' || p.ocr?.unreadable) return 'not paddle / unreadable';
  if (!(q?.status === 'screened' && q.dice >= QA_TRUST)) return 'no own Kanripo leaf';
  if (!isInterior(p.page_number, b.pages_count || 0)) return 'not interior';
  if (paddleTableRisk(p.ocr.data, { title: b.title }).flag) return 'table-flagged';
  if (hanLen(p.ocr.data) < MIN_HAN) return 'under 40 Han';
  return null;
}
const row = (p, b, stratum, extra = {}) => ({
  uid: '', stratum, pid: p.id, bid: p.book_id, pn: p.page_number, title: String(b.title || '').slice(0, 80), iss: p.ocr?.engine?.issue ?? null,
  qa_dice: p.ocr.qa_screen.dice, qa_pb: p.ocr.qa_screen.pb ?? null, qa_repo: p.ocr.qa_screen.repo ?? null,
  image_url: p.ocr?.engine?.input?.image_url || p.archived_photo, paddle: p.ocr.data, ...extra, // image-pick-ok: the exact image Paddle read, archived_photo only as fallback (sample.mjs rule)
});

// B-rand
const events = await db.collection('book_events').find({ type: 'paddle_zh_reocr', 'details.pages_written': { $gt: 0 } }, { projection: { _id: 0, book_id: 1 } }).toArray();
const frame = shuffle([...new Set(events.map((e) => e.book_id))].sort(), SEED);
const rand = []; const skips = {};
for (const bid of frame) {
  if (rand.length >= N) break;
  const b = await book(bid); if (!b) continue;
  const ps = await db.collection('pages').find({ book_id: bid, 'ocr.source': 'paddle', 'ocr.qa_screen.status': 'screened' }, { projection: PROJ }).toArray();
  const el = ps.filter((p) => { const why = eligible(p, b); if (why) skips[why] = (skips[why] || 0) + 1; return !why; }).sort((x, y) => x.page_number - y.page_number);
  if (!el.length) { skips['book: no eligible page'] = (skips['book: no eligible page'] || 0) + 1; continue; }
  rand.push(row(el[Math.floor(makeRng(bookSeed(bid))() * el.length)], b, 'B-rand'));
  process.stdout.write(`rand ${rand.length} `);
}
console.log('\nB-rand', rand.length, 'frame books', frame.length, JSON.stringify(skips));

// B-dis
const census = zlib.gunzipSync(fs.readFileSync(CENSUS)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => !r.excluded && r.cer >= DIS_CER && r.old);
const randBooks = new Set(rand.map((r) => r.bid));
const ordered = shuffle(census.sort((a, b) => (a.page_id < b.page_id ? -1 : 1)), SEED + 1);
const dis = []; const seenBook = new Set(); const skips2 = {};
for (const r of ordered) {
  if (dis.length >= N) break;
  if (randBooks.has(r.book_id) || seenBook.has(r.book_id)) continue;
  const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: PROJ });
  const b = await book(r.book_id);
  if (!p || !b) continue;
  const why = eligible(p, b);
  if (why) { skips2[why] = (skips2[why] || 0) + 1; continue; }
  if (p.ocr.data !== r.paddle) { skips2['paddle text changed since census'] = (skips2['paddle text changed since census'] || 0) + 1; continue; }
  seenBook.add(r.book_id);
  dis.push(row(p, b, 'B-dis', { second: r.old, second_model: r.rev_model, second_cer: r.cer }));
  process.stdout.write(`dis ${dis.length} `);
}
console.log('\nB-dis', dis.length, 'census candidates', census.length, JSON.stringify(skips2));
await c.close();

fs.mkdirSync('img', { recursive: true });
const out = [];
for (const [i, r] of [...rand, ...dis].entries()) {
  r.uid = `B${String(i + 1).padStart(3, '0')}`;
  const f = path.resolve('img', `${r.pid}.jpg`);
  if (!fs.existsSync(f)) {
    const res = await fetch(r.image_url); const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 1000) { console.log('IMG FAIL', r.uid, r.image_url, res.status); continue; }
    fs.writeFileSync(f, buf);
  }
  r.image = f;
  out.push(r);
}
fs.writeFileSync('setB.json', JSON.stringify(out, null, 1));
console.log('setB.json', out.length, 'drawn at', new Date().toISOString());
