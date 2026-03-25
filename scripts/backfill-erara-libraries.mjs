#!/usr/bin/env node
/**
 * Backfill contributing_library for e-rara books using OAI-PMH set codes.
 *
 * Strategy: For each known e-rara library set code, paginate through
 * ListIdentifiers to build a complete ID→library mapping. Then update
 * all our books in one pass. Much more efficient than fetching 18K manifests.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill-erara-libraries.mjs   # preview
 *   node scripts/backfill-erara-libraries.mjs               # apply
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';

// e-rara set codes → Swiss library names
// Source: e-rara.ch collection URLs and IIIF logo mapping
const SET_LIBRARY_MAP = {
  'zuz': 'Zentralbibliothek Zürich',
  'zut': 'ETH-Bibliothek Zürich',
  'bas': 'Universitätsbibliothek Basel',
  'bau_1': 'Universitätsbibliothek Basel',
  'ber': 'Universitätsbibliothek Bern',
  'gen': 'Bibliothèque de Genève',
  'bge': 'Bibliothèque de Genève',
  'gep': 'Bibliothèque de Genève',
  'snl': 'Schweizerische Nationalbibliothek (Bern)',
  'nbdig': 'Schweizerische Nationalbibliothek (Bern)',
  'lau': 'Bibliothèque cantonale et universitaire de Lausanne',
  'bcul': 'Bibliothèque cantonale et universitaire de Lausanne',
  'sgb': 'Stiftsbibliothek St. Gallen',
  'stgk': 'Kantonsbibliothek St. Gallen',
  'sol': 'Zentralbibliothek Solothurn',
  'lug': 'Biblioteca Salita dei Frati (Lugano)',
  'sha': 'Stadtbibliothek Schaffhausen',
  'thu': 'Kantonsbibliothek Thurgau',
  'gra': 'Kantonsbibliothek Graubünden (Chur)',
  'arg': 'Kantonsbibliothek Aargau',
  'win': 'Winterthurer Bibliotheken',
  'doz': 'Dokumentationsbibliothek Davos',
  'cgj': 'Stiftung der Werke von C.G. Jung (Zürich)',
  'med': 'Universitätsbibliothek Bern (Medizinhistorik)',
  'reu': 'Zentralbibliothek Zürich',  // Reutiner collection at ZB
  'doi': 'e-rara (Swiss libraries)',   // DOI redirect — could be any library
};

// Fetch all identifiers from a single set, paginating through resumptionTokens
async function fetchSetIdentifiers(setCode) {
  const ids = [];
  let url = `https://www.e-rara.ch/oai?verb=ListIdentifiers&metadataPrefix=oai_dc&set=${setCode}`;
  let pages = 0;

  while (url) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      console.log(`  [${setCode}] HTTP ${resp.status} — stopping`);
      break;
    }
    const text = await resp.text();

    // Extract identifiers (just the numeric ID)
    const matches = text.matchAll(/<identifier>(\d+)<\/identifier>/g);
    for (const m of matches) ids.push(m[1]);

    // Check for resumptionToken
    const tokenMatch = text.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/);
    if (tokenMatch && tokenMatch[1]) {
      url = `https://www.e-rara.ch/oai?verb=ListIdentifiers&resumptionToken=${encodeURIComponent(tokenMatch[1])}`;
      pages++;
      // Be gentle between pages
      await new Promise(r => setTimeout(r, 2000));
    } else {
      url = null;
    }
  }

  return ids;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // Step 1: Get all e-rara book IDs that need contributing_library
  const books = await db.collection('books').find({
    'image_source.provider': 'e-rara',
    'image_source.contributing_library': { $exists: false },
    status: { $ne: 'deleted' },
  }, { projection: { _id: 1, 'image_source.identifier': 1, erara_id: 1 } }).toArray();

  console.log(`Found ${books.length} e-rara books missing contributing_library\n`);
  if (books.length === 0) { await client.close(); return; }

  // Build a set of our erara IDs for quick lookup
  const ourIds = new Set();
  const idToBookId = new Map(); // erara_id → MongoDB _id
  for (const book of books) {
    const eraraId = String(book.image_source?.identifier || book.erara_id);
    if (eraraId) {
      ourIds.add(eraraId);
      idToBookId.set(eraraId, book._id);
    }
  }
  console.log(`Our IDs to match: ${ourIds.size}\n`);

  // Step 2: For each set, fetch all identifiers and match against our books
  const matched = new Map(); // erara_id → library name
  const setCodes = Object.keys(SET_LIBRARY_MAP).filter(s => s !== 'doi' && s !== 'book');

  for (const setCode of setCodes) {
    const libraryName = SET_LIBRARY_MAP[setCode];
    console.log(`Fetching set '${setCode}' (${libraryName})...`);

    try {
      const setIds = await fetchSetIdentifiers(setCode);
      let matchCount = 0;
      for (const id of setIds) {
        if (ourIds.has(id) && !matched.has(id)) {
          matched.set(id, libraryName);
          matchCount++;
        }
      }
      console.log(`  → ${setIds.length} records, ${matchCount} matched our books`);
    } catch (err) {
      console.log(`  → ERROR: ${err.message}`);
    }

    // Gentle delay between sets
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\nTotal matched: ${matched.size} / ${ourIds.size}`);

  // Step 3: Apply updates
  if (!DRY_RUN) {
    let updated = 0;
    const BATCH = 500;
    const entries = [...matched.entries()];

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const ops = batch.map(([eraraId, library]) => ({
        updateOne: {
          filter: { _id: idToBookId.get(eraraId) },
          update: { $set: { 'image_source.contributing_library': library } },
        }
      }));
      const result = await db.collection('books').bulkWrite(ops);
      updated += result.modifiedCount;
      console.log(`  Updated ${updated}/${entries.length}`);
    }

    // Set remaining unmatched to generic
    const unmatched = books.length - matched.size;
    if (unmatched > 0) {
      const unmatchedIds = books
        .filter(b => !matched.has(String(b.image_source?.identifier || b.erara_id)))
        .map(b => b._id);

      if (unmatchedIds.length > 0) {
        const result = await db.collection('books').updateMany(
          { _id: { $in: unmatchedIds }, 'image_source.contributing_library': { $exists: false } },
          { $set: { 'image_source.contributing_library': 'e-rara (Swiss libraries)' } },
        );
        console.log(`  Set ${result.modifiedCount} unmatched books to generic 'e-rara (Swiss libraries)'`);
      }
    }

    console.log(`\nDone. Updated ${updated} with specific libraries, ${unmatched} with generic.`);
  } else {
    // Report what would be updated
    const byLibrary = {};
    for (const [, lib] of matched) byLibrary[lib] = (byLibrary[lib] || 0) + 1;
    for (const [lib, count] of Object.entries(byLibrary).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)}  ${lib}`);
    }
    console.log(`  ${String(ourIds.size - matched.size).padStart(6)}  (unmatched → generic)`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
