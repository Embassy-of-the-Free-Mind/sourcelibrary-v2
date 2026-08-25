#!/usr/bin/env node
/**
 * The Books of Chilam Balam in the William Gates papers — BYU, MSS 279,
 * ContentDM collection p15999coll16.
 *
 * The Books of Chilam Balam are the Yucatec Maya manuscript books in which Maya
 * scribes kept prophecy, chronicle, ritual, medicine and the calendar in their
 * own language, written in the Latin alphabet, through the colonial period. Most
 * survive in one copy or in none: what William Gates (1863–1940) photographed
 * and photostatted is, for several of them, the only witness there is.
 *
 * ## Read the IMAGES before importing a record, not the catalogue
 *
 * Four records were on the acquisition list and the catalogue makes them look
 * alike — same collection, same rights, all "Mayan languages". They are four
 * different physical things, and three of them are an image problem before they
 * are an acquisition. The manifest below records what each one actually is,
 * because that is the fact you cannot get from the metadata:
 *
 *   Teabo      the ORIGINAL manuscript, in colour, one leaf per frame
 *   Nah        a photostat NEGATIVE — white ink on dark ground, one page a frame
 *   Ixil       positive photostats of the manuscript, THEN Gates's typescript
 *              of the same text, in one folder
 *   Calkiní    a negative carrying FOUR pages per frame, upper two INVERTED
 *   Tizimin    the same four-up negative shape as Calkiní
 *
 * A negative is legible to a person and to the OCR, so Nah imports as it stands
 * and the book record says what it is; inverting the tones is a later
 * improvement, not a precondition. The four-up records are different in kind —
 * four pages in one frame, half of them upside down, is not a book anybody can
 * read — and they go through `scripts/import/chilam-balam-fourup-byu.mjs`, which
 * splits the frames before importing them.
 *
 * THE TELL, and the reason the frame counts below are checked: the catalogue
 * gives Tizimin as "76 p." and its compound object carries 19 frames. 76 = 19x4.
 * That ratio is the four-up shape announcing itself, and the tripwire below is
 * what turned it up — it was in this manifest as an ordinary negative until the
 * count refused.
 *
 *   node --env-file=.env.production.local scripts/import/chilam-balam-gates-byu.mjs [--record=<id>] [--dry-run]
 *
 * Idempotent: a record already imported (matched on `source_fingerprint`) is
 * skipped, so re-running after adding a manifest entry is safe.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (process.argv.find((a) => a.startsWith('--record=')) || '').split('=')[1];
const COLLECTION = 'p15999coll16';
const HOST = 'https://contentdm.lib.byu.edu';

/**
 * `frames` is the count seen on 2026-08-25 and is a TRIPWIRE, not a target: a
 * compound object that comes back materially short has been truncated by the
 * API, and rows pointing at a half-fetched object are worse than no rows.
 */
const RECORDS = [
  {
    record: '79957',
    frames: 44,
    slug: 'chilam-balam-de-teabo-1621',
    title: 'Chilam Balam of Teabo',
    display_title: 'Chilam Balam de Teabo (1621)',
    published: '1621',
    call: 'MSS 279 Series 9 Subseries 11 Subseries 2, box 74 folder 3',
    dc_date: ['1621'],
    notes: [
      'BYU catalogues this item as an "Original manuscript, loosely bound" — the leaves themselves, not a photostat, which is unusual: most of the Gates material is photographic.',
      'Scholars refer to it as the "Lost Book of Chilam Balam of Teabo".',
      'The first leaf opens "Chun Pahal Vtah Vpecħil vyan…" and carries the date "8 enero de 1621" beside the Maya year "año 1116" in the scribe\'s own hand.',
    ],
  },
  {
    record: '85095',
    frames: 64,
    slug: 'chilam-balam-de-nah',
    title: 'Chilam Balam de Nah',
    display_title: 'Chilam Balam de Nah (18th century)',
    published: '1700-1800',
    call: 'MSS 279 Series 9 Subseries 11 Subseries 2',
    dc_date: ['1700-1800 (manuscript)'],
    negative: true,
    notes: [
      'The Chilam Balam de Nah is one of the medical and calendrical books of the Chilam Balam tradition, from Teabo in Yucatán.',
      'BYU holds it as a photostat NEGATIVE of the manuscript — the text reads as white ink on a dark ground, one manuscript page per frame. It is legible as it stands; the tones are reversed because that is what the surviving copy is.',
      'A separate BYU record (85889) holds Gates\'s typed transcription of the same manuscript, and another (37409) his typed recipes and index for it; neither is imported here.',
    ],
  },
  {
    record: '83560',
    frames: 133,
    slug: 'chilam-balam-de-ixil-lunario-maya',
    title: 'Lunario maya Chilam Balam or Ixil',
    display_title: 'Chilam Balam de Ixil — manuscript and Gates transcription',
    published: '1500-1940',
    call: 'MSS 279 Series 9 Subseries 11 Subseries 2',
    dc_date: ['undated (colonial manuscript); 1930s (transcription)'],
    notes: [
      'The Chilam Balam of Ixil, a Yucatec Maya book of the moon, the calendar and medicine.',
      'ONE ARCHIVAL FOLDER HOLDING TWO THINGS, and the frames run in that order: roughly frames 1-85 are positive photostats of the manuscript itself, in the scribe\'s hand; from about frame 86 the folder continues with William Gates\'s own typed transcription of the same text, headed "Ixil - 9", "Ixil - 10" and so on, with plant and remedy names typed in red.',
      'The boundary is approximate and was found by reading the frames, not from the catalogue, which records only the genres "Photocopies; Typescripts". Anyone quoting from this book should look at the leaf: a page from the second half is Gates\'s twentieth-century reading of the manuscript, not the manuscript.',
    ],
  },
];

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

