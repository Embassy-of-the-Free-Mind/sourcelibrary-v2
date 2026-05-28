#!/usr/bin/env node
/**
 * Backfill tenant_id on all five Supabase embedding tables from Mongo
 * books.tenantId (and gallery_images.tenantId for the image-side tables).
 *
 * Scale by table:
 *   page_translations  ~ 3.9M rows  (FROM books.tenantId via book_id)
 *   book_embeddings    ~ 34K rows
 *   artwork_embeddings ~ 20K rows
 *   gallery_text_embeddings ~ 117K rows (no active writer — see PR B notes)
 *   clip_embeddings    ~ 152K rows  (FROM gallery_images.tenantId via id)
 *
 * Resumable: state in scripts/migration/.backfill-tenant.state
 * Dry-run by default — pass --apply to write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-embedding-tenant-id.mjs --dry-run
 *   node scripts/migration/backfill-embedding-tenant-id.mjs --apply
 *   node scripts/migration/backfill-embedding-tenant-id.mjs --apply --table book_embeddings
 *   node scripts/migration/backfill-embedding-tenant-id.mjs --apply --resume
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.backfill-tenant.state');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESUME = args.includes('--resume');
const TABLE_FILTER = args.find((_, i, a) => a[i - 1] === '--table');

const ALL_TABLES = [
  'book_embeddings',
  'artwork_embeddings',
  'page_translations',
  'gallery_text_embeddings',
  'clip_embeddings',
];
const TABLES = TABLE_FILTER ? [TABLE_FILTER] : ALL_TABLES;

if (!APPLY) console.log('DRY RUN — no writes. Pass --apply to commit.');

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!MONGODB_URI || !SUPABASE_DB_URL) {
  console.error('Missing env: MONGODB_URI and SUPABASE_DB_URL required.');
  process.exit(1);
}

const mongo = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
await mongo.connect();
const db = mongo.db('bookstore');

const pgClient = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();
await pgClient.query('SET statement_timeout = 120000');

function loadState() {
  if (!RESUME || !fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
const state = loadState();

// ── Backfill helpers ─────────────────────────────────────────────────

/**
 * Backfill the 4 book-keyed tables (book_id → books.tenantId).
 * page_translations, book_embeddings, artwork_embeddings, gallery_text_embeddings
 * all key by book_id, so the same logic works for all four.
 */
async function backfillByBookId(table) {
  console.log(`\n── ${table} ──`);

  // Distinct book_ids needing backfill
  const { rows: bookRows } = await pgClient.query(
    `SELECT DISTINCT book_id FROM ${table} WHERE tenant_id IS NULL ORDER BY book_id`,
  );
  const allBookIds = bookRows.map(r => r.book_id);
  const tableState = state[table] || { done: [] };
  const doneSet = new Set(tableState.done);
  const bookIds = allBookIds.filter(id => !doneSet.has(id));
  console.log(`  ${bookIds.length.toLocaleString()} book_ids to process (${doneSet.size.toLocaleString()} already done)`);

  let updated = 0;
  let nullTenants = 0;
  let withTenants = 0;
  const start = Date.now();

  // Process books in chunks of 200 — fetch all tenant values, group by tenant
  // for batched UPDATE WHERE book_id = ANY(...)
  const CHUNK = 200;
  for (let i = 0; i < bookIds.length; i += CHUNK) {
    const chunk = bookIds.slice(i, i + CHUNK);
    const books = await db.collection('books')
      .find({ id: { $in: chunk } }, { projection: { id: 1, tenantId: 1 } })
      .toArray();

    // Group book_ids by tenantId
    const byTenant = new Map(); // tenantId (or null) → [book_id]
    const seenBookIds = new Set();
    for (const b of books) {
      const tenant = b.tenantId || null;
      if (!byTenant.has(tenant)) byTenant.set(tenant, []);
      byTenant.get(tenant).push(b.id);
      seenBookIds.add(b.id);
    }
    // Books not found in Mongo (orphan rows) — leave tenant_id NULL (main-site).
    // delete-stale-embeddings.mjs already prunes truly-orphaned rows.

    if (APPLY) {
      for (const [tenant, ids] of byTenant) {
        if (tenant === null) {
          // Already NULL — but we still need to "claim" these so the resume
          // state doesn't keep re-fetching them. We don't UPDATE since they're
          // already NULL.
          nullTenants += ids.length;
        } else {
          const res = await pgClient.query(
            `UPDATE ${table} SET tenant_id = $1 WHERE book_id = ANY($2::text[]) AND tenant_id IS NULL`,
            [tenant, ids],
          );
          updated += res.rowCount;
          withTenants += ids.length;
        }
      }
    } else {
      for (const [tenant, ids] of byTenant) {
        if (tenant === null) nullTenants += ids.length;
        else { withTenants += ids.length; updated += ids.length; }
      }
    }

    for (const id of chunk) doneSet.add(id);

    if ((i / CHUNK) % 10 === 0 || i + CHUNK >= bookIds.length) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = Math.round((i + chunk.length) / Math.max(elapsed, 1));
      console.log(`  [${i + chunk.length}/${bookIds.length}] updated ${updated.toLocaleString()} rows (${rate} books/s) — ${withTenants} tenant, ${nullTenants} main-site`);
      if (APPLY) {
        state[table] = { done: [...doneSet] };
        saveState(state);
      }
    }
  }

  console.log(`  Done. ${updated.toLocaleString()} rows updated (${withTenants.toLocaleString()} tenant-tagged books, ${nullTenants.toLocaleString()} main-site).`);
}

