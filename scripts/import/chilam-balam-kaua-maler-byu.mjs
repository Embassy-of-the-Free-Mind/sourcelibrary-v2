#!/usr/bin/env node
/**
 * Teobert Maler's 1887 photographs of the Chilam Balam de Kaua — BYU, MSS 279
 * (William Gates papers), ContentDM p15999coll16 compound object 83705.
 *
 * WHY THIS MATTERS: the Kaua manuscript was 282 pages / 141 folios. Only 19
 * folios survive — Princeton, Garrett-Gates Mesoamerican Manuscripts no. 6,
 * being manuscript pages 5–6, 9–14, 21–22 and 161–188 (Bolles 2003 [1975]:vi;
 * Gibson & Glass 1975:383; Weeks 1990:78). The other 122 folios vanished from
 * Manuel Cepeda Peraza's library in Mérida shortly after 1918 and have never
 * been located. Maler photographed the book in 1887, while it was still whole
 * and in Bishop Carrillo y Ancona's collection, so these plates are the only
 * surviving image of most of the text. Gates later made a positive photostat
 * of Maler's photos (Harvard, Tozzer Library); that is the copy Bricker &
 * Miram transcribed for their 2002 Tulane edition (2002:3).
 *
 * We already hold the surviving original leaves as a separate book (the IA
 * item `libro-de-chilam-balam-de-kaua`, 19 folios). This import is the
 * companion: the photographic record of the whole.
 *
 * RIGHTS: Maler died in 1917, so the photographs are public domain outright —
 * no reliance on Bridgeman for the reproduction. BYU independently marks the
 * object "Public domain" in its own item metadata, so `license` below records
 * a SOURCE claim, not our default.
 *
 * SPREADS: each plate photographs an open book, so one image carries two
 * manuscript pages (see the ink foliation, e.g. plate 70 = pp. 138–139). The
 * book is inserted with `needs_splitting: true` — Phase 3.1 must crop the
 * spreads before OCR, or readers get two-page transcriptions (#2449).
 *
 *   node --env-file=.env.production.local scripts/import/chilam-balam-kaua-maler-byu.mjs [--dry-run]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const COLLECTION = 'p15999coll16';
const RECORD = '83705';
const HOST = 'https://contentdm.lib.byu.edu';
const ITEM_URL = `${HOST}/digital/collection/${COLLECTION}/id/${RECORD}`;
const FINGERPRINT = `byu:${COLLECTION}/${RECORD}`;

/** Full-size IIIF derivative for one ContentDM page pointer. */
const pageUrl = (ptr) => `${HOST}/digital/iiif/${COLLECTION}/${ptr}/full/full/0/default.jpg`;

/** Walk ContentDM's nested compound-object tree and collect its <page> nodes in order. */
function collectPages(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) collectPages(v, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'page') { for (const p of (Array.isArray(v) ? v : [v])) out.push(p); }
      else collectPages(v, out);
    }
  }
  return out;
}

const infoUrl = `${HOST}/digital/bl/dmwebservices/index.php?q=dmGetCompoundObjectInfo/${COLLECTION}/${RECORD}/json`;
const res = await fetch(infoUrl, { signal: AbortSignal.timeout(30000) });
if (!res.ok) { console.error(`ContentDM compound-object fetch failed: ${res.status}`); process.exit(1); }
const pages = collectPages(await res.json())
  .map((p) => ({ ptr: String(p.pageptr), title: p.pagetitle }))
  .filter((p) => p.ptr && p.ptr !== 'undefined');

if (pages.length < 100) { console.error(`Expected ~144 plates, got ${pages.length} — refusing to import a truncated object.`); process.exit(1); }
console.log(`${pages.length} plates: ${pages[0].title} … ${pages[pages.length - 1].title}`);

// Positive control: the first plate must actually fetch before we insert 144 rows
// pointing at URLs nobody has tried (a probe is worthless until it has returned "found").
const head = await fetch(pageUrl(pages[0].ptr), { method: 'HEAD', signal: AbortSignal.timeout(20000) });
if (!head.ok) { console.error(`First plate HEAD failed: ${head.status}`); process.exit(1); }
console.log(`First plate: ${head.status} ${head.headers.get('content-type')} ${pageUrl(pages[0].ptr)}`);