async function framesFor(record) {
  const url = `${HOST}/digital/bl/dmwebservices/index.php?q=dmGetCompoundObjectInfo/${COLLECTION}/${record}/json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`compound-object fetch ${res.status}`);
  return collectPages(await res.json())
    .map((p) => ({ ptr: String(p.pageptr), title: p.pagetitle }))
    .filter((p) => p.ptr && p.ptr !== 'undefined');
}

const targets = ONLY ? RECORDS.filter((r) => r.record === ONLY) : RECORDS;
if (!targets.length) { console.error(`No manifest entry for record ${ONLY}`); process.exit(2); }

const client = DRY_RUN ? null : new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
if (client) await client.connect();
const db = client?.db('bookstore');

for (const spec of targets) {
  const itemUrl = `${HOST}/digital/collection/${COLLECTION}/id/${spec.record}`;
  const fingerprint = `byu:${COLLECTION}/${spec.record}`;
  console.log(`\n=== ${spec.title} (record ${spec.record})`);

  if (db) {
    const existing = await db.collection('books').findOne({ source_fingerprint: fingerprint }, { projection: { id: 1 } });
    if (existing) { console.log(`  already imported as ${existing.id} — skipping`); continue; }
  }

  let frames;
  try { frames = await framesFor(spec.record); } catch (e) { console.error(`  FAILED: ${e.message}`); continue; }

  // Tripwire, not a target — see RECORDS above.
  if (frames.length < spec.frames * 0.9) {
    console.error(`  Expected ~${spec.frames} frames, got ${frames.length} — refusing a truncated object.`);
    continue;
  }
  console.log(`  ${frames.length} frames (manifest says ${spec.frames})`);

  // Positive control: a probe is worthless until it has returned "found" once.
  const head = await fetch(pageUrl(frames[0].ptr), { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  if (!head.ok) { console.error(`  First frame HEAD failed: ${head.status}`); continue; }
  console.log(`  first frame: ${head.status} ${head.headers.get('content-type')}`);

  if (DRY_RUN) {
    console.log(`  would insert 1 book + ${frames.length} pages (hidden)  slug=${spec.slug}`);
    continue;
  }

  let slug = spec.slug;
  for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { id: 1 } }); i++) slug = `${spec.slug}-${i}`;

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const now = new Date();

  const bookDoc = makeBookDoc({
    _id: bookId,
    id: bookIdStr,
    slug,
    title: spec.title,
    display_title: spec.display_title,
    author: 'Anonymous Yucatec Maya scribes',
    language: 'Yucatec Maya',
    original_language: 'Yucatec Maya',
    text_role: 'original',
    published: spec.published,
    categories: [],
    collections: ['maya', 'mesoamerican', 'americas'],
    thumbnail: pageUrl(frames[0].ptr),
    pages_count: frames.length,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: 0,
    // One manuscript page per frame across this manifest. The Kaua Maler plates
    // are the exception and live in their own importer with needs_splitting.
    needs_splitting: false,
    dublin_core: {
      dc_identifier: [
        `BYU, L. Tom Perry Special Collections, ${spec.call} (William Gates papers)`,
        `ContentDM:${COLLECTION}/${spec.record}`,
      ],
      dc_source: itemUrl,
      dc_date: spec.dc_date,
    },
    image_source: {
      provider: 'byu',
      provider_name: 'Brigham Young University, L. Tom Perry Special Collections',
      source_url: itemUrl,
      identifier: `${COLLECTION}/${spec.record}`,
      // BYU states "Public domain" in its own item metadata — a SOURCE claim,
      // not our default.
      license: 'Public domain',
      license_url: 'http://lib.byu.edu/about/copyright/special_collections.php',
      contributing_library: 'Brigham Young University, Harold B. Lee Library (MSS 279, William Gates papers)',
      access_date: now,
    },
    page_count_source: 'contentdm_compound_object',
    notes: [
      'One of the Books of Chilam Balam, the Yucatec Maya manuscript books in which Maya scribes kept prophecy, chronicle, ritual, medicine and the calendar in their own language and the Latin alphabet through the colonial period.',
      ...spec.notes,
      'Held in the William Gates papers, the collection assembled by the Maya scholar and publisher William E. Gates (1863-1940), whose photographs are also the only surviving witness to most of the Chilam Balam de Kaua, held here separately.',
    ].join(' '),
    status: 'draft',
    hidden: true,
    visible: false,
    source_fingerprint: fingerprint,
    normalized_title: spec.title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(),
    normalized_author: 'anonymous yucatec maya scribes',
    created_at: now,
    updated_at: now,
  });

  await db.collection('books').insertOne(bookDoc);

  const pageDocs = frames.map((f, i) => {
    const pid = new ObjectId();
    const url = pageUrl(f.ptr);
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
  console.log(`  inserted book ${bookIdStr} + ${r.insertedCount} pages (hidden)`);
  console.log(`  https://sourcelibrary.org/book/${bookIdStr}`);
}

if (client) await client.close();
console.log('\nQA, then process, then make visible — see .claude/docs/import-workflow.md.');