/**
 * Backfill clip_embeddings: rows can be book-derived (book covers, etc.) OR
 * gallery-image-derived (extractions). Resolve via source_type column.
 */
async function backfillClip() {
  console.log(`\n── clip_embeddings ──`);

  // Fast path for book-source rows: same as backfillByBookId but filtered
  const { rows: bookSourceRows } = await pgClient.query(`
    SELECT DISTINCT book_id FROM clip_embeddings
     WHERE tenant_id IS NULL AND source_type = 'book' AND book_id IS NOT NULL
     ORDER BY book_id
  `);
  console.log(`  ${bookSourceRows.length.toLocaleString()} book_ids with source_type=book`);

  let updated = 0;
  const CHUNK = 200;
  for (let i = 0; i < bookSourceRows.length; i += CHUNK) {
    const chunk = bookSourceRows.slice(i, i + CHUNK).map(r => r.book_id);
    const books = await db.collection('books')
      .find({ id: { $in: chunk } }, { projection: { id: 1, tenantId: 1 } })
      .toArray();
    const byTenant = new Map();
    for (const b of books) {
      const t = b.tenantId || null;
      if (!byTenant.has(t)) byTenant.set(t, []);
      byTenant.get(t).push(b.id);
    }
    if (APPLY) {
      for (const [tenant, ids] of byTenant) {
        if (tenant === null) continue;
        const res = await pgClient.query(
          `UPDATE clip_embeddings SET tenant_id = $1 WHERE book_id = ANY($2::text[]) AND source_type = 'book' AND tenant_id IS NULL`,
          [tenant, ids],
        );
        updated += res.rowCount;
      }
    }
    if (i % (CHUNK * 5) === 0) console.log(`  book-source: ${i}/${bookSourceRows.length} chunks done, ${updated.toLocaleString()} updated`);
  }

  // Gallery-source rows: id is the gallery_image _id (hex string)
  const { rows: gallerySourceRows } = await pgClient.query(`
    SELECT id FROM clip_embeddings
     WHERE tenant_id IS NULL AND source_type = 'gallery_image'
     ORDER BY id
  `);
  console.log(`  ${gallerySourceRows.length.toLocaleString()} ids with source_type=gallery_image`);

  // Lookup gallery_images by _id in batches; gallery_images has its own tenantId
  let galleryUpdated = 0;
  const G_CHUNK = 500;
  for (let i = 0; i < gallerySourceRows.length; i += G_CHUNK) {
    const idsHex = gallerySourceRows.slice(i, i + G_CHUNK).map(r => r.id);
    const objectIds = idsHex
      .filter(h => /^[a-f0-9]{24}$/.test(h))
      .map(h => {
        // dynamic import only when needed
        return h;
      });
    if (objectIds.length === 0) continue;

    // Fetch gallery_images
    const { ObjectId } = await import('mongodb');
    const oids = objectIds.map(h => new ObjectId(h));
    const galleries = await db.collection('gallery_images')
      .find({ _id: { $in: oids } }, { projection: { _id: 1, tenantId: 1 } })
      .toArray();
    const byTenant = new Map();
    for (const g of galleries) {
      const t = g.tenantId || null;
      if (!byTenant.has(t)) byTenant.set(t, []);
      byTenant.get(t).push(String(g._id));
    }
    if (APPLY) {
      for (const [tenant, ids] of byTenant) {
        if (tenant === null) continue;
        const res = await pgClient.query(
          `UPDATE clip_embeddings SET tenant_id = $1 WHERE id = ANY($2::text[]) AND source_type = 'gallery_image' AND tenant_id IS NULL`,
          [tenant, ids],
        );
        galleryUpdated += res.rowCount;
      }
    }
    if (i % (G_CHUNK * 5) === 0) console.log(`  gallery-source: ${i}/${gallerySourceRows.length} processed, ${galleryUpdated.toLocaleString()} updated`);
  }

  console.log(`  Done. ${updated.toLocaleString()} book-source + ${galleryUpdated.toLocaleString()} gallery-source updated.`);
}

// ── Run ──────────────────────────────────────────────────────────────

for (const table of TABLES) {
  if (!ALL_TABLES.includes(table)) {
    console.warn(`Unknown table: ${table}`);
    continue;
  }
  if (table === 'clip_embeddings') {
    await backfillClip();
  } else {
    await backfillByBookId(table);
  }
}

await pgClient.end();
await mongo.close();
console.log('\nAll requested tables backfilled.');
