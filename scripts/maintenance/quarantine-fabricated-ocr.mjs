#!/usr/bin/env node
/**
 * Quarantine OCR that was invented for a blank page (#4149).
 *
 * WHAT IT DOES, IN ORDER, PER PAGE
 *   1. Re-downloads the page image and re-measures ink coverage RIGHT NOW.
 *      The detector's JSONL is a work list, never an authority — a stale file
 *      must not be able to delete a page's text.
 *   2. Writes the existing OCR into `page_revisions` with
 *      `source: 'quarantine-fabricated-2026-08'`, so nothing is destroyed and
 *      the fabrication stays auditable.
 *   3. Also appends the full prior document to a local JSONL backup.
 *   4. Only then `$unset`s `pages.ocr`, which removes the invented text from
 *      every read path and returns the page to the OCR queue.
 *
 * WHY UNSET RATHER THAN CORRECT: a blank leaf has no correct transcription.
 * Leaving the text in place with a flag would keep it in exports, embeddings
 * and the MCP tools, all of which read `ocr.data` and none of which check flags.
 *
 * SAFETY
 *   - Dry-run by default. `--apply` is required to write.
 *   - Refuses any page whose image cannot be fetched or whose ink coverage is
 *     above the threshold: unreadable is NOT evidence of fabrication.
 *   - Refuses to run without `--reason` naming the issue.
 *   - Caps at `--max` pages per run (default 200).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/quarantine-fabricated-ocr.mjs --in=scripts/output/fabricated-ocr.jsonl --reason=#4149
 *   node scripts/maintenance/quarantine-fabricated-ocr.mjs --in=… --reason=#4149 --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inkCoverage } from '../audit/detect-fabricated-ocr.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const APPLY = process.argv.includes('--apply');
const IN = arg('in', 'scripts/output/fabricated-ocr.jsonl');
const REASON = arg('reason', '');
const INK_MAX = Number(arg('ink', '0.004'));
const MAX = Number(arg('max', '200'));
const BACKUP = arg('backup', `scripts/output/quarantine-backup-${REASON.replace(/\W+/g, '')}.jsonl`);

if (!REASON) {
  console.error('--reason=#NNNN is required; it is written onto every revision row.');
  process.exit(2);
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  if (!fs.existsSync(IN)) { console.error(`no work list at ${IN}`); process.exit(1); }

  const work = fs.readFileSync(IN, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.verdict === 'FABRICATED');
  console.log(`${work.length} pages proposed by ${IN}`);
  if (!work.length) return;

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const revisions = db.collection('page_revisions');

  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  const backup = fs.createWriteStream(BACKUP, { flags: 'a' });

  let checked = 0, confirmed = 0, refused = 0, written = 0;
  const refusals = [];

  for (const row of work.slice(0, MAX)) {
    checked++;
    const doc = await pages.findOne(
      { book_id: row.book_id, page_number: row.page },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, ocr: 1, display_photo: 1, archived_photo: 1, photo: 1 } }
    );
    if (!doc) { refused++; refusals.push(`${row.book_id} p.${row.page}: page not found`); continue; }
    if (!doc.ocr?.data) { refused++; refusals.push(`${row.book_id} p.${row.page}: no OCR (already cleared?)`); continue; }

    const url = doc.display_photo || doc.archived_photo || doc.photo;
    if (!url) { refused++; refusals.push(`${row.book_id} p.${row.page}: no image URL — cannot verify`); continue; }

    let ink = null;
    try {
      const res = await fetch(url);
      if (res.ok) ink = await inkCoverage(Buffer.from(await res.arrayBuffer()));
    } catch { /* fall through to refusal */ }

    if (!ink) { refused++; refusals.push(`${row.book_id} p.${row.page}: image unreadable — NOT quarantining`); continue; }
    if (ink.coverage > INK_MAX) {
      refused++;
      refusals.push(`${row.book_id} p.${row.page}: ink ${(ink.coverage * 100).toFixed(3)}% > ${(INK_MAX * 100).toFixed(2)}% — page has content, NOT quarantining`);
      continue;
    }

    confirmed++;
    const chars = doc.ocr.data.length;
    console.log(`${APPLY ? 'QUARANTINE' : 'would quarantine'}  ${row.title?.slice(0, 34).padEnd(34)} p.${String(row.page).padStart(5)}  ` +
      `ink=${(ink.coverage * 100).toFixed(3)}%  ${chars}ch  ${row.langs?.join('/') || ''}`);

    if (!APPLY) continue;

    backup.write(JSON.stringify({ quarantined_at: new Date().toISOString(), reason: REASON, ink: ink.coverage, doc }) + '\n');
    // Match the collection's existing shape — `id` (string) carries a UNIQUE
    // index, so a row without one collides with any other id-less row on the
    // second insert. Field names follow the rows already there
    // (`field`/`data`/`source`), because `.claude/docs/data-provenance.md`
    // requires this collection be segmentable by `source`.
    await revisions.insertOne({
      id: randomUUID().replace(/-/g, '').slice(0, 12),
      page_id: doc.id,
      book_id: doc.book_id,
      page_number: doc.page_number,
      field: 'ocr',
      data: doc.ocr.data,
      source: 'quarantine-fabricated-2026-08',
      model: doc.ocr.model ?? null,
      language: doc.ocr.language ?? null,
      reason: REASON,
      note: `OCR removed: page image ink coverage ${(ink.coverage * 100).toFixed(3)}% (blank) while OCR asserted ${chars} characters.`,
      previous_ocr: doc.ocr,
      created_at: new Date(),
    });
    const res = await pages.updateOne({ _id: doc._id }, { $unset: { ocr: '' } });
    if (res.modifiedCount === 1) written++;
    else refusals.push(`${row.book_id} p.${row.page}: update reported modifiedCount ${res.modifiedCount}`);
  }

  await new Promise((r) => backup.end(r));
  await client.close();

  console.log(`\nchecked ${checked} · re-confirmed blank ${confirmed} · refused ${refused}`);
  if (refusals.length) {
    console.log('\nrefusals (each one is a page NOT touched):');
    for (const r of refusals.slice(0, 40)) console.log('  ' + r);
  }
  if (APPLY) {
    console.log(`\nOCR unset on ${written} pages. Prior text preserved in page_revisions and ${BACKUP}.`);
    console.log('These pages now have no OCR and will be picked up by the pipeline for a fresh pass.');
  } else {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to quarantine.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
