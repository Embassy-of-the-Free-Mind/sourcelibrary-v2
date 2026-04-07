#!/usr/bin/env node
/**
 * Sync entities from MongoDB → Supabase entities table.
 *
 * Mirrors fields needed for encyclopedia, explore, and author pages
 * so they can query Postgres (instant counts, trigram search, JOINs)
 * instead of fighting 505K-doc Atlas queries.
 *
 * Modes:
 *   --full   Sync all entities (first run or rebuild)
 *   (default) Incremental — sync entities updated since last sync
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY) {
  console.error('Missing MONGODB_URI or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const FULL_MODE = process.argv.includes('--full');
const BATCH_SIZE = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const PROJECTION = {
  _id: 1, name: 1, canonical_name: 1, type: 1, book_count: 1, total_mentions: 1,
  description: 1, aliases: 1, wikidata_id: 1, wikipedia_url: 1,
  wikidata_birth_date: 1, wikidata_death_date: 1, wikidata_coordinates: 1,
  gnd_id: 1, lcnaf_id: 1, viaf_id: 1, portrait_url: 1, birth_place: 1, death_place: 1,
  books: 1, created_at: 1, updated_at: 1,
};

function transformEntity(e) {
  // Extract just book_ids from the books array (skip page arrays to save space)
  const bookIds = Array.isArray(e.books)
    ? e.books.map(b => b.book_id).filter(Boolean)
    : [];

  return {
    id: e._id.toString(),
    name: e.name || '',
    canonical_name: e.canonical_name || null,
    type: e.type || 'concept',
    book_count: e.book_count || 0,
    total_mentions: e.total_mentions || 0,
    description: e.description || null,
    aliases: Array.isArray(e.aliases) ? e.aliases : null,
    wikidata_id: e.wikidata_id || null,
    wikipedia_url: e.wikipedia_url || null,
    wikidata_birth_date: e.wikidata_birth_date || null,
    wikidata_death_date: e.wikidata_death_date || null,
    wikidata_coordinates: e.wikidata_coordinates || null,
    gnd_id: e.gnd_id || null,
    lcnaf_id: e.lcnaf_id || null,
    viaf_id: e.viaf_id || null,
    portrait_url: e.portrait_url || null,
    birth_place: e.birth_place || null,
    death_place: e.death_place || null,
    book_ids: bookIds,
    created_at: e.created_at || null,
    updated_at: e.updated_at || null,
  };
}

async function run() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  // Get last sync timestamp for incremental mode
  let filter = {};
  if (!FULL_MODE) {
    const { data } = await supabase
      .from('entities')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);
    const lastSync = data?.[0]?.updated_at;
    if (lastSync) {
      filter = { updated_at: { $gt: new Date(lastSync) } };
      console.log(`Incremental sync since ${lastSync}`);
    } else {
      console.log('No existing data — running full sync');
    }
  } else {
    console.log('Full sync mode');
  }

  const total = await db.collection('entities').countDocuments(filter);
  console.log(`Entities to sync: ${total}`);

  const cursor = db.collection('entities')
    .find(filter, { projection: PROJECTION })
    .batchSize(BATCH_SIZE);

  let batch = [];
  let synced = 0;
  let errors = 0;

  for await (const entity of cursor) {
    batch.push(transformEntity(entity));

    if (batch.length >= BATCH_SIZE) {
      const { error } = await supabase
        .from('entities')
        .upsert(batch, { onConflict: 'id' });
      if (error) {
        console.error(`Batch error at ${synced}:`, error.message);
        errors++;
      }
      synced += batch.length;
      batch = [];
      if (synced % 10000 === 0) console.log(`  ${synced}/${total}`);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const { error } = await supabase
      .from('entities')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error('Final batch error:', error.message);
      errors++;
    }
    synced += batch.length;
  }

  console.log(`Done: ${synced} synced, ${errors} errors`);
  await mongo.close();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
