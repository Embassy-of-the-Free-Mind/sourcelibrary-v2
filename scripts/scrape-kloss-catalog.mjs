#!/usr/bin/env node
/**
 * Scrape the CMC (Cultureel Maconniek Centrum) catalog via Axiell WebAPI.
 *
 * The Bibliotheca Klossiana and broader Masonic/esoteric collections are
 * cataloged in the CMC's open Axiell Internet Server (AIS5) instance.
 *
 * API: https://ais.vrijmetselarij.nl/axiellwebapi/wwwopac.ashx
 *   - No authentication required
 *   - XML output, structured by grouped fields
 *   - Max 5000 records per request
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/scrape-kloss-catalog.mjs
 *
 * Options:
 *   --kloss-only     Only fetch Kloss collection records (notes contains "Kl.")
 *   --limit N        Limit total records fetched
 *   --dry-run        Print stats without writing to MongoDB
 */

import { MongoClient } from 'mongodb';
import { XMLParser } from 'fast-xml-parser';

const API_BASE = 'https://ais.vrijmetselarij.nl/axiellwebapi/wwwopac.ashx';
const BATCH_SIZE = 2000; // Records per request (max 5000)
const DELAY_MS = 1500;  // Polite delay between requests

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => {
    // Fields that can have multiple values in the Axiell grouped XML
    return [
      'record', 'Author', 'author.name',
      'Title', 'title',
      'notes', 'value',
      'keyword.contents', 'Keyword',
      'digital_reference', 'Digital_reference',
      'Copies', 'copy.number',
    ].includes(name);
  },
});

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const klossOnly = args.includes('--kloss-only');
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const maxRecords = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ── Fetch one batch from the API ─────────────────────────────────────

async function fetchBatch(startFrom, search = 'all') {
  const params = new URLSearchParams({
    command: 'search',
    database: 'fullCatalogue',
    search,
    xmltype: 'grouped',
    output: 'xml',
    startfrom: String(startFrom),
    limit: String(BATCH_SIZE),
  });

  const url = `${API_BASE}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${res.statusText}`);
  }

  const xml = await res.text();
  const parsed = xmlParser.parse(xml);

  const adlib = parsed.adlibXML || parsed.adLibXML;
  if (!adlib) {
    throw new Error('Unexpected XML structure — no adlibXML root');
  }

  const diagnostic = adlib.diagnostic || {};
  const totalHits = parseInt(diagnostic.hits || '0', 10);
  const firstItem = parseInt(diagnostic.first_item || '0', 10);

  const recordList = adlib.recordList?.record || [];
  const records = Array.isArray(recordList) ? recordList : [recordList];

  return { totalHits, firstItem, records };
}

// ── Normalize a raw XML record into a clean document ─────────────────

