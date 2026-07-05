#!/usr/bin/env node
/**
 * Fetch person-level Wikidata claims into the durable `wikidata_claims`
 * collection (#2979 occupation/tradition slice).
 *
 * Why a side collection: `canonical_entities` is a derived, droppable read
 * model rebuilt nightly — anything fetched from the network must live
 * somewhere durable so the rebuild is a pure local join, not 400+ API calls
 * a night. This collection is the durable cache: one doc per QID, fetched
 * once, refreshed only explicitly (--refresh).
 *
 * Claims fetched (person-level presentation data only — identity stays in
 * `authors`, #2179):
 *   P106 occupation · P103 native language · P140 religion/worldview ·
 *   P27 country of citizenship
 * Value QIDs are resolved to English labels in a second batched pass and
 * stored inline, so consumers never need the Wikidata API.
 *
 * Doc shape:
 *   { _id: 'Q859', occupations: [{id,label}], native_languages: [{id,label}],
 *     religions: [{id,label}], citizenships: [{id,label}], fetched_at }
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fetch-wikidata-claims.mjs --limit 100   # trial
 *   node scripts/maintenance/fetch-wikidata-claims.mjs               # all missing QIDs
 *   node scripts/maintenance/fetch-wikidata-claims.mjs --refresh     # refetch everything
 */
import { MongoClient } from 'mongodb';

const REFRESH = process.argv.includes('--refresh');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const CLAIM_PROPS = {
  P106: 'occupations',
  P103: 'native_languages',
  P140: 'religions',
  P27: 'citizenships',
};

const UA = 'SourceLibraryBot/1.0 (https://sourcelibrary.org; hello@sourcelibrary.org) wikidata-claims';
const BATCH = 50; // wbgetentities max ids per request

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const mc = new MongoClient(uri);
await mc.connect();
const db = mc.db('bookstore');
const claimsCol = db.collection('wikidata_claims');
await claimsCol.createIndex({ fetched_at: 1 }).catch(() => {});

// ── 1. QIDs to fetch: everything canonical_entities references, minus done.
const qids = await db.collection('canonical_entities')
  .distinct('wikidata_id', { wikidata_id: { $ne: null } });
const have = REFRESH ? new Set() : new Set(
  (await claimsCol.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id),
);
const todo = qids.filter((q) => /^Q\d+$/.test(q) && !have.has(q)).slice(0, LIMIT);
console.log(`QIDs: ${qids.length} referenced · ${have.size} already fetched · ${todo.length} to fetch`);
if (todo.length === 0) { await mc.close(); process.exit(0); }

async function wdGet(params, attempt = 0) {
  const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: 'json', maxlag: '5', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok || res.status === 429) {
    if (attempt >= 4) throw new Error(`wikidata ${res.status} after ${attempt} retries`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return wdGet(params, attempt + 1);
  }
  const data = await res.json();
  if (data.error?.code === 'maxlag') {
    if (attempt >= 4) throw new Error('wikidata maxlag persists');
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    return wdGet(params, attempt + 1);
  }
  return data;
}

// ── 2. Fetch claims in batches; collect referenced value QIDs for the label pass.
const parsed = new Map(); // qid -> { occupations: [valueQid,...], ... }
const valueQids = new Set();
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const data = await wdGet({ action: 'wbgetentities', ids: batch.join('|'), props: 'claims' });
  for (const qid of batch) {
    const claims = data?.entities?.[qid]?.claims || {};
    const doc = {};
    for (const [prop, field] of Object.entries(CLAIM_PROPS)) {
      const ids = (claims[prop] || [])
        .map((c) => c?.mainsnak?.datavalue?.value?.id)
        .filter((v) => typeof v === 'string');
      doc[field] = [...new Set(ids)].slice(0, 12);
      for (const v of doc[field]) valueQids.add(v);
    }
    parsed.set(qid, doc);
  }
  if ((i / BATCH) % 20 === 0) console.log(`  claims ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  await new Promise((r) => setTimeout(r, 120));
}

// ── 3. Resolve value QIDs → English labels (batched, cached across runs via
// existing docs' inline labels being reused only within this run — the value
// set is small, ~2-4K distinct).
const labelById = new Map();
const values = [...valueQids];
console.log(`resolving ${values.length} distinct value labels…`);
for (let i = 0; i < values.length; i += BATCH) {
  const batch = values.slice(i, i + BATCH);
  const data = await wdGet({ action: 'wbgetentities', ids: batch.join('|'), props: 'labels', languages: 'en' });
  for (const q of batch) {
    labelById.set(q, data?.entities?.[q]?.labels?.en?.value ?? null);
  }
  await new Promise((r) => setTimeout(r, 120));
}

// ── 4. Write docs.
const now = new Date();
const ops = [...parsed.entries()].map(([qid, doc]) => ({
  replaceOne: {
    filter: { _id: qid },
    replacement: {
      _id: qid,
      ...Object.fromEntries(
        Object.values(CLAIM_PROPS).map((field) => [
          field,
          doc[field].map((id) => ({ id, label: labelById.get(id) ?? null })),
        ]),
      ),
      fetched_at: now,
    },
    upsert: true,
  },
}));
let written = 0;
for (let i = 0; i < ops.length; i += 1000) {
  const res = await claimsCol.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  written += res.upsertedCount + res.modifiedCount + res.matchedCount;
}
const withOcc = [...parsed.values()].filter((d) => d.occupations.length > 0).length;
const withLang = [...parsed.values()].filter((d) => d.native_languages.length > 0).length;
const withRel = [...parsed.values()].filter((d) => d.religions.length > 0).length;
console.log(`\nwrote ${ops.length} claim docs (bulk acks ${written}).`);
console.log(`coverage of this batch: occupations ${withOcc} · native language ${withLang} · religion ${withRel}`);
await mc.close();
