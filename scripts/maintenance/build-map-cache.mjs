#!/usr/bin/env node
/**
 * Build the /explore/map data cache (system_config._id = 'map_data').
 *
 * WHY THIS EXISTS
 * ---------------
 * The map page (src/app/explore/map/page.tsx) reads a pre-computed snapshot
 * from system_config.map_data and only falls back to a live aggregate when the
 * cache is empty. Nothing was writing that doc — the snapshot was frozen on
 * 2026-04-04, so every book geocoded since (publication, author, and the new
 * `origin` tradition layer) was invisible. This script recomputes the snapshot
 * from `books.locations[]` and is meant to run on a cron (Hetzner) so the map
 * stays current.
 *
 * It mirrors the grouping in page.tsx's live-compute fallback exactly, so the
 * cached and uncached code paths produce identical shapes.
 *
 * Reads `books` from the nightly Parquet mirror (scripts/lib/mirror.mjs, #5189): a map that
 * is up to a day behind is fine, and the walk no longer leaves Atlas (12.5 MB/run measured
 * 2026-10-06). The write still goes to Atlas. `--live` reads Atlas instead; with no fresh
 * mirror the script fails rather than silently falling back.
 *
 * Usage:
 *   node scripts/maintenance/build-map-cache.mjs [--dry-run] [--live]
 */

import { MongoClient } from 'mongodb';
import { openMirror } from '../lib/mirror.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIVE = process.argv.includes('--live');
// Was 200: Venice, Basel, Leipzig, Paris… exceeded it, so their pins and lists
// were silently capped (2026-10-06). Keep in step with explore/map/page.tsx.
const MAX_BOOKS_PER_GROUP = 2000;

async function main() {
  console.log(`Build Map Cache — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let books;
  if (LIVE) {
    books = await db.collection('books').find(
      { visible: true, 'locations.0': { $exists: true } },
      { projection: { id: 1, year: 1, locations: 1 } },
    ).toArray();
    console.log('Source: Atlas (--live)');
  } else {
    // Same predicate as the live query: `visible` is the boolean true (not a truthy string),
    // and `locations.0` exists — a non-empty array.
    const mirror = openMirror({ collections: ['books'], columns: { books: ['id', 'year', 'visible', 'locations'] } });
    console.log(`Source: ${mirror.describe()}`);
    books = mirror.query(`
      SELECT id, year, locations FROM books
      WHERE json_type(visible) = 'BOOLEAN' AND visible::BOOLEAN
        AND json_type(locations) = 'ARRAY' AND json_array_length(locations) > 0`);
  }

  const groups = new Map();
  const byType = {};
  let totalBooks = 0;

  for (const book of books) {
    const locs = book.locations;
    if (!Array.isArray(locs)) continue;

    for (const loc of locs) {
      if (!loc.lat || !loc.lng || !loc.city) continue;
      const key = `${loc.city}|${loc.type}|${loc.lat.toFixed(2)}|${loc.lng.toFixed(2)}`;

      if (!groups.has(key)) {
        groups.set(key, {
          city: loc.city, country: loc.country ?? null,
          lat: loc.lat, lng: loc.lng, type: loc.type, books: [],
        });
      }
      const group = groups.get(key);
      if (group.books.length < MAX_BOOKS_PER_GROUP) {
        // id + year only: titles, covers and translation state are looked up
        // per clicked place by /api/explore/map/city. Carrying titles here put
        // the snapshot at 14.5 MB of Mongo's 16 MB document limit (2026-10-06).
        group.books.push({ id: book.id, year: book.year ?? null });
      }
      byType[loc.type] = (byType[loc.type] || 0) + 1;
      totalBooks++;
    }
  }

  const data = {
    locations: Array.from(groups.values()),
    stats: { total_books: totalBooks, total_locations: groups.size, by_type: byType },
  };

  console.log(`Visible books with locations: ${books.length}`);
  console.log(`Distinct location groups:     ${groups.size}`);
  console.log('Plotted points by type:');
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(14)} ${n}`);
  }

  // One Mongo document holds the whole snapshot; the BSON limit is 16 MB. Fail
  // loudly well before it, rather than let the write reject and the map freeze
  // on yesterday's cache.
  const bytes = Buffer.byteLength(JSON.stringify(data));
  console.log(`Snapshot size:                ${(bytes / 1e6).toFixed(1)} MB`);
  if (bytes > 14e6) {
    console.error('Snapshot exceeds 14 MB — lower MAX_BOOKS_PER_GROUP or split the doc. Not written.');
    process.exit(1);
  }

  if (!DRY_RUN) {
    await db.collection('system_config').updateOne(
      { _id: 'map_data' },
      { $set: { data, generatedAt: new Date(), count: groups.size } },
      { upsert: true },
    );
    console.log(`\nWrote system_config.map_data (${groups.size} groups).`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Done.');
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
