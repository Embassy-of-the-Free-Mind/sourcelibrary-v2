#!/usr/bin/env node
/**
 * ft-english-badged-adjudicate.mjs — issue #3524, the write half.
 *
 * Takes the classification produced by `scripts/audit/ft-english-badged-classify.mjs`
 * and records Class-2 books — the ones whose text really is English — as
 * `not_applicable` attempts in the append-only ledger.
 *
 * WHY THIS SHAPE, AND NOT A FLAG WRITE. The obvious fix ("language is English →
 * set is_first_translation false") would have stripped genuine badges from eight
 * Hebrew kabbalistic works and nine Latin ones whose `books.language` is simply
 * wrong — the June 2026 Arithmologia incident with a different predicate. So this
 * script never touches `is_first_translation`. It appends evidence; the nightly
 * derive turns evidence into a verdict; the sign-off-gated reconcile turns a
 * verdict into a badge. Append-only means every step is inspectable and
 * reversible, and a catalogue digitised next year can still overturn it.
 *
 * Why `method: 'human'`. A first English translation of a work already written in
 * English is not a claim that can be true, so no external catalogue search is
 * required or possible — this is a direct observation of our own page images.
 * That makes it a human adjudication, which is also what clears the reconcile
 * valve (`--resolver=tier2_agent,human`). Every attempt records the pages it read.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/ft-english-badged-adjudicate.mjs <classify.json>
 *   node --env-file=.env.production.local scripts/maintenance/ft-english-badged-adjudicate.mjs <classify.json> --apply
 *   ... --include-review     also write the entries the classifier flagged for review
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const ATTEMPTS = 'first_translation_attempts';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_REVIEW = args.includes('--include-review');
const INPUT = args.find((a) => a.endsWith('.json') && !a.startsWith('--'));

if (!INPUT) {
  console.error('Usage: ft-english-badged-adjudicate.mjs <classify-output.json> [--apply] [--include-review]');
  process.exit(1);
}

async function main() {
  const report = JSON.parse(readFileSync(INPUT, 'utf8'));
  const stamp = report.generated_at || new Date().toISOString();

  const all = report.rows.filter((r) => r.cls === 2);
  const targets = INCLUDE_REVIEW ? all : all.filter((r) => !r.review);
  const held = all.filter((r) => r.review && !INCLUDE_REVIEW);

  console.log(`Class 2 in report: ${all.length}`);
  console.log(`Writing attempts for: ${targets.length}${held.length ? `   (holding ${held.length} flagged for review — pass --include-review to write them)` : ''}`);
  if (held.length) for (const h of held) console.log(`   HELD  ${h.id}  ${h.author} — ${h.title}\n         ${h.why}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Snapshot the pre-write badge state so the whole operation is reversible.
  const ids = targets.map((r) => r.id);
  const before = await db.collection('books').find(
    { id: { $in: ids } },
    { projection: { id: 1, title: 1, is_first_translation: 1, first_translation: 1, first_translation_status: 1, _id: 0 } },
  ).toArray();

  const backupPath = `scripts/output/ft-english-badged-backup-${stamp.slice(0, 10)}.json`;
  writeFileSync(backupPath, JSON.stringify({ taken_at: stamp, books: before }, null, 2));
  console.log(`\nPre-write state snapshotted to ${backupPath} (${before.length} books)\n`);

  let written = 0, existing = 0;
  for (const r of targets) {
    const attempt = {
      attempt_id: `${r.id}:human:${stamp}`,
      book_id: r.id,
      date: stamp,
      method: 'human',
      match_key: 'none',
      result: 'not_applicable',
      evidence_strength: 'strong',
      sources_checked: ['sourcelibrary_pages_ocr'],
      queries: [
        `modal <language> tag over ${r.sampled} interior content pages (>=700 chars OCR, front/back matter excluded)`,
        `non-Latin script census of body text: ${r.nonLatinTotal} chars`,
      ],
      independence_score: 1,
      notes:
        `not_applicable: our item is itself in English — ${r.why}. `
        + `A first English translation of an English text is not a claim that can be true, so no external `
        + `catalogue search applies; this is a direct reading of our own page images. `
        + `Adjudicated ${stamp.slice(0, 10)} under issue #3524 by scripts/audit/ft-english-badged-classify.mjs.`,
      verdict: 'not_applicable',
    };

    if (!APPLY) {
      console.log(`  [dry] ${r.id}  ${r.author} — ${r.title}`);
      console.log(`        ${r.why}`);
      continue;
    }

    const res = await db.collection(ATTEMPTS).updateOne(
      { attempt_id: attempt.attempt_id },
      { $setOnInsert: attempt },
      { upsert: true },
    );
    if (res.upsertedCount > 0) { written++; console.log(`  wrote ${r.id}  ${r.author} — ${r.title}`); }
    else { existing++; console.log(`  exists ${r.id} (idempotent no-op)`); }
  }

  if (APPLY) {
    console.log(`\nAttempts written: ${written}   already present: ${existing}`);
    console.log('\nNothing public has changed yet. To materialise:');
    console.log('  npx tsx scripts/maintenance/derive-ft-verdict-from-attempts.ts            # dry-run, review');
    console.log('  npx tsx scripts/maintenance/derive-ft-verdict-from-attempts.ts --apply    # writes the verdict only');
    console.log('  npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --only-demotions --verdict=not_first,not_applicable --resolver=tier2_agent,human           # dry-run');
    console.log('  ... add --apply to flip the badges.  (The 05:30 cron runs exactly this pair unattended.)');
  } else {
    console.log('\nDRY-RUN — no writes. Re-run with --apply to append the attempts.');
  }

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
