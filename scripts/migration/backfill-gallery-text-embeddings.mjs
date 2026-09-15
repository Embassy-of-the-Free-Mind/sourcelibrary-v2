#!/usr/bin/env node
/**
 * Backfill gallery_text_embeddings table on Supabase.
 * Embeds gallery image descriptions + metadata via Gemini embedding-2-preview.
 * Run on Hetzner: set -a; source .env.production.local; set +a; node scripts/migration/backfill-gallery-text-embeddings.mjs
 *
 * COMMITTED 2026-09-15 (#4873). This file had lived ONLY in the working tree of
 * the Hetzner box since April — untracked, so never reviewed, absent from every
 * other checkout, and lost on a box rebuild. It is the sole writer of
 * `gallery_text_embeddings` (212,433 rows) and `image-embeddings-cron.mjs`
 * shells out to it by path every night, so a clean checkout failed that phase
 * with MODULE_NOT_FOUND and the cron summarised it as `gallery-text exit 1`.
 * The bytes here are that file verbatim; behaviour is unchanged.
 *
 * Idempotent: it loads the ids already in Supabase and embeds only the diff,
 * so it is safe to re-run and resumes after an interruption.
 *
 * Cost: BILLED. ~$0.20/1M input tokens at the measured 4.29 chars/token, text
 * capped at 4,000 chars per image — see the Cost section of
 * `.claude/docs/embeddings.md` before running it over a large diff.
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';

const BATCH_SIZE = 50;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-embedding-2-preview';
const DIMS = 768;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function composeEmbedText(img) {
  const parts = [];
  if (img.description) parts.push(img.description);
  if (img.museum_description && img.museum_description !== img.description) parts.push(img.museum_description);
  if (img.type) parts.push(`Type: ${img.type}`);
  if (img.book_title) parts.push(`From: ${img.book_title}`);

  const m = img.metadata || {};
  if (m.subjects?.length) parts.push(`Subjects: ${m.subjects.join(', ')}`);
  if (m.figures?.length) parts.push(`Figures: ${m.figures.join(', ')}`);
  if (m.symbols?.length) parts.push(`Symbols: ${m.symbols.join(', ')}`);
  if (m.style) parts.push(`Style: ${m.style}`);
  if (m.technique) parts.push(`Technique: ${m.technique}`);
  if (m.iconclass?.length) parts.push(`Iconclass: ${m.iconclass.join(', ')}`);

  return parts.join('\n').slice(0, 4000);
}

async function embedBatch(texts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: `models/${GEMINI_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: DIMS,
        })),
      }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (res.status === 429) {
    console.log('  Rate limited, waiting 10s...');
    await sleep(10000);
    return embedBatch(texts);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.embeddings.map(e => e.values);
}

async function main() {
  const mongo = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
  await mongo.connect();
  const db = mongo.db('bookstore');

  const pgClient = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await pgClient.connect();

  // Check what's already embedded
  const { rows: existing } = await pgClient.query('SELECT id FROM gallery_text_embeddings');
  const existingIds = new Set(existing.map(r => r.id));
  console.log(`Already embedded: ${existingIds.size}`);

  // Get all gallery images with descriptions
  const cursor = db.collection('gallery_images').find(
    { description: { $exists: true, $ne: '' } },
    { projection: { _id: 1, page_id: 1, book_id: 1, detection_index: 1, description: 1, museum_description: 1, metadata: 1, type: 1, book_title: 1 } }
  ).batchSize(500);

  let embedded = 0, skipped = 0, errors = 0;
  let batch = [];
  const startTime = Date.now();

  for await (const img of cursor) {
    const id = `${img.page_id}-${img.detection_index}`;
    if (existingIds.has(id)) { skipped++; continue; }

    batch.push({ ...img, _id_str: id });

    if (batch.length >= BATCH_SIZE) {
      try {
        const texts = batch.map(composeEmbedText);
        const embeddings = await embedBatch(texts);

        for (let i = 0; i < batch.length; i++) {
          const b = batch[i];
          await pgClient.query(
            `INSERT INTO gallery_text_embeddings (id, page_id, book_id, detection_index, embedding, text_source, model, generated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())
             ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, generated_at = now()`,
            [b._id_str, b.page_id, b.book_id, b.detection_index, `[${embeddings[i].join(',')}]`, 'description+metadata', GEMINI_MODEL]
          );
        }
        embedded += batch.length;
      } catch (e) {
        errors++;
        console.log(`  Batch error: ${e.message?.substring(0, 80)}`);
      }
      batch = [];

      if (embedded % 1000 === 0) {
        const rate = (embedded / ((Date.now() - startTime) / 1000)).toFixed(1);
        console.log(`  ${embedded} embedded, ${skipped} skipped, ${errors} errors (${rate}/s)`);
      }
      await sleep(100);
    }
  }

  // Final batch
  if (batch.length > 0) {
    try {
      const texts = batch.map(composeEmbedText);
      const embeddings = await embedBatch(texts);
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i];
        await pgClient.query(
          `INSERT INTO gallery_text_embeddings (id, page_id, book_id, detection_index, embedding, text_source, model, generated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, generated_at = now()`,
          [b._id_str, b.page_id, b.book_id, b.detection_index, `[${embeddings[i].join(',')}]`, 'description+metadata', GEMINI_MODEL]
        );
      }
      embedded += batch.length;
    } catch (e) {
      errors++;
    }
  }

  console.log(`\nDone: ${embedded} embedded, ${skipped} skipped, ${errors} errors`);
  await pgClient.end();
  await mongo.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
