#!/usr/bin/env node
/**
 * Re-derive the page_translations.translation SNIPPET column from Mongo,
 * dropping editorial-wrapper content (<meta>/<summary>/<keywords>/<vocab>).
 *
 * WHY: embed-gemini.mjs cleanText() used to keep the inner prose of those
 * wrappers, so AI page-descriptions ("the previous page focused on mercury…")
 * were stored as quotable snippets and mislocated content onto the wrong page
 * (Nirmal's "mercury on page 89" misquote, 2026-05-30). The code fix prevents
 * NEW pollution; this backfill cleans the already-stored rows.
 *
 * It does NOT touch the embedding vector — zero Gemini calls, zero cost. That
 * is deliberate: cleaning the snippet fixes the *quoted text* immediately, so
 * we can measure whether the (still meta-polluted) vectors actually need a
 * paid re-embed before spending on one.
 *
 * Modes:
 *   --book ID     One book (Mongo book.id)
 *   --full        All pages that have a Supabase row
 *   --limit N     Stop after N pages
 *   --write       Actually UPDATE (default is dry-run: show before/after)
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   set -a; source .env.production.local; set +a
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { cleanPageText } from '../lib/page-embedding-text.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const WRITE = args.includes('--write');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;

// The ONE composer (page-embedding-text.mjs) — the inline copy this replaces
// had drifted to a 4-tag subset, which is how the leak in #3820 happened.
const cleanText = cleanPageText;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  if (!BOOK_ID && !FULL) {
    console.error('Pass --book ID or --full');
    process.exit(1);
  }

  let scanned = 0, changed = 0, written = 0, droppedTokens = 0, errors = 0;
  const samples = [];

  // Run a batch of Mongo pages: bulk-select existing Supabase snippets in one
  // call (.in), then UPDATE only the changed rows with a concurrency pool.
  // We UPDATE (never upsert) so the embedding column is never touched.
  const SELECT_BATCH = 500;
  const UPDATE_CONCURRENCY = 25;

  async function flush(batch) {
    const ids = batch.map(b => b.pageId);
    const { data: rows, error } = await supabase
      .from('page_translations')
      .select('page_id, translation')
      .in('page_id', ids);
    if (error) { console.error(`select batch: ${error.message}`); errors += batch.length; return; }
    const existing = new Map((rows || []).map(r => [r.page_id, r.translation || '']));

    const todo = [];
    for (const b of batch) {
      if (!existing.has(b.pageId)) continue; // not embedded yet — worker writes clean
      const old = existing.get(b.pageId);
      if (old === b.cleaned) continue;
      changed++;

      const oldWords = new Set(old.toLowerCase().match(/[a-z]{4,}/g) || []);
      const newWords = new Set(b.cleaned.toLowerCase().match(/[a-z]{4,}/g) || []);
      const removed = [...oldWords].filter(w => !newWords.has(w));
      droppedTokens += removed.length;
      if (samples.length < 8) {
        samples.push({ page: b.page_number, removedSample: removed.slice(0, 12).join(', '), oldLen: old.length, newLen: b.cleaned.length });
      }
      if (WRITE) todo.push(b);
    }

    for (let i = 0; i < todo.length; i += UPDATE_CONCURRENCY) {
      const slice = todo.slice(i, i + UPDATE_CONCURRENCY);
      await Promise.all(slice.map(async b => {
        const { error: uerr } = await supabase
          .from('page_translations')
          .update({ translation: b.cleaned })
          .eq('page_id', b.pageId);
        if (uerr) { errors++; } else { written++; }
      }));
    }
  }

  // Process ONE book at a time with a short-lived Mongo cursor. A single 4M-doc
  // cursor held open across slow Supabase writes times out ("cursor not found")
  // and the process dies mid-run with no summary — which is exactly what
  // happened on the first attempt. Per-book cursors are hundreds of docs, so
  // they finish fast; the loop is also restartable via --after.
  async function processBook(bookId) {
    const cursor = db.collection('pages')
      .find({ book_id: bookId }, { projection: { _id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } });
    let batch = [];
    for await (const page of cursor) {
      if (LIMIT && scanned >= LIMIT) break;
      scanned++;
      const raw = page.translation?.data || page.ocr?.data || '';
      if (!raw) continue;
      batch.push({ pageId: page._id.toString(), page_number: page.page_number, cleaned: cleanText(raw) });
      if (batch.length >= SELECT_BATCH) { await flush(batch); batch = []; }
    }
    if (batch.length) await flush(batch);
  }

  if (BOOK_ID) {
    await processBook(BOOK_ID);
  } else {
    // --full: drive over book ids (small collection) rather than a giant pages cursor.
    const AFTER = args.find((_, i, a) => a[i - 1] === '--after') || '';
    const bookIds = (await db.collection('books')
      .find({ id: { $exists: true } }, { projection: { id: 1 } })
      .map(b => b.id).toArray())
      .filter(Boolean)
      .sort();
    const start = AFTER ? bookIds.findIndex(id => id > AFTER) : 0;
    const work = start < 0 ? [] : bookIds.slice(start);
    console.log(`Books to process: ${work.length}${AFTER ? ` (resuming after ${AFTER})` : ''}`);
    let bi = 0;
    for (const bookId of work) {
      if (LIMIT && scanned >= LIMIT) break;
      await processBook(bookId);
      bi++;
      if (bi % 200 === 0) console.log(`  …${bi}/${work.length} books | scanned ${scanned} | written ${written} | errors ${errors} | last ${bookId}`);
    }
  }

  console.log(`\nScanned ${scanned} pages | snippet changed: ${changed} | written: ${written} | errors: ${errors}${WRITE ? '' : ' (DRY RUN)'}`);
  console.log(`Words removed from snippets (editorial prose): ${droppedTokens}\n`);
  for (const s of samples) {
    console.log(`  p${s.page} ${s.oldLen}→${s.newLen} chars | removed: ${s.removedSample}`);
  }

  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
