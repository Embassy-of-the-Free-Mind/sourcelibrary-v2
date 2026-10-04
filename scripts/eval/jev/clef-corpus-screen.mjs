// Corpus-wide Clef screen (#5803): for every visible book, does ONE random page's stored text belong to its image?
// PRIOR ART: scripts/eval/jev/clef-leaf-match.mjs — same question and client, but it samples via $sample and loads every
//   page of each book, too heavy for ~42K books; scripts/eval/jev/clef-shift-check.mjs runs AFTER this on rows with p < 0.5.
// Read-only: Mongo reads, R2 image GETs, Clef calls. Writes only the progress file.
// Checkpoint first: one JSON row per book is appended to PROGRESS as it finishes; a rerun skips books already there.
// Run: PROGRESS=/root/clef-screen/progress.jsonl node --env-file=<.env.production.local> scripts/eval/jev/clef-corpus-screen.mjs
//   CONC=8 CAP_USD=35 LIMIT=<n books, for a smoke test>   (needs MONGODB_URI, CF_ANALYTICS_TOKEN)
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';

const PROGRESS = process.env.PROGRESS || '/root/clef-screen/progress.jsonl';
const CONC = Number(process.env.CONC || 8);
const CAP_USD = Number(process.env.CAP_USD || 35);
const LIMIT = Number(process.env.LIMIT || Infinity);
const PRICE = 0.24; // $/M input tokens, clef
const MIN_OCR = 300;
const Q = { same_page: { type: 'noul', instructions: 'The text in the state is a transcription of the page shown in the image (the same page, not a neighbouring page or a different book).' } };
const R2 = /^https:\/\/(images\.sourcelibrary\.org|[^/]*r2\.(dev|cloudflarestorage\.com))\//; // never hit provider IIIF (BSB quota)
sharp.cache(false); sharp.concurrency(1);

const done = new Set();
let spent = 0;
if (fs.existsSync(PROGRESS)) {
  for (const l of fs.readFileSync(PROGRESS, 'utf8').split('\n')) {
    if (!l) continue;
    try { const r = JSON.parse(l); done.add(r.book_id); spent += ((r.tokens || 0) * PRICE) / 1e6; } catch { /* torn last line */ }
  }
}
console.log('resume:', done.size, 'books done, $', spent.toFixed(3));

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: CONC + 2 });
await client.connect();
const db = client.db('bookstore');
const books = await db.collection('books')
  .find({ visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, language: 1, pages_count: 1, ia_identifier: 1, 'image_source.provider': 1, 'archive_metadata.jp2_offset_repaired': 1 } })
  .sort({ _id: 1 }).toArray();
const todo = books.filter((b) => !done.has(b.id || String(b._id))).slice(0, LIMIT);
console.log('visible books', books.length, 'to screen', todo.length);

const ocrText = (p) => (typeof p?.ocr === 'object' ? p.ocr?.data : p?.ocr) || '';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function loadImage(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('http ' + r.status);
      const buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return 'data:image/jpeg;base64,' + buf.toString('base64');
    } catch (e) { if (i === 3) return null; await sleep(1500 * (i + 1)); }
  }
}

let stop = null;
async function ask(image, text) {
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
async function screen(b) {
  const bid = b.id || String(b._id);
  const ids = [...new Set([bid, String(b._id)])];
  const base = { book_id: bid, language: b.language || null, provider: b.image_source?.provider || null, ia_identifier: b.ia_identifier || null, pages_count: b.pages_count };
  if (b.archive_metadata?.jp2_offset_repaired) base.jp2_offset_repaired = true;
  const tried = [];
  const reasons = [];
  for (let t = 0; t < 4 && tried.length < b.pages_count; t++) {
    let n;
    do n = 1 + Math.floor(Math.random() * b.pages_count); while (tried.includes(n));
    tried.push(n);
    const p = await db.collection('pages').findOne({ book_id: { $in: ids }, page_number: n }, proj);
    if (!p) { reasons.push('no_page'); continue; }
    const text = ocrText(p);
    if (text.length < MIN_OCR) { reasons.push('short_ocr'); continue; }
    const url = p.cropped_photo || p.display_photo || p.archived_photo;
    if (!url) { reasons.push('no_image'); continue; }
    if (!R2.test(url)) { reasons.push('non_r2_image'); continue; }
    const image = await loadImage(url);
    if (!image) { reasons.push('image_fetch_failed'); continue; }
    const a = await ask(image, text);
    if (!a) return null; // Clef unavailable: leave the book unrecorded so a rerun retries it
    return { ...base, status: 'screened', page: n, img_field: p.cropped_photo ? 'cropped' : p.display_photo ? 'display' : 'archived', ocr_len: text.length, p: a.p, tokens: a.tokens };
  }
  return { ...base, status: 'skip', tried, reasons };
}

let i = 0, n = 0, flags = 0;
const t0 = Date.now();
async function worker() {
  while (i < todo.length && !stop) {
    if (spent >= CAP_USD) { stop = 'cap'; break; }
    const b = todo[i++];
    let row;
    try { row = await screen(b); } catch (e) { console.error('book err', b._id, e.message); continue; }
    if (!row) continue;
    fs.appendFileSync(PROGRESS, JSON.stringify(row) + '\n');
    n++; if (row.p != null && row.p < 0.5) flags++;
    if (n % 500 === 0) console.log(new Date().toISOString(), n, '/', todo.length, 'flags', flags, '$', spent.toFixed(3), ((n / (Date.now() - t0)) * 1000).toFixed(2), 'books/s');
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
await client.close();
console.log('DONE', n, 'rows this run, flags', flags, '$', spent.toFixed(3), stop ? 'STOPPED: ' + stop : '');
