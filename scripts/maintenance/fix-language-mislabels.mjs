#!/usr/bin/env node
/**
 * fix-language-mislabels.mjs — apply HIGH-confidence language fixes (#2780)
 *
 * Reads a report produced by
 *   scripts/analysis/detect-language-mislabels.mjs
 * and corrects `books.language` for HIGH-CONFIDENCE rows only — the
 * unambiguous ones, where a non-English `original_language` proves the book
 * is not an English original.
 *
 * Why: those books are mistagged `language: English`. The bug (a) risks a
 * wrong FT demote if anything treats language=English as "English original",
 * and (b) wrongly excludes them from the FT-eligible census denominator
 * (readable + non-English). Fixing `language` KEEPS the badge and fixes the
 * count.
 *
 * SAFETY:
 *   - DRY-RUN by default. Writes only with --apply.
 *   - Touches ONLY the `language` field. Never the is_first_translation badge,
 *     never original_language, never anything else.
 *   - Backs up (id, mongo_id, old language) to a timestamped JSON BEFORE any
 *     write.
 *   - HIGH-confidence rows only (confidence === 'high' && proposed_language set).
 *     Medium/low/ambiguous rows are skipped — they need human review.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   # dry run (default):
 *   node scripts/maintenance/fix-language-mislabels.mjs scripts/output/ft-language-mislabel-<date>.json
 *   # apply (gated on Derek):
 *   node scripts/maintenance/fix-language-mislabels.mjs scripts/output/ft-language-mislabel-<date>.json --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');

function parseArgs(argv) {
  const args = argv.slice(2);
  const apply = args.includes('--apply');
  const reportPath = args.find((a) => !a.startsWith('--'));
  return { apply, reportPath };
}

async function main() {
  const { apply, reportPath } = parseArgs(process.argv);

  if (!reportPath) {
    console.error(
      'Usage: node scripts/maintenance/fix-language-mislabels.mjs <report.json> [--apply]',
    );
    process.exit(1);
  }
  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const allRows = Array.isArray(report.rows) ? report.rows : [];

  // HIGH-confidence only, with a concrete proposed language.
  const targets = allRows.filter(
    (r) =>
      r.confidence === 'high' &&
      r.proposed_language &&
      String(r.proposed_language).trim(),
  );

  console.log(`\n=== fix-language-mislabels (#2780) ===`);
  console.log(`Report:        ${reportPath}`);
  console.log(`Mode:          ${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log(`Total rows:    ${allRows.length}`);
  console.log(`HIGH-conf targets (would change): ${targets.length}`);
  console.log(
    `Skipped (medium/low/ambiguous, need review): ${allRows.length - targets.length}`,
  );

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  await withMongo(
    async (db) => {
      const books = db.collection('books');
      const backup = [];
      const diffPreview = [];
      let changed = 0;
      let alreadyCorrect = 0;
      let notFound = 0;

      for (const row of targets) {
        // Prefer string `id`; fall back to Mongo _id. (books.id != _id.)
        let book = null;
        if (row.id) book = await books.findOne({ id: row.id }, { projection: { language: 1 } });
        if (!book && row.mongo_id) {
          try {
            book = await books.findOne(
              { _id: new ObjectId(row.mongo_id) },
              { projection: { language: 1 } },
            );
          } catch {
            /* non-ObjectId _id (e.g. uuid stored as _id) — ignore */
          }
        }
        if (!book) {
          notFound += 1;
          continue;
        }

        const oldLang = book.language;
        const newLang = String(row.proposed_language).trim();

        if (oldLang === newLang) {
          alreadyCorrect += 1;
          continue;
        }

        backup.push({
          id: row.id,
          mongo_id: String(book._id),
          old_language: oldLang,
          new_language: newLang,
        });
        diffPreview.push(
          `  ${(row.id || row.mongo_id || '').padEnd(40)} ${String(oldLang).padEnd(10)} -> ${newLang}   ${(row.title || '').slice(0, 40)}`,
        );
        changed += 1;
      }

      console.log(`\nWould change: ${changed}`);
      console.log(`Already correct (skip): ${alreadyCorrect}`);
      console.log(`Not found in DB (skip): ${notFound}`);
      console.log('\nDiff preview (old -> new):');
      console.log(diffPreview.slice(0, 50).join('\n'));
      if (diffPreview.length > 50) {
        console.log(`  ... and ${diffPreview.length - 50} more`);
      }

      if (!apply) {
        console.log(
          '\nDRY-RUN — no writes made. Re-run with --apply to write (touches ONLY `language`).',
        );
        return;
      }

      if (backup.length === 0) {
        console.log('\nNothing to write after diffing. Done.');
        return;
      }

      // Back up BEFORE writing.
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        OUT_DIR,
        `language-mislabel-backup-${stamp}.json`,
      );
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      console.log(`\nBackup written: ${backupPath} (${backup.length} rows)`);

      // Apply — ONLY the `language` field. Match by the same _id we read.
      let written = 0;
      for (const b of backup) {
        const res = await books.updateOne(
          { _id: ObjectIdOrString(b.mongo_id) },
          { $set: { language: b.new_language } },
        );
        if (res.modifiedCount === 1) written += 1;
      }
      console.log(`\nApplied: ${written}/${backup.length} language fields updated.`);
      if (written !== backup.length) {
        console.warn(
          `WARNING: ${backup.length - written} updates did not modify a doc. ` +
            `Backup at ${backupPath} reflects intended changes.`,
        );
      }
    },
    { timeoutMs: 300000 },
  );
}

// Some books store a uuid string as _id; most use ObjectId. Match either.
function ObjectIdOrString(idStr) {
  try {
    return new ObjectId(idStr);
  } catch {
    return idStr;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
