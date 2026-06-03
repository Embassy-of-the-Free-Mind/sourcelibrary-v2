#!/usr/bin/env node
/**
 * unblock-recitation-books-to-lite.mjs
 *
 * One-off backfill: re-enroll books permanently benched by Gemini's RECITATION
 * filter (pipeline_auto.recitation_blocked === true) straight into the
 * gemini-3.1-flash-lite OCR retry tier.
 *
 * Context: ~14 famous published texts (Spinoza Ethics, Humboldt Kosmos,
 * Roman de la Rose, Histoire de la magie, …) were permanently blocked because
 * gemini-3-flash-preview AND the gemini-2.5-flash fallback both refused to OCR
 * them with finishReason=RECITATION. gemini-3.1-flash-lite has been verified to
 * bypass RECITATION on these texts (probe: finishReason=STOP, clean body-page
 * transcription). The pipeline now has a 3-tier escalation
 * (gemini-2.5-flash -> gemini-3.1-flash-lite -> permanent block); this script
 * fast-tracks the already-blocked books to the lite tier (skipping 2.5-flash,
 * which is the proven-to-fail model for them).
 *
 * For each blocked book it:
 *   $unset pipeline_auto.recitation_blocked
 *   $unset pipeline_auto.recitation_blocked_at
 *   $unset pipeline_auto.recitation_retry
 *   $set   pipeline_auto.recitation_retry_lite = true
 *   $set   pipeline_auto.status = 'archive_complete'
 *   touches pipeline_auto.last_updated / updated_at
 *
 * Default is DRY-RUN (prints what it WOULD change). Pass --apply to mutate.
 *
 * NOTE: run this only AFTER the orchestrator/batch-collector change is live on
 * Hetzner — otherwise the recitation_retry_lite tier won't be picked up.
 *
 * Usage:
 *   node scripts/maintenance/unblock-recitation-books-to-lite.mjs           # dry-run
 *   node scripts/maintenance/unblock-recitation-books-to-lite.mjs --apply   # mutate
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment.');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const blocked = await books
    .find(
      { 'pipeline_auto.recitation_blocked': true },
      { projection: { id: 1, title: 1, pages_count: 1, 'pipeline_auto.status': 1 } }
    )
    .toArray();

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — found ${blocked.length} recitation_blocked book(s)\n`);

  if (blocked.length === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  let changed = 0;
  for (const book of blocked) {
    const label = (book.title || '(untitled)').substring(0, 70);
    const pages = book.pages_count ?? '?';
    const curStatus = book.pipeline_auto?.status ?? '?';
    console.log(`  ${book.id} | ${pages} pages | status=${curStatus} | ${label}`);

    if (!APPLY) continue;

    const now = new Date();
    const res = await books.updateOne(
      { id: book.id },
      {
        $set: {
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.recitation_retry_lite': true,
          'pipeline_auto.last_updated': now,
          last_updated: now,
          updated_at: now,
        },
        $unset: {
          'pipeline_auto.recitation_blocked': '',
          'pipeline_auto.recitation_blocked_at': '',
          'pipeline_auto.recitation_retry': '',
        },
      }
    );
    if (res.modifiedCount === 1) changed++;
    else console.log(`    ! updateOne modifiedCount=${res.modifiedCount} for ${book.id}`);
  }

  console.log('');
  if (APPLY) {
    console.log(`Done. Re-enrolled ${changed}/${blocked.length} book(s) into the gemini-3.1-flash-lite retry tier.`);
  } else {
    console.log(`DRY-RUN complete. Would re-enroll ${blocked.length} book(s). Re-run with --apply to mutate.`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
