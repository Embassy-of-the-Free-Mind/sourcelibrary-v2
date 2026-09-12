#!/usr/bin/env node
/**
 * Complete the provenance on the BYU / William Gates books.
 *
 * The importers recorded the holding institution in prose
 * (`image_source.contributing_library`) and the archival call number inside
 * `dublin_core.dc_identifier`. Both are true and neither is where the book page
 * looks: `BibliographicInfo.tsx` renders `image_source.shelfmark` for the
 * classmark and `image_source.iiif_manifest` for the link to the source
 * institution's own IIIF, and `IMAGE_LICENSES` matches `license` by ID, so
 * "Public domain" fell through and rendered as the raw string instead of
 * resolving to the licence.
 *
 * Bigger than any of those: `image_source.provider` was set to `byu`, and `byu`
 * was not a member of `ImageSourceProvider` at all. A provider outside the union
 * has no entry in `LIBRARY_PARTNERS`, so it gets no `/libraries/<slug>` page and
 * no credit anywhere on the site — the institution whose photostats these are
 * was invisible. Fixed in `src/lib/types/image-source.ts` and
 * `src/lib/library-partners.ts`; this script fixes the rows.
 *
 * **The general lesson, and the reason this is a script rather than a one-off:**
 * an importer can fill every field it knows about and still leave the record
 * incomplete, because "what the record needs" is defined by the READ path, not
 * by the writer. Check a new provider against `ImageSourceProvider` and
 * `LIBRARY_PARTNERS` before importing under it.
 *
 *   node --env-file=.env.production.local scripts/maintenance/backfill-byu-gates-metadata.mjs [--commit]
 */
import { MongoClient } from 'mongodb';

const COMMIT = process.argv.includes('--commit');
const COLL = 'p15999coll16';
const HOST = 'https://contentdm.lib.byu.edu';

/** Archival call numbers, from each item's own ContentDM record. */
const SHELFMARKS = {
  79957: 'MSS 279, Series 9 Subseries 11 Subseries 2, box 74 folder 3',
  85095: 'MSS 279, Series 9 Subseries 11 Subseries 2',
  83560: 'MSS 279, Series 9 Subseries 11 Subseries 2',
  138175: 'MSS 279, Series 9 Subseries 11 Subseries 2, box 75 folder 1A',
  83705: 'MSS 279, Series 9 Subseries 11 Subseries 2, box 75 folders 6-6A and box 75A folders 7-7A',
};

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books')
  .find({ source_fingerprint: { $regex: `^byu:${COLL}/` } })
  .project({ id: 1, title: 1, source_fingerprint: 1, image_source: 1, visible: 1 })
  .toArray();
console.log(`${COMMIT ? 'WRITING' : 'DRY RUN'} — ${books.length} BYU/Gates books\n`);

for (const b of books) {
  const record = b.source_fingerprint.split('/')[1];
  const shelfmark = SHELFMARKS[record];
  if (!shelfmark) { console.log(`  ${b.id} record ${record}: no shelfmark on file — SKIPPED`); continue; }

  const set = {
    'image_source.provider': 'byu',
    'image_source.provider_name': 'Brigham Young University, L. Tom Perry Special Collections',
    'image_source.contributing_library': 'Brigham Young University, Harold B. Lee Library — L. Tom Perry Special Collections, MSS 279 (William Gates papers)',
    'image_source.shelfmark': shelfmark,
    // `IMAGE_LICENSES` is keyed by id; "Public domain" is the display NAME and
    // matched nothing. BYU asserts public domain in its own item metadata, so
    // this records a SOURCE claim rather than our default.
    'image_source.license': 'publicdomain',
    'image_source.license_url': 'http://lib.byu.edu/about/copyright/special_collections.php',
    'image_source.iiif_manifest': `${HOST}/iiif/2/${COLL}:${record}/manifest.json`,
    'image_source.digitized_by': 'Brigham Young University, L. Tom Perry Special Collections',
    'image_source.attribution': 'Courtesy of L. Tom Perry Special Collections, Harold B. Lee Library, Brigham Young University',
    updated_at: new Date(),
  };

  const before = b.image_source || {};
  const changed = Object.entries(set)
    .filter(([k]) => k.startsWith('image_source.'))
    .filter(([k, v]) => before[k.slice('image_source.'.length)] !== v);
  console.log(`  ${String(b.title).slice(0, 58).padEnd(60)} record ${record}`);
  for (const [k, v] of changed) console.log(`      ${k.slice('image_source.'.length)}: ${JSON.stringify(before[k.slice('image_source.'.length)])} → ${JSON.stringify(String(v).slice(0, 78))}`);
  if (!changed.length) console.log('      (already complete)');

  if (COMMIT && changed.length) {
    const r = await db.collection('books').updateOne({ id: b.id }, { $set: set });
    console.log(`      modified=${r.modifiedCount}`);
  }
}

// Verify against the read path's own requirement rather than against the write:
// a manifest URL that 404s is worse than none, because the book page links it.
console.log('\nchecking the IIIF manifests actually resolve…');
for (const b of books) {
  const record = b.source_fingerprint.split('/')[1];
  if (!SHELFMARKS[record]) continue;
  const url = `${HOST}/iiif/2/${COLL}:${record}/manifest.json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    console.log(`  ${record}: HTTP ${res.status}${res.ok ? '' : '  ← DOES NOT RESOLVE'}`);
  } catch (e) { console.log(`  ${record}: ${e.message.slice(0, 60)}`); }
}

if (!COMMIT) console.log('\nDRY RUN — pass --commit to write.');
await client.close();
