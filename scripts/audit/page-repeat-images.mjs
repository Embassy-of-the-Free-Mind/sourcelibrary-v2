#!/usr/bin/env node
/**
 * page-repeat-images — find a page image that repeats a nearby page in the SAME book
 * (a leaf photographed twice, or a spread uploaded twice), from the images alone.
 *
 * PRIOR ART: #5056's two detectors — the OCR-text walk (word-bigram Dice, misses text-light
 * leaves: title pages, bookplates, plates) and the R2 ETag census (byte-identical uploads only,
 * misses a leaf re-photographed: Michelspacher Cabala 69778932… pp.5=7, found by eye 2026-10-29).
 * scripts/audit/page-image-same-printing.py compares two BOOKS with ORB (heavier than needed
 * inside one book, where a re-shoot comes off the same rig minutes apart).
 * scripts/lib/page-alignment.mjs dHash — #5056 found dHash<=2 too strict for re-shoots, so this
 * uses pixel correlation of small grayscale thumbnails, the check #5056 validated (17/17 r>=0.967,
 * neighbours 0.25–0.75).
 *
 * METHOD. For each visible page (page_number > 0) take a 64x80 grayscale thumbnail of its display
 * image, z-normalise it, and correlate it with each of the next WINDOW pages. A pair is reported when
 * r >= MIN_R. Each row also carries `base`, page i's correlation with the page BEFORE it, so
 * a reader can see whether the pair stands above the book's ordinary page-to-page similarity, and
 * `flat` when either thumbnail has almost no contrast (blank leaves correlate with each other
 * without being the same leaf).
 *
 * IMAGE ALONE IS NOT ENOUGH (calibrated 2026-10-29, 12 bph pairs at r >= 0.99 opened by eye):
 * 10 were the same capture, 2 were different pages of dense text with identical layout (r 0.992,
 * 0.994). A finer thumbnail does not separate them: a re-shoot's framing shifts, so true repeats
 * fall to 0.95 at 256px while the two false pairs stay at 0.95–0.97. --rescore adds the second
 * signal, word-bigram Dice of the two pages' OCR (#5056's text test). Two OCR reads of one image
 * still differ a lot, so text can only veto: on the 12 calibration pairs, Dice < 0.15 vetoed both
 * false pairs and none of the 10 true ones. Not yet validated on a fresh draw. Text-light leaves
 * (blank, plate, title) have nothing to compare, which is exactly where the image test is needed.
 *
 * READS ONLY. Writes nothing to Mongo. Fetches images from R2 (images.sourcelibrary.org) directly,
 * never through a Vercel function.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/page-repeat-images.mjs --book <id> [--book <id>…]
 *   node scripts/audit/page-repeat-images.mjs --tenant bce03f71-c18d-4460-b8ad-224c817f9aa0 --out pairs.jsonl
 *   node scripts/audit/page-repeat-images.mjs --rescore pairs.jsonl --out scored.jsonl [--min-r 0.99]
 * Options: --window 6  --min-r 0.85  --concurrency 24  --limit-books N
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const books = args.flatMap((a, i) => (a === '--book' ? [args[i + 1]] : []));
const tenant = opt('tenant');
const outPath = opt('out');
const WINDOW = Number(opt('window', 6));
const MIN_R = Number(opt('min-r', 0.85));
const CONCURRENCY = Number(opt('concurrency', 24));
const LIMIT_BOOKS = Number(opt('limit-books', 0));
const W = 64, H = 80;

function pageImageUrl(p) {
  // cropped/ and archived/ are already the page; an /uploads/ spread needs its crop applied.
  const url = p.photo || p.archived_photo || p.compressed_photo; // image-pick-ok: a split leaf's crop is applied in thumb() below
  return url && /^https?:/.test(url) ? url : null;
}

async function thumb(p) {
  const url = pageImageUrl(p);
  if (!url) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      let img = sharp(Buffer.from(await res.arrayBuffer()));
      if (p.crop && !url.includes('/cropped/')) {
        const { width, height } = await img.metadata();
        const left = Math.round((p.crop.xStart / 1000) * width);
        const right = Math.round((p.crop.xEnd / 1000) * width);
        img = sharp(await img.extract({ left, top: 0, width: Math.max(1, right - left), height }).toBuffer());
      }
      const buf = await img.greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer();
      const v = Float64Array.from(buf);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      let ss = 0; for (const x of v) ss += (x - mean) ** 2;
      const sd = Math.sqrt(ss / v.length);
      for (let k = 0; k < v.length; k++) v[k] = sd > 0 ? (v[k] - mean) / sd : 0;
      return { v, sd };
    } catch {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

const corr = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s / a.length; };

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

const rescorePath = opt('rescore');
if (rescorePath) {
  // Second signal for each image pair: do the two pages' OCR texts agree?
  const words = (t) => (t || '').replace(/<[^>]+>/g, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const bigrams = (w) => { const s = new Map(); for (let k = 0; k + 1 < w.length; k++) { const g = w[k] + ' ' + w[k + 1]; s.set(g, (s.get(g) || 0) + 1); } return s; };
  const dice = (a, b) => {
    let inter = 0, na = 0, nb = 0;
    for (const v of a.values()) na += v;
    for (const v of b.values()) nb += v;
    for (const [g, v] of a) inter += Math.min(v, b.get(g) || 0);
    return na + nb ? (2 * inter) / (na + nb) : 0;
  };
  const TEXT_LIGHT = 40; // words; below this a page has too little text to compare
  const DIFFERENT_DICE = 0.15;
  const pairs = fs.readFileSync(rescorePath, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    .filter(r => r.type === 'pair' && r.r >= MIN_R);
  const ids = [...new Set(pairs.flatMap(r => [r.pageId, r.copyOfId]))];
  const text = new Map();
  for (let k = 0; k < ids.length; k += 1000) {
    const docs = await db.collection('pages').find({ id: { $in: ids.slice(k, k + 1000) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray();
    for (const d of docs) text.set(d.id, words(d.ocr?.data));
  }
  const counts = {};
  for (const r of pairs) {
    const a = text.get(r.copyOfId) || [], b = text.get(r.pageId) || [];
    const textLight = Math.min(a.length, b.length) < TEXT_LIGHT;
    const d = textLight ? null : +dice(bigrams(a), bigrams(b)).toFixed(3);
    // Two OCR reads of ONE image disagree a lot (an identical file scored Dice 0.33; true
    // repeats ran 0.21–0.92), while two different pages share almost nothing (0.009, 0.018).
    // So text can only VETO a pair, at a low bar; it cannot confirm one at a high bar.
    const verdict = textLight ? (r.flat ? 'check' : 'repeat-image-only') : d < DIFFERENT_DICE ? 'different' : 'repeat';
    counts[verdict] = (counts[verdict] || 0) + 1;
    const line = JSON.stringify({ ...r, dice: d, words: [a.length, b.length], verdict });
    if (outPath) fs.appendFileSync(outPath, line + '\n'); else console.log(line);
  }
  console.error(JSON.stringify({ pairs: pairs.length, ...counts }));
  await client.close();
  process.exit(0);
}

let targets;
if (books.length) {
  targets = await db.collection('books').find({ $or: [{ id: { $in: books } }, { slug: { $in: books } }] }, { projection: { id: 1, slug: 1, title: 1 } }).toArray();
} else if (tenant) {
  targets = await db.collection('books').find({ tenantId: tenant, visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, slug: 1, title: 1 } }).sort({ _id: 1 }).toArray();
} else {
  console.error('need --book or --tenant'); process.exit(2);
}
if (LIMIT_BOOKS) targets = targets.slice(0, LIMIT_BOOKS);

// Resumable: books already in the output file are skipped.
const done = new Set();
if (outPath && fs.existsSync(outPath)) {
  for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line); if (r.type === 'book') done.add(r.book);
  }
}
const emit = (row) => { const s = JSON.stringify(row); if (outPath) fs.appendFileSync(outPath, s + '\n'); else console.log(s); };

let bi = 0;
for (const b of targets) {
  bi++;
  if (done.has(b.id)) continue;
  const pages = await db.collection('pages')
    .find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, compressed_photo: 1, crop: 1 } })
    .sort({ page_number: 1 }).toArray();
  const t = await pool(pages, CONCURRENCY, thumb);
  let pairs = 0, missing = t.filter(x => !x).length;
  for (let i = 0; i < pages.length; i++) {
    if (!t[i]) continue;
    const base = t[i - 1] ? corr(t[i].v, t[i - 1].v) : null;
    for (let j = i + 1; j <= Math.min(pages.length - 1, i + WINDOW); j++) {
      if (!t[j]) continue;
      const r = corr(t[i].v, t[j].v);
      if (r < MIN_R) continue;
      pairs++;
      emit({
        type: 'pair', book: b.id, slug: b.slug,
        page: pages[j].page_number, copyOf: pages[i].page_number, gap: j - i,
        r: +r.toFixed(3), base: base == null ? null : +base.toFixed(3),
        flat: Math.min(t[i].sd, t[j].sd) < 12,
        pageId: pages[j].id, copyOfId: pages[i].id,
      });
    }
  }
  emit({ type: 'book', book: b.id, slug: b.slug, pages: pages.length, missing, pairs });
  console.error(`[${bi}/${targets.length}] ${b.slug} pages=${pages.length} missing=${missing} pairs=${pairs}`);
}
await client.close();
