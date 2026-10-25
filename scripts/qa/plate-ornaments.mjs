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
 *   node --env-file=.env.production.local scripts/qa/plate-ornaments.mjs <bookId> [--pages a,b] [--refresh] [--model …]
 *
 * Runs through the Gemini CLI on the subscription (`agy -p`, scan attached), never
 * the paid API (only flash-lite may run there; Derek, 2026-10-08), with no API
 * fallback: a quota stop ends the run with the cache saved, and the next run asks
 * only the pages still missing.
 *
 * Writes scripts/output/plate-ornaments/<bookId>.json (gitignored scratch).
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gatedImageCall } from '../lib/agy-cli.mjs';
import { spreadPageNumbers } from '../lib/scholarly-typst.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const bookId = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const MODEL = opt('model') || 'gemini-3.8-flash-low';
const CONCURRENCY = Number(opt('concurrency')) || 3;
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

For each ornament return {"kind": "headpiece" | "tailpiece", "box_2d": [ymin, xmin, ymax, xmax]} on a 0–1000 scale of the whole page, TIGHT around the ornament's printed ink. Return {"ornaments": []} if there are none.

Return only that JSON, written between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers. Do not use any tool except to view the attached page image.`;

// A book or treatise heading in the page's first lines (a running head may come first)
// Latin first (Fludd), then the vernaculars the collection holds most: German,
// French, Italian, Dutch, Spanish, English — book, part, chapter and preface headings
const OPENS_BOOK = new RegExp([
  '\\b(?:LIBER|TRACTATUS|SECTIO|PARS)\\s+(?:PRIMUS|SECUNDUS|TERTIUS|QUARTUS|QUINTUS|SEXTUS|SEPTIMUS|OCTAVUS|NONUS|DECIMUS|PRIMA|SECUNDA|TERTIA|[IVX]+\\b)',
  '\\b(?:PRAEFATIO|PRÆFATIO|PROOEMIUM|PROŒMIUM|AD LECTOREM|DEDICATIO)\\b',
  '\\b(?:Das|Der|Die)\\s+(?:erste|ander|andere|zweite|dritte|vierte|fünffte|fünfte)\\s+(?:Buch|Theil|Teil|Capitel|Kapitel)',
  '\\b(?:Vorrede|Vorred|Zuschrifft|Zuschrift)\\b',
  '\\b(?:LIVRE|CHAPITRE|PARTIE)\\s+(?:PREMIER|PREMIERE|SECOND|SECONDE|TROISIESME|TROISIÈME|[IVX]+\\b)',
  '\\b(?:PREFACE|PRÉFACE|AU LECTEUR)\\b',
  '\\b(?:LIBRO|CAPITOLO|PARTE)\\s+(?:PRIMO|SECONDO|TERZO|[IVX]+\\b)',
  '\\b(?:Het|Den)\\s+(?:eerste|tweede|derde)\\s+(?:Boek|Deel|Hooftstuck|Hoofdstuk)',
  '\\b(?:THE\\s+)?(?:FIRST|SECOND|THIRD)\\s+BOOKE?\\b',
].join('|'), 'i');
// Tailpieces follow the end of a section
const ENDS_SECTION = /\b(?:FINIS|ENDE|FIN|IL FINE|EYNDE|THE END)\b/;
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
  const spreads = await spreadPageNumbers(db, bookId);
  let candidates = pages.filter(p => !spreads.has(p.page_number)).filter(p => fromGallery.has(p.page_number) || OPENS_BOOK.test(String(p.ocr?.data || '').slice(0, 600)) || ENDS_SECTION.test(String(p.ocr?.data || '')));
  if (opt('pages')) { const want = new Set(opt('pages').split(',').map(Number)); candidates = pages.filter(p => want.has(p.page_number)); }
  candidates = candidates.filter(p => !cache.pages[p.page_number]);
  console.log(`${candidates.length} candidate pages: ${candidates.map(p => p.page_number).join(' ')}`);

  // The page's scan, resized for the model, or null when the scan is not this book's
  async function prepare(p) {
    const scanUrl = p.archived_photo;
    // A page image key must carry its own book id (#3362)
    if (!scanUrl?.includes(bookId)) { console.warn(`p${p.page_number}: no book-keyed scan, skipped`); return null; }
    const raw = Buffer.from(await (await fetch(scanUrl)).arrayBuffer());
    return { p, scanUrl, image: await sharp(raw).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer() };
  }
  const accept = (n, scanUrl, text) => {
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
    const ornaments = (JSON.parse(json[0]).ornaments || []).filter(o => ['headpiece', 'tailpiece'].includes(o.kind) && Array.isArray(o.box_2d) && o.box_2d.length === 4);
    cache.pages[n] = { scan_url: scanUrl, model: MODEL, ornaments };
    console.log(`p${n}: ${ornaments.map(o => o.kind).join(', ') || 'none'}`);
  };

  let quota = null, failed = 0;
  async function find(p) {
    const c = await prepare(p).catch(err => { console.warn(`p${p.page_number}: ${err.message}`); return null; });
    if (!c || quota) return;
    const r = await gatedImageCall(PROMPT, c.image, { model: MODEL });
    if (r.cls === 'quota') { quota = r.err || 'quota'; return; }
    try {
      if (r.cls) throw new Error(`${r.cls} ${r.err || ''}`.trim());
      accept(p.page_number, c.scanUrl, r.answer);
      writeFileSync(outFile, JSON.stringify(cache, null, 1));
    } catch (err) {
      failed++;
      console.warn(`p${p.page_number}: ${err.message}`);
    }
  }
  const queue = [...candidates];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length && !quota) await find(queue.shift()); }));
  if (failed) console.log(`${failed} page(s) failed and stay uncached; run again to re-ask them`);
  if (quota) { console.log(`QUOTA: stopped (${quota.slice(0, 160)}); the cache is saved, run again after the reset`); process.exitCode = 3; }
} finally {
  await client.close();
}
console.log(`cache: ${outFile} (${Object.keys(cache.pages).length} pages)`);
