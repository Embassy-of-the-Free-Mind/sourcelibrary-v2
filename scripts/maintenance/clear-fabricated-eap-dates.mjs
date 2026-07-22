#!/usr/bin/env node
/**
 * Clear the fabricated `1700` publication date on the British Library EAP
 * Tibetan manuscript cohort (issue #3307).
 *
 * WHAT IS WRONG
 * 1,446 undated Bhutanese manuscripts (EAP105 / EAP310 / EAP039, imported
 * April 2026) were stamped `published: "1700"` / `year: 1700` at import time.
 * The source has no such date: the EAP IIIF manifests carry no Date field at
 * all, and the catalogue records give only multi-century ranges —
 *   EAP105  12th century - Early 20th century   (726 books)
 *   EAP310  1650 - 1950                         (436 books)
 *   EAP039  14th century - 20th century         (283 books)
 * `1700` is the midpoint of a 300-to-800 year window presented as an exact
 * year. It is published to readers and, worse, as machine-readable
 * `citation_publication_date` on ~1,445 public book pages.
 *
 * WHAT THIS DOES
 *   --tier=citation (default)  unset `published` only.
 *       Stops the fabricated bibliographic claim: no `citation_publication_date`,
 *       no "(1700)" in the title/description/og:title. Leaves `year` intact, so
 *       ngrams / timeline / year filters are UNCHANGED.
 *   --tier=full                also unset `year`.
 *       The honest representation of an undated manuscript. Note the cost:
 *       build-ngrams.mjs requires a numeric year, so ~279K pages leave the
 *       ngram corpus and the timeline. Deliberate choice, not a side effect.
 *
 * Either way it records `field_provenance.year` so the correction is auditable
 * and the original value is recoverable from the backup written to
 * scripts/output/.
 *
 * SAFETY
 *   - Dry-run by default. `--apply` is required to write.
 *   - Always writes a full backup of the affected docs first.
 *   - Scoped by a conjunction that cannot match anything else:
 *     provider 'bl' AND year 1700 AND an eap.bl.uk manifest URL.
 *   - `--revert=<backup.json>` restores the previous values.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/clear-fabricated-eap-dates.mjs                 # dry run
 *   node scripts/maintenance/clear-fabricated-eap-dates.mjs --apply
 *   node scripts/maintenance/clear-fabricated-eap-dates.mjs --tier=full --apply
 *   node scripts/maintenance/clear-fabricated-eap-dates.mjs --revert=scripts/output/eap-dates-backup-<ts>.json --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const TIER = (args.find(a => a.startsWith('--tier='))?.split('=')[1] || 'citation').toLowerCase();
const REVERT = args.find(a => a.startsWith('--revert='))?.split('=')[1];

if (!['citation', 'full'].includes(TIER)) {
  console.error(`Unknown --tier=${TIER}. Use "citation" or "full".`);
  process.exit(1);
}

const FILTER = {
  'image_source.provider': 'bl',
  'image_source.source_url': { $regex: '^https://eap\\.bl\\.uk/' },
  year: 1700,
};

/** Catalogue-level creation ranges, recorded as provenance (not as a claim). */
const EAP_RANGE = {
  EAP105: '12th century - Early 20th century',
  EAP310: '1650 - 1950',
  EAP039: '14th century - 20th century',
};

const projectOf = (url = '') => url.match(/archive-file\/(EAP\d+)/)?.[1] || null;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set. Source .env.production.local first.'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  if (REVERT) return revert(client, books);

  const docs = await books.find(FILTER, {
    projection: { _id: 1, slug: 1, title: 1, published: 1, year: 1, visible: 1, 'image_source.source_url': 1 },
  }).toArray();

  console.log(`Matched ${docs.length} books (tier=${TIER}, apply=${APPLY})`);
  if (!docs.length) { await client.close(); return; }

  const byProject = {};
  for (const d of docs) {
    const p = projectOf(d.image_source?.source_url) || 'unknown';
    byProject[p] = (byProject[p] || 0) + 1;
  }
  console.log('  by project:', Object.entries(byProject).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('  visible   :', docs.filter(d => d.visible).length);
  console.log('  distinct published values:',
    JSON.stringify([...new Set(docs.map(d => d.published))].slice(0, 5)));
  console.log('\nWill unset:', TIER === 'full' ? 'published, year' : 'published');
  console.log('Sample of affected pages:');
  for (const d of docs.slice(0, 3)) {
    console.log(`  https://sourcelibrary.org/book/${d.slug}  published=${JSON.stringify(d.published)} year=${d.year}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
    await client.close();
    return;
  }

  // Backup BEFORE writing.
  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(outDir, `eap-dates-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(
    { tier: TIER, filter: FILTER, written_at: stamp,
      docs: docs.map(d => ({ _id: String(d._id), published: d.published, year: d.year })) }, null, 1));
  console.log(`\nBackup written: ${backupPath}`);

  let modified = 0;
  for (const d of docs) {
    const proj = projectOf(d.image_source?.source_url);
    const unset = TIER === 'full' ? { published: '', year: '' } : { published: '' };
    const res = await books.updateOne({ _id: d._id }, {
      $unset: unset,
      $set: {
        'field_provenance.year': {
          source: 'import_placeholder_cleared',
          method: 'eap_source_has_no_date',
          previous_published: d.published ?? null,
          previous_year: d.year ?? null,
          eap_project: proj,
          eap_creation_range: proj ? EAP_RANGE[proj] ?? null : null,
          tier: TIER,
          issue: 3307,
          date: new Date().toISOString(),
          script: 'clear-fabricated-eap-dates.mjs',
        },
      },
    });
    modified += res.modifiedCount;
  }
  // Report what the driver actually observed, not what it hoped for.
  console.log(`\nmodifiedCount total: ${modified} of ${docs.length}`);
  const remaining = await books.countDocuments(FILTER);
  console.log(`Still matching filter (expect 0 for tier=full, ${docs.length} for tier=citation): ${remaining}`);
  console.log('\nNEXT: re-sync Supabase catalog + purge CDN so public pages pick this up.');
  await client.close();
}

async function revert(client, books) {
  const data = JSON.parse(fs.readFileSync(REVERT, 'utf8'));
  console.log(`Reverting ${data.docs.length} books from ${REVERT} (tier was ${data.tier}, apply=${APPLY})`);
  if (!APPLY) { console.log('DRY RUN — nothing written.'); await client.close(); return; }
  const { ObjectId } = await import('mongodb');
  let n = 0;
  for (const d of data.docs) {
    const set = {};
    if (d.published != null) set.published = d.published;
    if (d.year != null) set.year = d.year;
    if (!Object.keys(set).length) continue;
    const res = await books.updateOne({ _id: new ObjectId(d._id) },
      { $set: set, $unset: { 'field_provenance.year': '' } });
    n += res.modifiedCount;
  }
  console.log(`modifiedCount total: ${n} of ${data.docs.length}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
