/**
 * Local QA harness for the scholarly deposit PDF (the one Zenodo serves).
 *
 * Renders the SAME generator the DOI mint uses (scripts/lib/scholarly-typst.mjs)
 * against real production data, touching neither Zenodo nor Mongo writes — so
 * typography changes can be inspected before a deposit makes them permanent.
 * The reader-download PDF is a different generator with its own harness:
 * scripts/qa/render-book-pdf.ts.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/qa/render-scholarly-pdf.mjs <bookId> [--pages 120-180] [--refresh] [--keep-typ] [--no-plates] [--no-original] [--out path.pdf] [--dedication text | --dedication-file path]
 *
 * Illustrations (gallery_images crops) are fetched fresh on every run — they
 * need MONGODB_URI even when the book is cached; --no-plates skips them. Run
 * scripts/qa/plate-captions.mjs first for tight crops and translated captions.
 *
 * The book + pages are cached under scripts/output/scholarly-cache/ after the
 * first fetch, so design iteration needs no database (pass --refresh to
 * re-fetch). --pages limits the BODY to a page_number range for fast renders;
 * front and back matter are always included. Requires `typst` on PATH.
 */
import { MongoClient } from 'mongodb';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { generateScholarlyPdf, generateTypstSource, fetchFrontispiece, fetchIllustrations, fetchOrnaments, editionCredits, resolveDedication } from '../lib/scholarly-typst.mjs';

const args = process.argv.slice(2);
const bookId = args.find(a => !a.startsWith('--'));
const flag = name => args.includes(`--${name}`);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
if (!bookId) {
  console.error('usage: render-scholarly-pdf.mjs <bookId> [--pages A-B] [--refresh] [--keep-typ] [--out path.pdf]');
  process.exit(1);
}

const cacheDir = join('scripts', 'output', 'scholarly-cache');
const cacheFile = join(cacheDir, `${bookId}.json`);

async function load() {
  if (existsSync(cacheFile) && !flag('refresh')) return JSON.parse(readFileSync(cacheFile, 'utf-8'));
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set and no cache — source .env.production.local');
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    const db = client.db('bookstore');
    const book = await db.collection('books').findOne({ $or: [{ id: bookId }, { slug: bookId }] });
    if (!book) throw new Error(`book not found: ${bookId}`);
    // Same selection as mintOneBook: every page with translation text, in order
    const pages = await db.collection('pages')
      .find({ book_id: book.id }, { projection: { page_number: 1, page_type: 1, 'translation.data': 1, 'ocr.data': 1 } })
      .sort({ page_number: 1 })
      .toArray();
    const collections = book.collections?.length
      ? await db.collection('collections').find({ slug: { $in: book.collections }, dedication: { $exists: true } }, { projection: { slug: 1, dedication: 1 } }).toArray()
      : [];
    const data = { book, collections, pages: pages.filter(p => p.translation?.data) };
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(data));
    return data;
  } finally {
    await client.close();
  }
}

const { book, pages, collections = [] } = await load();
let body = pages;
const range = opt('pages');
if (range) {
  const [from, to] = range.split('-').map(Number);
  body = pages.filter(p => p.page_number >= from && p.page_number <= to);
}

// Front matter as the mint would pass it: the newest edition that has any
const edition = [...(book.editions || [])].reverse().find(e => e.front_matter?.introduction);
// A rewritten, fact-checked draft in scripts/qa/edition-texts/<id>/ wins over
// the stored front matter, so it can be read in a render before it is adopted
const draft = name => { const f = join('scripts', 'qa', 'edition-texts', bookId, `${name}.md`); return existsSync(f) ? readFileSync(f, 'utf-8') : null; };
const options = {
  introduction: draft('introduction') ?? edition?.front_matter?.introduction,
  methodology: draft('methodology') ?? edition?.front_matter?.methodology,
  doi: edition?.doi,
  version: edition?.version,
  frontispiece: await fetchFrontispiece(book),
  credits: editionCredits(book),
  // --dedication "text" previews wording without writing it anywhere
  dedication: opt('dedication') || (opt('dedication-file') ? readFileSync(opt('dedication-file'), 'utf-8') : resolveDedication(book, collections)),
};
// --no-original leaves out the source transcription at the back (each page still links its facsimile)
if (flag('no-original')) options.includeOriginal = false;
if (!flag('no-plates')) {
  const client = new MongoClient(process.env.MONGODB_URI);
  // Caption-pass output (scripts/qa/plate-captions.mjs), when it has been run for this book
  const capFile = join('scripts', 'output', 'plate-captions', `${book.id}.json`);
  const captions = existsSync(capFile) ? JSON.parse(readFileSync(capFile, 'utf-8')).pages : null;
  try { options.illustrations = await fetchIllustrations(client.db('bookstore'), book, { captions }); } finally { await client.close(); }
  console.log(`${options.illustrations.length} illustrations${captions ? `, ${Object.keys(captions).length} captioned pages` : ''}`);
  // The book's own headpieces and tailpieces (scripts/qa/plate-ornaments.mjs), verified ones only
  const ornFile = join('scripts', 'output', 'plate-ornaments', `${book.id}.json`);
  if (existsSync(ornFile)) {
    options.ornaments = await fetchOrnaments(book, JSON.parse(readFileSync(ornFile, 'utf-8')).pages);
    console.log(`${options.ornaments.length} ornaments`);
  }
}
if (!options.frontispiece) console.warn('no frontispiece: cover image missing, unreachable, or not keyed to this book');

const out = opt('out') || join('scripts', 'output', `${book.id}-scholarly${range ? `-p${range}` : ''}.pdf`);
mkdirSync(dirname(out), { recursive: true });
if (flag('keep-typ')) writeFileSync(out.replace(/\.pdf$/, '.typ'), generateTypstSource(book, body, { ...options, illustrations: (options.illustrations || []).map((il, i) => ({ ...il, file: `plate-${i + 1}.jpg` })) }));

const started = Date.now();
const pdf = await generateScholarlyPdf(book, body, options);
writeFileSync(out, pdf);
console.log(`${out}  ${(pdf.length / 1024 / 1024).toFixed(1)} MB  ${body.length} source pages  ${((Date.now() - started) / 1000).toFixed(1)}s`);
