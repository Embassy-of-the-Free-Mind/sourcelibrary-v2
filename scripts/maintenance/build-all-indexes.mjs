#!/usr/bin/env node
/**
 * Build tag-based indexes for all translated books.
 * Pure string parsing — no AI calls, no cost.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/build-all-indexes.mjs
 */

import { MongoClient } from 'mongodb';

const CONCURRENCY = 10;

function extractTag(text, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'gi');
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) {
      for (const raw of content.split(',')) {
        const term = raw.trim();
        if (term && term.length > 1 && term.length < 100) results.push(term);
      }
    }
  }
  return results;
}

function extractInlineTerms(text) {
  const regex = /<term>([^<]+)<\/term>/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const term = match[1].trim();
    if (term && term.length > 1 && term.length < 100) results.push(term);
  }
  return results;
}

function normalizeKey(term) {
  return term.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildBookIndex(pages) {
  const index = new Map();

  for (const page of pages) {
    const pn = page.page_number;

    if (page.ocr?.data) {
      for (const v of extractTag(page.ocr.data, 'vocab')) {
        const key = normalizeKey(v);
        if (!key) continue;
        const e = index.get(key);
        if (e) { e.pages.add(pn); }
        else { index.set(key, { term: v, pages: new Set([pn]), type: 'vocab' }); }
      }
    }

    if (page.translation?.data) {
      for (const t of extractInlineTerms(page.translation.data)) {
        const key = normalizeKey(t);
        if (!key) continue;
        const e = index.get(key);
        if (e) {
          e.pages.add(pn);
          if (e.type === 'vocab') { e.type = 'term'; e.term = t; }
        } else {
          index.set(key, { term: t, pages: new Set([pn]), type: 'term' });
        }
      }
      for (const k of extractTag(page.translation.data, 'keywords')) {
        const key = normalizeKey(k);
        if (!key) continue;
        const e = index.get(key);
        if (e) { e.pages.add(pn); }
        else { index.set(key, { term: k, pages: new Set([pn]), type: 'keyword' }); }
      }
    }
  }

  return Array.from(index.values())
    .map(({ term, pages, type }) => ({
      term,
      pages: Array.from(pages).sort((a, b) => a - b),
      type,
    }))
    .sort((a, b) => b.pages.length - a.pages.length);
}

async function processBook(db, book) {
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  const entries = buildBookIndex(pages);

  if (entries.length === 0) return 0;

  await db.collection('books').updateOne(
    { id: book.id },
    {
      $set: {
        'index.entries': entries,
        'index.generatedAt': new Date(),
        'index.pagesCovered': pages.length,
        'index.method': 'tag-extraction',
        updated_at: new Date(),
      }
    }
  );

  return entries.length;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books')
    .find(
      { hidden: { $ne: true }, $or: [{ pages_translated: { $gte: 1 } }, { pages_ocr: { $gte: 1 } }] },
      { projection: { id: 1, title: 1, pages_count: 1 } }
    )
    .sort({ pages_translated: -1 })
    .toArray();

  console.log(`Processing ${books.length} books with ${CONCURRENCY} workers...\n`);

  let done = 0;
  let totalEntries = 0;
  let withEntries = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (book) => {
        try {
          const count = await processBook(db, book);
          return { book, count, error: null };
        } catch (err) {
          return { book, count: 0, error: err.message };
        }
      })
    );

    for (const r of results) {
      done++;
      if (r.error) {
        console.error(`  ERROR ${r.book.title}: ${r.error}`);
      } else if (r.count > 0) {
        totalEntries += r.count;
        withEntries++;
      }
    }

    if (done % 100 === 0 || done === books.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (done / elapsed * 1000).toFixed(0);
      console.log(`  ${done}/${books.length} (${elapsed}s, ${rate}/s) — ${withEntries} indexed, ${totalEntries} total entries`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s. ${withEntries}/${books.length} books indexed, ${totalEntries} total entries.`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
