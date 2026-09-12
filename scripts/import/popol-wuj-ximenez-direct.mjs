#!/usr/bin/env node
/**
 * Direct insert of the Popol Vuh manuscript — Newberry Library, Ayer MS 1515
 * (Francisco Ximénez, c. 1701–1703; K'iche' and Spanish in parallel columns,
 * the only surviving witness of the text).
 *
 * The IA item `popol-wuj` is a loose-JPEG upload (no jp2 zip / scandata), so the
 * standard /api/import/ia route cannot page it. This script orders the leaves
 * from the filenames — title, front matter (i–iv), folios 1–56 r/v, then the
 * four "Escolios" leaves — and inserts book + pages HIDDEN, following
 * scripts/import/al-badri-direct.mjs.
 *
 *   node --env-file=.env.production.local scripts/import/popol-wuj-ximenez-direct.mjs [--dry-run]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const IA_ID = 'popol-wuj';
const FINGERPRINT = 'ia:popol-wuj/ayer-ms-1515';

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
function leafKey(name) {
  // 150AyerMS1515pvfl_title_r.jpg | 150AyerMS1515pvfl_iii_v.jpg | 150AyerMS1515pvfl_12_r.jpg | 150AyerMS1515_Escolios_2_v.jpg
  const m = name.match(/(?:pvfl_|_Escolios_)([A-Za-z0-9]+)_([rv])\.jpg$/);
  if (!m) return null;
  const [, leaf, side] = m;
  const sideN = side === 'r' ? 0 : 1;
  if (name.includes('Escolios')) return [3, Number(leaf), sideN];
  if (leaf === 'title') return [0, 0, sideN];
  if (ROMAN[leaf.toLowerCase()]) return [1, ROMAN[leaf.toLowerCase()], sideN];
  if (/^\d+$/.test(leaf)) return [2, Number(leaf), sideN];
  return null;
}
function leafLabel(name) {
  const m = name.match(/(?:pvfl_|_Escolios_)([A-Za-z0-9]+)_([rv])\.jpg$/);
  const [, leaf, side] = m;
  return name.includes('Escolios') ? `Escolios ${leaf}${side}` : leaf === 'title' ? `title ${side}` : `fol. ${leaf}${side}`;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const files = (await (await fetch(`https://archive.org/metadata/${IA_ID}/files`)).json()).result
  .filter((f) => f.format === 'JPEG')
  // The uploader left one accidental duplicate ("…_29_r(1).jpg") beside the real leaf — drop it.
  .filter((f) => !/\(\d+\)\.jpg$/.test(f.name))
  .map((f) => ({ name: f.name, key: leafKey(f.name) }));
const unkeyed = files.filter((f) => !f.key).map((f) => f.name);
if (unkeyed.length) { console.error('Unrecognised filenames:', unkeyed); process.exit(1); }
files.sort((a, b) => cmp(a.key, b.key));
console.log(`${files.length} leaves: ${leafLabel(files[0].name)} … ${leafLabel(files[files.length - 1].name)}`);
const url = (name) => `https://archive.org/download/${IA_ID}/${encodeURIComponent(name)}`;

const head = await fetch(url(files[0].name), { method: 'HEAD', signal: AbortSignal.timeout(20000) });
if (!head.ok) { console.error(`First leaf HEAD failed: ${head.status}`); process.exit(1); }
console.log(`First leaf: ${head.status} ${head.headers.get('content-type')}`);

if (DRY_RUN) { files.slice(0, 8).forEach((f, i) => console.log(`  p${i + 1} ${leafLabel(f.name).padEnd(12)} ${url(f.name)}`)); console.log(`Would insert 1 book + ${files.length} pages`); process.exit(0); }

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
const existing = await db.collection('books').findOne({ $or: [{ source_fingerprint: FINGERPRINT }, { ia_identifier: IA_ID }] }, { projection: { _id: 1 } });
if (existing) { console.log(`Skipping — already imported as ${existing._id}`); await client.close(); process.exit(0); }

const slugBase = 'popol-vuh-ximenez-manuscript-ayer-ms-1515';
let slug = slugBase; for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${slugBase}-${i}`;
const bookId = new ObjectId();
const bookIdStr = bookId.toHexString();
const now = new Date();

const bookDoc = makeBookDoc({
  _id: bookId,
  id: bookIdStr,
  slug,
  title: 'Popol Vuh (Ayer MS 1515) — Empiezan las historias del origen de los indios de esta provincia de Guatemala',
  display_title: 'Popol Vuh — the Ximénez manuscript (Ayer MS 1515)',
  author: 'Francisco Ximénez (copyist and translator); K\'iche\' Maya authors',
  language: 'K\'iche\' Maya',
  published: '1701',
  categories: [],
  ia_identifier: IA_ID,
  thumbnail: url(files[0].name),
  pages_count: files.length,
  pages_ocr: 0,
  pages_translated: 0,
  pages_archived: 0,
  dublin_core: {
    dc_identifier: ['Newberry Library, Ayer MS 1515', `IA:${IA_ID}`],
    dc_source: `https://archive.org/details/${IA_ID}`,
  },
  image_source: {
    provider: 'internet_archive',
    provider_name: 'Internet Archive',
    source_url: `https://archive.org/details/${IA_ID}`,
    identifier: IA_ID,
    license: 'publicdomain',
    contributing_library: 'Newberry Library (Ayer MS 1515), via Internet Archive',
    access_date: now,
  },
  page_count_source: 'file_list',
  notes: 'The only surviving manuscript of the Popol Vuh: Ximénez\'s K\'iche\' transcription with his Spanish translation in parallel columns, c. 1701–1703, Chichicastenango. Leaves ordered title, i–iv, fol. 1–56 r/v, Escolios 1–4 from the IA filenames. Page images are the IA JPEGs (no jp2/scandata on the item).',
  status: 'draft',
  hidden: true,
  visible: false,
  source_fingerprint: FINGERPRINT,
  normalized_title: 'popol vuh ximenez manuscript ayer ms 1515',
  normalized_author: 'francisco ximenez',
  created_at: now,
  updated_at: now,
});
await db.collection('books').insertOne(bookDoc);
console.log(`Inserted book ${bookIdStr} slug=${slug}`);

const pageDocs = files.map((f, i) => {
  const pid = new ObjectId();
  return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: bookIdStr, page_number: i + 1, photo: url(f.name), thumbnail: url(f.name), photo_original: url(f.name), created_at: now, updated_at: now });
});
const r = await db.collection('pages').insertMany(pageDocs, { ordered: false });
console.log(`Inserted ${r.insertedCount} pages. https://sourcelibrary.org/book/${bookIdStr}`);
await client.close();
