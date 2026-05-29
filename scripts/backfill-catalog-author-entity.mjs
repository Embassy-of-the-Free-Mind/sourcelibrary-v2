#!/usr/bin/env node
/**
 * Resolve each catalog author → canonical Mongo `entities` record and write
 * index_catalog_entries.author_entity_id, plus an EXACT entity-join
 * author_held_count (and sample book) for resolved authors.
 *
 * This is the entity-join upgrade of backfill-catalog-author-held.mjs. It uses
 * scripts/lib/entity-resolve.mjs (stem-then-authority reconcile → bridge to the
 * Mongo entity by viaf / vernacular name → author_entity_id). Advantages over
 * the surname-cluster path:
 *   • Exact: separates same-surname people (Giovanni Pico vs nephew
 *     Gianfrancesco) that surname regex conflates.
 *   • No Gemini: the entity IS the verified identity, so this runs in minutes.
 *   • author_entity_id becomes the JOIN KEY linking the catalog to the main
 *     site's author graph — persistence timeline, catalog↔author cross-links,
 *     "every edition that banned author X", dedup.
 *
 * Identities that DON'T resolve to an entity are left as-is (their v1
 * surname-based author_held_count stands; author_entity_id stays null). Run the
 * surname backfill for that tail separately if needed.
 *
 * Requires the column (run once in Supabase SQL Editor):
 *   ALTER TABLE index_catalog_entries ADD COLUMN author_entity_id text;
 *   CREATE INDEX ON index_catalog_entries (author_entity_id);
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-catalog-author-entity.mjs            # dry-run
 *   node scripts/backfill-catalog-author-entity.mjs --apply
 *   node scripts/backfill-catalog-author-entity.mjs --apply --concurrency 4
 */
import { MongoClient } from 'mongodb';
import { loadResolver, resolveToEntity } from './lib/entity-resolve.mjs';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;
const concArg = process.argv.indexOf('--concurrency');
// Default concurrency 4: per-identity PATCHes target disjoint rows, but keep it
// low to avoid the index-contention deadlocks (40P01) seen at 10.
const CONCURRENCY = Math.max(1, concArg > -1 ? Number(process.argv[concArg + 1]) : 4);

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = APPLY ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE_* missing'); process.exit(1); }
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

async function supa(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const opts = { method, headers: H };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
      if (!r.ok) {
        const text = (await r.text()).slice(0, 400);
        if ((r.status >= 500 || r.status === 409) && attempt < 4) { await new Promise(res => setTimeout(res, 800 * 2 ** attempt)); continue; }
        throw new Error(`${method} ${path} → ${r.status}: ${text}`);
      }
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (attempt === 4 || !/ETIMEDOUT|ECONNRESET|fetch failed|self-signed/i.test(String(e))) throw e;
      await new Promise(res => setTimeout(res, 1500 * 2 ** attempt));
    }
  }
}

// Count held books for an entity, matching author-held v1 semantics
// (visible + actually-processed, books not artwork/fragments).
async function heldBooksForEntity(db, entityId) {
  return db.collection('books').find(
    { author_entity_id: entityId,
      visible: { $ne: false },
      pages_count: { $gt: 0 },
      resource_type: { $nin: ['artwork', 'emblem', 'image', 'illustration', 'manuscript-fragment'] } },
    { projection: { _id: 1, slug: 1, year: 1, title: 1, pages_count: 1 } },
  ).toArray();
}

// Distinct (author_normalized, author) identities + a representative entry.
async function fetchIdentities() {
  const byKey = new Map();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const rows = await supa('GET',
      `index_catalog_entries?select=author,author_normalized,condemnation_year,author_held_count&author_normalized=not.is.null&author_normalized=neq.&order=author_normalized&limit=${PAGE}&offset=${offset}`);
    if (!rows.length) break;
    for (const r of rows) {
      if (!r.author_normalized || r.author_normalized.length < 3) continue;
      const k = `${r.author_normalized}::${(r.author || '').trim().toLowerCase()}`;
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, { author: r.author, author_normalized: r.author_normalized, condemnation_year: r.condemnation_year, priorHeld: r.author_held_count || 0, count: 1 });
      else {
        cur.count++;
        // representative year: earliest non-null condemnation (closest to the life)
        if (r.condemnation_year && (!cur.condemnation_year || r.condemnation_year < cur.condemnation_year)) cur.condemnation_year = r.condemnation_year;
        if ((r.author_held_count || 0) > cur.priorHeld) cur.priorHeld = r.author_held_count || 0;
      }
    }
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return byKey;
}

