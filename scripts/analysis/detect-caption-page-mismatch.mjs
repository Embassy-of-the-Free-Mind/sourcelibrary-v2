#!/usr/bin/env node
/**
 * detect-caption-page-mismatch.mjs
 *
 * FREE (no model calls) triage for the image-extraction failure mode where the
 * gallery `museum_description` (written from the image + book topic, with no page
 * text) disagrees with what the picture actually shows — the "wrestlers labelled
 * gymnosophists" bug.
 *
 * Signal: the OCR pass emits a context-grounded `<image-desc>` for the same image
 * (it read the whole page, including captions). Both that and `museum_description`
 * are English prose describing the SAME picture, so they should share content
 * words. Low overlap = the two descriptions disagree = candidate mislabel. These
 * are CANDIDATES for review (or a cheap LLM judge), not confirmed errors.
 *
 * Usage:
 *   node scripts/analysis/detect-caption-page-mismatch.mjs [--sample N] [--book ID]
 *        [--threshold 0.12] [--limit-print 25]
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = parseInt(getArg('--sample', '4000'), 10);
const BOOK = getArg('--book', null);
const THRESH = parseFloat(getArg('--threshold', '0.12'));
const PRINT = parseInt(getArg('--limit-print', '25'), 10);

const STOP = new Set(['the','this','these','those','that','with','from','into','among','around','toward','towards',
  'and','or','but','for','its','his','her','their','they','are','was','were','has','have','had','been','being',
  'depicts','depicting','shows','showing','shown','illustration','illustrates','illustrating','image','scene',
  'figure','figures','figure.','large','small','vibrant','colorful','colourful','detailed','striking','manuscript',
  'miniature','painting','woodcut','engraving','emblem','portrait','frontispiece','illumination','plate','print',
  'left','right','center','centre','top','bottom','above','below','upper','lower','side','background','foreground',
  'wearing','holding','seated','standing','sitting','dressed','adorned','featuring','appears','appear','identified',
  'page','book','text','script','inscription','inscriptions','armenian','latin','greek','style','traditional',
  'royal','king','figure','figures','men','man','woman','women','people','group','three','four','five','two','one',
  'who','which','where','while','when','also','such','here','there','their','some','many','other','another','within']);

const tokens = (s) => {
  if (!s) return new Set();
  return new Set((s.toLowerCase().match(/[a-zà-ÿ]+/g) || [])
    .filter(w => w.length >= 4 && !STOP.has(w)));
};

const imgDescRx = /<image-desc[^>]*>([\s\S]*?)<\/image-desc>/i;
// the OCR <note> rendering also carries the same description in translation.data
const noteRx = /<note>([\s\S]*?illustration[\s\S]*?)<\/note>/i;

function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return null;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.min(a.size, b.size); // containment of the smaller in the larger
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  const match = BOOK ? { book_id: BOOK, museum_description: { $type: 'string' } }
                     : { museum_description: { $type: 'string' } };
  const pipeline = BOOK
    ? [{ $match: match }, { $project: { page_id: 1, book_id: 1, book_title: 1, museum_description: 1, page_number: 1 } }]
    : [{ $match: match }, { $sample: { size: SAMPLE } },
       { $project: { page_id: 1, book_id: 1, book_title: 1, museum_description: 1, page_number: 1 } }];

  const imgs = await db.collection('gallery_images').aggregate(pipeline).toArray();
  const pageIds = [...new Set(imgs.map(i => i.page_id).filter(Boolean))];

  const pageDesc = new Map();
  for (let i = 0; i < pageIds.length; i += 2000) {
    const chunk = pageIds.slice(i, i + 2000);
    const pages = await db.collection('pages')
      .find({ id: { $in: chunk } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } })
      .toArray();
    for (const p of pages) {
      const ocr = p.ocr?.data || '', tr = p.translation?.data || '';
      const m = ocr.match(imgDescRx) || tr.match(imgDescRx) || tr.match(noteRx) || ocr.match(noteRx);
      pageDesc.set(p.id, m ? m[1] : null);
    }
  }

  let scanned = 0, noImgDesc = 0, flagged = 0;
  const examples = [];
  for (const im of imgs) {
    const gd = pageDesc.get(im.page_id);
    if (!gd) { noImgDesc++; continue; }
    scanned++;
    const ov = overlap(tokens(im.museum_description), tokens(gd));
    if (ov == null) continue;
    if (ov < THRESH) {
      flagged++;
      if (examples.length < PRINT) examples.push({
        book: im.book_title, page: im.page_number, ov: ov.toFixed(2),
        museum: (im.museum_description || '').replace(/\s+/g, ' ').slice(0, 130),
        ocrDesc: gd.replace(/\s+/g, ' ').slice(0, 130),
        url: `https://sourcelibrary.org/book/${im.book_id}/page/${im.page_id}`,
      });
    }
  }

  console.log(`\n=== caption ↔ page-image-description disagreement triage (threshold ${THRESH}) ===`);
  console.log(`gallery images examined  : ${imgs.length}${BOOK ? ` (book ${BOOK})` : ` (random sample of ${SAMPLE})`}`);
  console.log(`comparable (have <image-desc>): ${scanned}  | no <image-desc>: ${noImgDesc}`);
  console.log(`FLAGGED (descriptions disagree): ${flagged}  (${(100 * flagged / (scanned || 1)).toFixed(1)}% of comparable)`);
  console.log(`\n--- examples (low word-overlap; review or LLM-judge) ---`);
  for (const e of examples) {
    console.log(`\n[${e.book}] p${e.page}  overlap=${e.ov}`);
    console.log(`  museum : ${e.museum}…`);
    console.log(`  ocrDesc: ${e.ocrDesc}…`);
    console.log(`  ${e.url}`);
  }
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
