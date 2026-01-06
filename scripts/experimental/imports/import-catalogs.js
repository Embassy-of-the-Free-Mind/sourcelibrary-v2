#!/usr/bin/env node
/**
 * Import IA and BPH catalogs into MongoDB
 * Run with: node scripts/import-catalogs.js
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load env manually
const envContent = fs.readFileSync('.env.local', 'utf8');
const envLines = envContent.split('\n');
const env = {};
for (const line of envLines) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    env[match[1]] = match[2];
  }
}

const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB;

// Simple CSV parser that handles quoted fields
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCSV(content) {
  const lines = content.split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const record = {};

    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || '';
    }

    results.push(record);
  }

  return results;
}

async function importCatalogs() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Import IA catalog
  console.log('\nImporting Internet Archive catalog...');
  const iaPath = '/Users/dereklomas/secondrenaissance/data/massive_latin_collection_20251119_091153.csv';
  const iaContent = fs.readFileSync(iaPath, 'utf-8');
  const iaRecords = parseCSV(iaContent);

  const iaDocs = iaRecords.map(r => ({
    source: 'ia',
    identifier: r.identifier,
    title: r.title || 'Untitled',
    author: r.creator || 'Unknown',
    year: r.year || r.date?.substring(0, 4) || 'Unknown',
    language: r.language || 'Unknown',
    description: r.description || '',
    publisher: r.publisher || '',
    imageUrl: r.identifier ? `https://archive.org/services/img/${r.identifier}` : null,
    // Text index fields
    searchText: [r.title, r.creator, r.description].filter(Boolean).join(' ').toLowerCase()
  }));

  // Drop and recreate
  await db.collection('external_catalog').deleteMany({ source: 'ia' });
  if (iaDocs.length > 0) {
    await db.collection('external_catalog').insertMany(iaDocs);
  }
  console.log(`Imported ${iaDocs.length} IA records`);

  // Import BPH catalog
  console.log('\nImporting BPH catalog...');
  const bphPath = '/Users/dereklomas/secondrenaissance/data/raw/bph/bph_catalog.csv';
  const bphContent = fs.readFileSync(bphPath, 'utf-8');
  const bphRecords = parseCSV(bphContent);

  const bphDocs = bphRecords.map(r => ({
    source: 'bph',
    identifier: r.uuid,
    title: r.Title || 'Untitled',
    author: r.Author || 'Unknown',
    year: r['Year of publication'] || 'Unknown',
    language: r.Language || 'Unknown',
    description: [r.Keywords, r.Remarks].filter(Boolean).join(' - '),
    publisher: r.Publisher || '',
    printer: r.Printer || '',
    placeOfPublication: r['Place of publication'] || '',
    keywords: r.Keywords || '',
    shelfMark: r['Shelf mark'] || '',
    // Text index fields
    searchText: [r.Title, r.Author, r.Keywords, r.Remarks].filter(Boolean).join(' ').toLowerCase()
  }));

  await db.collection('external_catalog').deleteMany({ source: 'bph' });
  if (bphDocs.length > 0) {
    await db.collection('external_catalog').insertMany(bphDocs);
  }
  console.log(`Imported ${bphDocs.length} BPH records`);

  // Create text index for fast searching
  console.log('\nCreating search index...');
  try {
    await db.collection('external_catalog').createIndex({ searchText: 'text' });
    console.log('Created text index on searchText');
  } catch (e) {
    console.log('Text index already exists or failed:', e.message);
  }

  // Also create regular indexes
  await db.collection('external_catalog').createIndex({ source: 1 });
  await db.collection('external_catalog').createIndex({ title: 1 });
  await db.collection('external_catalog').createIndex({ author: 1 });

  console.log('\nDone!');
  await client.close();
}

importCatalogs().catch(console.error);
