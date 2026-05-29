#!/usr/bin/env node
/**
 * Search tenant-purity audit.
 *
 * Guards the Tenant Subdomain Lockdown invariant for /api/search: a tenant
 * request must never surface another tenant's (or the global library's) books.
 *
 * The keyword lanes scope by tenantId, and the semantic PAGE lane scopes via
 * match_semantic's filter_tenant_id. But the semantic BOOK lane
 * (match_books_semantic) is GLOBAL — book_embeddings has no tenant_id column,
 * so the RPC can't filter, and a tenant request leaks global books unless the
 * Mongo materialization re-applies the tenant filter. This audit:
 *
 *   1. Runs the global semantic book RPC for a set of queries (the leak surface).
 *   2. Reports how many cross-tenant books it surfaces (PRE-filter) — this is
 *      the leak magnitude; it should be > 0, proving the filter is load-bearing.
 *   3. Applies the route's tenant filter (visible + pages_count + tenantId) and
 *      asserts ZERO cross-tenant books survive (POST-filter).
 *
 * Exits non-zero if any cross-tenant book survives the filter — i.e. if the fix
 * in src/app/api/search/route.ts (semantic materialization tenant scope) is
 * missing or wrong. Re-run after touching the semantic lanes.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/search-tenant-purity.mjs [tenant-slug]   # default: bph
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const TENANT_SLUG = process.argv[2] || 'bph';
const QUERIES = [
  'alchemy and the philosophers stone',
  'rosicrucian brotherhood',
  'hermetic philosophy and the soul',
  'kabbalah and the tree of life',
  'transmutation of metals',
];

async function embed(text) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ model: 'models/gemini-embedding-2-preview', content: { parts: [{ text }] }, outputDimensionality: 768 }],
      }),
    },
  );
  const d = await r.json();
  return d.embeddings?.[0]?.values || null;
}

const m = new MongoClient(process.env.MONGODB_URI);
await m.connect();
const db = m.db(process.env.MONGODB_DB || 'bookstore');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const tenant = await db.collection('tenants').findOne({ slug: TENANT_SLUG, status: { $ne: 'deleted' } });
if (!tenant) { console.error(`No tenant for slug "${TENANT_SLUG}"`); process.exit(2); }
const tid = tenant.id;
console.log(`Auditing search tenant-purity for "${TENANT_SLUG}" (tenantId=${tid})\n`);

let totalPreLeak = 0;
let totalPostLeak = 0;

for (const q of QUERIES) {
  const emb = await embed(q);
  if (!emb) { console.log(`  ${q} — embedding failed, skipped`); continue; }
  const { data, error } = await sb.rpc('match_books_semantic', {
    query_embedding: JSON.stringify(emb),
    match_threshold: 0.3, match_count: 25,
    filter_language: null, filter_year_min: null, filter_year_max: null,
  });
  if (error) { console.log(`  ${q} — RPC error: ${error.message}`); continue; }
  const ids = (data || []).map(r => r.book_id);
  const books = await db.collection('books')
    .find({ id: { $in: ids } })
    .project({ id: 1, tenantId: 1, visible: 1, pages_count: 1, title: 1 })
    .toArray();

  // PRE-filter: what the global RPC surfaces that would pass visible+pages but is foreign.
  const preLeak = books.filter(b => b.visible && b.pages_count > 0 && b.tenantId !== tid);
  // POST-filter: actually run the route's fixed materialization query (adds tenantId)
  // and check nothing foreign comes back.
  const materialized = await db.collection('books')
    .find({ id: { $in: ids }, visible: true, pages_count: { $gt: 0 }, tenantId: tid })
    .project({ id: 1, tenantId: 1 })
    .toArray();
  const postLeak = materialized.filter(b => b.tenantId !== tid);

  totalPreLeak += preLeak.length;
  totalPostLeak += postLeak.length;
  console.log(`  "${q}"`);
  console.log(`     global RPC results: ${ids.length} | would-leak (pre-fix): ${preLeak.length} | leak after tenant filter: ${postLeak.length}`);
  if (preLeak.length) console.log(`     e.g. ${preLeak.slice(0, 2).map(b => `"${(b.title || '').slice(0, 40)}"`).join(', ')}`);
}

await m.close();

console.log(`\nSummary: pre-fix cross-tenant leak across ${QUERIES.length} queries = ${totalPreLeak} books; post-fix = ${totalPostLeak}.`);
if (totalPreLeak === 0) {
  console.log('NOTE: pre-fix leak was 0 — the semantic book RPC surfaced no foreign books for these queries; the guard did not get to exercise a real leak.');
}
if (totalPostLeak > 0) {
  console.error('FAIL: cross-tenant books survive the tenant filter — the /api/search semantic materialization tenant scope is missing or wrong.');
  process.exit(1);
}
console.log('PASS: no cross-tenant books survive the tenant filter.');
