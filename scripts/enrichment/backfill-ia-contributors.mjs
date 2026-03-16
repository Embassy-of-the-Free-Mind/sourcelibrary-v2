#!/usr/bin/env node
/**
 * Backfill contributing_library and sponsor for existing IA books.
 *
 * Tries the IA metadata API first, falls back to IIIF manifest if that fails.
 * The IA metadata API is unreliable (frequent timeouts), so IIIF is critical.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/backfill-ia-contributors.mjs
 *   set -a; source .env.production.local; set +a; node scripts/backfill-ia-contributors.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/backfill-ia-contributors.mjs --limit=50
 *   set -a; source .env.production.local; set +a; node scripts/backfill-ia-contributors.mjs --iiif-only
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const iiifOnly = args.includes('--iiif-only');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 0;
const CONCURRENCY = 10;

/** Strip HTML tags from IA metadata values (some contributors have anchor tags) */
function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').trim();
}

/** Try IA metadata API (fast when working, often times out) */
async function fetchViaMetadataAPI(identifier) {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}/metadata`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.result || data;
    if (!result || Object.keys(result).length === 0) return null;
    const rawContributor = typeof result.contributor === 'string' ? result.contributor : null;
    const rawSponsor = typeof result.sponsor === 'string' ? result.sponsor : null;
    return {
      contributor: rawContributor ? stripHtml(rawContributor) : null,
      sponsor: rawSponsor ? stripHtml(rawSponsor) : null,
    };
  } catch {
    return null;
  }
}

/** Try IIIF manifest (more reliable, different servers) */
async function fetchViaIIIF(identifier) {
  try {
    const res = await fetch(`https://iiif.archive.org/iiif/${identifier}/manifest.json`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const manifest = await res.json();
    const meta = manifest.metadata || [];
    let contributor = null, sponsor = null;
    for (const m of meta) {
      let label = m.label;
      if (label && typeof label === 'object') label = Object.values(label).flat()[0];
      if (Array.isArray(label)) label = label[0];
      let value = m.value;
      if (value && typeof value === 'object') value = Object.values(value).flat()[0];
      if (Array.isArray(value)) value = value[0];
      value = String(value).replace(/<[^>]*>/g, '').trim();
      if (label === 'contributor') contributor = value;
      if (label === 'sponsor') sponsor = value;
    }
    return { contributor, sponsor };
  } catch {
    return null;
  }
}

/** Fetch contributor data — metadata API first, IIIF fallback */
async function fetchIAContributor(identifier) {
  if (!iiifOnly) {
    const meta = await fetchViaMetadataAPI(identifier);
    if (meta && (meta.contributor || meta.sponsor)) return meta;
  }
  // Fallback (or primary in --iiif-only mode)
  return await fetchViaIIIF(identifier);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find IA books without contributing_library
  const filter = {
    'image_source.provider': 'internet_archive',
    'image_source.identifier': { $exists: true },
    'image_source.contributing_library': { $exists: false },
    status: { $ne: 'deleted' },
  };

  const total = await db.collection('books').countDocuments(filter);
  console.log(`Found ${total} IA books without contributing_library`);
  if (dryRun) console.log('DRY RUN — no writes');

  const cursor = db.collection('books')
    .find(filter, { projection: { id: 1, title: 1, ia_identifier: 1, 'image_source.identifier': 1, _id: 0 } })
    .sort({ read_count: -1 });

  if (limit > 0) cursor.limit(limit);

  const books = await cursor.toArray();
  console.log(`Processing ${books.length} books...`);

  let updated = 0, skipped = 0, failed = 0;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (book) => {
      const identifier = book.ia_identifier || book.image_source?.identifier;
      if (!identifier) { skipped++; return; }

      const meta = await fetchIAContributor(identifier);
      if (!meta) { failed++; return; }

      if (!meta.contributor && !meta.sponsor) {
        skipped++;
        return;
      }

      const update = {};
      if (meta.contributor) update['image_source.contributing_library'] = meta.contributor;
      if (meta.sponsor) update['image_source.sponsor'] = meta.sponsor;

      if (dryRun) {
        console.log(`  ${book.title?.slice(0, 50)} → ${meta.contributor || '(none)'} / ${meta.sponsor || '(none)'}`);
        updated++;
        return;
      }

      await db.collection('books').updateOne({ id: book.id }, { $set: update });
      updated++;
    }));

    const pct = Math.round(((i + batch.length) / books.length) * 100);
    process.stdout.write(`\r  ${i + batch.length}/${books.length} (${pct}%) — ${updated} updated, ${skipped} skipped, ${failed} failed`);
  }

  console.log(`\n\nDone: ${updated} updated, ${skipped} skipped (no data), ${failed} failed (fetch error)`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
