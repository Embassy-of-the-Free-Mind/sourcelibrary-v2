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
 *   node --env-file=.env.production.local scripts/qa/plate-captions.mjs <bookId> [--limit N] [--pages 23,74] [--refresh]
 *
 *   … --batch      submit every uncached page as ONE Gemini Batch job (half price; the default for a whole book)
 *   … --collect    collect that job into the cache; pages that failed stay uncached for a realtime re-ask
 *
 * Writes scripts/output/plate-captions/<bookId>.json (gitignored scratch); a page
 * already in the cache is not re-asked unless --refresh. Every call is metered
 * (realtime through gemini-script-client, Batch through gemini-rest-batch).
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { buildRequest, submitBatch, collectBatch } from '../lib/gemini-rest-batch.mjs';
import { normalizeCaptionFigure, illustrationQuery } from '../lib/scholarly-typst.mjs';

const MODEL = 'gemini-3-flash-preview';
const args = process.argv.slice(2);
const bookId = args.find(a => !a.startsWith('--'));
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
// A dense labelled table can need more than the default (Fludd UCH I, p. 440); --max-tokens for its re-ask
const MAX_TOKENS = Number(opt('max-tokens')) || 4000;
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

Return only JSON: {"figures": [ ... ]}`;

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
  let pageNumbers = [...byPage.keys()].sort((a, b) => a - b);
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
    cache.pages[n] = { scan_url: scanUrl, scan_width: scanWidth, scan_height: scanHeight, figures };
    console.log(`p${n}: ${figures.length} figure(s) — ${figures.map(f => `${f.title} [${(f.inscriptions || []).length} insc, ${(f.key || []).length} key]`).join(' | ')}`);
  };

  if (args.includes('--collect')) {
    if (!cache.batch) throw new Error('no batch job recorded in the cache; run --batch first');
    const res = await collectBatch(cache.batch, { endpoint: 'scripts/qa/plate-captions.mjs', bookId });
    if (!res) { console.log(`${cache.batch.job_name}: still running`); process.exitCode = 3; }
    else {
      let failed = 0;
      for (const row of res.rows) {
        try {
          if (row.outcome !== 'text') throw new Error(`${row.outcome}${row.error ? ` ${row.error}` : ''}`);
          accept(Number(row.key), cache.batch.pages[row.key], row.text);
        } catch (err) { failed++; console.warn(`p${row.key}: ${err.message}`); }
      }
      console.log(`${res.state}: ${res.rows.length} replies, ${failed} failed (re-ask those realtime), $${res.cost_usd.toFixed(4)}`);
      const { pages, ...job } = cache.batch;
      cache.batches = [...(cache.batches || []), { ...job, collected_at: new Date().toISOString(), state: res.state, cost_usd: res.cost_usd, failed }];
      delete cache.batch;
      writeFileSync(outFile, JSON.stringify(cache, null, 1));
    }
  } else if (args.includes('--batch')) {
    if (cache.batch) throw new Error(`batch ${cache.batch.job_name} already submitted; --collect it first`);
    const lines = [], pages = {};
    // Eight scans at a time: the fetch, not the model, is the slow part of building the job
    for (let i = 0; i < pageNumbers.length; i += 8) {
      for (const p of await Promise.all(pageNumbers.slice(i, i + 8).map(prepare))) {
        if (!p) continue;
        lines.push({ key: String(p.n), request: buildRequest({ model: MODEL, prompt: p.prompt, images: [p.image], maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' }) });
        pages[p.n] = { scanUrl: p.scanUrl, scanWidth: p.scanWidth, scanHeight: p.scanHeight };
      }
      console.log(`prepared ${Math.min(i + 8, pageNumbers.length)}/${pageNumbers.length}`);
    }
    const job = await submitBatch({ model: MODEL, name: `plate-captions-${bookId}-${Date.now()}`, lines, issue: 5849, note: 'illustrated-edition caption pass (scripts/qa/plate-captions.mjs); results go to scripts/output only, never to pages' });
    cache.batch = { ...job, pages };
    writeFileSync(outFile, JSON.stringify(cache, null, 1));
    console.log(`submitted ${job.job_name}: ${job.requests} pages, ${(job.bytes / 1e6).toFixed(0)} MB`);
  } else for (const n of pageNumbers) {
    const p = await prepare(n);
    if (!p) continue;
    // Malformed JSON is the common failure and a second ask usually clears it
    for (let attempt = 1; attempt <= 2; attempt++) try {
      const { text } = await callGemini({
        model: MODEL,
        prompt: p.prompt,
        imageParts: p.image,
        endpoint: 'scripts/qa/plate-captions.mjs',
        type: 'image_extraction',
        bookId,
        pageIds: p.pageId ? [p.pageId] : undefined,
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: 'application/json',
      });
      accept(n, p, text);
      break;
    } catch (err) {
      console.warn(`p${n} (attempt ${attempt}): ${err.message}`);
    }
    writeFileSync(outFile, JSON.stringify(cache, null, 1));
  }
} finally {
  await client.close();
}
console.log(`cache: ${outFile} (${Object.keys(cache.pages).length} pages)`);
