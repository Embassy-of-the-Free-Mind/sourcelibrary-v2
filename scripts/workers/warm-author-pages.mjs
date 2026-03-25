#!/usr/bin/env node
/**
 * Warm Author Pages
 *
 * Fetches all author page URLs to trigger ISR regeneration.
 * Run after sync-worker to ensure cached pages reflect latest page counts.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/warm-author-pages.mjs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';
const BATCH_SIZE = 10;

function authorSlug(author) {
  return author
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  const authors = await db.collection('books').distinct('author', {
    hidden: { $ne: true },
    author: { $exists: true, $ne: null, $nin: ['Unknown', 'Anonymous', 'Various'] },
  });
  await client.close();

  const slugs = [...new Set(authors.map(a => authorSlug(a)))];
  console.log(`[warm-authors] ${slugs.length} author pages to warm`);

  let ok = 0, fail = 0;
  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    const batch = slugs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(slug =>
        fetch(`${BASE_URL}/author/${slug}`, {
          headers: { 'User-Agent': 'SourceLibrary-Warmer' },
        }).then(r => {
          if (!r.ok) throw new Error(`${r.status}`);
        })
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') ok++;
      else fail++;
    }
  }

  console.log(`[warm-authors] Done: ${ok} ok, ${fail} failed`);
}

main().catch(err => { console.error(err); process.exit(1); });
