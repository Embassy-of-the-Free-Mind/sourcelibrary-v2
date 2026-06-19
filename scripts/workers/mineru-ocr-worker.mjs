#!/usr/bin/env node
/**
 * mineru-ocr-worker.mjs — OCR English public-domain, modern-print books with
 * MinerU (CPU, pipeline backend) at zero Gemini cost. Runs on the Hetzner box
 * where MinerU is installed (~/mineru-eval/venv).
 *
 * Why: clean modern English print OCRs as well with MinerU as with Gemini (eval
 * 2026-06-18: 0.96–0.99 char agreement), so the English pre-copyright backlog can
 * be cleared while the Gemini pipeline is paused for cost.
 *
 * Safe-write rules:
 *   - Fill ONLY pages whose ocr.data is missing/empty — never overwrite Gemini OCR.
 *   - Tag provenance: ocr.source='mineru', ocr.model='mineru-pipeline'.
 *   - Empty MinerU output (<MIN_CHARS) → flag the page for a Gemini fallback,
 *     do NOT store blank text as confident OCR.
 *   - Gate the lane: language English, year 1820–1928, non-artwork, has imaged
 *     pages. Skip books whose OCR'd text is mostly CJK (mislabeled-language data).
 *
 * Usage:
 *   node scripts/workers/mineru-ocr-worker.mjs --limit 3            # process 3 books
 *   node scripts/workers/mineru-ocr-worker.mjs --book <id>          # one book
 *   node scripts/workers/mineru-ocr-worker.mjs --limit 200          # scale
 *   add --dry-run to OCR + report without writing to Mongo
 */
import { MongoClient } from 'mongodb';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MINERU = process.env.MINERU_BIN || '/root/mineru-eval/venv/bin/mineru';
const WORKDIR = process.env.MINERU_WORKDIR || '/root/mineru-eval/worker-tmp';
const MODEL_TAG = 'mineru-pipeline';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag('--dry-run');
const LIMIT = parseInt(opt('--limit', '3'), 10);
const ONE_BOOK = opt('--book', null);
const MIN_CHARS = parseInt(opt('--min-chars', '40'), 10);

const CJK_RE = /[㐀-鿿぀-ヿ가-힯]/g;
const LATIN_RE = /[A-Za-zÀ-ÿ]/g;
const TITLE_SKIP = /萬|葯|guo yao|chinese/i;

function cjkRatio(text) {
  const cjk = (text.match(CJK_RE) || []).length;
  const lat = (text.match(LATIN_RE) || []).length;
  const tot = cjk + lat;
  return tot ? cjk / tot : 0;
}

