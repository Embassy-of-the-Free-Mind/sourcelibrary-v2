/**
 * Create the `split_from_spread` index on `pages` (#2298 prerequisite).
 *
 * `split_from_spread` is unindexed, so any query that filters on it COLLSCANs
 * the full `pages` collection (~millions of docs). That makes the spread-OCR
 * corruption enumeration (#2298, `find-spread-corrupted-ocr.mjs`) and the
 * provenance drift audit (#2297, `audit-ocr-source-drift.mjs`) either very slow
 * or — from a constrained client — effectively unrunnable.
 *
 * Index shape: `{ split_from_spread: 1, 'ocr.model': 1 }`. Compound because the
 * canonical query is "split pages that have OCR" (both #2298 and #2297 filter on
 * exactly that pair). A plain `{ split_from_spread: 1 }` would also work but the
 * compound serves the real access pattern and the ocr.model existence check.
 * Sparse, since split_from_spread is only set on ~10% of pages.
 *
 * Idempotent + background build (won't block writes). Heartbeat for the build.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/create-split-from-spread-index.mjs
 */
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 120000,
  socketTimeoutMS: 1_200_000, // 20 min — large-collection index build
});
await client.connect();
const db = client.db('bookstore');

const KEY = { split_from_spread: 1, 'ocr.model': 1 };
const NAME = 'pages_split_from_spread_ocr_idx';

console.log(`Creating ${NAME} = ${JSON.stringify(KEY)} on pages (sparse, background)...`);
console.log(`  Started: ${new Date().toLocaleTimeString()}`);

const heartbeat = setInterval(() => {
  console.log(`  ... still building (${new Date().toLocaleTimeString()})`);
}, 60_000);

try {
  await db.collection('pages').createIndex(KEY, {
    name: NAME,
    background: true,
    sparse: true,
  });
  console.log(`  OK: pages.${NAME}`);
} catch (e) {
  if (e.message?.includes('already exists') || e.codeName === 'IndexOptionsConflict' || e.code === 85 || e.code === 86) {
    // 85 IndexOptionsConflict / 86 IndexKeySpecsConflict — an equivalent index already exists.
    console.log(`  EXISTS (or equivalent): pages.${NAME} — ${e.message}`);
  } else {
    clearInterval(heartbeat);
    console.error(`  ERROR: pages.${NAME} — ${e.message}`);
    await client.close();
    process.exit(1);
  }
} finally {
  clearInterval(heartbeat);
}

console.log(`Done: ${new Date().toLocaleTimeString()}. #2298 enumeration + #2297 audit are now index-backed.`);
await client.close();
