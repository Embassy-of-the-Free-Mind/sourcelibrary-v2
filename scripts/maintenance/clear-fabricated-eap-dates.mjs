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

/**
 * Researched production-date ranges, keyed by `books.author` — which for this
 * cohort holds the HOLDING COLLECTION, and maps 1:1 onto the EAP sub-collections.
 *
 * These come from the EAP project descriptions and the scholarship behind them
 * (digitisation led by Dr Karma Phuntsho, Aris Trust Centre, Oxford), NOT from
 * the item records, which carry only 300-800 year spans. Each entry cites its
 * basis so a future reader can audit or improve it.
 *
 * `earliest`/`latest` are PRODUCTION-date bounds for the manuscript. Where only
 * a founding date is known it is a floor, not a date — marked confidence 'low'.
 * Where nothing usable was found, both are null and nothing is written.
 *
 * Deliberately NOT derived from the texts themselves: translation-derived dates
 * in this corpus are unreliable (a "Female Fire Sheep year" in one translation
 * turned out to have no ལུག/ལོ in the underlying Tibetan at all — see #3307).
 */
const COLLECTION_DATING = {
  'Gangtey Monastery Collection': {
    earliest: 1613, latest: 1699, confidence: 'medium',
    basis: 'Monastery founded 1613 by Gyalse Pema Thinley; EAP039 states the collection was "mostly written in the 17th century as a funerary tribute to the founder"',
    source: 'https://eap.bl.uk/project/EAP039',
  },
  'Neyphug Monastery': {
    earliest: 1600, latest: 1699, confidence: 'medium',
    basis: 'EAP310: Kanjur created in the 17th century during the time of the second Neyphug lama; monastery founded 1550 by gter ston Ngag dbang Grags pa (1525-1599)',
    source: 'https://eap.bl.uk/project/EAP310',
  },
  'Tshamdrak Monastery': {
    earliest: 1682, latest: 1799, confidence: 'medium',
    basis: 'EAP310: Tshamdrak founded by Ngawang Drupa (1682-1748) — the collection cannot predate its founder',
    source: 'https://eap.bl.uk/project/EAP310',
  },
  'Thadrak Temple': {
    earliest: 1700, latest: 1799, confidence: 'medium',
    basis: 'EAP item catalogue, "Dates of original material: probably 18th century" (uniform across the EAP310/1/1 Kanjur sub-collection)',
    source: 'https://eap.bl.uk/archive-file/EAP310-1-1-1',
  },
  'Drametse Monastery Collection': {
    earliest: 1511, latest: 1930, confidence: 'low',
    basis: 'Monastery founded 1511 by Ani Choten Zangmo (granddaughter of Pema Lingpa, 1450-1521) — a FLOOR, not a production date. Upper bound from the EAP105 catalogue range ("Early 20th century")',
    source: 'https://eap.bl.uk/project/EAP105',
  },
  'Ogyen Choling Collection': {
    earliest: null, latest: null, confidence: 'none',
    basis: 'No production date published. The EAP105 catalogue range (12th century - Early 20th century) is too wide to be worth recording as a bound',
    source: 'https://eap.bl.uk/project/EAP105',
  },
  'Phurdrup Gonpa': {
    earliest: null, latest: null, confidence: 'none',
    basis: 'No founding or production date located. Contents are gter ma of Nyangral Nyi ma ’Od zer (1124-1192) and Sangye Lingpa (1340-1396) — composition dates, not production dates',
    source: 'https://eap.bl.uk/project/EAP310',
  },
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set. Source .env.production.local first.'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  if (REVERT) return revert(client, books);

  const docs = await books.find(FILTER, {
    projection: { _id: 1, slug: 1, title: 1, author: 1, published: 1, year: 1, visible: 1, 'image_source.source_url': 1 },
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
  // Researched production ranges, by holding collection.
  const byCollection = {};
  for (const d of docs) {
    const k = d.author || '(none)';
    byCollection[k] = (byCollection[k] || 0) + 1;
  }
  console.log('\nResearched date ranges to be written:');
  let willRange = 0;
  for (const [name, n] of Object.entries(byCollection).sort((a, b) => b[1] - a[1])) {
    const dt = COLLECTION_DATING[name];
    if (dt?.earliest != null && dt?.latest != null) {
      willRange += n;
      console.log(`  ${String(n).padStart(4)}  ${name.padEnd(30)} -> ${dt.earliest}-${dt.latest}  (${dt.confidence})`);
    } else {
      console.log(`  ${String(n).padStart(4)}  ${name.padEnd(30)} -> (no usable range; nothing written)`);
    }
  }
  console.log(`  => ${willRange} of ${docs.length} books (${(willRange / docs.length * 100).toFixed(0)}%) get a researched range`);

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

  let modified = 0, ranged = 0;
  for (const d of docs) {
    const proj = projectOf(d.image_source?.source_url);
    const dating = COLLECTION_DATING[d.author] || null;
    const unset = TIER === 'full' ? { published: '', year: '' } : { published: '' };
    const set = {
      'field_provenance.year': {
        source: 'import_placeholder_cleared',
        method: 'eap_source_has_no_date',
        previous_published: d.published ?? null,
        previous_year: d.year ?? null,
        eap_project: proj,
        eap_creation_range: proj ? EAP_RANGE[proj] ?? null : null,
        collection: d.author ?? null,
        range_basis: dating?.basis ?? null,
        range_source: dating?.source ?? null,
        range_confidence: dating?.confidence ?? 'none',
        tier: TIER,
        issue: 3307,
        date: new Date().toISOString(),
        script: 'clear-fabricated-eap-dates.mjs',
      },
    };
    // Only write bounds where research actually produced them.
    if (dating?.earliest != null && dating?.latest != null) {
      set.year_earliest = dating.earliest;
      set.year_latest = dating.latest;
      ranged++;
    }
    const res = await books.updateOne({ _id: d._id }, { $unset: unset, $set: set });
    modified += res.modifiedCount;
  }
  console.log(`\nyear_earliest/year_latest written on: ${ranged}`);
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
