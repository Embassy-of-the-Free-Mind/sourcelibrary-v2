#!/usr/bin/env node

/**
 * Backfill the `kind` enum on every doc in the `collections` collection.
 *
 * Issue #3002: /collections mixes five different kinds of thing on one axis.
 * `kind` makes the axis explicit so the front door can render bands:
 *
 *   tradition  — subject taxonomy (Alchemy, Kabbalah, Theology)
 *   region     — geographic/cultural corpus (East Asia, South Asia)
 *   provenance — a historical library / list / press (Jung, Kloss, Aldine)
 *   exhibit    — small editorial essay-collection (Cannabis, Sibyls)
 *   artwork    — image-first sets (today's collection_type: 'visual_art')
 *
 * Assignment precedence:
 *   1. Explicit table below (the 57 roots + re-tagged children from #3002B)
 *   2. collection_type === 'visual_art'          → artwork
 *   3. type === 'curated'                        → exhibit
 *   4. any ancestor is a region-kind collection  → region
 *   5. everything else                           → tradition
 *
 * Pure metadata, reversible (`kind` is unread until the /collections
 * kind-banded layout ships). Legacy `type` / `collection_type` are left
 * untouched. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-collection-kind.mjs
 *   node scripts/maintenance/backfill-collection-kind.mjs --apply
 */

import { MongoClient } from 'mongodb';

const KINDS = ['tradition', 'region', 'provenance', 'exhibit', 'artwork'];

// Explicit assignments from the issue #3002 section-B table. Slugs absent
// from prod are tolerated (logged) so the script stays re-runnable.
const EXPLICIT = {
  // tradition — top-level subject halls (incl. the two promoted philosophy
  // children and roots that #3002 folds under other halls; folding is done
  // by reorganize-collections.mjs, kind stays 'tradition' either way)
  ...Object.fromEntries([
    'theology', 'literature', 'natural-philosophy', 'sacred-texts', 'medicine',
    'mysticism', 'hermetica', 'alchemy', 'astrology', 'magic',
    'secret-societies', 'psychology', 'kabbalah', 'history-political-thought',
    'demonology', 'art-illustrated', 'philosophy', 'classical-philosophy',
    'renaissance-philosophy', 'renaissance-natural-philosophy',
    'architecture', 'renaissance-architecture', 'arabic-medicine',
    'pharmacopeias', 'education', 'aesthetic-theory',
    'theosophy', 'theosophical-tradition', 'theosophical-society',
    'mathematics', 'science-mathematics', 'gnostic-texts', 'hermetica-sacred',
    'music-sound', 'miscellany',
  ].map(s => [s, 'tradition'])),

  // region — geographic/cultural corpora
  ...Object.fromEntries([
    'east-asia', 'south-asia', 'world-traditions', 'middle-east-africa',
    'americas',
  ].map(s => [s, 'region'])),

  // provenance — historical libraries, lists, presses, partner corpora
  ...Object.fromEntries([
    'shwep', 'bhutan', 'index-librorum-prohibitorum', 'mahabharata-bori',
    'atharvaveda-pandit', 'javanese-kraton', 'east-asian-history-of-health',
    'indonesian-manuscripts', 'balinese-narrative-drawings',
    'jungs-library', 'kloss-collection', 'aldine-press',
  ].map(s => [s, 'provenance'])),

  // exhibit — small editorial essay-collections
  ...Object.fromEntries([
    'cannabis-western-record', 'prehistory-of-ai', 'hogwarts-library',
    'signs-in-the-sky', 'chariots-of-the-gods', 'taken-up-to-the-heavens',
    'spirits-of-the-air', 'eros-esoteric', 'gardens-festivals-ephemeral',
    'druids-megaliths', 'sibyls', 'sacred-plants', 'norse-antiquities',
    'microscopy', 'games', 'yoga', 'the-human-condition', 'connoisseurship',
  ].map(s => [s, 'exhibit'])),

  // artwork — image-first sets
  ...Object.fromEntries([
    'leonardo-drawings', 'alchemists-studio', 'art-of-altdorfer-baldung',
    'venetian-mystery', 'hashika-e-measles-prints', 'book-of-the-dead',
  ].map(s => [s, 'artwork'])),
};

function parentsOf(doc) {
  if (!doc.parent) return [];
  return Array.isArray(doc.parent) ? doc.parent.filter(Boolean) : [doc.parent];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Set MONGODB_URI before running. Hint: set -a; source .env.production.local; set +a');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const collections = db.collection('collections');

  const docs = await collections
    .find({})
    .project({ slug: 1, name: 1, parent: 1, type: 1, collection_type: 1, kind: 1, tenantId: 1 })
    .toArray();
  console.log(`Found ${docs.length} collection docs.\n`);

  const bySlug = new Map(docs.map(d => [d.slug, d]));

  const missingExplicit = Object.keys(EXPLICIT).filter(s => !bySlug.has(s));
  if (missingExplicit.length) {
    console.warn(`NOTE: ${missingExplicit.length} explicit slugs not in prod: ${missingExplicit.join(', ')}\n`);
  }

  // "Descends from a region" — walk parent chains with cycle protection.
  const regionMemo = new Map();
  function descendsFromRegion(slug, seen = new Set()) {
    if (regionMemo.has(slug)) return regionMemo.get(slug);
    if (seen.has(slug)) return false; // cycle guard
    seen.add(slug);
    const doc = bySlug.get(slug);
    if (!doc) return false;
    const result = parentsOf(doc).some(p =>
      EXPLICIT[p] === 'region' || descendsFromRegion(p, seen)
    );
    regionMemo.set(slug, result);
    return result;
  }

  function classify(doc) {
    if (EXPLICIT[doc.slug]) return { kind: EXPLICIT[doc.slug], via: 'explicit' };
    if (doc.collection_type === 'visual_art') return { kind: 'artwork', via: 'collection_type' };
    if (doc.type === 'curated') return { kind: 'exhibit', via: 'type:curated' };
    if (descendsFromRegion(doc.slug)) return { kind: 'region', via: 'region-ancestor' };
    return { kind: 'tradition', via: 'default' };
  }

  const summary = Object.fromEntries(KINDS.map(k => [k, 0]));
  summary.unchanged = 0;
  const viaCounts = {};
  const ops = [];

  for (const doc of docs.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''))) {
    const { kind, via } = classify(doc);
    if (!KINDS.includes(kind)) throw new Error(`Bad kind ${kind} for ${doc.slug}`);
    if (doc.kind === kind) {
      summary.unchanged++;
      continue;
    }
    summary[kind]++;
    viaCounts[via] = (viaCounts[via] || 0) + 1;
    console.log(`  ${String(doc.slug).padEnd(36)} ${(doc.kind || '(none)').padEnd(12)} → ${kind.padEnd(11)} [${via}]`);
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { kind, kind_updated_at: new Date() } },
      },
    });
  }

  console.log('\nSummary:');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log('By rule:', JSON.stringify(viaCounts));
  console.log(`\n${ops.length} docs need updates.`);

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write changes.');
  } else if (ops.length > 0) {
    const res = await collections.bulkWrite(ops);
    console.log(`\nWrote: ${res.modifiedCount} modified.`);
    const stillMissing = await collections.countDocuments({ kind: { $nin: KINDS } });
    console.log(`Docs still without a valid kind: ${stillMissing} (expect 0).`);
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
