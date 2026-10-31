/**
 * PRIOR ART: scripts/workers/image-extract-worker.mjs + scripts/lib/image-extraction-request.mjs
 * — the production detector. It finds and boxes figures for the GALLERY and writes
 * gallery_images; it does not transcribe or translate the words engraved on a plate,
 * and its boxes are allowed to be loose (a gallery thumbnail tolerates a running head;
 * a printed plate does not). This script is the edition's caption pass: read-only
 * against production, output to a local cache the edition generator reads.
 *
 * Plate captions for the illustrated scholarly edition (#5849).
 *
 * For every page the edition sets a plate on (same selection as fetchIllustrations),
 * show Gemini the full page scan with that page's transcription and translation, and
 * ask for: a tight box around each figure (no running head, page number, chapter head
 * or body text), a short English title, every inscription on the figure with its
 * translation, and the letter key when the page text gives one. A reader of the
 * English edition must be able to read every word on the plate from the caption.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/qa/plate-captions.mjs <bookId> [--limit N] [--pages 23,74] [--refresh] [--model gemini-3.8-flash-medium]
 *
 * The model runs through the Gemini CLI on the subscription (`agy -p`, the scan
 * attached), never the paid API: only flash-lite may run on the API (Derek,
 * 2026-10-08), and a caption needs Flash. A quota stop ends the run with the cache
 * saved; the next run asks only the pages still missing. There is no API fallback.
 *
 * Writes scripts/output/plate-captions/<bookId>.json (gitignored scratch); a page
 * already in the cache is not re-asked unless --refresh, so a captioned book costs
 * nothing to render again.
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gatedImageCall } from '../lib/agy-cli.mjs';
import { normalizeCaptionFigure, illustrationQuery, spreadPageNumbers } from '../lib/scholarly-typst.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const bookId = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const MODEL = opt('model') || 'gemini-3.8-flash-low';
// Pages in flight at once; the shared account's quota, not the box, is the limit
const CONCURRENCY = Number(opt('concurrency')) || 3;
if (!bookId) { console.error('usage: plate-captions.mjs <bookId> [--limit N] [--pages a,b] [--refresh]'); process.exit(1); }

const outDir = join('scripts', 'output', 'plate-captions');
const outFile = join(outDir, `${bookId}.json`);
mkdirSync(outDir, { recursive: true });
// --refresh re-asks the --pages named, or every page when none are named
const fresh = { book_id: bookId, model: MODEL, pages: {} };
const cache = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf-8')) : fresh;
if (args.includes('--refresh')) {
  if (opt('pages')) for (const n of opt('pages').split(',')) delete cache.pages[n];
  else cache.pages = {};
}

const TITLE_NOTE = `This page is a TITLE PAGE or FRONTISPIECE. Treat the whole designed page as ONE illustration: its box takes in everything printed or engraved on the page (title, imprint, ornament, any engraving), excluding only the blank margin. Transcribe and translate EVERY line of text on it as inscriptions, in reading order.

`;
const PROMPT = ({ ocr, translation, count, title }) => `${title ? TITLE_NOTE : ''}This is one page of an early modern printed book. The page carries ${count} illustration(s) (engraving, woodcut, diagram or typographic table). An English reading edition will reprint each illustration as a plate with a caption, and a reader who knows no Latin must be able to read EVERY word on the illustration from the caption.

Do NOT include decorative headpieces, tailpieces, borders, ornamental initials or printer's ornaments: they are not illustrations.

For each illustration on the page, return:
- "box_2d": [ymin, xmin, ymax, xmax] on a 0–1000 scale of the whole page image. TIGHT around the illustration itself, including any frame, plate border, and words engraved inside or on the frame. EXCLUDE the running head, page number, chapter headings, body text, catchwords and signature marks printed around it, even when they touch it.
- "title": a short English title for what the illustration shows (at most 12 words), in the book's own terms — use the wording of the translation below where it names the figure. No interpretation the page does not support.
- "inscriptions": every word or number engraved ON the illustration (labels, mottoes, names, numbers beside labels), each as {"original": exactly as printed, "english": translation}. Keep the order a reader would scan (top to bottom, left to right). Omit single key letters (A, B, C) here. Use [] if there are none. Never invent text you cannot see.
- "key": if the illustration uses reference letters or numbers AND the page text explains them, each as {"mark": "A", "english": what it denotes, from the translation}. Use [] otherwise.

Transcription of the page (OCR, may contain errors):
"""
${ocr.slice(0, 6000)}
"""

English translation of the page:
"""
${translation.slice(0, 6000)}
"""

Return only JSON: {"figures": [ ... ]}. Write the JSON between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary. Do not use any tool except to view the attached page image.`;

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  try { return JSON.parse(m[0]); } catch (err) { throw new Error(`${err.message} — reply starts: ${m[0].slice(0, 120)}`); }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db('bookstore');
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1 } });
  if (!book) throw new Error(`book not found: ${bookId}`);
  const gallery = await db.collection('gallery_images')
    .find(illustrationQuery(book), { projection: { page_number: 1, image_url: 1, type: 1 } })
    .toArray();
  const byPage = new Map();
  for (const g of gallery) byPage.set(g.page_number, [...(byPage.get(g.page_number) || []), g]);
  // Title pages print whole (fetchIllustrations), with or without a gallery record
  const titlePages = await db.collection('pages').find({ book_id: bookId, page_type: 'title-page' }, { projection: { page_number: 1, archived_photo: 1 } }).toArray();
  const titleNumbers = new Set(titlePages.map(p => p.page_number));
  for (const p of titlePages) if (!byPage.has(p.page_number)) byPage.set(p.page_number, [{ page_number: p.page_number, image_url: p.archived_photo, type: 'title-page' }]);
  // Not the archived spreads of a split book: their figures are the single pages' figures
  const spreads = await spreadPageNumbers(db, bookId);
  let pageNumbers = [...byPage.keys()].filter(n => !spreads.has(n)).sort((a, b) => a - b);
  if (opt('pages')) { const want = new Set(opt('pages').split(',').map(Number)); pageNumbers = pageNumbers.filter(n => want.has(n)); }
  pageNumbers = pageNumbers.filter(n => !cache.pages[n]);
  if (opt('limit')) pageNumbers = pageNumbers.slice(0, Number(opt('limit')));
  console.log(`${pageNumbers.length} pages to caption`);

  const isTitle = n => titleNumbers.has(n) || byPage.get(n).some(g => ['frontispiece', 'title-page'].includes(g.type));
  // The scan, the prompt and the page id for one page, or null when the scan is not this book's
  async function prepare(n) {
    const scanUrl = byPage.get(n)[0].image_url;
    // A page image key must carry its own book id (#3362)
    if (!scanUrl?.includes(bookId)) { console.warn(`p${n}: scan URL not keyed to this book, skipped`); return null; }
    const page = await db.collection('pages').findOne({ book_id: bookId, page_number: n }, { projection: { _id: 1, 'ocr.data': 1, 'translation.data': 1 } });
    const raw = Buffer.from(await (await fetch(scanUrl)).arrayBuffer());
    const meta = await sharp(raw).metadata();
    const image = await sharp(raw).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const prompt = PROMPT({ ocr: page?.ocr?.data || '', translation: page?.translation?.data || '', count: isTitle(n) ? 1 : byPage.get(n).length, title: isTitle(n) });
    return { n, scanUrl, scanWidth: meta.width, scanHeight: meta.height, image, prompt, pageId: page?._id ? String(page._id) : undefined };
  }
  const accept = (n, { scanUrl, scanWidth, scanHeight }, text) => {
    const figures = parseJson(text).figures.map(normalizeCaptionFigure);
    cache.pages[n] = { scan_url: scanUrl, scan_width: scanWidth, scan_height: scanHeight, model: MODEL, figures };
    console.log(`p${n}: ${figures.length} figure(s) — ${figures.map(f => `${f.title} [${(f.inscriptions || []).length} insc, ${(f.key || []).length} key]`).join(' | ')}`);
  };

  let quota = null, failed = 0;
  async function caption(n) {
    if (quota) return;
    // A page whose scan will not download is left uncached for the next run, not fatal
    const p = await prepare(n).catch(err => { console.warn(`p${n}: ${err.message}`); return null; });
    if (!p || quota) return;
    // Malformed JSON is the common failure and a second ask usually clears it
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await gatedImageCall(p.prompt, p.image, { model: MODEL });
      if (r.cls === 'quota') { quota = r.err || 'quota'; return; }
      try {
        if (r.cls) throw new Error(`${r.cls} ${r.err || ''}`.trim());
        accept(n, p, r.answer);
        writeFileSync(outFile, JSON.stringify(cache, null, 1));
        return;
      } catch (err) {
        console.warn(`p${n} (attempt ${attempt}): ${err.message}`);
      }
    }
    failed++;
  }
  const queue = [...pageNumbers];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length && !quota) await caption(queue.shift()); }));
  if (failed) console.log(`${failed} page(s) failed twice and stay uncached; run again to re-ask them`);
  if (quota) { console.log(`QUOTA: stopped (${quota.slice(0, 160)}); the cache is saved, run again after the reset`); process.exitCode = 3; }
} finally {
  await client.close();
}
console.log(`cache: ${outFile} (${Object.keys(cache.pages).length} pages)`);
