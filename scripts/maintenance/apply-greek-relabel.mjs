#!/usr/bin/env node
/**
 * apply-greek-relabel.mjs — apply the FREE, reversible language relabel for
 * issue #2761 (Greek facing-page editions mislabeled language:'English').
 *
 * Reads the plan emitted by scripts/analysis/detect-greek-mislabel.mjs --plan,
 * backs up each book's current language, and sets language -> proposed (Greek).
 * Does NOT touch visibility, text_role, or any translation — relabel only
 * unblocks future real translation (the passthrough prompt fires on
 * language==='English'); it does not re-translate existing pages.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/apply-greek-relabel.mjs plan.json            # dry-run (default)
 *   node scripts/maintenance/apply-greek-relabel.mjs plan.json --apply    # write
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const planPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!planPath) { console.error('usage: apply-greek-relabel.mjs <plan.json> [--apply]'); process.exit(1); }
const plan = JSON.parse(readFileSync(planPath, 'utf8'));

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const B = mc.db('bookstore').collection('books');

const backup = [];
let changed = 0;
for (const item of plan) {
  const _id = ObjectId.createFromHexString(item._id);
  const book = await B.findOne({ _id }, { projection: { language: 1, title: 1 } });
  if (!book) { console.log(`SKIP ${item._id} (not found)`); continue; }
  if (book.language === item.to.language) { console.log(`SKIP ${item._id} (already ${item.to.language})`); continue; }
  backup.push({ _id: item._id, title: book.title, from_language: book.language, to_language: item.to.language });
  console.log(`${APPLY ? 'RELABEL' : 'WOULD RELABEL'} ${item._id} "${(book.title||'').slice(0,70)}" : ${book.language} -> ${item.to.language} (greek ${item.greekFrac}%)`);
  if (APPLY) {
    await B.updateOne({ _id }, {
      $set: {
        language: item.to.language,
        language_relabel: {
          from: book.language, to: item.to.language, issue: 2761,
          reason: 'Greek facing-page edition mislabeled English; relabel unblocks real translation (passthrough prompt fires on language===English).',
          greek_page_fraction: item.greekFrac, at: new Date().toISOString(),
        },
      },
    });
    changed++;
  }
}
const backupPath = planPath.replace(/\.json$/, '') + '-backup.json';
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log(`\n${APPLY ? `Applied ${changed} relabels.` : `Dry-run: ${backup.length} books would change.`} Backup: ${backupPath}`);
await mc.close();
