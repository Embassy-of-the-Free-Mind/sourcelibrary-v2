#!/usr/bin/env node
/**
 * Push the verified references in scripts/music/ground-truth/ into
 * `music_transcriptions` as status:"verified" rows, so the reader plays the
 * same music the eval scores against (ground-truth/README.md: "the same
 * reference must also exist as a status:'verified' row").
 *
 * PRIOR ART: scripts/music/seed-shaker-transcriptions.mjs — seeds two
 * hand-written rows from literals in the script; it has no notion of the
 * manifest, and re-running it re-seeds those two only. This one is
 * manifest-driven and idempotent: every `kind:"reference"` entry with a
 * `page_id` and a file is upserted on (book_id, page_id); a draft row on the
 * same page is replaced (its AI reading is kept in `notes` for the record).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/music/sync-ground-truth.mjs [--dry-run] [--id <manifest id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GT = path.join(__dirname, 'ground-truth');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
const VERIFIER = process.env.MUSIC_VERIFIED_BY || 'claude letter-for-letter pass (see notes)';

const manifest = JSON.parse(fs.readFileSync(path.join(GT, 'manifest.json'), 'utf8'));
const refs = manifest.items.filter((x) => x.kind === 'reference' && x.file && x.page_id && (!ONLY || x.id === ONLY));
if (!refs.length) { console.error('no references matched'); process.exit(1); }

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const col = client.db('bookstore').collection('music_transcriptions');

let changed = 0;
for (const r of refs) {
  const abc = fs.readFileSync(path.join(GT, r.file), 'utf8').trim();
  const existing = await col.findOne({ book_id: r.book_id, page_id: r.page_id });
  const priorNote = existing && existing.status === 'draft' && existing.notes
    ? `\n\nReplaced draft (${existing.transcriber || 'unknown transcriber'}): ${existing.notes}`
    : '';
  const now = new Date();
  const doc = {
    book_id: r.book_id,
    page_id: r.page_id,
    spans_pages: existing?.spans_pages?.length ? existing.spans_pages : [r.page_id],
    title: r.title,
    abc,
    status: 'verified',
    transcriber: existing?.transcriber || 'human',
    verified_by: VERIFIER,
    notes: `${r.verified}${priorNote}`,
    notation_system: r.notation_system,
    updated_at: now,
  };
  const same = existing && existing.status === 'verified' && existing.abc === abc && existing.notes === doc.notes;
  console.log(`${r.id}: ${existing ? existing.status : 'absent'} → verified${same ? ' (unchanged)' : ''}${DRY ? ' [dry-run]' : ''}`);
  if (same || DRY) continue;
  const res = await col.updateOne(
    { book_id: r.book_id, page_id: r.page_id },
    { $set: doc, $setOnInsert: { created_at: now } },
    { upsert: true },
  );
  if (res.matchedCount || res.upsertedCount) changed++;
}
console.log(`${changed} row(s) written`);
await client.close();
