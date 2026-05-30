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

// Identical to scripts/workers/embed-gemini.mjs cleanText (keep in sync).
function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<(meta|summary|keywords|vocab)>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const mongoFilter = BOOK_ID ? { book_id: BOOK_ID } : {};
  if (!BOOK_ID && !FULL) {
    console.error('Pass --book ID or --full');
    process.exit(1);
  }

  const cursor = db.collection('pages')
    .find(mongoFilter, { projection: { _id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 });

  let scanned = 0, changed = 0, written = 0, droppedTokens = 0;
  const samples = [];

  for await (const page of cursor) {
    if (LIMIT && scanned >= LIMIT) break;
    scanned++;

    const raw = page.translation?.data || page.ocr?.data || '';
    if (!raw) continue;
    const cleaned = cleanText(raw);

    const pageId = page._id.toString();
    const { data: existing } = await supabase
      .from('page_translations')
      .select('translation')
      .eq('page_id', pageId)
      .maybeSingle();
    if (!existing) continue; // not embedded yet — worker will write it clean

    const old = existing.translation || '';
    if (old === cleaned) continue;
    changed++;

    // crude signal: words present in old snippet but gone after re-clean
    const oldWords = new Set(old.toLowerCase().match(/[a-z]{4,}/g) || []);
    const newWords = new Set(cleaned.toLowerCase().match(/[a-z]{4,}/g) || []);
    const removed = [...oldWords].filter(w => !newWords.has(w));
    droppedTokens += removed.length;

    if (samples.length < 8) {
      samples.push({
        page: page.page_number,
        removedSample: removed.slice(0, 12).join(', '),
        oldLen: old.length,
        newLen: cleaned.length,
      });
    }

    if (WRITE) {
      const { error } = await supabase
        .from('page_translations')
        .update({ translation: cleaned })
        .eq('page_id', pageId);
      if (error) { console.error(`  page ${page.page_number}: ${error.message}`); continue; }
      written++;
    }
  }

  console.log(`\nScanned ${scanned} pages | snippet changed: ${changed} | written: ${written}${WRITE ? '' : ' (DRY RUN)'}`);
  console.log(`Words removed from snippets (editorial prose): ${droppedTokens}\n`);
  for (const s of samples) {
    console.log(`  p${s.page} ${s.oldLen}→${s.newLen} chars | removed: ${s.removedSample}`);
  }

  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
