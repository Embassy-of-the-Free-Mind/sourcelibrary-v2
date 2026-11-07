#!/usr/bin/env node
/**
 * Read the PRINTED page number, running head and first body line off each page IMAGE (#5803).
 *
 * PRIOR ART: scripts/eval/jev/clef-book-offset-map.mjs — scores image N against text N and N±1, so it can map a
 *   ±1 shift but not a block permutation (the BPH `6988a59*` batch, offsets of tens to hundreds of leaves).
 *   scripts/maintenance/repair-text-permutation.mjs re-seats by an explicit map; for Schutzschrift (#6659) the
 *   map was seeded from `split_detection.textWarning`, but the other 18 books in the batch carry that on 0–32
 *   leaves each. scripts/audit/revision-image-shift.mjs and backfill-printed-page-4291.mjs read the printed
 *   number from the TEXT's <page-num>, which is the side under suspicion. Nothing reads it from the image.
 *
 * The printed number on the image is independent of the stored text, so it says which transcription belongs on
 * this leaf. scripts/maintenance/plan-reseat-by-printed-page.mjs turns these reads into a permutation map.
 *
 * READ-ONLY: writes one JSONL row per page to --out, resumable (pages already in the file are skipped).
 * Model: gemini-3.1-flash-lite only, through scripts/lib/gemini-script-client.mjs (thinking off, usage logged).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/printed-page-image-read.mjs \
 *     --books=<id,id|prefix*> --out=<file.jsonl> [--cap=4] [--concurrency=8] [--limit=N] [--estimate]
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BOOKS = String(opt('books', '')).split(',').filter(Boolean);
const OUT = opt('out');
const CAP = Number(opt('cap', 4));
const CONC = Number(opt('concurrency', 8));
const ESTIMATE = process.argv.includes('--estimate');
const LIMIT = Number(opt('limit', Infinity)); // pilot: read only the first N pages of the work list
const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'scripts/audit/printed-page-image-read.mjs';
const PROMPT_VERSION = 'printed-page-read-v1';
// flash-lite list price (scripts/lib/model-pricing.mjs): $0.25 / $1.50 per M. A 1024-px image bills ~1,120 tokens.
const PRICE_IN = 0.25 / 1e6, PRICE_OUT = 1.5 / 1e6;
const EST_IN = 1120 + 260, EST_OUT = 70;
if (!BOOKS.length || !OUT) { console.error('usage: --books=<id,id|prefix*> --out=<file.jsonl> [--cap=4] [--estimate]'); process.exit(1); }

const PROMPT = `This is one page of a printed book. Report, exactly as printed on THIS page:
- printed_page: the page or folio number printed on the page (in a corner, or centred at the head or foot), as printed ("75", "xii", "f. 3r"). null if none is printed. NOT a signature mark ("A2", "B iij"), not a catchword, not a plate or figure number.
- running_head: the running headline at the top, if any, else null.
- first_line: the first line of the main body text (below any running head), copied verbatim, at most 12 words. null if the page has no body text.
- blank: true if the page is blank, a cover, a binding or a colour card.
Return only JSON: {"printed_page": string|null, "running_head": string|null, "first_line": string|null, "blank": boolean}`;

const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (!r.error) done.add(`${r.book_id}:${r.page_number}`); }

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const idFilter = { $or: BOOKS.map((b) => (b.endsWith('*') ? { id: new RegExp(`^${b.slice(0, -1)}`) } : { id: b })) };
const books = await db.collection('books').find(idFilter, { projection: { _id: 0, id: 1, title: 1 } }).toArray();
const work = [];
for (const b of books) {
  const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { _id: 0, id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
  for (const p of pages) if (!done.has(`${b.id}:${p.page_number}`)) work.push({ book: b.id, page: p });
}
if (work.length > LIMIT) work.length = LIMIT;
const est = work.length * (EST_IN * PRICE_IN + EST_OUT * PRICE_OUT);
console.log(`${books.length} books, ${work.length} pages to read (${done.size} already read); estimate $${est.toFixed(2)} (cap $${CAP})`);
if (ESTIMATE) { await client.close(); process.exit(0); }
if (est > CAP) { console.log('[REFUSE] estimate above cap'); await client.close(); process.exit(2); }

let spent = 0, n = 0, failed = 0;
const out = fs.createWriteStream(OUT, { flags: 'a' });
async function readOne({ book, page }) {
  const row = { book_id: book, page_number: page.page_number, page_id: page.id, model: MODEL, prompt_version: PROMPT_VERSION, read_at: new Date().toISOString() };
  try {
    const url = getPageSource(page);
    if (!url) throw new Error('no image');
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const r = await callGemini({ model: MODEL, prompt: PROMPT, imageParts: [jpg], endpoint: ENDPOINT, type: 'audit', bookId: book, pageIds: [page.id], promptVersion: PROMPT_VERSION, maxOutputTokens: 400 });
    spent += r.inputTokens * PRICE_IN + r.outputTokens * PRICE_OUT;
    const t = r.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    Object.assign(row, JSON.parse(t), { image: url, usage: { in: r.inputTokens, out: r.outputTokens } });
  } catch (e) { row.error = String(e.message || e).slice(0, 200); failed++; }
  out.write(JSON.stringify(row) + '\n');
  if (++n % 200 === 0) console.log(`  ${n}/${work.length}  spent $${spent.toFixed(3)}  failed ${failed}`);
}
let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < work.length) {
    if (spent >= CAP) throw new Error(`cap $${CAP} reached`);
    await readOne(work[i++]);
  }
}));
out.end();
await client.close();
console.log(`read ${n} pages, failed ${failed}, spent ~$${spent.toFixed(3)} → ${OUT}`);
