#!/usr/bin/env node
/**
 * One-shot backfill: set `bph_works.is_first_translation` from Atlas
 * `books.is_first_translation`.
 *
 * Background: see `supabase/migrations/20260526000000_bph_works_first_translation.sql`.
 * The signal lives in Atlas; the BPH catalogue is Supabase. The catalogue's
 * Advanced filter "First English translation" originally pre-fetched the
 * universe of ids and passed them as `sl_book_id.in.(…)`, but the URL
 * exceeded Cloudflare's 16KB cap (~38KB for 1.5K BPH-linked rows → 414).
 * Denormalising onto bph_works lets the filter run as a single `eq`.
 *
 * The recurring half lives in `src/app/api/cron/sync-bph-sl-book-ids/route.ts`,
 * which PATCHes the column alongside `sl_book_id` / `sl_book_slug` so new
 * verifications land on the catalogue within 6 hours.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a;
 *   node scripts/migration/backfill-bph-first-translation.mjs
 *
 * Idempotent — running again is a no-op for rows already in the right state.
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — source .env.production.local first.');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI.');
  process.exit(1);
}

async function main() {
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  // Universe of first-translation book ids from Atlas.
  const firstTranslation = await db.collection('books').find(
    { is_first_translation: true, hidden: { $ne: true } },
    { projection: { _id: 0, id: 1 } },
  ).toArray();
  const ids = firstTranslation.map(r => r.id).filter(Boolean);
  console.log('atlas first_translation count:', ids.length);

  await c.close();

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal,count=exact',
  };

  // Phase 1: set TRUE on rows linked to a first-translation book.
  // Chunk the .in.(…) since this still goes through PostgREST (~1500 ids
  // is well under the URL cap when split into chunks of 500).
  const CHUNK = 500;
  let setTrue = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const url = `${SUPABASE_URL}/rest/v1/bph_works?sl_book_id=in.(${chunk.map(encodeURIComponent).join(',')})&is_first_translation=eq.false`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ is_first_translation: true }),
    });
    if (!res.ok) {
      console.error(`PATCH chunk ${i}: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const cr = res.headers.get('content-range');
    const n = cr ? parseInt(cr.split('/')[1] || '0', 10) : 0;
    setTrue += n;
  }
  console.log('bph_works set TRUE:', setTrue);

  // Phase 2: ensure FALSE on linked rows whose Atlas book is NO LONGER
  // a first translation (e.g. verification flipped). We can't `not.in.()`
  // a 1500-id list in one shot, so flip the comparison: fetch all currently
  // TRUE rows from bph_works and reset any whose sl_book_id isn't in the set.
  const currentlyTrueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bph_works?is_first_translation=eq.true&select=sl_book_id`,
    { headers },
  );
  if (!currentlyTrueRes.ok) {
    console.error(`fetch currently TRUE: ${currentlyTrueRes.status} ${await currentlyTrueRes.text()}`);
    process.exit(1);
  }
  const currentlyTrue = await currentlyTrueRes.json();
  const idSet = new Set(ids);
  const stale = currentlyTrue
    .map(r => r.sl_book_id)
    .filter(id => id && !idSet.has(id));

  let setFalse = 0;
  for (let i = 0; i < stale.length; i += CHUNK) {
    const chunk = stale.slice(i, i + CHUNK);
    const url = `${SUPABASE_URL}/rest/v1/bph_works?sl_book_id=in.(${chunk.map(encodeURIComponent).join(',')})`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ is_first_translation: false }),
    });
    if (!res.ok) {
      console.error(`reset chunk ${i}: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const cr = res.headers.get('content-range');
    const n = cr ? parseInt(cr.split('/')[1] || '0', 10) : 0;
    setFalse += n;
  }
  console.log('bph_works reset to FALSE (stale flips):', setFalse);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
