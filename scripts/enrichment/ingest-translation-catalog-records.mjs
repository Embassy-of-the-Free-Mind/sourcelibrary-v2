#!/usr/bin/env node
/**
 * Ingest normalized translation-catalog records into the Mongo
 * `translation_catalogs` collection (the Tier-0 first-translation registry).
 *
 * This is the reusable, source-agnostic writer for NON-LATIN catalogs (issue
 * #2899). Source-specific harvesters (Sefaria, Sacred Books of the East, …)
 * produce a JSONL file of raw records and hand it here; this script validates,
 * normalizes (shared logic with import-translation-catalogs.mjs), and upserts
 * idempotently keyed on (source, author_surname, english_title, translator,
 * year) so re-running never duplicates.
 *
 * Safety: source_language is REQUIRED and validated against an ISO whitelist.
 * The matcher's SOURCE_LANG guard rejects a row with a wrong/empty
 * source_language, but we fail loud at ingest rather than ship a guard-defeating
 * row (the #2892/#2893 false-demote failure class).
 *
 * Records file: a JSON array, or JSONL (one record per line). Each record uses
 * the buildCatalogDoc() schema. Anonymous rows (no resolvable author surname)
 * are DROPPED with a warning — the matcher would never index them anyway.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/enrichment/ingest-translation-catalog-records.mjs <records.jsonl>          # dry-run
 *   node scripts/enrichment/ingest-translation-catalog-records.mjs <records.jsonl> --apply
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';
import { buildCatalogDoc, catalogKey } from '../lib/translation-catalog-record.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';
const APPLY = process.argv.includes('--apply');
const file = process.argv.find((a) => !a.startsWith('--') && /\.(jsonl?|json)$/.test(a));

function loadRecords(path) {
  const text = fs.readFileSync(path, 'utf8').trim();
  if (!text) return [];
  // JSON array?
  if (text[0] === '[') return JSON.parse(text);
  // JSONL
  return text.split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); }
    catch (e) { throw new Error(`bad JSONL at line ${i + 1}: ${e.message}`); }
  });
}

export async function ingestRecords(db, rawRecords, { apply = false, log = console.log } = {}) {
  const col = db.collection('translation_catalogs');
  const stats = { input: rawRecords.length, built: 0, anonymous: 0, invalid: 0, upserted: 0, modified: 0 };
  const seenKeys = new Set();
  const ops = [];

  for (const rec of rawRecords) {
    let doc;
    try {
      doc = buildCatalogDoc(rec);
    } catch (e) {
      stats.invalid++;
      log(`  SKIP (invalid): ${e.message}`);
      continue;
    }
    if (!doc.author_surname || doc.author_surname.length < 3) {
      stats.anonymous++;
      continue; // matcher indexes by surname; anonymous rows can never match
    }
    const key = catalogKey(doc);
    if (seenKeys.has(key)) continue; // de-dup within this batch
    seenKeys.add(key);
    stats.built++;

    const filter = {
      source: doc.source,
      author_surname: doc.author_surname,
      english_title_normalized: doc.english_title_normalized,
      translator: doc.translator,
      pub_year_int: doc.pub_year_int,
    };
    const { imported_at, ...setFields } = doc;
    ops.push({
      updateOne: {
        filter,
        update: { $set: setFields, $setOnInsert: { imported_at: new Date() } },
        upsert: true,
      },
    });
  }

  if (apply && ops.length) {
    for (let i = 0; i < ops.length; i += 1000) {
      const res = await col.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      stats.upserted += res.upsertedCount;
      stats.modified += res.modifiedCount;
    }
  }
  return stats;
}

async function main() {
  if (!MONGODB_URI) { console.error('MONGODB_URI not set. Source .env.production.local first.'); process.exit(1); }
  if (!file) { console.error('Usage: ingest-translation-catalog-records.mjs <records.jsonl> [--apply]'); process.exit(1); }

  const records = loadRecords(file);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | file: ${file} | records: ${records.length}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const stats = await ingestRecords(client.db(MONGODB_DB), records, { apply: APPLY });
    console.log('\n── Result ──');
    console.log(`  input:        ${stats.input}`);
    console.log(`  built (kept): ${stats.built}`);
    console.log(`  dropped anon: ${stats.anonymous}`);
    console.log(`  invalid:      ${stats.invalid}`);
    if (APPLY) {
      console.log(`  upserted new: ${stats.upserted}`);
      console.log(`  modified:     ${stats.modified}`);
      const byLang = await client.db(MONGODB_DB).collection('translation_catalogs')
        .aggregate([{ $group: { _id: '$source_language', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
      console.log('  source_language now:', byLang.map((x) => `${x._id}:${x.n}`).join(', '));
    } else {
      console.log('  (dry-run — nothing written; pass --apply to persist)');
    }
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
