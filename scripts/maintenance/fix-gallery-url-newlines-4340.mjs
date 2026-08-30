#!/usr/bin/env node
/**
 * Strip embedded whitespace from gallery_images URL fields — issue #4340.
 *
 * 7,575 rows carry a literal "\n" after the host in thumbnail_url and
 * extracted_url ("https://images.sourcelibrary.org\n/gallery/..."), written
 * ~2026-07-05 by a run whose R2_PUBLIC_URL env value had a trailing newline
 * (see lesson_env_newline_phantom_sync_success; backfill-card-thumbs.mjs
 * already defends at read time with cleanUrl()). Browsers strip \n during URL
 * parsing so <img> mostly survives, but every non-browser consumer (JSON API
 * clients, MCP agents, OG scrapers) gets a broken URL — and the values flow
 * out through /api/search/unified today.
 *
 * The class-level guard (getR2PublicUrl() trimming its env value) ships in the
 * same PR, so a rerun of the original writer cannot re-poison these rows.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-gallery-url-newlines-4340.mjs --dry-run
 *   node scripts/maintenance/fix-gallery-url-newlines-4340.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const FIELDS = ['thumbnail_url', 'extracted_url', 'image_url', 'card_url'];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const col = db.collection('gallery_images');

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

const filter = { $or: FIELDS.map(f => ({ [f]: /[\s]/ })) };
const total = await col.countDocuments(filter);
console.log(`Rows with whitespace in ${FIELDS.join('/')}: ${total}`);

if (!APPLY) {
  const sample = await col.find(filter).limit(3).toArray();
  for (const s of sample) {
    for (const f of FIELDS) {
      if (s[f] && /\s/.test(s[f])) console.log(`  ${s._id} ${f}: ${JSON.stringify(s[f]).slice(0, 110)}`);
    }
  }
  console.log('\nDry run only — re-run with --apply to write.');
} else {
  // Per-field chained $replaceAll on \n, \r, \t and space. URLs legitimately
  // never contain raw whitespace, so a blanket strip is safe for these fields.
  const stripAll = (expr) => [' ', '\t', '\r', '\n'].reduce(
    (input, ch) => ({ $replaceAll: { input, find: ch, replacement: '' } }),
    expr,
  );
  const stripStages = FIELDS.map(f => ({
    $set: {
      [f]: {
        $cond: [
          { $eq: [{ $type: `$${f}` }, 'string'] },
          stripAll(`$${f}`),
          `$${f}`,
        ],
      },
    },
  }));
  const res = await col.updateMany(filter, [
    ...stripStages,
    { $set: { updated_at: new Date() } },
  ]);
  console.log(`matched=${res.matchedCount} modified=${res.modifiedCount}`);

  await recordSweepAction(db, {
    sweep: 'gallery-url-newlines-4340',
    book_id: 'corpus-wide',
    action: 'stripped-newlines-from-url-fields',
    detail: { rows_matched: res.matchedCount, rows_modified: res.modifiedCount, fields: FIELDS },
  });

  const remaining = await col.countDocuments(filter);
  console.log(`Remaining rows with whitespace after write: ${remaining}`);
  if (remaining > 0) process.exitCode = 1;
}

await client.close();
