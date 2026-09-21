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
 *   node scripts/qa/render-scholarly-pdf.mjs <bookId> [--pages 120-180] [--refresh] [--keep-typ] [--out path.pdf] [--dedication text]
 *
 * The book + pages are cached under scripts/output/scholarly-cache/ after the
 * first fetch, so design iteration needs no database (pass --refresh to
 * re-fetch). --pages limits the BODY to a page_number range for fast renders;
 * front and back matter are always included. Requires `typst` on PATH.
 */
import { MongoClient } from 'mongodb';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { generateScholarlyPdf, generateTypstSource, fetchFrontispiece, editionCredits, resolveDedication } from '../lib/scholarly-typst.mjs';

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
const options = {
  introduction: edition?.front_matter?.introduction,
  methodology: edition?.front_matter?.methodology,
  doi: edition?.doi,
  version: edition?.version,
  frontispiece: await fetchFrontispiece(book),
  credits: editionCredits(book),
  // --dedication "text" previews wording without writing it anywhere
  dedication: opt('dedication') || resolveDedication(book, collections),
};
if (!options.frontispiece) console.warn('no frontispiece: cover image missing, unreachable, or not keyed to this book');

const out = opt('out') || join('scripts', 'output', `${book.id}-scholarly${range ? `-p${range}` : ''}.pdf`);
mkdirSync(dirname(out), { recursive: true });
if (flag('keep-typ')) writeFileSync(out.replace(/\.pdf$/, '.typ'), generateTypstSource(book, body, options));

const started = Date.now();
const pdf = await generateScholarlyPdf(book, body, options);
writeFileSync(out, pdf);
console.log(`${out}  ${(pdf.length / 1024 / 1024).toFixed(1)} MB  ${body.length} source pages  ${((Date.now() - started) / 1000).toFixed(1)}s`);
