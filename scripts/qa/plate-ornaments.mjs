/**
 * PRIOR ART: scripts/qa/plate-captions.mjs — the edition's caption pass, which is
 * told to SKIP ornaments (they are not illustrations to caption). This is its
 * sibling for the ornaments themselves; the gallery's own `decorative` records
 * are boxed for thumbnails and mostly initials, too loose to print.
 *
 * Ornaments for the illustrated scholarly edition (#5849).
 *
 * The 1617 Fludd opens each book under a woodcut headpiece and closes sections
 * with a tailpiece. The edition reuses the book's OWN ornaments at the same
 * places, so it has to know where they are, boxed tightly enough to print. Asks
 * Gemini, per candidate page, for tight boxes around headpieces and tailpieces
 * only (no initials, no text, no illustrations).
 *
 * Candidates: pages whose transcription opens a book or treatise (LIBER …,
 * TRACTATUS …) and pages the gallery records as a headpiece or tailpiece.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/qa/plate-ornaments.mjs <bookId> [--pages a,b] [--refresh]
 *
 * Writes scripts/output/plate-ornaments/<bookId>.json (gitignored scratch).
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callGemini } from '../lib/gemini-script-client.mjs';

const MODEL = 'gemini-3-flash-preview';
const args = process.argv.slice(2);
const bookId = args.find(a => !a.startsWith('--'));
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
if (!bookId) { console.error('usage: plate-ornaments.mjs <bookId> [--pages a,b] [--refresh]'); process.exit(1); }

const outDir = join('scripts', 'output', 'plate-ornaments');
const outFile = join(outDir, `${bookId}.json`);
mkdirSync(outDir, { recursive: true });
const cache = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf-8')) : { book_id: bookId, model: MODEL, pages: {} };
if (args.includes('--refresh')) {
  if (opt('pages')) for (const n of opt('pages').split(',')) delete cache.pages[n];
  else cache.pages = {};
}

const PROMPT = `This is one page of an early modern printed book. Find its printer's ORNAMENTS of two kinds only:
- "headpiece": a wide decorative woodcut or engraved band printed across the top of a section (foliage, masks, scrollwork).
- "tailpiece": a decorative woodcut printed after the end of a section (a vignette, cul-de-lampe, basket of fruit, mask).
Do NOT include: decorated initial letters, illustrations or diagrams, rules or lines of type, text of any kind, page numbers.

For each ornament return {"kind": "headpiece" | "tailpiece", "box_2d": [ymin, xmin, ymax, xmax]} on a 0–1000 scale of the whole page, TIGHT around the ornament's printed ink. Return {"ornaments": []} if there are none.`;

// A book or treatise heading in the page's first lines (a running head may come first)
const OPENS_BOOK = /\b(?:LIBER|TRACTATUS|SECTIO)\s+(?:PRIMUS|SECUNDUS|TERTIUS|QUARTUS|QUINTUS|SEXTUS|SEPTIMUS|OCTAVUS|NONUS|DECIMUS|[IVX]+\b)/i;
// Tailpieces follow the end of a section
const ENDS_SECTION = /\bFINIS\b/;
const GALLERY_ORNAMENT = /headpiece|tailpiece|vignette|cul-de-lampe|printer'?s ornament|fleuron/i;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db('bookstore');
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { _id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  const gallery = await db.collection('gallery_images').find({ book_id: bookId, type: 'decorative' }, { projection: { page_number: 1, description: 1 } }).toArray();
  const fromGallery = new Set(gallery.filter(g => GALLERY_ORNAMENT.test(g.description || '')).map(g => g.page_number));
  let candidates = pages.filter(p => fromGallery.has(p.page_number) || OPENS_BOOK.test(String(p.ocr?.data || '').slice(0, 600)) || ENDS_SECTION.test(String(p.ocr?.data || '')));
  if (opt('pages')) { const want = new Set(opt('pages').split(',').map(Number)); candidates = pages.filter(p => want.has(p.page_number)); }
  candidates = candidates.filter(p => !cache.pages[p.page_number]);
  console.log(`${candidates.length} candidate pages: ${candidates.map(p => p.page_number).join(' ')}`);

  for (const p of candidates) {
    const scanUrl = p.archived_photo;
    // A page image key must carry its own book id (#3362)
    if (!scanUrl?.includes(bookId)) { console.warn(`p${p.page_number}: no book-keyed scan, skipped`); continue; }
    const raw = Buffer.from(await (await fetch(scanUrl)).arrayBuffer());
    const image = await sharp(raw).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    try {
      const { text } = await callGemini({
        model: MODEL, prompt: PROMPT, imageParts: image, responseMimeType: 'application/json',
        endpoint: 'scripts/qa/plate-ornaments.mjs', type: 'image_extraction', bookId, pageIds: [String(p._id)], maxOutputTokens: 1000,
      });
      const ornaments = (JSON.parse(text).ornaments || []).filter(o => ['headpiece', 'tailpiece'].includes(o.kind) && Array.isArray(o.box_2d) && o.box_2d.length === 4);
      cache.pages[p.page_number] = { scan_url: scanUrl, ornaments };
      console.log(`p${p.page_number}: ${ornaments.map(o => o.kind).join(', ') || 'none'}`);
    } catch (err) {
      console.warn(`p${p.page_number}: ${err.message}`);
    }
    writeFileSync(outFile, JSON.stringify(cache, null, 1));
  }
} finally {
  await client.close();
}
console.log(`cache: ${outFile} (${Object.keys(cache.pages).length} pages)`);
