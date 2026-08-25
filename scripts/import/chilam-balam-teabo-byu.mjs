#!/usr/bin/env node
/**
 * The Chilam Balam of Teabo — BYU, MSS 279 (William Gates papers), box 74
 * folder 3; ContentDM p15999coll16 compound object 79957.
 *
 * WHY THIS ONE, AND WHY ONLY THIS ONE
 * -----------------------------------
 * BYU's own record calls it an "Original manuscript, loosely bound", genre
 * `Manuscripts`, 43 p., dated 1621 — and the images bear that out: colour
 * photographs of the actual paper, one leaf per frame, the archival label
 * ("MSS 279 / Box G- / Folder 27") written on the edge of the first leaf, which
 * opens *"Chun Pahal Vtah Vpecħil vyan…"* and carries "8 enero de 1621" and the
 * Maya year "año 1116" in the scribe's hand. BYU marks it "Public domain" in its
 * own item metadata, so `license` below records a SOURCE claim, not our default.
 *
 * Three other Chilam Balam books sit in the same ContentDM collection and are
 * NOT imported here, because each is an image problem before it is an
 * acquisition. Recorded so the next session does not import them blind:
 *
 *   Chilam Balam de Nah          record 85095, 64 frames
 *     A photostat NEGATIVE — white ink on dark grey. Legible to a human, but it
 *     would reach the reader inverted and the OCR would be asked to read a
 *     negative. Needs an inversion step first.
 *
 *   Lunario maya Chilam Balam or Ixil   record 83560, 133 frames
 *     MIXED, and the catalogue says so if you read it ("Photocopies;
 *     Typescripts"). The early frames are positive photostats of the manuscript;
 *     p. 100 is a Gates TYPESCRIPT — a 20th-century typed transcription in
 *     Yucatec Maya, not the leaf. Two different artefacts, and probably two
 *     books; the boundary has not been found.
 *
 *   Chilam Balam of Calkiní      record 138175, 8 frames
 *     The worst of the three and the one most likely to be imported by mistake,
 *     because 8 frames looks like a small easy book. It is a photostat negative
 *     of Princeton's Garrett-Gates Mesoamerican Manuscript no. 5 carrying FOUR
 *     manuscript pages per frame, and on each frame the upper two are MIRRORED.
 *     BYU's catalogue says 24 p. against 8 frames, which is the tell. Needs
 *     split + invert + mirror before it is worth anything to a reader.
 *
 * There is also record 85910, a photostat negative of the Chilam Balam of
 * Tizimin (76 p.) — not on the acquisition list, but we hold Tizimin only as
 * Edmonson's modern English translation, so it is a real gap.
 *
 *   node --env-file=.env.production.local scripts/import/chilam-balam-teabo-byu.mjs [--dry-run]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const COLLECTION = 'p15999coll16';
const RECORD = '79957';
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

// BYU's catalogue says 43 p.; the object carries 44 frames (the extra is the
// binding's outer leaf). A count far from that means the object came back
// truncated, and 44 rows pointing at a half-fetched object is worse than none.
if (pages.length < 40) { console.error(`Expected ~44 frames, got ${pages.length} — refusing to import a truncated object.`); process.exit(1); }
console.log(`${pages.length} frames: ${pages[0].title} … ${pages[pages.length - 1].title}`);

// Positive control: the first frame must actually fetch before we insert 44 rows
// pointing at URLs nobody has tried. A probe is worthless until it has returned
// "found" at least once.
const head = await fetch(pageUrl(pages[0].ptr), { method: 'HEAD', signal: AbortSignal.timeout(20000) });
if (!head.ok) { console.error(`First frame HEAD failed: ${head.status}`); process.exit(1); }
console.log(`First frame: ${head.status} ${head.headers.get('content-type')} ${pageUrl(pages[0].ptr)}`);

if (DRY_RUN) {
  pages.slice(0, 6).forEach((p, i) => console.log(`  frame ${String(i + 1).padStart(3)} ${String(p.title).padEnd(10)} ${pageUrl(p.ptr)}`));
  console.log(`Would insert 1 book + ${pages.length} pages (hidden, needs_splitting: false)`);
  process.exit(0);
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const existing = await db.collection('books').findOne({ source_fingerprint: FINGERPRINT }, { projection: { _id: 1 } });
if (existing) { console.log(`Skipping — already imported as ${existing._id}`); await client.close(); process.exit(0); }

const slugBase = 'chilam-balam-de-teabo-1621';
let slug = slugBase;
for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { _id: 1 } }); i++) slug = `${slugBase}-${i}`;

const bookId = new ObjectId();
const bookIdStr = bookId.toHexString();
const now = new Date();

const bookDoc = makeBookDoc({
  _id: bookId,
  id: bookIdStr,
  slug,
  title: 'Chilam Balam of Teabo',
  display_title: 'Chilam Balam de Teabo (1621)',
  author: 'Anonymous Yucatec Maya scribes',
  language: 'Yucatec Maya',
  original_language: 'Yucatec Maya',
  text_role: 'original',
  published: '1621',
  categories: [],
  collections: ['maya', 'mesoamerican', 'americas'],
  thumbnail: pageUrl(pages[0].ptr),
  pages_count: pages.length,
  pages_ocr: 0,
  pages_translated: 0,
  pages_archived: 0,
  // One leaf per frame — no spread splitting, unlike the Kaua Maler plates.
  needs_splitting: false,
  dublin_core: {
    dc_identifier: [
      'BYU, L. Tom Perry Special Collections, MSS 279 (William Gates papers), Series 9 Subseries 11 Subseries 2, box 74 folder 3',
      `ContentDM:${COLLECTION}/${RECORD}`,
    ],
    dc_source: ITEM_URL,
    dc_date: ['1621'],
  },
  image_source: {
    provider: 'byu',
    provider_name: 'Brigham Young University, L. Tom Perry Special Collections',
    source_url: ITEM_URL,
    identifier: `${COLLECTION}/${RECORD}`,
    // BYU states "Public domain" in its own item metadata — a source claim, not our default.
    license: 'Public domain',
    license_url: 'http://lib.byu.edu/about/copyright/special_collections.php',
    contributing_library: 'Brigham Young University, Harold B. Lee Library (MSS 279, William Gates papers)',
    access_date: now,
  },
  page_count_source: 'contentdm_compound_object',
  notes: [
    'One of the Books of Chilam Balam, the Yucatec Maya manuscript books in which Maya scribes kept prophecy, chronicle, ritual, medicine and calendar in their own language and the Latin alphabet through the colonial period.',
    'BYU catalogues this item as an "Original manuscript, loosely bound" — the leaves themselves, not a photostat, which is unusual: most of the Gates material is photographic. Scholars refer to it as the "Lost Book of Chilam Balam of Teabo".',
    'The first leaf opens "Chun Pahal Vtah Vpecħil vyan…" and carries the date "8 enero de 1621" beside the Maya year "año 1116" in the scribe\'s own hand.',
    'Held in the William Gates papers, the collection assembled by the Maya scholar and publisher William E. Gates (1863–1940), whose photographs are also the only surviving witness to most of the Chilam Balam de Kaua — held here separately.',
  ].join(' '),
  status: 'draft',
  hidden: true,
  visible: false,
  source_fingerprint: FINGERPRINT,
  normalized_title: 'chilam balam of teabo',
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
console.log(`Inserted ${r.insertedCount} pages (hidden). https://sourcelibrary.org/book/${bookIdStr}`);
console.log('QA, then process, then make visible — see .claude/docs/import-workflow.md.');
await client.close();
