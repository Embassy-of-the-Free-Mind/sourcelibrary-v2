#!/usr/bin/env node
/**
 * Backfill dhash on gallery_images rows that don't have one (issue #2113).
 *
 * Reads gallery_images where `dhash` is unset and `extracted_url` is set,
 * downloads the cropped image from R2, computes the 64-bit dhash via
 * scripts/lib/dhash.mjs, and writes it back.
 *
 * Idempotent: skips rows that already have a dhash. Safe to re-run.
 * Concurrency-safe: each $set is independent.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-gallery-dhash.mjs --dry-run
 *   node scripts/maintenance/backfill-gallery-dhash.mjs --apply --limit=500
 *   node scripts/maintenance/backfill-gallery-dhash.mjs --apply --concurrency=30
 */

import { MongoClient } from 'mongodb';
import { computeDHash } from '../lib/dhash.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = args.includes('--dry-run') || !APPLY;
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const LIMIT = parseInt(getArg('limit', '0'), 10); // 0 = no limit
const CONCURRENCY = parseInt(getArg('concurrency', '20'), 10);
const FETCH_TIMEOUT_MS = 30_000;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Hint: set -a; source .env.production.local; set +a');
  process.exit(1);
}

async function fetchImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function processOne(gi) {
  // Accept thumbnail_url as a fallback only if extracted_url is empty/missing.
  // Empty strings are common (~1.5% of rows) and would otherwise cycle forever
  // through the find().limit() loop because the row keeps matching the
  // dhash-unset filter — see the sentinel-write logic below.
  const url =
    (typeof gi.extracted_url === 'string' && gi.extracted_url) ||
    (typeof gi.thumbnail_url === 'string' && gi.thumbnail_url) ||
    null;
  if (!url) return { id: gi.id, error: 'no-source' };
  try {
    const buf = await fetchImage(url);
    const dhash = await computeDHash(buf);
    return { id: gi.id, dhash };
  } catch (e) {
    return { id: gi.id, error: e?.message ?? String(e) };
  }
}

async function processPool(items, concurrency, fn) {
  let idx = 0;
  const results = [];
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const coll = db.collection('gallery_images');

  // Filter: rows missing a dhash field altogether. Errored runs write
  // `dhash: null` as a sentinel so failed rows don't reappear in subsequent
  // find().limit() iterations — without that, every empty-URL row would cycle
  // forever, blocking real candidates from being seen.
  const filter = {
    dhash: { $exists: false },
    extracted_url: { $exists: true, $ne: null },
  };

  const remaining = await coll.countDocuments(filter);
  const totalWithDhash = await coll.countDocuments({ dhash: { $exists: true } });
  const totalRows = await coll.estimatedDocumentCount();
  console.log(`gallery_images: ${totalRows} total, ${totalWithDhash} with dhash`);
  console.log(`remaining to backfill: ${remaining}${LIMIT ? ` (will process up to ${LIMIT})` : ''}`);
  console.log(`mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}, concurrency: ${CONCURRENCY}`);

  const target = LIMIT > 0 ? Math.min(LIMIT, remaining) : remaining;
  if (target === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  const BATCH = 200; // pull this many rows at a time, then process in pool
  let processed = 0, ok = 0, errors = 0;
  const errorSamples = [];
  const t0 = Date.now();

  while (processed < target) {
    const chunkSize = Math.min(BATCH, target - processed);
    const chunk = await coll
      .find(filter, { projection: { _id: 0, id: 1, extracted_url: 1, thumbnail_url: 1 } })
      .limit(chunkSize)
      .toArray();
    if (chunk.length === 0) break;

    const results = await processPool(chunk, CONCURRENCY, processOne);

    if (!DRY_RUN) {
      const ops = [];
      for (const r of results) {
        if (r.error) {
          // Write a sentinel so this row stops matching the `dhash: { $exists: false }`
          // filter on the next iteration. Without this, errored rows cycle forever and
          // the script never advances to other candidates.
          ops.push({
            updateOne: {
              filter: { id: r.id },
              update: { $set: { dhash: null, dhash_error: r.error.slice(0, 120) } },
            },
          });
          continue;
        }
        ops.push({
          updateOne: {
            filter: { id: r.id },
            update: { $set: { dhash: r.dhash }, $unset: { dhash_error: '' } },
          },
        });
      }
      if (ops.length) await coll.bulkWrite(ops, { ordered: false });
    }

    for (const r of results) {
      if (r.error) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push(`${r.id}: ${r.error}`);
      } else ok++;
    }

    processed += chunk.length;
    const elapsed = (Date.now() - t0) / 1000;
    const rate = processed / elapsed;
    const etaSec = ((target - processed) / Math.max(rate, 0.1)).toFixed(0);
    process.stdout.write(
      `\r  processed=${processed}/${target} ok=${ok} err=${errors} rate=${rate.toFixed(1)}/s eta=${etaSec}s   `,
    );
  }

  console.log('\nDone.');
  if (errorSamples.length > 0) {
    console.log('Sample errors:');
    for (const e of errorSamples) console.log('  ' + e);
  }

  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
