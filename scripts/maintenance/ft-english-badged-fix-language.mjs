#!/usr/bin/env node
/**
 * ft-english-badged-fix-language.mjs — issue #3524, Class 1.
 *
 * These books are tagged `books.language: English` while their pages are plainly
 * Hebrew, Latin, German, French or Italian. The BADGE is probably right — we may
 * well be the first English rendering — and the LANGUAGE FIELD is what is wrong.
 * So this script repairs `books.language` and never touches
 * `is_first_translation`. It is the mirror image of the Class-2 adjudication, and
 * the reason a single bulk rule over this set would have been destructive.
 *
 * Conservative by construction:
 *   - only a modal OCR language at or above MIN_SHARE of the sampled interior pages;
 *   - only tags that map to exactly one language (so "latin, english, greek" is held);
 *   - mixed-content containers (a manuscript box of loose material) are held;
 *   - every prior value is snapshotted before the write.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/ft-english-badged-fix-language.mjs <classify.json>
 *   node --env-file=.env.production.local scripts/maintenance/ft-english-badged-fix-language.mjs <classify.json> --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const MIN_SHARE = 0.75;

/** Modal OCR tag → the canonical `books.language` value. One language only. */
const CANON = {
  la: 'Latin', latin: 'Latin',
  he: 'Hebrew', hebrew: 'Hebrew',
  de: 'German', german: 'German', deutsch: 'German',
  fr: 'French', french: 'French',
  it: 'Italian', italian: 'Italian',
  nl: 'Dutch', dutch: 'Dutch',
  es: 'Spanish', spanish: 'Spanish',
  el: 'Greek', greek: 'Greek',
  ar: 'Arabic', arabic: 'Arabic',
  sa: 'Sanskrit', sanskrit: 'Sanskrit',
  ml: 'Malayalam', malayalam: 'Malayalam',
};

/** Titles that describe a heterogeneous container, where one language is a lie. */
const CONTAINER_RE = /\b(box|scrapbook|collection|miscellan|album|crest)\b/i;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INPUT = args.find((a) => a.endsWith('.json') && !a.startsWith('--'));
if (!INPUT) { console.error('Usage: ft-english-badged-fix-language.mjs <classify.json> [--apply]'); process.exit(1); }

async function main() {
  const report = JSON.parse(readFileSync(INPUT, 'utf8'));
  const stamp = report.generated_at || new Date().toISOString();
  const rows = report.rows.filter((r) => r.cls === 1);

  const plan = [], held = [];
  for (const r of rows) {
    const share = r.sampled ? r.modalCount / r.sampled : 0;
    const canon = CANON[r.modal ?? ''];
    if (!canon) { held.push({ ...r, hold: `modal "${r.modal}" does not map to one language` }); continue; }
    if (share < MIN_SHARE) { held.push({ ...r, hold: `modal share ${r.modalCount}/${r.sampled} below ${MIN_SHARE}` }); continue; }
    if (CONTAINER_RE.test(r.title)) { held.push({ ...r, hold: 'looks like a mixed-content container; one language would be a lie' }); continue; }
    if (canon === r.language) { held.push({ ...r, hold: 'already correct' }); continue; }
    plan.push({ ...r, to: canon, share });
  }

  console.log(`Class 1 in report: ${rows.length}`);
  console.log(`Repairing language on: ${plan.length}    holding: ${held.length}\n`);
  for (const p of plan) console.log(`  ${p.id}  ${p.language} -> ${p.to.padEnd(10)} (${p.modalCount}/${p.sampled})  ${p.author} — ${p.title}`);
  if (held.length) {
    console.log('\nHELD for review:');
    for (const h of held) console.log(`  ${h.id}  modal=${h.modal ?? '-'} (${h.modalCount}/${h.sampled})  ${h.author} — ${h.title}\n        ${h.hold}`);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const before = await db.collection('books').find(
    { id: { $in: plan.map((p) => p.id) } },
    { projection: { id: 1, title: 1, language: 1, original_language: 1, is_first_translation: 1, _id: 0 } },
  ).toArray();
  const backupPath = `scripts/output/ft-english-badged-language-backup-${stamp.slice(0, 10)}.json`;
  writeFileSync(backupPath, JSON.stringify({ taken_at: stamp, books: before }, null, 2));
  console.log(`\nPre-write state snapshotted to ${backupPath} (${before.length} books)`);

  if (!APPLY) {
    console.log('\nDRY-RUN — no writes. Re-run with --apply.');
    await client.close();
    return;
  }

  let n = 0;
  for (const p of plan) {
    const res = await db.collection('books').updateOne(
      { id: p.id },
      { $set: {
          language: p.to,
          updated_at: new Date(),
          'field_provenance.language': {
            source: 'ft-english-badged-fix-language',
            was: p.language,
            evidence: `modal OCR <language> "${p.modal}" on ${p.modalCount}/${p.sampled} interior content pages`,
            issue: '#3524',
            applied_at: new Date().toISOString(),
          },
        } },
    );
    n += res.modifiedCount;
  }
  console.log(`\nAPPLIED — language repaired on ${n} of ${plan.length} books. Badges untouched.`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
