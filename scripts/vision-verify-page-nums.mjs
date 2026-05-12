#!/usr/bin/env node
/**
 * Vision-verify printed page numbers across an entire book.
 *
 * For each visible page with a cropped_photo, calls Gemini-3-flash vision
 * with a tightly-scoped prompt asking only for the printed page number.
 * Writes the result to `printed_pg_verified` on the page doc.
 *
 * Idempotent — skips pages that already have `printed_pg_verified` unless
 * --force is passed. Resumable on failures.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/vision-verify-page-nums.mjs --book <id> --concurrency 8
 *   node scripts/vision-verify-page-nums.mjs --book <id> --force
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const args = process.argv.slice(2);
const BOOK = args[args.indexOf('--book') + 1];
const FORCE = args.includes('--force');
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return i !== -1 ? parseInt(args[i + 1], 10) : 6;
})();

if (!BOOK || !/^[0-9a-f]{24}$/.test(BOOK)) {
  console.error('Usage: --book <24-hex> [--force] [--concurrency N]');
  process.exit(1);
}
const MONGODB_URI = process.env.MONGODB_URI;
const KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
].filter(Boolean);
if (!MONGODB_URI || KEYS.length === 0) { console.error('env not set'); process.exit(1); }

let keyIdx = 0;
function getAi() { return new GoogleGenerativeAI(KEYS[keyIdx++ % KEYS.length]); }

async function visionRead(imageUrl, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
      const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
      const ai = getAi();
      const model = ai.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const r = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        { text: `What is the PRINTED page number on this page of a historical book?
Look for the typeset number that the original printer placed at the top or bottom of the page (page header or footer).
Use Arabic numerals only (convert Roman if needed).
IGNORE: handwritten annotations, library stamps, modern catalog numbers, signatures (e.g. "A2", "B iij").

Reply with ONLY the number or "none".
Examples of valid replies: "42", "108", "1", "none"` }
      ]);
      const text = r.response.text().trim();
      const m = text.match(/^(\d+)$/);
      if (m) return parseInt(m[1], 10);
      if (/^none$/i.test(text)) return null;
      return null;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function parallelMap(items, fn, concurrency) {
  let i = 0;
  const results = new Array(items.length);
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const book = await db.collection('books').findOne({ id: BOOK });
  if (!book) { console.error('book not found'); process.exit(1); }
  const filter = { book_id: BOOK, page_number: { $gt: 0 }, cropped_photo: { $exists: true, $ne: null } };
  if (!FORCE) filter.printed_pg_verified = { $exists: false };
  const pages = await db.collection('pages').find(filter, {
    projection: { _id: 1, page_number: 1, cropped_photo: 1 }
  }).sort({ page_number: 1 }).toArray();
  console.log(`Book: ${book.slug}`);
  console.log(`Pages to verify: ${pages.length} (concurrency=${CONCURRENCY}, ${KEYS.length} keys)`);
  const start = Date.now();
  let done = 0;
  await parallelMap(pages, async (p) => {
    const v = await visionRead(p.cropped_photo).catch(() => 'ERR');
    await db.collection('pages').updateOne(
      { _id: p._id },
      { $set: { printed_pg_verified: v === 'ERR' ? null : v, printed_pg_verified_at: new Date() } }
    );
    done++;
    if (done % 25 === 0 || done === pages.length) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`  ${done}/${pages.length} (${elapsed}s)`);
    }
  }, CONCURRENCY);
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
