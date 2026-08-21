#!/usr/bin/env node
/**
 * Backfill CLIP embeddings for visual search.
 *
 * Embeds all artworks (resource_type exists) and book covers (thumbnail)
 * via the Hetzner CLIP server, stores in Supabase clip_embeddings table.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/backfill-clip-embeddings.mjs
 *
 * Options:
 *   --artworks-only    Only embed artworks (resource_type exists)
 *   --covers-only      Only embed book covers
 *   --gallery-only     Only embed gallery images from image extraction
 *   --fix-gallery-crops  Re-embed gallery rows whose stored image is not the
 *                        illustration crop (extracted_url). Historical rows were
 *                        embedded from the FULL PAGE scan, which buries the artwork
 *                        in page text and breaks photo->image matching (#3193).
 *   --limit N          Process at most N items
 *   --dry-run          Count what would be embedded, don't embed
 *   --clip-url URL     CLIP server URL (default: http://localhost:3457)
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';

const { Client: PgClient } = pg;

const CLIP_URL = process.env.CLIP_URL || process.argv.find(a => a.startsWith('--clip-url='))?.split('=')[1] || 'http://localhost:3457';
const ARTWORKS_ONLY = process.argv.includes('--artworks-only');
const COVERS_ONLY = process.argv.includes('--covers-only');
const GALLERY_ONLY = process.argv.includes('--gallery-only');
const FIX_GALLERY_CROPS = process.argv.includes('--fix-gallery-crops');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;

// Batch settings
const BATCH_SIZE = 10; // Images per batch to CLIP server
const PG_BATCH = 50;   // Rows per INSERT

async function main() {
  // Check CLIP server health
  try {
    const health = await fetch(`${CLIP_URL}/health`).then(r => r.json());
    console.log(`CLIP server: ${health.model} (${health.dims} dims)`);
  } catch (e) {
    console.error(`Cannot reach CLIP server at ${CLIP_URL}: ${e.message}`);
    console.error('Start it with: node scripts/workers/clip-server.mjs');
    process.exit(1);
  }

  // Connect to MongoDB
  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  const db = mongo.db('bookstore');
  const books = db.collection('books');

  // Connect to Supabase Postgres (support SUPABASE_DB_URL or individual PG* vars)
  let pgClient;
  if (process.env.SUPABASE_DB_URL) {
    // Use direct port 5432 instead of pooler port 6543 for long-running scripts
    const connStr = process.env.SUPABASE_DB_URL.replace(':6543/', ':5432/');
    pgClient = new PgClient({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  } else if (process.env.PGPASSWORD) {
    pgClient = new PgClient({
      host: process.env.PGHOST || 'db.ykhxaecbbxaaqlujuzde.supabase.co',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
      ssl: { rejectUnauthorized: false },
    });
  } else {
    console.error('Missing SUPABASE_DB_URL or PGPASSWORD');
    process.exit(1);
  }

  await pgClient.connect();
  await pgClient.query('SET ROLE postgres');

  // Get existing embeddings to skip (id -> embedded image_url, for crop-fix detection)
  const { rows: existing } = await pgClient.query('SELECT id, image_url FROM clip_embeddings');
  const existingUrl = new Map(existing.map(r => [r.id, r.image_url]));
  const existingIds = new Set(existingUrl.keys());
  console.log(`Existing embeddings: ${existingIds.size}`);

  // Collect items to embed
  const items = [];

  // Phase 1: Artworks (resource_type exists, have a thumbnail or commons image)
  if (!COVERS_ONLY && !GALLERY_ONLY) {
    const artworks = await books.find(
      {
        resource_type: { $exists: true },
        $or: [
          { commons_full_url: { $exists: true, $ne: null } },
          { thumbnail: { $exists: true, $ne: null } },
          { thumbnail_blob: { $exists: true, $ne: null } },
        ],
      },
      {
        projection: {
          id: 1, title: 1, display_title: 1, author: 1, resource_type: 1,
          commons_full_url: 1, thumbnail: 1, thumbnail_blob: 1, archived_full_url: 1,
        },
      },
    ).toArray();

    for (const a of artworks) {
      const id = `artwork-${a.id}`;
      if (existingIds.has(id)) continue;

      // Best available image URL — prefer R2 (no rate limits) over external
      const imageUrl = a.archived_full_url || a.thumbnail_blob || a.thumbnail;
      if (!imageUrl) continue;

      items.push({
        id,
        source_type: 'artwork',
        book_id: a.id,
        image_url: imageUrl,
        title: a.display_title || a.title,
        author: a.author,
        resource_type: a.resource_type,
        thumbnail_url: a.thumbnail_blob || a.thumbnail || imageUrl,
      });
    }
    console.log(`Artworks to embed: ${items.length}`);
  }

  // Phase 2: Book covers (non-artwork books with thumbnails)
  if (!ARTWORKS_ONLY && !GALLERY_ONLY) {
    const coverQuery = {
      resource_type: { $exists: false },
      pages_count: { $gt: 0 },
      $or: [
        { thumbnail_blob: { $exists: true, $ne: null } },
        { thumbnail: { $exists: true, $ne: null } },
      ],
    };

    const coverBooks = await books.find(coverQuery, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1,
        thumbnail: 1, thumbnail_blob: 1,
      },
    }).toArray();

    const coverItems = [];
    for (const b of coverBooks) {
      const id = `cover-${b.id}`;
      if (existingIds.has(id)) continue;

      const imageUrl = b.thumbnail_blob || b.thumbnail;
      if (!imageUrl) continue;

      coverItems.push({
        id,
        source_type: 'book_cover',
        book_id: b.id,
        image_url: imageUrl,
        title: b.display_title || b.title,
        author: b.author,
        resource_type: null,
        thumbnail_url: imageUrl,
      });
    }
    console.log(`Book covers to embed: ${coverItems.length}`);
    for (const it of coverItems) items.push(it);
  }

  // Phase 3: Gallery images from image extraction pipeline
  if (!ARTWORKS_ONLY && !COVERS_ONLY) {
    const galleryImages = await db.collection('gallery_images').find(
      { image_url: { $exists: true, $ne: null } },
      {
        projection: {
          id: 1, book_id: 1, book_title: 1, book_author: 1,
          image_url: 1, extracted_url: 1, thumbnail_url: 1, type: 1, description: 1,
        },
      },
    ).toArray();

    const galleryItems = [];
    for (const g of galleryImages) {
      const id = `gallery-${g.id}`;
      // Embed the illustration CROP, never the full page scan — a full-page
      // embedding is dominated by the surrounding text and can't match a
      // photo of the artwork alone (#3193).
      const embedUrl = g.extracted_url || g.image_url;
      if (!embedUrl) continue;
      if (existingIds.has(id)) {
        // Skip unless we're repairing rows embedded from the wrong (full-page) URL
        if (!FIX_GALLERY_CROPS || existingUrl.get(id) === embedUrl) continue;
      }

      galleryItems.push({
        id,
        source_type: 'gallery_image',
        book_id: g.book_id,
        image_url: embedUrl,
        title: g.description || g.book_title,
        author: g.book_author,
        resource_type: g.type || null,
        thumbnail_url: g.thumbnail_url || embedUrl,
      });
    }
    console.log(`Gallery images to embed: ${galleryItems.length}`);
    for (const it of galleryItems) items.push(it);
  }

  const total = LIMIT > 0 ? Math.min(items.length, LIMIT) : items.length;
  console.log(`\nTotal to process: ${total}`);

  if (DRY_RUN) {
    console.log('Dry run — exiting');
    await pgClient.end();
    await mongo.close();
    return;
  }

  // Process in batches
  let embedded = 0;
  let failed = 0;
  // Keep a bounded sample of WHY things failed, not just how many. Capped so a
  // run where everything fails cannot itself become the problem.
  const FAILED_SAMPLE_CAP = 10;
  const failedSamples = [];
  const pendingRows = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = items.slice(i, Math.min(i + BATCH_SIZE, total));
    const urls = batch.map(b => b.image_url);

    try {
      const resp = await fetch(`${CLIP_URL}/embed-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });

      if (!resp.ok) {
        console.error(`Batch ${i}-${i + batch.length}: HTTP ${resp.status}`);
        failed += batch.length;
        continue;
      }

      const data = await resp.json();

      for (let j = 0; j < data.results.length; j++) {
        const result = data.results[j];
        const item = batch[j];

        if (result.embedding) {
          pendingRows.push(item);
          item._embedding = result.embedding;
          embedded++;
        } else {
          failed++;
          // SAY WHY. This branch used to be a bare `failed++`, which threw away
          // the server's reason — so on 2026-08-21 a run where every source URL
          // 404'd surfaced as "0 embedded, 60 failed" and read like a broken
          // embedder. It cost an hour of eliminating the CLIP server, the batch
          // size and the Postgres write before the actual cause (1,596 gallery
          // rows carrying a dead `extracted_url` at /artwork/<slug>.jpg) showed
          // up. A counter cannot distinguish a dead source from a dead service;
          // the reason can. #4185.
          if (failedSamples.length < FAILED_SAMPLE_CAP) {
            failedSamples.push({ id: item.id, url: item.image_url, reason: result.error || 'no embedding returned' });
          }
        }
      }

      // Flush to Postgres when we have enough rows
      if (pendingRows.length >= PG_BATCH) {
        await flushToPostgres(pgClient, pendingRows);
        pendingRows.length = 0;
      }

      const pct = ((i + batch.length) / total * 100).toFixed(1);
      process.stdout.write(`\r  ${pct}% — ${embedded} embedded, ${failed} failed (${data.ms}ms for ${batch.length} images)`);
    } catch (e) {
      console.error(`\nBatch ${i} error: ${e.message}`);
      failed += batch.length;
    }
  }

  // Final flush
  if (pendingRows.length > 0) {
    await flushToPostgres(pgClient, pendingRows);
  }

  console.log(`\n\nDone: ${embedded} embedded, ${failed} failed`);

  if (failedSamples.length) {
    console.log(`\nWhy they failed (first ${failedSamples.length} of ${failed}):`);
    for (const f of failedSamples) console.log(`  ${f.reason} — ${f.url}`);
    // A run that embeds NOTHING is a different event from one that loses a few
    // pages, and it is almost never the embedder: the CLIP server and the batch
    // size are the first things anyone suspects and the last things at fault.
    if (embedded === 0 && failed > 0) {
      console.log(
        `\nEVERY image failed. Check the SOURCE before the service — HEAD one of the URLs above.\n` +
        `1,596 gallery rows are known to carry a dead extracted_url at /artwork/<slug>.jpg (#4185).`,
      );
    }
  }

  await pgClient.end();
  await mongo.close();
}

async function flushToPostgres(client, rows) {
  if (rows.length === 0) return;

  // Use multi-row INSERT with ON CONFLICT
  const values = [];
  const params = [];
  let paramIdx = 1;

  // Model identifier as reported by clip-server.mjs:25 (MODEL_ID) / :87 (/health endpoint).
  // Kept inline so this script is self-contained even when the CLIP server is unreachable.
  const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';

  for (const row of rows) {
    const embeddingStr = `[${row._embedding.join(',')}]`;
    values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}::vector, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9})`);
    params.push(
      row.id,
      row.source_type,
      row.book_id,
      row.image_url,
      embeddingStr,
      row.title,
      row.author,
      row.resource_type,
      row.thumbnail_url,
      CLIP_MODEL,
    );
    paramIdx += 10;
  }

  const sql = `
    INSERT INTO clip_embeddings (id, source_type, book_id, image_url, embedding, title, author, resource_type, thumbnail_url, embedding_model)
    VALUES ${values.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      embedding = EXCLUDED.embedding,
      image_url = EXCLUDED.image_url,
      title = EXCLUDED.title,
      author = EXCLUDED.author,
      thumbnail_url = EXCLUDED.thumbnail_url,
      embedding_model = EXCLUDED.embedding_model,
      created_at = NOW()
  `;

  await client.query(sql, params);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
