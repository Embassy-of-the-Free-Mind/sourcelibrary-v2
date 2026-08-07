#!/usr/bin/env node
/**
 * Create the indexes for the BPH task board (`bph_feedback_tasks`).
 *
 * The board lives in Mongo rather than Supabase, so there is no SQL migration
 * for it — index creation is the whole schema change. Safe to re-run: Mongo
 * treats createIndex on an existing identical index as a no-op.
 *
 * Run:
 *   set -a; . .env.production.local; set +a; node scripts/maintenance/ensure-bph-task-indexes.mjs
 */

import { withMongo } from '../lib/mongo.mjs';

await withMongo(async (db) => {
  const col = db.collection('bph_feedback_tasks');

  // The board query: everything for a tenant, ordered within its column.
  const board = await col.createIndex(
    { tenant_slug: 1, status: 1, position: 1 },
    { name: 'tenant_status_position' }
  );

  // "Is this feedback already on the board?" — one lookup per inbox render.
  const link = await col.createIndex(
    { tenant_slug: 1, feedback_id: 1 },
    { name: 'tenant_feedback' }
  );

  console.log('Indexes ensured on bph_feedback_tasks:');
  console.log('  ', board);
  console.log('  ', link);

  const count = await col.countDocuments({});
  console.log(`\nCollection currently holds ${count} task${count === 1 ? '' : 's'}.\n`);
});