function normalizeRecord(raw) {
  // Deep value extractor — handles Axiell's nested {value: {#text, @_lang}} structure
  const extractText = (val) => {
    if (!val) return null;
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val)) {
      return val.map(extractText).filter(Boolean);
    }
    if (typeof val === 'object') {
      // {value: ...} wrapper
      if (val.value !== undefined) return extractText(val.value);
      // {#text: "...", @_lang: "..."} leaf
      if (val['#text'] !== undefined) return String(val['#text']).trim();
      return null;
    }
    return null;
  };

  const getString = (val) => {
    const result = extractText(val);
    if (Array.isArray(result)) return result[0] || null;
    return result;
  };

  const getArray = (val) => {
    const result = extractText(val);
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  };

  // Axiell grouped XML nests fields: Title.title.value, Author.author.name, etc.
  const priref = getString(raw['@_priref'] || raw.priref);

  // Title: <Title><title><value>...</value></title></Title>
  const titleGroup = raw.Title;
  const titleObj = Array.isArray(titleGroup) ? titleGroup[0] : titleGroup;
  const titleField = titleObj?.title;
  const titleVal = Array.isArray(titleField) ? titleField[0] : titleField;
  const title = getString(titleVal);

  // Author: <Author><author.name>...</author.name></Author>
  const authorGroup = raw.Author;
  const authors = [];
  if (authorGroup) {
    const authorList = Array.isArray(authorGroup) ? authorGroup : [authorGroup];
    for (const a of authorList) {
      const name = getString(a['author.name']);
      if (name) authors.push(name);
    }
  }

  const year = getString(raw.year_of_publication || raw.search_year || raw.production_date);
  const place = getString(raw.place_of_publication);
  const publisher = getString(raw.publisher);
  const materialType = getString(raw.material_type);
  const pagination = getString(raw.pagination);
  const shelfMark = getString(raw.shelf_mark || raw.current_location);

  // Notes: <notes><value>...</value></notes>
  const notesRaw = raw.notes;
  const notes = [];
  if (notesRaw) {
    const noteList = Array.isArray(notesRaw) ? notesRaw : [notesRaw];
    for (const n of noteList) {
      const text = getString(n);
      if (text) notes.push(text);
    }
  }

  // Keywords
  const kwGroup = raw.Keyword;
  const keywords = [];
  if (kwGroup) {
    const kwList = Array.isArray(kwGroup) ? kwGroup : [kwGroup];
    for (const kw of kwList) {
      const text = getString(kw['keyword.contents']);
      if (text) keywords.push(text);
    }
  }

  // Digital references
  const digiGroup = raw.Digital_reference;
  const digitalRefs = [];
  if (digiGroup) {
    const digiList = Array.isArray(digiGroup) ? digiGroup : [digiGroup];
    for (const d of digiList) {
      const ref = getString(d.digital_reference);
      if (ref) digitalRefs.push(ref);
    }
  }

  const language = getString(raw.language);
  const description = getString(raw.description);
  const edition = getString(raw.edition);
  const format = getString(raw.format);
  const series = getString(raw.series);

  // Detect if this is a Kloss item — match "Kl." followed by MS/B/number/colon patterns
  const allNotes = notes.join(' ');
  const isKloss = /\bKl\.\s*(MS|B)\b/i.test(allNotes)
    || /\bKl\.\s*\d/i.test(allNotes)
    || /\bKloss\b/i.test(allNotes);

  // Extract Kloss shelf mark from notes
  const klossMatch = allNotes.match(/Kl\.\s*(MS[.:]\s*[^\s,;]+|MS\s*\d+[a-z]?|\d+[a-z]?)/i);
  const klossShelfMark = klossMatch ? klossMatch[0].trim() : null;

  // Detect if already digitized
  const hasDigitalCopy = digitalRefs.length > 0;

  return {
    priref,
    title,
    authors,
    year,
    place_of_publication: place,
    publisher,
    material_type: materialType,
    pagination,
    shelf_mark: shelfMark,
    kloss_shelf_mark: klossShelfMark,
    is_kloss: isKloss,
    notes,
    keywords,
    digital_references: digitalRefs,
    has_digital_copy: hasDigitalCopy,
    language,
    description,
    edition,
    format,
    series,
    scraped_at: new Date(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const search = klossOnly ? 'notes=Kl.' : 'all';
  console.log(`Scraping CMC catalog — ${klossOnly ? 'Kloss only' : 'full catalog'}...`);

  // First batch to get total
  const first = await fetchBatch(1, search);
  const totalHits = Math.min(first.totalHits, maxRecords);
  console.log(`Total records: ${first.totalHits}${maxRecords < Infinity ? ` (limiting to ${maxRecords})` : ''}`);

  if (dryRun) {
    console.log(`\nFirst 3 records (sample):`);
    for (const r of first.records.slice(0, 3)) {
      const norm = normalizeRecord(r);
      console.log(`  - ${norm.title} (${norm.year || 'n.d.'}) [${norm.is_kloss ? 'KLOSS' : 'other'}]`);
      if (norm.authors.length) console.log(`    Authors: ${norm.authors.join(', ')}`);
      if (norm.kloss_shelf_mark) console.log(`    Kloss: ${norm.kloss_shelf_mark}`);
    }
    console.log(`\nDry run — no records written.`);
    return;
  }

  // Connect to MongoDB
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const collection = db.collection('kloss_catalog');

  // Create indexes
  await collection.createIndex({ priref: 1 }, { unique: true });
  await collection.createIndex({ is_kloss: 1 });
  await collection.createIndex({ has_digital_copy: 1 });
  await collection.createIndex({ year: 1 });
  await collection.createIndex({ 'authors': 1 });

  let totalProcessed = 0;
  let totalUpserted = 0;
  let startFrom = 1;

  while (totalProcessed < totalHits) {
    const batch = startFrom === 1 ? first : await fetchBatch(startFrom, search);

    if (batch.records.length === 0) break;

    const normalized = batch.records.map(normalizeRecord);

    // Bulk upsert
    const ops = normalized.map(doc => ({
      updateOne: {
        filter: { priref: doc.priref },
        update: { $set: doc },
        upsert: true,
      },
    }));

    const result = await collection.bulkWrite(ops, { ordered: false });
    totalUpserted += result.upsertedCount + result.modifiedCount;
    totalProcessed += batch.records.length;

    const klossCount = normalized.filter(r => r.is_kloss).length;
    const digitizedCount = normalized.filter(r => r.has_digital_copy).length;
    console.log(`  Batch ${startFrom}-${startFrom + batch.records.length - 1}: ${batch.records.length} records (${klossCount} Kloss, ${digitizedCount} digitized)`);

    startFrom += BATCH_SIZE;

    if (totalProcessed >= totalHits) break;

    // Polite delay
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Summary stats
  const stats = {
    total: await collection.countDocuments(),
    kloss: await collection.countDocuments({ is_kloss: true }),
    digitized: await collection.countDocuments({ has_digital_copy: true }),
    kloss_digitized: await collection.countDocuments({ is_kloss: true, has_digital_copy: true }),
    kloss_undigitized: await collection.countDocuments({ is_kloss: true, has_digital_copy: false }),
  };

  console.log(`\n=== Scrape Complete ===`);
  console.log(`Total records: ${stats.total}`);
  console.log(`Kloss collection: ${stats.kloss}`);
  console.log(`Already digitized: ${stats.digitized} (${stats.kloss_digitized} Kloss)`);
  console.log(`Kloss undigitized: ${stats.kloss_undigitized}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
