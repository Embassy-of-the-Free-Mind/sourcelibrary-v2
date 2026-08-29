#!/usr/bin/env node
/**
 * Backfill image_source.contributing_library for books missing it.
 *
 * Phase 1: Single-institution providers — set name directly (no API calls).
 * Phase 2: IA books — fetch contributor from IA metadata API (+ call_number → shelfmark).
 * Phase 3: e-rara — extract holding library from OAI-PMH or manifest.
 * Phase 4 (#4361): books whose contributing_library IS an aggregator name
 *   ("Internet Archive" — 6,185 live books at time of writing) — replace with
 *   the IA item's `contributor`, the actual holding institution. An aggregator
 *   hosted the scan; some library owns the book, and the citation copy clause
 *   (#4360) refuses to name an aggregator, so these books cite no holder until
 *   this phase recovers the real one.
 * Phase 5 (#4361): BPH shelfmark materialization — READ Supabase `bph_works`
 *   (never write it: .claude/docs/bph-catalogue-disaster-recovery.md), copy
 *   `shelf_mark` (or the PH-shelfmark in `ubn`) onto the matched Mongo book's
 *   image_source.shelfmark when empty.
 *
 * Value-overwriting phases (4, 5) record a ROW per change in `sweep_log`
 * (field-sprawl invariant #3969) — including `no-contributor` verdicts, which
 * double as the checkpoint so re-runs skip items IA has no holder for.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill-contributing-library.mjs          # preview
 *   node scripts/backfill-contributing-library.mjs                     # run all phases
 *   PHASE=N node scripts/backfill-contributing-library.mjs             # run phase N only
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from './lib/sweep-log.mjs';

const SWEEP = 'holding-library-4361';

// Sponsors that fund scanning but hold nothing — never a contributing_library.
const JUNK_SPONSOR = /google|msn|microsoft|sloan foundation|internet archive/i;

// Aggregator values that should never stand as a holding library. Mirror of
// the read-side list in src/lib/holding-library.ts (AGGREGATORS) — the
// citation layer filters these on read; this sweep replaces them at the rows.
const AGGREGATOR_VALUES = [
  'Internet Archive',
  'archive.org',
  'Google Books',
  'Google',
  'HathiTrust',
  'Project Gutenberg',
];

const DRY_RUN = process.env.DRY_RUN === '1';
const PHASE = process.env.PHASE ? parseInt(process.env.PHASE) : 0; // 0 = all
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 0; // 0 = no cap (smoke tests)

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
        // Try contributor first, then fall back to sponsor — but a scanning
        // funder (Google, MSN, Sloan) is not a holder (#4361).
        const sponsor = typeof meta?.sponsor === 'string' && !JUNK_SPONSOR.test(meta.sponsor) ? meta.sponsor : null;
        const contributor = meta?.contributor || sponsor;
        if (!contributor || typeof contributor !== 'string') { failed++; return; }

        // IA's call_number is that holder's shelfmark for the copy — the other
        // half of the citation copy clause (#4360/#4361).
        const callNumber = typeof meta?.call_number === 'string' ? meta.call_number.trim() : '';
        if (!DRY_RUN) {
          if (callNumber) {
            await db.collection('books').updateOne(
              { _id: book._id, 'image_source.shelfmark': { $exists: false } },
              { $set: { 'image_source.shelfmark': callNumber } },
            );
          }
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

async function phase4(db) {
  console.log('\n=== PHASE 4: replace aggregator-as-holder with IA contributor (#4361) ===\n');

  // Books already resolved to "no contributor" in a previous run — the
  // sweep_log row IS the checkpoint (corpus walks need one; the selection
  // below is value-based, so without this every re-run would re-fetch the
  // whole no-contributor tail from IA).
  const settled = new Set(
    (await db.collection('sweep_log')
      .find({ sweep: SWEEP, action: 'no-contributor' }, { projection: { book_id: 1 } })
      .toArray()).map(r => r.book_id),
  );

  const books = await db.collection('books').find({
    'image_source.contributing_library': { $in: AGGREGATOR_VALUES },
    'image_source.identifier': { $exists: true },
    'image_source.provider': 'internet_archive',
    status: { $ne: 'deleted' },
  }, { projection: { _id: 1, id: 1, 'image_source.identifier': 1, 'image_source.contributing_library': 1 } }).toArray();

  let pending = books.filter(b => !settled.has(b.id));
  console.log(`${books.length} books carry an aggregator as holder; ${pending.length} unsettled`);
  if (LIMIT > 0) {
    pending = pending.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT}: processing first ${pending.length} only`);
  }
  if (pending.length === 0) return 0;

  let updated = 0;
  let noContributor = 0;
  let failed = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (book) => {
      const identifier = book.image_source.identifier;
      try {
        const resp = await fetch(`https://archive.org/metadata/${identifier}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) { failed++; return; }
        const data = await resp.json();
        const meta = data?.metadata;
        const contributor = typeof meta?.contributor === 'string' ? meta.contributor.trim() : '';
        const callNumber = typeof meta?.call_number === 'string' ? meta.call_number.trim() : '';

        // The item itself names no holder: leave the aggregator value (the
        // read-side citation layer suppresses it) and checkpoint the verdict.
        if (!contributor || AGGREGATOR_VALUES.some(a => a.toLowerCase() === contributor.toLowerCase())) {
          noContributor++;
          if (!DRY_RUN) {
            await recordSweepAction(db, {
              sweep: SWEEP, book_id: book.id, action: 'no-contributor',
              detail: { ia: identifier },
            });
          }
          return;
        }

        if (!DRY_RUN) {
          if (callNumber) {
            await db.collection('books').updateOne(
              { _id: book._id, 'image_source.shelfmark': { $exists: false } },
              { $set: { 'image_source.shelfmark': callNumber } },
            );
          }
          await db.collection('books').updateOne(
            { _id: book._id },
            { $set: { 'image_source.contributing_library': contributor } },
          );
          await recordSweepAction(db, {
            sweep: SWEEP, book_id: book.id, action: 'holder-recovered',
            detail: { from: book.image_source.contributing_library, to: contributor, ia: identifier, ...(callNumber ? { shelfmark: callNumber } : {}) },
          });
        }
        updated++;
      } catch {
        failed++;
      }
    }));

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= pending.length) {
      console.log(`  ${Math.min(i + BATCH_SIZE, pending.length)}/${pending.length} — ${updated} recovered, ${noContributor} no-contributor, ${failed} failed`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nPhase 4 total: ${updated} recovered, ${noContributor} genuinely holderless, ${failed} failed (transient — re-run retries them)`);
  return updated;
}

async function phase5(db) {
  console.log('\n=== PHASE 5: BPH shelfmark materialization from bph_works (#4361) ===\n');
  console.log('READS Supabase only — bph_works writes are catalogue-editor-only.\n');

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  );

  // supabase-js caps every response at 1,000 rows — paginate or lose data.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bph_works')
      .select('ubn, shelf_mark, sl_book_id')
      .not('sl_book_id', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`bph_works read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  console.log(`${rows.length} bph_works rows matched to a Source Library book`);

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    // shelf_mark is the physical mark; a UBN is the BPH catalogue number and
    // doubles as the shelfmark for manuscripts (PH-numbers).
    const mark = (row.shelf_mark || '').trim() || (row.ubn ? `UBN ${row.ubn}` : '');
    if (!mark) { skipped++; continue; }

    if (DRY_RUN) { updated++; continue; }
    const res = await db.collection('books').updateOne(
      {
        id: row.sl_book_id,
        $or: [
          { 'image_source.shelfmark': { $exists: false } },
          { 'image_source.shelfmark': { $in: [null, ''] } },
        ],
      },
      { $set: { 'image_source.shelfmark': mark } },
    );
    if (res.modifiedCount > 0) {
      updated++;
      await recordSweepAction(db, {
        sweep: SWEEP, book_id: row.sl_book_id, action: 'bph-shelfmark',
        detail: { shelfmark: mark, ubn: row.ubn ?? null },
      });
    } else {
      skipped++; // already has a shelfmark, or the book row is gone
    }
  }

  console.log(`\nPhase 5 total: ${updated} shelfmarks set, ${skipped} skipped (no mark / already set / unmatched)`);
  return updated;
}

async function phase6(db) {
  console.log('\n=== PHASE 6: consolidate TOP-LEVEL contributing_library/shelfmark into image_source (#4361) ===\n');
  console.log('3,860 live books carry the holder only at top level (field sprawl); image_source is canonical.\n');

  let total = 0;
  for (const [from, to] of [
    ['contributing_library', 'image_source.contributing_library'],
    ['shelfmark', 'image_source.shelfmark'],
  ]) {
    const filter = {
      [from]: { $nin: [null, ''] },
      $or: [{ [to]: { $exists: false } }, { [to]: { $in: [null, ''] } }],
      status: { $ne: 'deleted' },
    };
    const count = await db.collection('books').countDocuments(filter);
    console.log(`${from} → ${to}: ${count} books`);
    if (count === 0 || DRY_RUN) { total += count; continue; }

    // Set-if-empty copy; the top-level twin stays for now — removing a field
    // 3,860 rows' READERS may still expect is its own change, not a side
    // effect of a backfill.
    const cursor = db.collection('books').find(filter, { projection: { _id: 1, id: 1, [from.split('.')[0]]: 1 } });
    for await (const book of cursor) {
      const value = book[from];
      if (typeof value !== 'string' || !value.trim()) continue;
      const res = await db.collection('books').updateOne(
        { _id: book._id, $or: [{ [to]: { $exists: false } }, { [to]: { $in: [null, ''] } }] },
        { $set: { [to]: value.trim() } },
      );
      if (res.modifiedCount > 0) {
        total++;
        await recordSweepAction(db, {
          sweep: SWEEP, book_id: book.id, action: 'consolidated-to-image-source',
          detail: { field: from, value: value.trim() },
        });
      }
    }
    console.log(`  → done`);
  }
  console.log(`\nPhase 6 total: ${total}`);
  return total;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  let total = 0;
  if (PHASE === 0 || PHASE === 1) total += await phase1(db);
  if (PHASE === 0 || PHASE === 2) total += await phase2(db);
  if (PHASE === 0 || PHASE === 3) total += await phase3(db);
  if (PHASE === 0 || PHASE === 4) total += await phase4(db);
  if (PHASE === 0 || PHASE === 5) total += await phase5(db);
  if (PHASE === 0 || PHASE === 6) total += await phase6(db);

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
