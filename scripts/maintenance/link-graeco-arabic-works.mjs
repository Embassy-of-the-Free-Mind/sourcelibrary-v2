#!/usr/bin/env node
/**
 * Link Arabic transmission witnesses to the work clusters we already hold.
 *
 * WHY THIS EXISTS. We hold the receiving end of the Graeco-Arabic chain — 296
 * Galen, 330 Hippocrates, 139 Dioscorides, 119 Euclid, overwhelmingly in Latin
 * and Greek — and almost never the Arabic end. Importing Arabic witnesses
 * without linking them produces orphans: 356 books that sit outside the very
 * work-graph that makes them meaningful. That is #4394's defect committed on
 * purpose, at scale.
 *
 * It is not hypothetical. Measured before writing this: 5 Arabic Almagest books
 * already carry NO work_id while 6 others sit correctly on Q155952; Hippocrates
 * has 11 unlinked against 8 on `local:a:hippocrates:aphorisms`.
 *
 * DESIGN — deliberately conservative, because a wrong work_id merges unrelated
 * books and that is expensive to undo:
 *   - A CURATED map, not fuzzy matching. `author-identity.md` is emphatic that a
 *     pattern is a net, never a verdict; the al-Kindi query in this same session
 *     matched al-Mutanabbi's poetry.
 *   - It only ever FILLS AN EMPTY work_id. It never overwrites, never merges two
 *     existing clusters. Cluster merging is merge-work-clusters.mjs, which has
 *     alias-preservation and a provenance log; this does not reimplement it.
 *   - Every target id is one we ALREADY hold books on, so nothing is minted.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/link-graeco-arabic-works.mjs
 *   node --env-file=.env.production.local scripts/maintenance/link-graeco-arabic-works.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'graeco-arabic-work-linking';
const BACKUP = 'scripts/output/graeco-arabic-linking-backup.json';

// work → { id: the cluster we already hold, match: title test }
// Each `id` was read off production, not invented. See the measurement in the
// header: these are live clusters spanning Greek/Latin/Arabic already.
const MAP = [
  { work: 'Ptolemy, Almagest',        id: 'Q155952',   match: /almagest|almageste/i },
  // A title-page IMAGE is not a witness of the work.
  { work: 'Euclid, Elements',         id: 'Q172891',   match: /(euclid|uqlidis)[^.]{0,40}(element|geom|geom)/i, notMatch: /title page|frontispiece|portrait/i },
  // Require the treatise itself, not works derived FROM Dioscorides:
  // "Alphabetum empiricum sive Dioscoridis", "Fasciculus remediorum ex
  // Dioscoride et Mathiolo" are compilations, not copies.
  { work: 'Dioscorides, De Materia',  id: 'Q3704131',  match: /dioscorid/i, notMatch: /\b(ex dioscorid|sive|fasciculus|alphabetum|remediorum)\b/i },
  // `qanun` ALONE collides with al-Biruni's Canon Masudicus — different author,
  // and astronomy not medicine. Require Avicenna's name alongside it.
  // No \u escapes in any regex sent to Mongo: its PCRE2 rejects them outright,
  // and a JS-literal \u012B reaches the server as the four characters "\u01".
  // "ibn sin" already covers the transliterations we care about.
  { work: 'Avicenna, Canon',          id: 'Q55360132', match: /(avicenn|ibn sin)/i, andMatch: /canon|qanun/i, notMatch: /masudi|mas'udi/i },
  // "Aphorisms" is a GENRE. Unqualified it matched chemical, astrological,
  // legal and eucharistic aphorisms — four disciplines, none of them Hippocrates.
  { work: 'Hippocrates, Aphorisms',   id: 'local:a:hippocrates:aphorisms', match: /aphorism/i, andMatch: /hippocrat|buqrat/i },
  { work: 'Picatrix / Ghayat',        id: 'local:n:majriti-maslama-pseudo:liber-piccatricia', match: /picatrix|ghayat al-hakim/i },
  { work: 'Turba Philosophorum',      id: 'turba-philosophorum', match: /turba philosoph/i },
  { work: 'Theology of Aristotle',    id: 'local:a:aristotle:mystical-philosophy-theology', match: /theolog(ia|y) of aristotle/i },
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const plan = [];
  for (const entry of MAP) {
    // Sanity: the target cluster must actually exist. Linking into a cluster
    // that holds nothing would be minting an id by another name.
    const clusterSize = await books.countDocuments({ work_id: entry.id });
    if (clusterSize === 0) {
      console.log(`SKIP  ${entry.work}: target cluster ${entry.id} holds 0 books — refusing to mint`);
      continue;
    }

    const conds = [
      { $or: [{ title: entry.match }, { display_title: entry.match }, { english_title: entry.match }] },
      { $or: [{ work_id: { $exists: false } }, { work_id: null }, { work_id: '' }] },
    ];
    // andMatch narrows a GENRE word to a work by requiring the author too.
    if (entry.andMatch) conds.push({ $or: [{ title: entry.andMatch }, { display_title: entry.andMatch }, { english_title: entry.andMatch }] });
    let orphans = await books.find({ $and: conds }).project({ id: 1, title: 1, display_title: 1, language: 1, visible: 1 }).toArray();
    // notMatch removes derivative compilations and image records.
    if (entry.notMatch) orphans = orphans.filter(o => !entry.notMatch.test(`${o.title} ${o.display_title || ''}`));

    console.log(`\n${entry.work}`);
    console.log(`  cluster ${entry.id} — ${clusterSize} books held`);
    console.log(`  unlinked candidates: ${orphans.length}`);
    for (const o of orphans.slice(0, 6)) {
      console.log(`    [${String(o.language).padEnd(9)}] ${String(o.title).replace(/\s+/g, ' ').slice(0, 74)}`);
    }
    if (orphans.length > 6) console.log(`    … and ${orphans.length - 6} more`);
    for (const o of orphans) plan.push({ id: o.id, title: o.title, language: o.language, work_id: entry.id, work: entry.work });
  }

  console.log(`\n${plan.length} books would be linked into ${new Set(plan.map(p => p.work_id)).size} existing clusters.`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await client.close(); return; }

  mkdirSync('scripts/output', { recursive: true });
  // Merge, never overwrite: a re-run must not shrink the restore set.
  const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { sweep: SWEEP, records: {} };
  for (const p of plan) if (!backup.records[p.id]) backup.records[p.id] = { work_id: null };
  writeFileSync(BACKUP, JSON.stringify(backup, null, 1));

  let n = 0;
  for (const p of plan) {
    const res = await books.updateOne(
      // Re-assert emptiness at write time: another session may have linked it
      // since we planned, and we never overwrite someone else's answer.
      { id: p.id, $or: [{ work_id: { $exists: false } }, { work_id: null }, { work_id: '' }] },
      { $set: { work_id: p.work_id, work_id_source: 'graeco-arabic-curated', updated_at: new Date() } }
    );
    if (res.modifiedCount !== 1) { console.log(`  skipped ${p.id} (already linked since planning)`); continue; }
    n++;
    await recordSweepAction(db, {
      sweep: SWEEP, book_id: p.id, action: 'linked-to-existing-work',
      detail: { work: p.work, work_id: p.work_id, language: p.language, title: String(p.title).slice(0, 160) },
    });
  }
  console.log(`\nlinked ${n}/${plan.length}`);
  console.log('NEXT: node scripts/workers/sync-books-catalog.mjs  (books_catalog carries work_id)');
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
