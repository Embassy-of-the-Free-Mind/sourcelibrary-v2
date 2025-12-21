#!/usr/bin/env node
/**
 * Sync external catalog data from Supabase to MongoDB
 *
 * Tables synced:
 * - ia_latin_texts (Internet Archive)
 * - bph_works (Embassy of the Free Mind / BPH)
 *
 * Run with: node scripts/sync-catalog-from-supabase.js
 *
 * Required env vars:
 * - MONGODB_URI
 * - MONGODB_DB
 * - SUPABASE_URL (defaults to secondrenaissance project)
 * - SUPABASE_KEY (anon key)
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');

// Load env manually
function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const envLines = envContent.split('\n');
    for (const line of envLines) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      }
    }
  } catch (e) {
    console.log('No .env.local found, using process.env');
  }
  return { ...process.env, ...env };
}

const env = loadEnv();

const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB;
const SUPABASE_URL = env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = env.SUPABASE_KEY;

if (!SUPABASE_KEY) {
  console.error('Error: SUPABASE_KEY environment variable is required');
  console.error('Add it to .env.local: SUPABASE_KEY=your_anon_key');
  process.exit(1);
}

// Fetch from Supabase REST API
async function fetchFromSupabase(table, { select = '*', limit = 1000, offset = 0 } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;

  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'count=exact'
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const countHeader = response.headers.get('content-range');
  const total = countHeader ? parseInt(countHeader.split('/')[1]) : data.length;

  return { data, total };
}

// Fetch all records with pagination
async function fetchAllFromSupabase(table, batchSize = 1000) {
  console.log(`Fetching from ${table}...`);

  let allRecords = [];
  let offset = 0;
  let total = null;

  while (true) {
    const { data, total: fetchedTotal } = await fetchFromSupabase(table, {
      limit: batchSize,
      offset
    });

    if (total === null) {
      total = fetchedTotal;
      console.log(`  Total records in ${table}: ${total}`);
    }

    allRecords = allRecords.concat(data);
    console.log(`  Fetched ${allRecords.length}/${total}`);

    if (data.length < batchSize) break;
    offset += batchSize;
  }

  return allRecords;
}

async function syncCatalog() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  try {
    // Sync Internet Archive catalog
    console.log('\n=== Syncing Internet Archive catalog ===');
    const iaRecords = await fetchAllFromSupabase('ia_latin_texts');

    const iaDocs = iaRecords.map(r => ({
      source: 'ia',
      identifier: r.identifier,
      title: r.title || 'Untitled',
      author: r.creator || 'Unknown',
      year: r.year?.toString() || r.date_raw?.substring(0, 4) || 'Unknown',
      language: r.language || 'Unknown',
      description: r.description || '',
      downloads: r.downloads || 0,
      imageUrl: r.identifier ? `https://archive.org/services/img/${r.identifier}` : null,
      searchText: [r.title, r.creator, r.description].filter(Boolean).join(' ').toLowerCase()
    }));

    if (iaDocs.length > 0) {
      await db.collection('external_catalog').deleteMany({ source: 'ia' });

      // Insert in batches
      const batchSize = 1000;
      for (let i = 0; i < iaDocs.length; i += batchSize) {
        const batch = iaDocs.slice(i, i + batchSize);
        await db.collection('external_catalog').insertMany(batch);
        console.log(`  Inserted ${Math.min(i + batchSize, iaDocs.length)}/${iaDocs.length}`);
      }
    }
    console.log(`Synced ${iaDocs.length} IA records`);

    // Sync BPH catalog
    console.log('\n=== Syncing BPH catalog ===');
    const bphRecords = await fetchAllFromSupabase('bph_works');

    const bphDocs = bphRecords.map(r => ({
      source: 'bph',
      identifier: r.id || r.ubn,
      title: r.title || 'Untitled',
      author: r.author || 'Unknown',
      year: r.year?.toString() || r.year_raw || 'Unknown',
      language: r.language || 'Unknown',
      description: [r.keywords, r.remarks].filter(Boolean).join(' - '),
      publisher: r.publisher || '',
      printer: r.printer || '',
      placeOfPublication: r.place || '',
      keywords: r.keywords || '',
      shelfMark: r.shelf_mark || '',
      searchText: [r.title, r.author, r.keywords, r.remarks].filter(Boolean).join(' ').toLowerCase()
    }));

    if (bphDocs.length > 0) {
      await db.collection('external_catalog').deleteMany({ source: 'bph' });

      // Insert in batches
      const batchSize = 1000;
      for (let i = 0; i < bphDocs.length; i += batchSize) {
        const batch = bphDocs.slice(i, i + batchSize);
        await db.collection('external_catalog').insertMany(batch);
        console.log(`  Inserted ${Math.min(i + batchSize, bphDocs.length)}/${bphDocs.length}`);
      }
    }
    console.log(`Synced ${bphDocs.length} BPH records`);

    // Create indexes
    console.log('\n=== Creating indexes ===');
    try {
      await db.collection('external_catalog').createIndex({ searchText: 'text' });
      console.log('Created text index');
    } catch (e) {
      console.log('Text index exists or failed:', e.message);
    }

    await db.collection('external_catalog').createIndex({ source: 1 });
    await db.collection('external_catalog').createIndex({ title: 1 });
    await db.collection('external_catalog').createIndex({ author: 1 });
    await db.collection('external_catalog').createIndex({ year: 1 });
    console.log('Created field indexes');

    // Stats
    const iaCount = await db.collection('external_catalog').countDocuments({ source: 'ia' });
    const bphCount = await db.collection('external_catalog').countDocuments({ source: 'bph' });
    console.log(`\n=== Summary ===`);
    console.log(`Internet Archive: ${iaCount} records`);
    console.log(`BPH/EFM: ${bphCount} records`);
    console.log(`Total: ${iaCount + bphCount} records`);

  } finally {
    await client.close();
  }
}

syncCatalog()
  .then(() => {
    console.log('\nSync complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nSync failed:', err);
    process.exit(1);
  });