if (DRY_RUN) {
  pages.slice(0, 6).forEach((p, i) => console.log(`  plate ${String(i + 1).padStart(3)} ${String(p.title).padEnd(10)} ${pageUrl(p.ptr)}`));
  console.log(`Would insert 1 book + ${pages.length} pages (needs_splitting: true)`);
  process.exit(0);
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const existing = await db.collection('books').findOne({ source_fingerprint: FINGERPRINT }, { projection: { _id: 1 } });
if (existing) { console.log(`Skipping — already imported as ${existing._id}`); await client.close(); process.exit(0); }

const slugBase = 'chilam-balam-de-kaua-maler-photographs-1887';
let slug = slugBase;
for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${slugBase}-${i}`;

const bookId = new ObjectId();
const bookIdStr = bookId.toHexString();
const now = new Date();

const bookDoc = makeBookDoc({
  _id: bookId,
  id: bookIdStr,
  slug,
  title: 'Libro de Chilam Balam de Kaua — Tratado de las 7 planetas ytr de medecinarvm, sygno, de sangrar (Maler photographs, 1887)',
  display_title: 'Chilam Balam de Kaua — Maler\'s 1887 photographs',
  author: 'Anonymous Yucatec Maya scribes',
  language: 'Yucatec Maya',
  original_language: 'Yucatec Maya',
  text_role: 'original',
  published: '1789',
  categories: [],
  collections: ['maya', 'mesoamerican', 'americas'],
  thumbnail: pageUrl(pages[0].ptr),
  pages_count: pages.length,
  pages_ocr: 0,
  pages_translated: 0,
  pages_archived: 0,
  // One plate = one opening, so the spread splitter must run before OCR (#2449).
  needs_splitting: true,
  dublin_core: {
    dc_identifier: [
      'BYU, L. Tom Perry Special Collections, MSS 279 (William Gates papers), Series 9 Subseries 11 Subseries 2, box 75 folder 6-6A, box 75A folder 7-7A',
      `ContentDM:${COLLECTION}/${RECORD}`,
    ],
    dc_source: ITEM_URL,
    dc_creator: ['Teobert Maler (photographer, 1887)'],
    dc_date: ['1789 (manuscript); 1887 (photographs)'],
  },
  image_source: {
    provider: 'byu',
    provider_name: 'Brigham Young University, L. Tom Perry Special Collections',
    source_url: ITEM_URL,
    identifier: `${COLLECTION}/${RECORD}`,
    // `IMAGE_LICENSES` is keyed by ID, so this has to be the id and not the
    // display name — "Public domain" matched nothing and rendered raw. BYU
    // asserts public domain in its own item metadata, so it is a SOURCE claim.
    license: 'publicdomain',
    license_url: 'http://lib.byu.edu/about/copyright/special_collections.php',
    // The rest of what `BibliographicInfo.tsx` actually renders. The holding
    // institution is prose in `contributing_library`; the CLASSMARK belongs in
    // `shelfmark`, and the manifest lets a reader check a leaf against the
    // source institution's own copy. An importer can fill every field it knows
    // about and still leave the record incomplete — what a record NEEDS is
    // defined by the read path.
    iiif_manifest: `${HOST}/iiif/2/${COLLECTION}:${RECORD}/manifest.json`,
    digitized_by: 'Brigham Young University, L. Tom Perry Special Collections',
    attribution: 'Courtesy of L. Tom Perry Special Collections, Harold B. Lee Library, Brigham Young University',
    shelfmark: 'MSS 279, Series 9 Subseries 11 Subseries 2, box 75 folders 6-6A and box 75A folders 7-7A',
    contributing_library: 'Brigham Young University, Harold B. Lee Library — L. Tom Perry Special Collections, MSS 279 (William Gates papers)',
    access_date: now,
  },
  page_count_source: 'contentdm_compound_object',
  notes: [
    'Teobert Maler photographed the Chilam Balam de Kaua in Mérida in 1887, from the collection of Bishop Crescencio Carrillo y Ancona; his signature and the date appear on the mount of the first plate.',
    'The manuscript itself ran to 282 pages (141 folios). Only 19 folios survive — Princeton University Library, Garrett-Gates Mesoamerican Manuscripts no. 6, being manuscript pages 5-6, 9-14, 21-22 and 161-188. The remaining 122 folios disappeared from the Cepeda Peraza library in Mérida shortly after 1918 and have not been located since, so for most of the book these photographs are the only surviving witness.',
    'Each plate photographs an open book, so one image carries two manuscript pages; the ink foliation is visible at the head of each plate (plate 70 = pp. 138-139).',
    'Companion to the surviving original leaves, held separately from the Internet Archive item libro-de-chilam-balam-de-kaua.',
    'Gates made a positive photostat of Maler\'s photographs (Harvard, Tozzer Library); that copy is the source Bricker & Miram transcribed for An Encounter of Two Worlds (Tulane, 2002).',
  ].join(' '),
  status: 'draft',
  hidden: true,
  visible: false,
  source_fingerprint: FINGERPRINT,
  normalized_title: 'libro de chilam balam de kaua maler photographs',
  normalized_author: 'anonymous yucatec maya scribes',
  created_at: now,
  updated_at: now,
});

await db.collection('books').insertOne(bookDoc);
console.log(`Inserted book ${bookIdStr} slug=${slug}`);

const pageDocs = pages.map((p, i) => {
  const pid = new ObjectId();
  const url = pageUrl(p.ptr);
  return makePageDoc({
    _id: pid,
    id: pid.toHexString(),
    book_id: bookIdStr,
    page_number: i + 1,
    photo: url,
    thumbnail: url,
    photo_original: url,
    created_at: now,
    updated_at: now,
  });
});
const r = await db.collection('pages').insertMany(pageDocs, { ordered: false });
console.log(`Inserted ${r.insertedCount} pages. https://sourcelibrary.org/book/${bookIdStr}`);
await client.close();
