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
 * Usage:
 *   node scripts/maintenance/build-map-cache.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_BOOKS_PER_GROUP = 200;

async function main() {
  console.log(`Build Map Cache — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const books = await db.collection('books').find(
    { visible: true, 'locations.0': { $exists: true } },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1, locations: 1 } },
  ).toArray();

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
        group.books.push({
          id: book.id,
          title: book.title || 'Untitled',
          display_title: book.display_title || undefined,
          author: book.author || 'Unknown',
          year: book.year ?? null,
          slug: book.slug || '',
        });
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
