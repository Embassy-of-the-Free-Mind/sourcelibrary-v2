#!/usr/bin/env node
/**
 * Seed `acquisition_queue` rows for a direct-inserted IA wave so the hourly
 * archiver (:45, scripts/catalog-coverage/archive-acquired-cron.sh) pulls the
 * page masters to R2.
 *
 * PRIOR ART: scripts/catalog-coverage/acquire-gap-batch.mjs — writes exactly
 *   this row shape when IT imports a book, but only for works that went through
 *   its own enumerate→source→import loop. A wave imported by
 *   new-world-wave.mjs never passes through it, so the archiver's queue mode
 *   cannot see the books. Wave 1 solved this with an uncommitted copy in
 *   scripts/output/ on Hetzner (nw-seed-queue.mjs, hardcoded list path); this
 *   is that script with `--list`, committed so the next wave does not rewrite it.
 *
 * THIS IS ACTUATION, NOT RECORDING. The :45 cron reads this collection and
 * starts fetching page images to R2 without further instruction. Rows carry
 * source:'ia', which archive-acquired.ts routes to archive-ia-bulk.mjs
 * (datacenter-safe); the four IIIF sources (erara|iiif|mdz|gallica) are the
 * only other values it understands.
 *
 * Usage (on Hetzner, or anywhere with MONGODB_URI):
 *   node --env-file=.env.production.local scripts/import/new-world-seed-queue.mjs --list <candidates.json> --prefix nw2 --category new-world-2
 *   ... --commit
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const COMMIT = process.argv.includes('--commit');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIST = arg('--list', null);
const PREFIX = arg('--prefix', 'nw');
const CATEGORY = arg('--category', 'new-world');
if (!LIST) { console.error('--list <candidates.json> is required'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing'); process.exit(1); }

const raw = JSON.parse(readFileSync(LIST, 'utf8'));
const list = raw.books || raw;

const mc = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const queue = db.collection('acquisition_queue');

let seeded = 0;
let already = 0;
let missing = 0;
let pages = 0;

for (const b of list) {
  const book = await books.findOne(
    { $or: [{ ia_identifier: b.ia }, { source_fingerprint: `ia:${b.ia}` }] },
    { projection: { id: 1, pages_count: 1, archive_status: 1 } },
  );
  if (!book) { missing++; console.log(`MISS  ${b.ia} — not imported`); continue; }

  const sn = `${PREFIX}:${b.ia}`;
  const existing = await queue.findOne({ sn }, { projection: { _id: 1 } });
  if (existing) { already++; continue; }

  pages += book.pages_count || 0;
  if (!COMMIT) { seeded++; console.log(`DRY   ${sn.padEnd(48)} ${String(book.pages_count || 0).padStart(4)}pp  ${book.id}`); continue; }

  await queue.insertOne({
    sn,
    status: 'acquired',
    book_id: book.id,
    source: 'ia',
    source_ref: b.ia,
    category: CATEGORY,
    title: b.title,
    author: b.author,
    year: parseInt(b.published, 10) || null,
    lang: b.language,
    added_at: new Date(),
    done_at: new Date(),
  });
  seeded++;
  console.log(`SEED  ${sn.padEnd(48)} ${String(book.pages_count || 0).padStart(4)}pp  ${book.id}`);
}

await mc.close();
console.log(`\n=== ${COMMIT ? 'SEEDED' : 'DRY-RUN'} — rows:${seeded} already:${already} missing:${missing} pages:${pages} ===`);
if (COMMIT && seeded) console.log('The :45 archive-acquired cron will now fetch these page images to R2 — no further step.');
