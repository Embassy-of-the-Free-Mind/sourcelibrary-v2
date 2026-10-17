// Library-wide page-image vs stored-text audit (#5803): for a stratified random sample of visible books, does the stored
// OCR of k pages spread through the book transcribe that page's own image? Flags (p < 0.5) get the neighbour check inline
// (image N vs text N±1, text N vs image N±1), so a shift is separated from a page that matches nothing near it
// (invented text on a blank leaf, another book's page, garbled OCR).
// PRIOR ART: scripts/eval/jev/clef-corpus-screen.mjs — same Clef client and question, but ONE random page per book, so a
//   shift that starts later in a book or a single invented plate-back is missed; scripts/eval/jev/clef-shift-check.mjs —
//   the neighbour check, run here inline on each flag instead of as a second pass.
// Pages per book: one random eligible page in each third of the book (k=3), plus one "plate-back" page when the book has
//   one: the leaf right after an illustration page whose own OCR claims ≥ 300 chars of text (#6783: invented prose on 10
//   blank plate versos). Eligible = page_number in [1, pages_count], ≥ 300 chars of transcription outside <image-desc>,
//   an R2 image, not gated `ocr.unreadable`.
// Strata: image_source.provider. n per stratum = max(MIN_PER, share of N_BOOKS), capped at the stratum size; rows carry
//   the stratum weight N_s / n_s so rates can be weighted back to the visible library.
// Read-only: Mongo reads, R2 image GETs, Clef calls. Writes only OUT (one JSON row per sampled page; resumable by book).
// Run: OUT=$JOB_SCRATCH/audit.jsonl N_BOOKS=6000 CAP_USD=9 CONC=8 SEED=5803 \
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/jev/clef-audit-screen.mjs
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = process.env.OUT || 'clef-audit.jsonl';
const CONC = Number(process.env.CONC || 8);
const CAP_USD = Number(process.env.CAP_USD || 9);
const N_BOOKS = Number(process.env.N_BOOKS || 6000);
const MIN_PER = Number(process.env.MIN_PER || 40);
const MAX_PAGES = Number(process.env.MAX_PAGES || Infinity); // pilot: stop after this many scored pages
const SEED = Number(process.env.SEED || 5803);
const PRICE = 0.24; // $/M input tokens, clef
const MIN_TX = 300;
const Q = { same_page: { type: 'noul', instructions: 'The text in the state is a transcription of the page shown in the image (the same page, not a neighbouring page or a different book).' } };
const R2 = /^https:\/\/(images\.sourcelibrary\.org|[^/]*r2\.(dev|cloudflarestorage\.com))\//; // never hit provider IIIF (BSB quota)
sharp.cache(false); sharp.concurrency(1);

// mulberry32: a seeded shuffle, so the sample is reproducible
let s = SEED >>> 0;
const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const done = new Set();
let spent = 0, scored = 0;
if (fs.existsSync(OUT)) {
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!l) continue;
    try { const r = JSON.parse(l); done.add(r.book_id); spent += ((r.tokens || 0) * PRICE) / 1e6; if (r.p != null) scored++; } catch { /* torn last line */ }
  }
}
console.log('resume:', done.size, 'books,', scored, 'pages, $', spent.toFixed(3));

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: CONC + 2 });
await client.connect();
const db = client.db('bookstore');
const pagesC = db.collection('pages');
const all = await db.collection('books')
  .find({ visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, language: 1, pages_count: 1, 'image_source.provider': 1 } })
  .sort({ _id: 1 }).toArray();
const byProv = new Map();
for (const b of all) { const k = b.image_source?.provider || 'none'; if (!byProv.has(k)) byProv.set(k, []); byProv.get(k).push(b); }
const sample = [];
for (const [prov, list] of [...byProv].sort()) {
  const n = Math.min(list.length, Math.max(MIN_PER, Math.round((N_BOOKS * list.length) / all.length)));
  for (const b of shuffle([...list]).slice(0, n)) sample.push({ b, prov, w: list.length / n });
}
shuffle(sample); // interleave strata so a capped run is still a spread
const todo = sample.filter((x) => !done.has(x.b.id || String(x.b._id)));
console.log('visible', all.length, 'sampled', sample.length, 'to do', todo.length);

