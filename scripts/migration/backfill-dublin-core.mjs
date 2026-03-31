#!/usr/bin/env node
/**
 * Backfill dublin_core fields from AI enrichment data.
 *
 * Maps existing book fields to proper Dublin Core:
 *   title/display_title → dc_title (handled at read time)
 *   author → dc_creator (handled at read time)
 *   categories + subject_keywords → dc_subject
 *   ai_metadata.description → dc_description
 *   year_published → dc_date (handled at read time)
 *   language → dc_language (handled at read time)
 *   image_source.provider_name → dc_publisher (if not set)
 *   pages_count → dc_format
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/backfill-dublin-core.mjs
 *   set -a; source .env.production.local; set +a; node scripts/migration/backfill-dublin-core.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[dc-backfill] ${DRY_RUN ? 'DRY RUN — ' : ''}Starting`);

  // Find books with AI enrichment but sparse dublin_core
  const cursor = db.collection('books').find({
    pages_ocr: { $gt: 0 },
  }).project({
    id: 1, title: 1, display_title: 1, author: 1, language: 1,
    year_published: 1, categories: 1, subject_keywords: 1,
    ai_metadata: 1, dublin_core: 1, image_source: 1, pages_count: 1,
    ustc_sn: 1, doi: 1,
  });

  let updated = 0;
  let skipped = 0;
  let batch = [];

  while (await cursor.hasNext()) {
    const book = await cursor.next();
    const dc = book.dublin_core || {};
    const updates = {};

    // dc_subject: merge categories + keywords
    const subjects = new Set([
      ...(dc.dc_subject || []),
      ...(book.categories || []),
      ...(book.subject_keywords || []),
    ]);
    if (subjects.size > 0 && (!dc.dc_subject || dc.dc_subject.length < subjects.size)) {
      updates['dublin_core.dc_subject'] = [...subjects];
    }

    // dc_description
    if (!dc.dc_description && book.ai_metadata?.description) {
      updates['dublin_core.dc_description'] = book.ai_metadata.description;
    }

    // dc_publisher
    if (!dc.dc_publisher && book.image_source?.provider_name) {
      updates['dublin_core.dc_publisher'] = book.image_source.provider_name;
    }

    // dc_type
    if (!dc.dc_type) {
      updates['dublin_core.dc_type'] = 'Text';
    }

    // dc_format
    if (!dc.dc_format && book.pages_count) {
      updates['dublin_core.dc_format'] = `${book.pages_count} pages`;
    }

    // dc_language
    if (!dc.dc_language && book.language) {
      updates['dublin_core.dc_language'] = book.language;
    }

    // dc_rights
    if (!dc.dc_rights) {
      updates['dublin_core.dc_rights'] = 'CC BY-SA 4.0';
    }

    // dc_identifier: add USTC and DOI if missing
    const existingIds = new Set(dc.dc_identifier || []);
    const newIds = [...existingIds];
    if (book.ustc_sn && !existingIds.has(`USTC:${book.ustc_sn}`)) {
      newIds.push(`USTC:${book.ustc_sn}`);
    }
    if (book.doi && !existingIds.has(`doi:${book.doi}`)) {
      newIds.push(`doi:${book.doi}`);
    }
    if (newIds.length > existingIds.size) {
      updates['dublin_core.dc_identifier'] = newIds;
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      if (updated < 5) {
        console.log(`  [dry] ${book.id} "${book.title?.substring(0, 40)}": ${Object.keys(updates).join(', ')}`);
      }
      updated++;
      continue;
    }

    batch.push({
      updateOne: {
        filter: { _id: book._id },
        update: { $set: updates },
      }
    });

    if (batch.length >= BATCH_SIZE) {
      await db.collection('books').bulkWrite(batch, { ordered: false });
      updated += batch.length;
      console.log(`[dc-backfill] Updated ${updated} books`);
      batch = [];
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await db.collection('books').bulkWrite(batch, { ordered: false });
    updated += batch.length;
  }

  console.log(`[dc-backfill] ${DRY_RUN ? 'DRY RUN ' : ''}Done: ${updated} updated, ${skipped} already complete`);
  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