async function main() {
  console.log(`catalog author-entity backfill — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${LIMIT ? ` (limit ${LIMIT})` : ''}`);

  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');

  console.log('Loading resolver (Supabase authority + Mongo entity bridge)…');
  const resolver = await loadResolver((path) => supa('GET', path), db);
  console.log(`  ${resolver.authority.clusters.size} clusters; ${resolver.byViaf.size} viaf + ${resolver.byName.size} name bridges.`);

  console.log('Scanning identities…');
  const identities = [...fetchIdentitiesSorted(await fetchIdentities())];
  const work = LIMIT ? identities.slice(0, LIMIT) : identities;
  console.log(`${work.length} distinct authored identities.\n`);

  let resolved = 0, withEntity = 0, held = 0, entriesUpdated = 0, done = 0;
  const samples = [];
  const queue = [...work];
  const startedAt = Date.now();

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      done++;
      const r = resolveToEntity(id.author, { resolver, year: id.condemnation_year });
      if (r && r.entityId) {
        resolved++; withEntity++;
        const books = await heldBooksForEntity(db, r.entityId);
        // representative sample: prefer a book with a year + most pages
        const sample = [...books].sort((a, b) => (b.year ? 1 : 0) - (a.year ? 1 : 0) || (b.pages_count || 0) - (a.pages_count || 0))[0];
        if (books.length) held++;
        if (samples.length < 15) samples.push({ key: `${id.author}`, entity: r.primary_name, via: r.via, books: books.length });

        if (APPLY) {
          // author_entity_id is the deliverable — always write it. For the held
          // count, never regress: take max(prior surname count, entity-join
          // count), since entity-join undercounts authors whose books lack an
          // author_entity_id. Only refresh the sample when the entity join is
          // the winning (≥) count, so the sample matches the number shown.
          const patch = { author_entity_id: r.entityId };
          if (books.length >= (id.priorHeld || 0)) {
            patch.author_held_count = books.length;
            patch.author_held_sample_slug = sample?.slug || null;
            patch.author_held_sample_id = sample ? String(sample._id) : null;
          }
          const path = id.author == null
            ? `index_catalog_entries?author_normalized=eq.${encodeURIComponent(id.author_normalized)}&author=is.null`
            : `index_catalog_entries?author_normalized=eq.${encodeURIComponent(id.author_normalized)}&author=eq.${encodeURIComponent(id.author)}`;
          try { await supa('PATCH', path, patch); entriesUpdated += id.count; }
          catch (e) { console.error(`\nPATCH failed ${id.author}: ${String(e).slice(0, 120)}`); }
        }
      }
      if (done % 50 === 0 || done === work.length) {
        const el = (Date.now() - startedAt) / 1000;
        process.stdout.write(`\r  ${done}/${work.length}  resolved=${resolved}  with-entity=${withEntity}  held>0=${held}  ${el.toFixed(0)}s   `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log();

  console.log('\n─── samples (resolved → entity) ───');
  for (const s of samples) console.log(`  ${s.key.slice(0, 34).padEnd(34)} → ${s.entity} [${s.via}]  ${s.books} held`);

  console.log('\n─── summary ───');
  console.log(`  identities            : ${work.length}`);
  console.log(`  resolved to entity    : ${withEntity} (${(withEntity / work.length * 100).toFixed(1)}%)`);
  console.log(`  of those, hold ≥1 book: ${held}`);
  console.log(`  catalog entries updated: ${APPLY ? entriesUpdated : '(dry-run)'}`);

  await mc.close();
}

// Sort identities by descending entry-count (process high-impact first).
function* fetchIdentitiesSorted(byKey) {
  yield* [...byKey.values()].sort((a, b) => b.count - a.count);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