// Turn MinerU markdown into clean reading text: drop image-reference markdown
// (local hashes that don't resolve), keep table/inline text, strip md scaffolding.
function sanitize(md) {
  let t = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '');   // markdown images out entirely
  t = t.replace(/<[^>]+>/g, ' ');                      // html tags -> keep inner cell text
  t = t.replace(/^#{1,6}\s+/gm, '');                   // heading hashes
  t = t.replace(/^\s*>\s?/gm, '');                     // blockquotes
  t = t.replace(/`{1,3}/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
// real textual content length (ignores any residual markup) — used to gate empties
const realLen = (s) => (s.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length;

// Detect run-together / mangled OCR (MinerU loses word spacing on decorative or
// fine-press typography, e.g. ornamental poetry editions). Clean prose sits at
// mean-word-length ~4-5 and space-ratio ~0.16-0.18; flag clear outliers for a
// Gemini fallback rather than storing a mangled "quote".
function lowQuality(text) {
  const real = realLen(text);
  if (real < 80) return false; // too short to judge; MIN_CHARS gate handles it
  const toks = text.split(/\s+/).filter(Boolean).length || 1;
  const meanWordLen = real / toks;
  const spaceRatio = (text.match(/ /g) || []).length / Math.max(1, text.length);
  return meanWordLen > 8 || spaceRatio < 0.10;
}

const imgUrl = (p) => p.display_photo || p.archived_photo || p.photo || null;
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function readPageMd(outDir, base) {
  const hits = [
    path.join(outDir, base, 'ocr', `${base}.md`),
    path.join(outDir, base, 'auto', `${base}.md`),
  ].filter((p) => fs.existsSync(p));
  return hits.length ? fs.readFileSync(hits[0], 'utf8').trim() : '';
}

async function processBook(db, book) {
  const id = String(book._id);
  const pagesCol = db.collection('pages');
  if (TITLE_SKIP.test(book.title || '')) {
    return { id, title: book.title, skipped: 'title-language-gate' };
  }

  // pages with an image and no usable OCR yet — excluding pages MinerU has already
  // tried and flagged (empty/low-quality), so repeated runs converge instead of
  // re-OCRing the same illustration plates forever.
  const pages = await pagesCol.find({
    book_id: id,
    page_number: { $gt: 0 },
    ocr_mineru_status: { $nin: ['empty', 'low-quality'] },
    $and: [
      { $or: [{ display_photo: { $exists: true, $ne: null } }, { archived_photo: { $exists: true, $ne: null } }, { photo: { $exists: true, $ne: null } }] },
      { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }] },
    ],
  }).project({ _id: 1, page_number: 1, display_photo: 1, archived_photo: 1, photo: 1 }).sort({ page_number: 1 }).toArray();

  if (!pages.length) return { id, title: book.title, skipped: 'no-empty-imaged-pages' };

  const bookDir = path.join(WORKDIR, id);
  const imgDir = path.join(bookDir, 'img');
  const outDir = path.join(bookDir, 'out');
  fs.rmSync(bookDir, { recursive: true, force: true });
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // map base filename -> page doc
  const byBase = new Map();
  let dlOk = 0;
  for (const p of pages) {
    const url = imgUrl(p);
    const base = `page-${String(p.page_number).padStart(4, '0')}`;
    try {
      await downloadImage(url, path.join(imgDir, `${base}.jpg`));
      byBase.set(base, p);
      dlOk++;
    } catch (e) { /* skip unreachable image */ }
  }
  if (!dlOk) { fs.rmSync(bookDir, { recursive: true, force: true }); return { id, title: book.title, skipped: 'all-image-dl-failed' }; }

  // run MinerU once over the whole image dir
  const t0 = Date.now();
  sh(MINERU, ['-p', imgDir, '-o', outDir, '-b', 'pipeline', '-m', 'ocr']);
  const secs = (Date.now() - t0) / 1000;

  // collect outputs
  let written = 0, flaggedEmpty = 0, sampledCjk = 0, sampleN = 0, sampleText = '';
  const pageOps = [];
  for (const [base, p] of byBase) {
    const text = sanitize(readPageMd(outDir, base));
    if (sampleN < 8) { sampleText += ' ' + text; sampleN++; }
    if (realLen(text) >= MIN_CHARS && !lowQuality(text)) {
      pageOps.push({ pageId: p._id, text });
    } else {
      const status = realLen(text) < MIN_CHARS ? 'empty' : 'low-quality';
      flaggedEmpty++;
      if (!DRY) {
        await pagesCol.updateOne(
          { _id: p._id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }] },
          { $set: { ocr_mineru_status: status, ocr_needs_fallback: true, ocr_mineru_at: new Date() } },
        );
      }
    }
  }

  // language safety: if the OCR'd sample is mostly CJK, this "English" book is mislabeled — abort writes
  const ratio = cjkRatio(sampleText);
  if (ratio > 0.10) {
    fs.rmSync(bookDir, { recursive: true, force: true });
    return { id, title: book.title, skipped: `mislabeled-cjk (ratio ${ratio.toFixed(2)})`, pagesSeen: byBase.size };
  }

  // write the good pages
  if (!DRY) {
    const now = new Date();
    for (const { pageId, text } of pageOps) {
      const r = await pagesCol.updateOne(
        { _id: pageId, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }] },
        { $set: { ocr: {
            data: text,
            language: 'English',
            model: MODEL_TAG,
            source: 'mineru',
            engine: 'mineru pipeline backend (PP-OCR + PDF-Extract-Kit)',
            updated_at: now,
          }, ocr_mineru_status: 'ok', ocr_mineru_at: now } },
      );
      if (r.modifiedCount) written++;
    }
    // recompute book.pages_ocr
    const ocrCount = await pagesCol.countDocuments({ book_id: id, 'ocr.data': { $exists: true, $ne: '' } });
    await db.collection('books').updateOne({ _id: book._id }, { $set: { pages_ocr: ocrCount, mineru_ocr_at: now } });
  } else {
    written = pageOps.length;
  }

  fs.rmSync(bookDir, { recursive: true, force: true });
  return { id, title: book.title, year: book.year, pages: byBase.size, written, flaggedEmpty, secs: Math.round(secs), cjk: ratio.toFixed(2) };
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  let candidates;
  if (ONE_BOOK) {
    candidates = await books.find({ _id: (await import('mongodb')).ObjectId.createFromHexString(ONE_BOOK) }).toArray();
  } else {
    candidates = await books.find({
      language: /english/i,
      content_type: { $ne: 'artwork' },
      year: { $gte: 1820, $lt: 1929 },
      pages_count: { $gt: 0 },
      $expr: { $lt: ['$pages_ocr', { $multiply: [0.9, '$pages_count'] }] },
    }).project({ _id: 1, title: 1, year: 1, pages_count: 1, pages_ocr: 1 }).sort({ pages_count: 1 }).limit(LIMIT * 3).toArray();
  }

  console.log(`[mineru-worker] ${DRY ? 'DRY-RUN ' : ''}candidates fetched: ${candidates.length}, processing up to ${LIMIT}`);
  let done = 0;
  for (const book of candidates) {
    if (done >= LIMIT) break;
    try {
      const r = await processBook(db, book);
      console.log(JSON.stringify(r));
      if (!r.skipped) done++;
    } catch (e) {
      console.log(JSON.stringify({ id: String(book._id), title: book.title, error: e.message }));
    }
  }
  console.log(`[mineru-worker] processed ${done} book(s)${DRY ? ' (dry-run, no writes)' : ''}`);
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
