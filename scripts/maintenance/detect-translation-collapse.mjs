#!/usr/bin/env node
/**
 * Detect "collapsed" translations — real text pages whose English translation
 * is a degenerate sliver (a boundary note + a stray catchword + the hidden
 * <summary>/<keywords> page-description block) instead of the actual prose.
 *
 * Why this exists
 * ---------------
 * Found 2026-06-16 on "The Extant Fragments of Dicaearchus" (Estienne, 1589,
 * book 69b2f434f9f1ad2b3b15154a). Internal page 34 (printed leaf "4") has a full
 * page of Latin+Greek OCR (1367 chars) but its translation collapsed to 471
 * chars — only `<note>continued from previous page…</note>`, a one-word catchword
 * `…structure (δομῆς)`, and a <summary>/<keywords> wrapper. The entire body of
 * Estienne's commentary was dropped. The identical text scanned a few leaves over
 * (page 20) translated fully — so the source is fine; the generation collapsed.
 *
 * Trigger: pages that begin mid-sentence and END on a catchword (the printer's
 * cue for the next page's first word). The translator mistakes the whole page for
 * a mere continuation fragment, translates only the catchword, and emits its
 * page-description machinery in place of the body. Overwhelmingly a
 * gemini-3.1-flash-lite failure mode on mixed Greek/Latin scholarly pages.
 *
 * This is the INVERSE of detect-translation-loops.mjs (translation too LONG).
 * Here the translation is too SHORT relative to its own OCR.
 *
 * Detection signal (image-free, fast, two-stage)
 * ----------------------------------------------
 * Stage 1 (aggregation): comparable text pages where raw translation length is a
 *   small fraction of raw OCR length — a cheap over-capturing pre-filter.
 * Stage 2 (JS): strip editorial wrappers from BOTH sides to get the visible prose
 *   body, then flag where translation body is a tiny fraction of OCR body. This
 *   removes false positives (e.g. pages that are mostly untranslatable Greek
 *   quotation already carried verbatim).
 *
 * READ-ONLY. Writes nothing to Mongo. Optionally dumps the flagged page list to
 * scripts/output/ so a targeted re-translation (with the stronger model) can be
 * planned.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/detect-translation-collapse.mjs                 # full corpus
 *   node scripts/maintenance/detect-translation-collapse.mjs --book=<id>     # one book
 *   node scripts/maintenance/detect-translation-collapse.mjs --dump          # write flagged list
 *   node scripts/maintenance/detect-translation-collapse.mjs --body-ratio=0.25 --min-ocr=400
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const BOOK = arg('book', null);
const PRE_RATIO = parseFloat(arg('pre-ratio', '0.6'));   // stage-1 raw trLen/ocrLen ceiling
const BODY_RATIO = parseFloat(arg('body-ratio', '0.3')); // stage-2 trBody/ocrBody flag threshold
const MIN_OCR_BODY = parseInt(arg('min-ocr', '400'), 10);// min OCR body chars to consider a page
const MIN_OCR_RAW = parseInt(arg('min-ocr-raw', '500'), 10);
const DUMP = process.argv.includes('--dump');

const toOid = id => { try { return new ObjectId(String(id)); } catch { return null; } };

// Blocks that are descriptive/structural, not body prose. Their CONTENT is
// stripped (not just the tag) so a page that is "all wrapper" measures as empty.
const BLOCK_TAGS = [
  'meta', 'image-desc', 'vocab', 'summary', 'keywords', 'warning', 'note',
  'scan-quality', 'language', 'page-type', 'page-num', 'header', 'sig',
  'insert', 'columns', 'script',
];
const blockRe = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
// Self-closing / unmatched single tags of the same families.
const looseRe = new RegExp(`</?(${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi');

/** Visible prose length after removing editorial wrapper blocks + residual tags. */
function bodyLen(text) {
  if (!text) return 0;
  let t = String(text);
  t = t.replace(blockRe, ' ');
  t = t.replace(looseRe, ' ');
  t = t.replace(/<[^>]+>/g, ' ');        // any remaining inline tags (term/gloss/etc.) -> keep inner text already
  t = t.replace(/->|<-/g, ' ');           // verse/centering markers
  t = t.replace(/\s+/g, ' ').trim();
  return t.length;
}

// A real collapse leaves only a sliver: the boundary note / summary wrapper with
// almost no body. Require a short body so a long page that merely opens with a
// "continued from previous page" note isn't mistaken for a collapse.
const isCollapseSignature = tr =>
  bodyLen(tr) < 60 &&
  (/continued from previous page/i.test(tr || '') || /<summary>/i.test(tr || ''));