const ocrText = (p) => (typeof p?.ocr === 'object' ? p.ocr?.data : p?.ocr) || '';
const txLen = (t) => t.replace(/<image-desc[\s\S]*?<\/image-desc>/g, '').replace(/<[^>]+>[^<\n]*<\/[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
const pageType = (t) => (t.match(/<page-type>([^<]+)<\/page-type>/) || [])[1] || null;
const imgUrl = (p) => p?.cropped_photo || p?.display_photo || p?.archived_photo || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadImage(url) {
  if (!url || !R2.test(url)) return null;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('http ' + r.status);
      const buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return 'data:image/jpeg;base64,' + buf.toString('base64');
    } catch { if (i === 3) return null; await sleep(1500 * (i + 1)); }
  }
}

let stop = null;
async function ask(image, text) {
  if (!image || !text || text.length < 100) return null;
  for (let i = 0; i < 6; i++) {
    if (stop) return null;
    try {
      const r = await fetch('https://api.cloudflare.com/client/v4/accounts/eb0562555fd5ce2a4ec0f29b6df10e7b/ai/run/@cf/cloudflare/clef', {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { Authorization: 'Bearer ' + process.env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'clef', images: [image], state: text.slice(0, 4000), questions: Q }),
      });
      if (r.status === 401 || r.status === 403) { stop = 'auth ' + r.status; return null; }
      if (!r.ok) { console.error('clef', r.status, (await r.text()).slice(0, 160)); await sleep((r.status === 429 ? 15000 : 2000) * (i + 1)); continue; }
      const j = (await r.json()).result;
      if (!j?.answers) { await sleep(2000); continue; }
      spent += (j.usage.input_tokens * PRICE) / 1e6;
      return { p: +j.answers.same_page.noul.toFixed(4), tokens: j.usage.input_tokens };
    } catch (e) { console.error('clef err', e.message); await sleep(3000 * (i + 1)); }
  }
  return null;
}

const proj = { projection: { page_number: 1, ocr: 1, cropped_photo: 1, display_photo: 1, archived_photo: 1 } };
const getPage = (ids, n) => pagesC.findOne({ book_id: { $in: ids }, page_number: n }, proj);

async function neighbours(ids, n, image, text) {
  const [prev, next] = await Promise.all([getPage(ids, n - 1), getPage(ids, n + 1)]);
  const [iPrev, iNext] = await Promise.all([loadImage(imgUrl(prev)), loadImage(imgUrl(next))]);
  const r = await Promise.all([ask(image, ocrText(prev)), ask(image, ocrText(next)), ask(iPrev, text), ask(iNext, text)]);
  const nb = { img_vs_prev_text: r[0]?.p ?? null, img_vs_next_text: r[1]?.p ?? null, text_vs_prev_img: r[2]?.p ?? null, text_vs_next_img: r[3]?.p ?? null };
  const tokens = r.reduce((a, x) => a + (x?.tokens || 0), 0);
  const v = (a, b) => (a ?? 0) >= 0.95 && (b ?? 0) >= 0.95;
  const best = Math.max(...Object.values(nb).map((x) => x ?? 0));
  // a clean one-leaf shift matches in both directions: image N = text N−1 and text N = image N+1, or the mirror
  nb.class = v(nb.img_vs_prev_text, nb.text_vs_next_img) ? 'shift_img_is_prev_text'
    : v(nb.img_vs_next_text, nb.text_vs_prev_img) ? 'shift_img_is_next_text'
    : best >= 0.7 ? 'one_sided' : 'no_neighbour';
  return { nb, tokens };
}

