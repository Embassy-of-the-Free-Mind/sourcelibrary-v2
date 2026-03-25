#!/usr/bin/env node
/**
 * Backfill image_source.contributing_library for books missing it.
 *
 * Phase 1: Single-institution providers — set name directly (no API calls).
 * Phase 2: IA books — fetch contributor from IA metadata API.
 * Phase 3: e-rara — extract holding library from OAI-PMH or manifest.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill-contributing-library.mjs          # preview
 *   node scripts/backfill-contributing-library.mjs                     # run all phases
 *   PHASE=1 node scripts/backfill-contributing-library.mjs             # run phase 1 only
 *   PHASE=2 node scripts/backfill-contributing-library.mjs             # run phase 2 only
 *   PHASE=3 node scripts/backfill-contributing-library.mjs             # run phase 3 only
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';
const PHASE = process.env.PHASE ? parseInt(process.env.PHASE) : 0; // 0 = all

// Phase 1: Single-institution provider → contributing_library name
const PROVIDER_LIBRARY_MAP = {
  'mdz': 'Bayerische Staatsbibliothek (Munich)',
  'efm': 'Embassy of the Free Mind (Bibliotheca Philosophica Hermetica)',
  'cmc_kloss': 'CMC Prins Frederik — Bibliotheca Klossiana (The Hague)',
  'bodleian': 'Bodleian Library, University of Oxford',
  'gallica': 'Bibliothèque nationale de France',
  'vatican': 'Biblioteca Apostolica Vaticana',
  'vatlib': 'Biblioteca Apostolica Vaticana',
  'cambridge': 'Cambridge University Library',
  'loc': 'Library of Congress',
  'library_of_congress': 'Library of Congress',
  'bl': 'British Library',
  'wellcome': 'Wellcome Collection',
  'etcsl': 'University of Oxford (ETCSL)',
  'cdli': 'UCLA (Cuneiform Digital Library Initiative)',
  'heidelberg': 'Universitätsbibliothek Heidelberg',
  'sbb': 'Staatsbibliothek zu Berlin',
  'onb': 'Österreichische Nationalbibliothek (Vienna)',
  'yale_beinecke': 'Yale University, Beinecke Rare Book & Manuscript Library',
  'harvard': 'Harvard University Library',
  'penn_colenda': 'University of Pennsylvania Libraries',
  'huntington': 'The Huntington Library',
  'getty': 'Getty Research Institute',
  'kyoto_rmda': 'Kyoto University Library',
  'hab': 'Herzog August Bibliothek Wolfenbüttel',
  'daotam': 'Đạo Tam (Vietnamese Buddhist Archive)',
  'qdl': 'Qatar Digital Library / British Library',
};

async function phase1(db) {
  console.log('\n=== PHASE 1: Single-institution providers ===\n');
  let totalUpdated = 0;

  for (const [provider, libraryName] of Object.entries(PROVIDER_LIBRARY_MAP)) {
    const filter = {
      'image_source.provider': provider,
      'image_source.contributing_library': { $exists: false },
      status: { $ne: 'deleted' },
    };
    const count = await db.collection('books').countDocuments(filter);
    if (count === 0) continue;

    console.log(`${provider}: ${count} books → "${libraryName}"`);
    if (!DRY_RUN) {
      const result = await db.collection('books').updateMany(filter, {
        $set: { 'image_source.contributing_library': libraryName },
      });
      console.log(`  → updated ${result.modifiedCount}`);
      totalUpdated += result.modifiedCount;
    } else {
      totalUpdated += count;
    }
  }
  console.log(`\nPhase 1 total: ${totalUpdated}`);
  return totalUpdated;
}

async function phase2(db) {
  console.log('\n=== PHASE 2: Internet Archive contributor re-fetch ===\n');

  const books = await db.collection('books').find({
    'image_source.provider': 'internet_archive',
    'image_source.contributing_library': { $exists: false },
    'image_source.identifier': { $exists: true },
    status: { $ne: 'deleted' },
  }, { projection: { _id: 1, id: 1, 'image_source.identifier': 1 } }).toArray();

  console.log(`Found ${books.length} IA books missing contributing_library`);
  if (books.length === 0) return 0;

  let updated = 0;
  let failed = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (book) => {
      const identifier = book.image_source.identifier;
      try {
        const resp = await fetch(`https://archive.org/metadata/${identifier}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) { failed++; return; }
        const data = await resp.json();
        const meta = data?.metadata;
        // Try contributor first, then fall back to sponsor or publisher
        const contributor = meta?.contributor || meta?.sponsor;
        if (!contributor || typeof contributor !== 'string') { failed++; return; }

        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { _id: book._id },
            { $set: { 'image_source.contributing_library': contributor } },
          );
        }
        updated++;
      } catch {
        failed++;
      }
    }));

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= books.length) {
      console.log(`  ${Math.min(i + BATCH_SIZE, books.length)}/${books.length} — ${updated} updated, ${failed} failed`);
    }
    // Small delay between batches to be kind to IA
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nPhase 2 total: ${updated} updated, ${failed} failed`);
  return updated;
}

// Map e-rara logo service URLs to Swiss library names
const ERARA_LOGO_MAP = {
  'http://www.ub.unibas.ch': 'Universitätsbibliothek Basel',
  'http://www.zb.uzh.ch': 'Zentralbibliothek Zürich',
  'http://www.ville-ge.ch/bge': 'Bibliothèque de Genève',
  'http://www.library.ethz.ch': 'ETH-Bibliothek Zürich',
  'http://www.ub.unibe.ch': 'Universitätsbibliothek Bern',
  'http://www.cgjung-werke.org': 'Stiftung der Werke von C.G. Jung (Zürich)',
  'http://www.unige.ch/ihr': 'Institut d\'histoire de la Réformation, Genève',
  'http://www.sbt.ti.ch/bsf/': 'Biblioteca Salita dei Frati (Lugano)',
  'www.stiftsbezirk.ch/de/stiftsbibliothek/': 'Stiftsbibliothek St. Gallen',
  'http://www.zbsolothurn.ch': 'Zentralbibliothek Solothurn',
  'www.bibliotheken-schaffhausen.ch': 'Stadtbibliothek Schaffhausen',
  'http://biblio.unibe.ch/adam': 'Universitätsbibliothek Bern (Medizinhistorik)',
  'http://www.snl.ch': 'Schweizerische Nationalbibliothek (Bern)',
  'http://www.nb.admin.ch': 'Schweizerische Nationalbibliothek (Bern)',
  'http://www.bcul.vd.ch': 'Bibliothèque cantonale et universitaire de Lausanne',
  'http://www.kantonsbibliothek.gr.ch': 'Kantonsbibliothek Graubünden (Chur)',
  'http://www.ag.ch/kantonsbibliothek': 'Kantonsbibliothek Aargau',
};

async function phase3(db) {
  console.log('\n=== PHASE 3: e-rara holding library extraction ===\n');
  console.log('Strategy: fetch IIIF manifest, extract logo.service.@id → Swiss library name\n');

  const books = await db.collection('books').find({
    'image_source.provider': 'e-rara',
    'image_source.contributing_library': { $exists: false },
    status: { $ne: 'deleted' },
    'image_source.iiif_manifest': { $exists: true },
  }, { projection: { _id: 1, 'image_source.iiif_manifest': 1 } }).toArray();

  console.log(`Found ${books.length} e-rara books missing contributing_library`);
  if (books.length === 0) return 0;

  let updated = 0;
  let failed = 0;
  let unmapped = 0;
  let retried = 0;
  const unmappedLogos = {};
  // Gentle rate: 5 concurrent, 1s between batches — ~5 req/s
  const BATCH_SIZE = 5;
  const DELAY_MS = 1000;
  const MAX_RETRIES = 2;

  async function fetchLibrary(book, attempt = 0) {
    try {
      const resp = await fetch(book.image_source.iiif_manifest, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      });
      if (resp.status === 429 || resp.status === 503) {
        // Rate limited — back off and retry
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
          retried++;
          return fetchLibrary(book, attempt + 1);
        }
        return null;
      }
      if (!resp.ok) return null;
      const manifest = await resp.json();

      const logoUrl = manifest?.logo?.service?.['@id'];
      let library = logoUrl ? ERARA_LOGO_MAP[logoUrl] : null;

      if (!library && logoUrl) {
        for (const [pattern, name] of Object.entries(ERARA_LOGO_MAP)) {
          try {
            const host = new URL(pattern.startsWith('http') ? pattern : `http://${pattern}`).hostname;
            if (logoUrl.includes(host)) { library = name; break; }
          } catch { /* skip bad URLs */ }
        }
      }

      if (!library) {
        library = 'e-rara (Swiss libraries)';
        unmapped++;
        if (logoUrl) unmappedLogos[logoUrl] = (unmappedLogos[logoUrl] || 0) + 1;
      }
      return library;
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        retried++;
        return fetchLibrary(book, attempt + 1);
      }
      return null;
    }
  }

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(batch.map(async (book) => {
      const library = await fetchLibrary(book);
      if (!library) { failed++; return; }
      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { _id: book._id },
          { $set: { 'image_source.contributing_library': library } },
        );
      }
      updated++;
    }));

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= books.length) {
      console.log(`  ${Math.min(i + BATCH_SIZE, books.length)}/${books.length} — ${updated} updated (${unmapped} unmapped), ${failed} failed, ${retried} retries`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  if (Object.keys(unmappedLogos).length > 0) {
    console.log('\nUnmapped logo URLs (add to ERARA_LOGO_MAP):');
    for (const [url, count] of Object.entries(unmappedLogos).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${url}`);
    }
  }

  console.log(`\nPhase 3 total: ${updated} updated (${unmapped} fell back to generic), ${failed} failed`);
  return updated;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  let total = 0;
  if (PHASE === 0 || PHASE === 1) total += await phase1(db);
  if (PHASE === 0 || PHASE === 2) total += await phase2(db);
  if (PHASE === 0 || PHASE === 3) total += await phase3(db);

  // Final count
  const remaining = await db.collection('books').countDocuments({
    status: { $ne: 'deleted' },
    pages_count: { $gt: 0 },
    'image_source.contributing_library': { $exists: false },
  });

  console.log(`\n=== DONE ===`);
  console.log(`Total updated: ${total}`);
  console.log(`Still missing: ${remaining}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
