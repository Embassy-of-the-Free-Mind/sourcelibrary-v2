#!/usr/bin/env node
/**
 * Backfill MongoDB books.editor (and fix books.author='Unknown') from the
 * BPH Supabase catalogue.
 *
 * Context: 124 BPH-provider books in MongoDB are stored with the literal
 * string author='Unknown'. The BPH catalogue (Supabase bph_works) often has
 * the responsible party for these — usually an editor (Waite, Thomasius,
 * Prszybram, …) but occasionally an author whose name wasn't captured at
 * import time. The book detail page renders "Unknown" because that's what's
 * in the data; partner-reported as confusing (Chiara, BPH).
 *
 * For each book with author='Unknown' that has a numeric UBN matching a row
 * in bph_works:
 *   - If bph_works.author is set: overwrite book.author with the catalogue
 *     value (the import lost it; this restores it).
 *   - Else if bph_works.editor is set: set book.editor (book.author stays
 *     'Unknown' — UI fallback renders the editor instead).
 *   - Else (catalogue also has neither): leave the record alone.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/vibecodingevents/.env.local | cut -d= -f2)
 *   node scripts/backfill-bph-editor-from-catalogue.mjs --dry-run
 *   node scripts/backfill-bph-editor-from-catalogue.mjs
 *
 * Idempotent — safe to re-run. Doesn't touch records whose author is already
 * a real name.
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_KEY required');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('MONGODB_URI required');
  process.exit(1);
}

function extractUbn(dcIdentifier) {
  if (typeof dcIdentifier === 'string' && /^\d+$/.test(dcIdentifier)) return dcIdentifier;
  if (Array.isArray(dcIdentifier)) {
    for (const v of dcIdentifier) {
      if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    }
  }
  return null;
}

async function lookupCatalogue(ubns) {
  const out = new Map();
  // Chunk to keep URL safe.
  const CHUNK = 200;
  for (let i = 0; i < ubns.length; i += CHUNK) {
    const chunk = ubns.slice(i, i + CHUNK);
    const inList = chunk.map((u) => `"${u}"`).join(',');
    const url = `${SUPABASE_URL}/rest/v1/bph_works?ubn=in.(${encodeURIComponent(inList).replace(/%2C/g, ',').replace(/%22/g, '"')})&select=ubn,author,editor,variant_author,pseudonym`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    for (const r of rows) out.set(r.ubn, r);
  }
  return out;
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { socketTimeoutMS: 120_000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log('Loading BPH books with author="Unknown"…');
  const docs = await db
    .collection('books')
    .find(
      { 'image_source.provider': 'bph', author: 'Unknown' },
      { projection: { id: 1, slug: 1, title: 1, 'dublin_core.dc_identifier': 1, editor: 1 } }
    )
    .toArray();

  const linkable = [];
  let skippedNoUbn = 0;
  for (const d of docs) {
    const ubn = extractUbn(d.dublin_core?.dc_identifier);
    if (!ubn) {
      skippedNoUbn++;
      continue;
    }
    linkable.push({ id: d.id, slug: d.slug, title: d.title, ubn, currentEditor: d.editor });
  }
  console.log(`  ${docs.length} unknown-author BPH books`);
  console.log(`  ${linkable.length} with usable UBN`);
  console.log(`  ${skippedNoUbn} skipped (no numeric UBN — likely IIIF imports)`);

  const ubns = linkable.map((l) => l.ubn);
  console.log('\nLooking up bph_works rows…');
  const cat = await lookupCatalogue(ubns);
  console.log(`  ${cat.size} catalogue rows fetched`);

  const updates = [];
  let neither = 0;
  for (const row of linkable) {
    const r = cat.get(row.ubn);
    if (!r) {
      neither++;
      continue;
    }
    const author = (r.author || r.variant_author || r.pseudonym || '').trim();
    const editor = (r.editor || '').trim();
    if (author) {
      updates.push({ id: row.id, set: { author }, kind: 'author', ubn: row.ubn, title: row.title });
    } else if (editor) {
      updates.push({ id: row.id, set: { editor }, kind: 'editor', ubn: row.ubn, title: row.title });
    } else {
      neither++;
    }
  }

  console.log(`\n  ${updates.filter((u) => u.kind === 'author').length} books → restore author from catalogue`);
  console.log(`  ${updates.filter((u) => u.kind === 'editor').length} books → set editor from catalogue (author stays "Unknown")`);
  console.log(`  ${neither} books → catalogue has neither author nor editor; leaving as-is`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — first 5 author restorations:');
    for (const u of updates.filter((x) => x.kind === 'author').slice(0, 5)) {
      console.log(`  ${u.id} ubn=${u.ubn}  author ← "${u.set.author}"  (${u.title?.slice(0, 60)})`);
    }
    console.log('\nDRY RUN — first 5 editor assignments:');
    for (const u of updates.filter((x) => x.kind === 'editor').slice(0, 5)) {
      console.log(`  ${u.id} ubn=${u.ubn}  editor ← "${u.set.editor}"  (${u.title?.slice(0, 60)})`);
    }
    await client.close();
    return;
  }

  console.log('\nApplying updates…');
  let applied = 0;
  for (const u of updates) {
    const res = await db.collection('books').updateOne({ id: u.id }, { $set: u.set });
    if (res.modifiedCount > 0) applied++;
  }
  console.log(`  ${applied} books updated`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
