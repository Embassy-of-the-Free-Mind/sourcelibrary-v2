#!/usr/bin/env node

/**
 * Apply the issue #3002 collection reorganization (migration-order steps 2+3):
 *
 *   RENAME    renaissance-natural-philosophy display name, which today is
 *             byte-identical to natural-philosophy's ("Natural Philosophy &
 *             Science" twice on one page).
 *   REPARENT  promote classical-/renaissance-philosophy to roots (retire the
 *             thin `philosophy` umbrella); fold architecture, arabic-medicine,
 *             pharmacopeias, education, aesthetic-theory under their halls;
 *             fix the music-sound inversion (179 books under a 10-book
 *             exhibit) by adding art-illustrated as primary parent.
 *   VISIBILITY unhide the region roots (east-asia, south-asia,
 *             world-traditions); hide the retired `philosophy` umbrella.
 *   MERGE     theosophy → theosophical-tradition;
 *             science-mathematics → mathematics;
 *             hermetica-sacred → hermetica + gnostic-texts.
 *             Merges only re-tag books.collections ($addToSet targets, $pull
 *             source, bump updated_at) and retire the source doc
 *             (visible:false + merged_into). NOTHING is deleted.
 *   FEATURED  seed featured:true + featured_order from the (soon retired)
 *             hardcoded CURATED_PATHWAYS array so /collections can go
 *             data-driven (#3002 E).
 *
 * ⚠ ORDER MATTERS: deploy src/lib/collection-redirects.json to prod BEFORE
 *   running with --apply — merged slugs 404 until the 308 redirects are live.
 *   The redirect map and this script's MERGES table must stay in sync
 *   (audit-collections.mjs check #8 enforces it).
 *
 * After --apply:
 *   1. node scripts/workers/sync-books-catalog.mjs        (Supabase grid lags Mongo)
 *   2. book_count snapshots refresh via scripts/workers/sync-worker.mjs (cron)
 *   3. purge CDN (collection pages carry 24h edge cache) — npm run deploy:prod does this
 *
 * Dry-run by default; --apply writes. A full-doc backup of every touched
 * collection doc + the affected book ids is written to scripts/output/
 * before any write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reorganize-collections.mjs
 *   node scripts/maintenance/reorganize-collections.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RENAMES = [
  { slug: 'renaissance-natural-philosophy', name: 'Renaissance Natural Philosophy' },
];

// null = promote to root ($unset parent)
const REPARENTS = [
  { slug: 'classical-philosophy', parent: null },
  { slug: 'renaissance-philosophy', parent: null },
  { slug: 'architecture', parent: ['art-illustrated'] },
  { slug: 'renaissance-architecture', parent: ['architecture'] },
  { slug: 'arabic-medicine', parent: ['medicine'] },
  { slug: 'pharmacopeias', parent: ['medicine'] },
  { slug: 'education', parent: ['literature'] },
  { slug: 'aesthetic-theory', parent: ['art-illustrated'] },
  { slug: 'music-sound', parent: ['art-illustrated', 'the-human-condition'] },
];

const VISIBILITY = [
  { slug: 'east-asia', visible: true },
  { slug: 'south-asia', visible: true },
  { slug: 'world-traditions', visible: true },
  // Retired umbrella: its two children are promoted above; the public URL
  // 308s via src/lib/collection-redirects.json. Its 85 direct book
  // memberships are kept (harmless on a hidden collection) — flagged for
  // curator re-shelving in the issue.
  { slug: 'philosophy', visible: false },
];

// Must stay in sync with src/lib/collection-redirects.json.
const MERGES = [
  { from: 'theosophy', into: ['theosophical-tradition'] },
  { from: 'science-mathematics', into: ['mathematics'] },
  { from: 'hermetica-sacred', into: ['hermetica', 'gnostic-texts'] },
];

// Snapshot of CURATED_PATHWAYS (src/app/collections/page.tsx) at migration
// time — seeds the data-driven featured flag. Order = display order.
const FEATURED = [
  'courts-of-wonder', 'maps-of-the-invisible', 'rosicrucian-moment',
  'grimoire-tradition', 'women-of-the-secret-tradition', 'alchemical-emblem',
  'ficinos-florence', 'dance-of-death', 'bestiary-tradition',
  'ancient-egyptian', 'art-of-memory', 'behmenist-underground',
  'visions-ecstasies', 'yokai-oni', 'sumerian-mesopotamian',
  'forbidden-books', 'music-of-the-spheres', 'rudolf-prague',
  'contemplative-traditions', 'newtons-other-science',
  'sympathy-of-all-things', 'kepler-fludd-debate', 'neoplatonism',
  'the-cosmos', 'indic-traditions', 'chinese-classics', 'great-manuscripts',
  'herbalism', 'jungs-library', 'kloss-collection',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Set MONGODB_URI before running. Hint: set -a; source .env.production.local; set +a');
    process.exit(1);
  }

  // Guard: the redirect map must cover every merge source + the retired umbrella.
  const redirectMap = JSON.parse(
    readFileSync(path.join(__dirname, '../../src/lib/collection-redirects.json'), 'utf8')
  );
  const needRedirect = [...MERGES.map(m => m.from), 'philosophy'];
  const missingRedirects = needRedirect.filter(s => !redirectMap[s]);
  if (missingRedirects.length) {
    console.error(`ABORT: src/lib/collection-redirects.json is missing entries for: ${missingRedirects.join(', ')}`);
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const collections = db.collection('collections');
  const books = db.collection('books');

  const touchedSlugs = [
    ...RENAMES.map(r => r.slug),
    ...REPARENTS.map(r => r.slug),
    ...VISIBILITY.map(v => v.slug),
    ...MERGES.flatMap(m => [m.from, ...m.into]),
    ...FEATURED,
  ];
  const existing = await collections.find({ slug: { $in: touchedSlugs } }).toArray();
  const bySlug = new Map(existing.map(d => [d.slug, d]));

  const missing = [...new Set(touchedSlugs)].filter(s => !bySlug.has(s));
  if (missing.length) {
    console.warn(`NOTE: slugs not found in prod (skipped): ${missing.join(', ')}\n`);
  }

  // ---- Plan ----
  const colOps = [];
  const plan = [];

  for (const r of RENAMES) {
    const doc = bySlug.get(r.slug);
    if (!doc || doc.name === r.name) continue;
    plan.push(`RENAME     ${r.slug}: "${doc.name}" → "${r.name}"`);
    colOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { name: r.name, updated_at: new Date() } } } });
  }

  for (const r of REPARENTS) {
    const doc = bySlug.get(r.slug);
    if (!doc) continue;
    const current = JSON.stringify(doc.parent ?? null);
    const wanted = JSON.stringify(r.parent);
    if (current === wanted) continue;
    plan.push(`REPARENT   ${r.slug}: ${current} → ${wanted}`);
    const update = r.parent === null
      ? { $unset: { parent: '' }, $set: { updated_at: new Date() } }
      : { $set: { parent: r.parent, updated_at: new Date() } };
    colOps.push({ updateOne: { filter: { _id: doc._id }, update } });
  }

  for (const v of VISIBILITY) {
    const doc = bySlug.get(v.slug);
    if (!doc || doc.visible === v.visible) continue;
    plan.push(`VISIBILITY ${v.slug}: ${doc.visible} → ${v.visible}`);
    colOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { visible: v.visible, updated_at: new Date() } } } });
  }

  const mergeBookIds = {};
  for (const m of MERGES) {
    const doc = bySlug.get(m.from);
    if (!doc) continue;
    const ids = await books.find({ collections: m.from }).project({ _id: 1 }).map(d => d._id).toArray();
    mergeBookIds[m.from] = ids;
    plan.push(`MERGE      ${m.from} → ${m.into.join(' + ')} (${ids.length} books re-tagged, doc retired)`);
    if (!doc.merged_into) {
      colOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { visible: false, merged_into: m.into[0], retired_at: new Date(), updated_at: new Date() } },
        },
      });
    }
  }

  for (let i = 0; i < FEATURED.length; i++) {
    const doc = bySlug.get(FEATURED[i]);
    if (!doc) continue;
    if (doc.featured === true && doc.featured_order === i) continue;
    plan.push(`FEATURED   ${FEATURED[i]}: featured_order=${i}`);
    colOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { featured: true, featured_order: i, updated_at: new Date() } } } });
  }

  console.log(plan.length ? plan.join('\n') : 'Nothing to do — all changes already applied.');
  console.log(`\n${colOps.length} collection-doc updates, ${Object.values(mergeBookIds).reduce((a, b) => a + b.length, 0)} book re-tags planned.`);

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write changes.');
    console.log('⚠ Before --apply: the redirect map must already be DEPLOYED to prod.');
    await client.close();
    return;
  }

  // ---- Backup, then write ----
  const outDir = path.join(__dirname, '../output');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(outDir, `collections-reorg-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ collections: existing, mergeBookIds }, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  if (colOps.length) {
    const res = await collections.bulkWrite(colOps);
    console.log(`Collection docs: ${res.modifiedCount} modified.`);
  }

  for (const m of MERGES) {
    const ids = mergeBookIds[m.from];
    if (!ids || !ids.length) continue;
    // Two passes: $addToSet and $pull can't target the same field in one update.
    const add = await books.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { collections: { $each: m.into } }, $set: { updated_at: new Date() } }
    );
    const pull = await books.updateMany(
      { _id: { $in: ids } },
      { $pull: { collections: m.from }, $set: { updated_at: new Date() } }
    );
    const remaining = await books.countDocuments({ collections: m.from });
    console.log(`Merge ${m.from}: +tags on ${add.modifiedCount}, -tag on ${pull.modifiedCount}, remaining tagged: ${remaining} (expect 0).`);
  }

  console.log('\nDone. Next steps:');
  console.log('  1. node scripts/workers/sync-books-catalog.mjs   (Supabase collection grid)');
  console.log('  2. node scripts/maintenance/audit-collections.mjs (verify invariants)');
  console.log('  3. CDN purge on next deploy (npm run deploy:prod handles it)');

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