// Absolute body cap — the decisive precision fix. Real collapses are short in
// ABSOLUTE terms (empty or a sliver). Dense pages and pages with huge or
// artifact-inflated OCR have a low body RATIO but an adequate translation; they
// are NOT collapses. Ratio-only flagged ~20% false positives (verified 2026-06-16).
const COLLAPSE_ABS_CAP = parseInt(arg('abs-cap', '800'), 10);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
// Own client: socketTimeoutMS:0 so the long full-collection scan doesn't idle-timeout
// the socket (the shared helper hardcodes 30s, which killed the first run).
const client = new MongoClient(uri, {
  maxPoolSize: 2, serverSelectionTimeoutMS: 15_000, connectTimeoutMS: 15_000, socketTimeoutMS: 0,
});
await client.connect();
const db = client.db('bookstore');
try {
  const pages = db.collection('pages');

  const match = {
    page_type: 'text',
    'translation.source': 'ai',
    'translation.recitation_blocked': { $ne: true },
    'translation.safety_blocked': { $ne: true },
    'translation.data': { $type: 'string', $ne: '' },
    'ocr.data': { $type: 'string', $ne: '' },
  };
  if (BOOK) match.book_id = String(BOOK);

  // Stage 1: cheap pre-filter on raw lengths.
  const totalComparable = await pages.countDocuments(match);
  console.log(`Translation-collapse detector (READ-ONLY)`);
  console.log(`  comparable text pages (page_type=text, source=ai): ${totalComparable.toLocaleString()}`);
  console.log(`  stage-1 pre-filter: rawTr/rawOcr < ${PRE_RATIO} AND rawOcr >= ${MIN_OCR_RAW}`);
  console.log(`  stage-2 flag:       trBody/ocrBody < ${BODY_RATIO} AND ocrBody >= ${MIN_OCR_BODY}\n`);

  // Stage 1: STREAM length-only docs server-side (tiny payload, keeps socket busy
  // so the full-collection scan never idles). Returns only ids + lengths for pages
  // whose raw translation is a small fraction of raw OCR.
  const cur = pages.aggregate([
    { $match: match },
    { $project: {
        book_id: 1, page_number: 1,
        model: '$translation.model',
        lang: '$ocr.language',
        ocrLen: { $strLenCP: '$ocr.data' },
        trLen: { $strLenCP: '$translation.data' },
    } },
    { $match: { $expr: { $and: [
      { $gte: ['$ocrLen', MIN_OCR_RAW] },
      { $lt: ['$trLen', { $multiply: ['$ocrLen', PRE_RATIO] }] },
    ] } } },
  ], { allowDiskUse: true, batchSize: 500 });

  const candIds = [];
  let scanned = 0;
  for await (const c of cur) {
    candIds.push(c);
    if (++scanned % 2000 === 0) process.stderr.write(`\r  stage-1 candidates so far: ${scanned}`);
  }
  process.stderr.write(`\r  stage-1 candidates: ${candIds.length}            \n`);

  // Stage 2: fetch FULL text only for the (few) candidates, wrapper-aware refine.
  const flagged = [];
  for (let i = 0; i < candIds.length; i += 200) {
    const slice = candIds.slice(i, i + 200);
    const docs = await pages.find(
      { _id: { $in: slice.map(s => s._id) } },
      { projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'ocr.language': 1 } },
    ).toArray();
    for (const d of docs) {
      const ocrBody = bodyLen(d.ocr?.data);
      const trBody = bodyLen(d.translation?.data);
      if (ocrBody < MIN_OCR_BODY) continue;
      if (trBody >= COLLAPSE_ABS_CAP) continue; // adequate translation — not a collapse regardless of OCR size
      const ratio = ocrBody ? trBody / ocrBody : 0;
      if (ratio < BODY_RATIO || isCollapseSignature(d.translation?.data)) {
        flagged.push({
          book_id: d.book_id, page_number: d.page_number,
          model: d.translation?.model || '(none)', lang: d.ocr?.language || '(none)',
          ocrBody, trBody, ratio: +ratio.toFixed(3),
          sig: isCollapseSignature(d.translation?.data),
        });
      }
    }
  }

  console.log(`stage-1 candidates: ${candIds.length.toLocaleString()}`);
  console.log(`stage-2 FLAGGED collapses: ${flagged.length.toLocaleString()}` +
    (totalComparable ? `  (${(100 * flagged.length / totalComparable).toFixed(2)}% of comparable pages)` : '') + '\n');

  const tally = (key) => {
    const m = new Map();
    for (const f of flagged) m.set(f[key], (m.get(f[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log('By translation model:');
  for (const [k, n] of tally('model')) console.log(`  ${String(k).padEnd(34)} ${n}`);
  console.log('\nBy OCR language (top 12):');
  for (const [k, n] of tally('lang').slice(0, 12)) console.log(`  ${String(k).padEnd(20)} ${n}`);

  // Top affected books, with titles.
  const byBook = tally('book_id').slice(0, 25);
  const oids = byBook.map(([id]) => toOid(id)).filter(Boolean);
  const titles = new Map();
  if (oids.length) {
    const bs = await db.collection('books')
      .find({ _id: { $in: oids } }, { projection: { display_title: 1, title: 1, language: 1, status: 1 } }).toArray();
    for (const b of bs) titles.set(String(b._id), b);
  }
  console.log('\nTop affected books:');
  for (const [id, n] of byBook) {
    const b = titles.get(id) || {};
    console.log(`  ${String(n).padStart(4)}  ${(b.display_title || b.title || id)}  [${b.language || '?'}|${b.status || '?'}]  ${id}`);
  }

  if (DUMP) {
    const outDir = path.join(process.cwd(), 'scripts', 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const out = path.join(outDir, `translation-collapse-${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify(flagged, null, 2));
    console.log(`\nWrote ${flagged.length} flagged pages -> ${out}`);
  }
} finally {
  await client.close();
}