async function screenBook({ b, prov, w }) {
  const bid = b.id || String(b._id);
  const ids = [...new Set([bid, String(b._id)])];
  const base = { book_id: bid, title: (b.title || '').slice(0, 80), provider: prov, language: b.language || null, pages_count: b.pages_count, w: +w.toFixed(3) };
  const len = { $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr' }, 'string'] }, '$ocr', { $ifNull: ['$ocr.data', ''] }] } };
  const data = { $cond: [{ $eq: [{ $type: '$ocr' }, 'string'] }, '$ocr', { $ifNull: ['$ocr.data', ''] }] };
  const meta = await pagesC.aggregate([
    { $match: { book_id: { $in: ids }, page_number: { $gte: 1, $lte: b.pages_count } } },
    { $project: { _id: 0, n: '$page_number', len, unr: { $ifNull: ['$ocr.unreadable', false] }, ill: { $gte: [{ $indexOfCP: [data, '<page-type>illustration'] }, 0] }, img: { $type: { $ifNull: ['$cropped_photo', { $ifNull: ['$display_photo', '$archived_photo'] }] } } } },
  ]).toArray();
  const ok = meta.filter((m) => m.len >= MIN_TX && !m.unr && m.img === 'string').sort((a, b2) => a.n - b2.n);
  if (!ok.length) return [{ ...base, status: 'no_eligible' }];
  const ill = new Set(meta.filter((m) => m.ill).map((m) => m.n));
  const okSet = new Map(ok.map((m) => [m.n, m]));
  const picks = [];
  const T = b.pages_count;
  for (let t = 0; t < 3; t++) {
    const pool = shuffle(ok.filter((m) => m.n > (t * T) / 3 && m.n <= ((t + 1) * T) / 3).map((m) => ({ n: m.n, kind: 'third' + (t + 1) })));
    picks.push(pool);
  }
  const backs = shuffle(ok.filter((m) => ill.has(m.n - 1) && !ill.has(m.n)).map((m) => ({ n: m.n, kind: 'plate_back' })));
  picks.push(backs);
  const rows = [];
  const used = new Set();
  for (const pool of picks) {
    for (const c of pool.slice(0, 3)) { // up to 3 tries per slot (short transcription once tags are stripped, image fetch fails)
      if (used.has(c.n)) continue;
      const p = await getPage(ids, c.n);
      const text = ocrText(p);
      if (txLen(text) < MIN_TX) continue;
      const image = await loadImage(imgUrl(p));
      if (!image) continue;
      used.add(c.n);
      const a = await ask(image, text);
      if (!a) return null; // Clef unavailable: leave the book unrecorded so a rerun retries it
      const row = { ...base, status: 'screened', page: c.n, kind: c.kind, page_type: pageType(text), ocr_model: p.ocr?.model || null, ocr_source: p.ocr?.source || null, ocr_at: p.ocr?.updated_at || null, tx_len: txLen(text), p: a.p, tokens: a.tokens };
      if (a.p < 0.5) { const nb = await neighbours(ids, c.n, image, text); Object.assign(row, nb.nb); row.tokens += nb.tokens; }
      rows.push(row);
      scored++;
      break;
    }
  }
  return rows.length ? rows : [{ ...base, status: 'no_image' }];
}

let i = 0, nb = 0, flags = 0;
const t0 = Date.now();
async function worker() {
  while (i < todo.length && !stop) {
    if (spent >= CAP_USD) { stop = 'cap'; break; }
    if (scored >= MAX_PAGES) { stop = 'max_pages'; break; }
    const x = todo[i++];
    let rows;
    try { rows = await screenBook(x); } catch (e) { console.error('book err', x.b._id, e.message); continue; }
    if (!rows) continue;
    fs.appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    nb++; flags += rows.filter((r) => r.p != null && r.p < 0.5).length;
    if (nb % 200 === 0) console.log(new Date().toISOString(), nb, '/', todo.length, 'books', scored, 'pages flags', flags, '$', spent.toFixed(3), ((nb / (Date.now() - t0)) * 1000).toFixed(2), 'books/s');
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
await client.close();
console.log('DONE', nb, 'books this run,', scored, 'pages total, flags', flags, '$', spent.toFixed(4), stop ? 'STOPPED: ' + stop : '');
