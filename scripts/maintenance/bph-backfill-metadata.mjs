#!/usr/bin/env node
/**
 * Backfill the rich BPH catalog metadata onto already-ingested books.
 * Idempotent: re-running on a book updates the same record in place.
 *
 * Use when the ingest script's metadata block has been expanded and existing
 * books need their `metadata.*`, `image_source.*`, `dublin_core.*`,
 * `field_provenance.*`, `source_fingerprint`, and `bph_match.*` rewritten
 * from the current `bph_works` row.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/bph-backfill-metadata.mjs --book-id 6a18a7f60ce3f7b4466f03eb
 *   node scripts/maintenance/bph-backfill-metadata.mjs --all-manuscripts   # every ingested BPH manuscript
 *   node scripts/maintenance/bph-backfill-metadata.mjs --dry-run --book-id <id>
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const mongo = new MongoClient(process.env.MONGODB_URI);

const { values: args } = parseArgs({ options: {
  'book-id': { type: 'string' },
  'all-manuscripts': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
} });

if (!args['book-id'] && !args['all-manuscripts']) {
  console.error('usage: --book-id <mongo-id> | --all-manuscripts  [--dry-run]');
  process.exit(1);
}

await mongo.connect();
const db = mongo.db('bookstore');

// Find target books
let books;
if (args['book-id']) {
  const b = await db.collection('books').findOne({ id: args['book-id'] });
  books = b ? [b] : [];
} else {
  books = await db.collection('books').find({
    'image_source.provider': 'bph',
    'image_source.source_id': /^RIT00\d+/,
    'pipeline_auto.source': 'bph-nas-ingest',
  }).toArray();
}
console.log(`Backfilling ${books.length} books${args['dry-run'] ? ' (DRY RUN)' : ''}\n`);

for (const book of books) {
  const barcode = book.image_source?.source_id;
  if (!barcode) { console.log(`  SKIP ${book.id} — no source_id`); continue; }

  const { data: work, error } = await sb.from('bph_works').select('*').eq('picturae_barcode', barcode).single();
  if (error || !work) { console.log(`  SKIP ${book.id} ${barcode} — no bph_works row`); continue; }

  const now = new Date();
  const provCatalog = {
    source: 'bph-backfill-metadata',
    upstream: 'bph_works (Supabase)',
    origin: 'EFM/BPH Memorix cataloging system',
    method: 'bulk-import',
    confidence: 1.0,
    date: now.toISOString(),
  };
  const provIf = (v) => (v === null || v === undefined || v === '' ? undefined : provCatalog);
  const sourceFingerprint = work.ubn ? `dc:${work.ubn}` : `bph:${barcode}`;
  const dcIdentifier = work.ubn || barcode;
  const dcSource = work.ubn
    ? `BPH Catalogue (UBN: ${work.ubn}) / Picturae DAM (${barcode})`
    : `BPH Catalogue / Picturae DAM (${barcode})`;

  const update = {
    source_fingerprint: sourceFingerprint,
    'image_source.source_url': null,
    'image_source.identifier': work.ubn || null,
    'dublin_core.dc_identifier': dcIdentifier,
    'dublin_core.dc_source': dcSource,
    'field_provenance.title': provCatalog,
    'field_provenance.display_title': provCatalog,
    'field_provenance.author': provIf(work.author),
    'field_provenance.published': provIf(work.year || work.ms_date),
    'field_provenance.publisher': provIf(work.publisher),
    'field_provenance.place_published': provIf(work.place),
    'field_provenance.language': provIf(work.language),
    'field_provenance.categories': provCatalog,
    'field_provenance.dublin_core': provCatalog,
    'field_provenance.metadata': provCatalog,
    'field_provenance.contributing_library': provCatalog,
    metadata: {
      shelf_mark: work.shelf_mark,
      ubn: work.ubn,
      memorix_uuid: work.uuid,
      picturae_barcode: barcode,
      record_type: work.record_type,
      uniform_title: work.uniform_title,
      full_title: work.full_title,
      ms_date: work.ms_date,
      year: work.year,
      year_raw: work.year_raw,
      script: work.script,
      scribe: work.scribe,
      binding: work.binding,
      physical_description: work.physical_description,
      object_size_cm: work.object_size_cm,
      illumination_illustration: work.illumination_illustration,
      iconography: work.iconography,
      contents: work.contents,
      characterization: work.characterization,
      origin: work.origin,
      provenance: work.provenance,
      acquisition_source: work.acquisition_source,
      acquisition_date: work.acquisition_date,
      edition_note: work.edition_note,
      remarks: work.remarks,
      bibliography: work.bibliography,
      annotation: work.annotation,
      fully_approved: work.fully_approved,
      publish_scan: work.publish_scan,
      memorix_file_count: work.memorix_file_count,
      memorix_total_file_bytes: work.memorix_total_file_bytes,
      memorix_modified_time: work.memorix_modified_time,
    },
    'bph_match.bph_works_id': work.id,
    'bph_match.memorix_uuid': work.uuid,
    updated_at: now,
  };

  // Strip undefined values from metadata + field_provenance
  for (const k of Object.keys(update.metadata)) {
    if (update.metadata[k] === null || update.metadata[k] === undefined || update.metadata[k] === '') {
      delete update.metadata[k];
    }
  }

  const newFieldCount = Object.keys(update.metadata).length;
  const oldFieldCount = Object.keys(book.metadata || {}).length;
  console.log(`  ${work.shelf_mark || '?'.padEnd(8)}  ${book.id}  metadata: ${oldFieldCount} → ${newFieldCount} fields`);

  if (args['dry-run']) continue;

  await db.collection('books').updateOne({ id: book.id }, { $set: update });
}

await mongo.close();
console.log(args['dry-run'] ? '\n(dry run — no writes)' : '\nDone.');
