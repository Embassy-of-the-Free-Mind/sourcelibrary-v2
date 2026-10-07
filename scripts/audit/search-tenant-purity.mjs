#!/usr/bin/env node
/**
 * Search tenant-purity audit.
 *
 * Guards the Tenant Subdomain Lockdown invariant for every search surface that
 * ranks an embedding table: a tenant request must never surface another
 * tenant's (or the global library's) books.
 *
 * WHAT CHANGED (#4330, #2753). This audit used to call `match_books_semantic`
 * itself and re-apply the route's Mongo filter in the script — it tested a copy
 * of the fix, on one lane, and so said PASS for months while
 * `/api/search/semantic` served the global corpus on partner subdomains. It now
 * asks the ROUTES, over HTTP, and resolves every book id that comes back
 * against `books.tenantId` in Mongo. What a route renders is the only thing
 * that can leak.
 *
 * Three arms per route:
 *   tenant   the request as the partner host sees it → ZERO foreign books
 *   control  the same request with no tenant → must surface foreign books.
 *            Without it "0 foreign" could mean the lane was down, the query
 *            matched nothing, or this script reads the wrong field. A route
 *            whose control arm shows no foreign book is NOT EXERCISED, and the
 *            run reports UNKNOWN rather than passing.
 *   closed   a tenant slug that does not exist → ZERO books of any kind. An
 *            unresolvable scope is not an absent one.
 *
 * Two ways to run it:
 *
 *   # After a deploy — the real subdomain, which is the only place the proxy's
 *   # host-based tenant resolution can be verified (tenant-lockdown.md):
 *   node --env-file=.env.production.local scripts/audit/search-tenant-purity.mjs bph
 *
 *   # Before a merge — a local `next dev`, with the x-tenant-* headers the
 *   # proxy would stamp. A Vercel preview cannot do this: its host is not a
 *   # tenant subdomain, so the tenant branch never runs there.
 *   node --env-file=.env.production.local scripts/audit/search-tenant-purity.mjs bph --local=http://localhost:3111
 *
 * Read-only. ~60 requests; each embeds one short query (fractions of a cent).
 *
 * Exit codes: 0 pass, 1 fail (a foreign book, or a closed scope that answered),
 * 2 unknown (a route's control arm never showed a foreign book).
 */
import { MongoClient, ObjectId } from 'mongodb';

const args = process.argv.slice(2);
const val = (f) => { const m = args.find((a) => a.startsWith(`${f}=`)); return m ? m.slice(f.length + 1) : undefined; };
const TENANT_SLUG = args.find((a) => !a.startsWith('--')) || 'bph';
const LOCAL = val('--local');
const APEX = val('--apex') || 'https://sourcelibrary.org';
const ONLY = val('--only')?.split(',');
const VERBOSE = args.includes('--verbose');

const QUERIES = [
  'alchemy and the philosophers stone',
  'rosicrucian brotherhood',
  'hermetic philosophy and the soul',
];
// Image lanes match on what a picture shows, not on a subject heading.
const IMAGE_QUERIES = ['dragon', 'alchemical furnace', 'sun and moon'];

const m = new MongoClient(process.env.MONGODB_URI);
await m.connect();
const db = m.db(process.env.MONGODB_DB || 'bookstore');

const tenant = await db.collection('tenants').findOne({ slug: TENANT_SLUG, status: { $ne: 'deleted' } });
if (!tenant) { console.error(`No tenant for slug "${TENANT_SLUG}"`); process.exit(2); }
const tid = tenant.id;

// Seeds for the similar-images route: one image of the tenant's own, and one
// from outside it. The foreign seed is the one that exercises the route — the
// neighbours of a partner's own plate are mostly that partner's other plates,
// with or without a filter.
const ownBooks = (await db.collection('books').find({ tenantId: tid, visible: true }).project({ _id: 0, id: 1 }).toArray()).map((b) => b.id);
const seedProjection = { projection: { _id: 0, id: 1 } };
const ownSeed = await db.collection('gallery_images').findOne({ book_id: { $in: ownBooks.slice(0, 300) }, book_visible: true }, seedProjection);
const foreignSeed = await db.collection('gallery_images').findOne(
  { book_id: { $nin: ownBooks }, book_visible: true, gallery_quality: { $gte: 0.8 }, extracted_url: { $ne: null } },
  seedProjection,
);

const q = (s) => encodeURIComponent(s);
/** Every route this PR scoped. `ids` overrides the generic book_id/bookId walk. */
const ROUTES = [
  { name: 'semantic.book', urls: QUERIES.map((s) => `/api/search/semantic?q=${q(s)}&limit=20`) },
  { name: 'semantic.page', urls: QUERIES.map((s) => `/api/search/semantic?q=${q(s)}&level=page&limit=20`) },
  { name: 'search', urls: QUERIES.map((s) => `/api/search?q=${q(s)}&limit=25`) },
  { name: 'unified', urls: QUERIES.map((s) => `/api/search/unified?q=${q(s)}`) },
  { name: 'visual', urls: IMAGE_QUERIES.map((s) => `/api/search/visual?q=${q(s)}&limit=24`) },
  { name: 'gallery.visual', urls: IMAGE_QUERIES.map((s) => `/api/gallery?q=${q(s)}&visual=true&limit=24`) },
  { name: 'gallery.semantic', urls: IMAGE_QUERIES.map((s) => `/api/gallery?q=${q(s)}&semantic=true&limit=24`) },
  { name: 'gallery.search', urls: IMAGE_QUERIES.map((s) => `/api/gallery?q=${q(s)}&limit=24`) },
  { name: 'artwork.search', urls: IMAGE_QUERIES.map((s) => `/api/artwork/search?q=${q(s)}&limit=20`), ids: (d) => (d.items || []).map((i) => i.id) },
  { name: 'gallery.similar', urls: [ownSeed, foreignSeed].filter(Boolean).map((s) => `/api/gallery/similar?id=${q(s.id)}&limit=12`) },
].filter((r) => !ONLY || ONLY.includes(r.name));

function collectBookIds(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) collectBookIds(n, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'book_id' || k === 'bookId') && typeof v === 'string' && v) out.push(v);
      else if (k !== 'filters') collectBookIds(v, out);
    }
  }
  return out;
}

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  // Exempts the run from the anonymous search allowance (anon-gate.ts).
  'X-Warm-Ping': 'search-tenant-purity',
};
const tenantHeaders = { 'x-tenant-id': tid, 'x-tenant-slug': TENANT_SLUG, 'x-tenant-source': 'subdomain', 'x-tenant-embedded': '1' };
const ARMS = {
  tenant: LOCAL
    ? { base: LOCAL, headers: tenantHeaders }
    : { base: `https://${TENANT_SLUG}.sourcelibrary.org`, headers: {} },
  control: { base: LOCAL || APEX, headers: {} },
  closed: { base: LOCAL || APEX, headers: { 'x-tenant-slug': 'zz-no-such-tenant', 'x-tenant-embedded': '1' } },
};
for (const [name, arm] of Object.entries(ARMS)) arm.name = name;

// These routes are shared-cached by URL. Without a per-arm key the closed arm
// is served the control arm's stored body and "answers" with the global corpus
// — which is what the first run of this audit against production reported.
const RUN = Date.now().toString(36);
async function fetchIds(route, url, arm) {
  try {
    const res = await fetch(`${arm.base}${url}&_audit=${arm.name}-${RUN}`, { headers: { ...BASE_HEADERS, ...arm.headers }, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return { status: res.status, ids: [], error: `non-JSON (${text.slice(0, 60).replace(/\s+/g, ' ')})` }; }
    const ids = route.ids ? route.ids(data).filter(Boolean) : collectBookIds(data);
    return { status: res.status, ids, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { status: 0, ids: [], error: e.message };
  }
}

// books.tenantId for every id seen. `id` first, then `_id` — 16K books carry a
// re-minted `_id` and are invisible to an `_id`-only lookup (CLAUDE.md).
const owner = new Map();
async function resolveOwners(ids) {
  const need = [...new Set(ids)].filter((id) => !owner.has(id));
  if (need.length === 0) return;
  const docs = await db.collection('books').find({ id: { $in: need } }).project({ id: 1, tenantId: 1 }).toArray();
  for (const d of docs) owner.set(d.id, d.tenantId ?? null);
  const missing = need.filter((id) => !owner.has(id) && ObjectId.isValid(id));
  if (missing.length) {
    const byOid = await db.collection('books').find({ _id: { $in: missing.map((id) => new ObjectId(id)) } }).project({ tenantId: 1 }).toArray();
    for (const d of byOid) owner.set(String(d._id), d.tenantId ?? null);
  }
  for (const id of need) if (!owner.has(id)) owner.set(id, undefined); // not a book we hold
}
// A book this tenant does not own. An id Mongo does not know is foreign too:
// it cannot be shown to be the tenant's.
const isForeign = (id) => owner.get(id) !== tid;

console.log(`Search tenant-purity: "${TENANT_SLUG}" (tenantId=${tid})`);
console.log(`  tenant arm:  ${ARMS.tenant.base}${LOCAL ? '  (x-tenant-* headers, as the proxy stamps them)' : ''}`);
console.log(`  control arm: ${ARMS.control.base}\n`);

let failed = false;
const unexercised = [];
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('route', 18)}${pad('tenant: books / foreign', 26)}${pad('control: books / foreign', 27)}closed: books`);

for (const route of ROUTES) {
  const tally = { tenant: [], control: [], closed: [] };
  const errors = [];
  for (const url of route.urls) {
    for (const armName of ['tenant', 'control']) {
      const r = await fetchIds(route, url, ARMS[armName]);
      if (r.error) errors.push(`${armName} ${url}: ${r.error}`);
      tally[armName].push(...r.ids);
    }
  }
  const closed = await fetchIds(route, route.urls[0], ARMS.closed);
  if (closed.error) errors.push(`closed ${route.urls[0]}: ${closed.error}`);
  tally.closed = closed.ids;

  await resolveOwners([...tally.tenant, ...tally.control, ...tally.closed]);
  const uniq = (a) => [...new Set(a)];
  const tenantIds = uniq(tally.tenant);
  const controlIds = uniq(tally.control);
  const leaked = tenantIds.filter(isForeign);
  const controlForeign = controlIds.filter(isForeign);

  let verdict = 'ok';
  if (leaked.length > 0) { verdict = 'LEAK'; failed = true; }
  else if (tally.closed.length > 0) { verdict = 'CLOSED SCOPE ANSWERED'; failed = true; }
  else if (controlForeign.length === 0) { verdict = 'NOT EXERCISED'; unexercised.push(route.name); }
  console.log(`${pad(route.name, 18)}${pad(`${tenantIds.length} / ${leaked.length}`, 26)}${pad(`${controlIds.length} / ${controlForeign.length}`, 27)}${pad(uniq(tally.closed).length, 8)}${verdict}`);
  if (leaked.length) console.log(`     foreign on the tenant arm: ${leaked.slice(0, 5).join(', ')}`);
  if (errors.length && (VERBOSE || verdict !== 'ok')) for (const e of errors.slice(0, 4)) console.log(`     ${e}`);
}

await m.close();

console.log('');
if (failed) {
  console.error('FAIL: a tenant request surfaced a book outside the tenant, or an unresolvable tenant was answered.');
  process.exit(1);
}
if (unexercised.length > 0) {
  console.error(`UNKNOWN: ${unexercised.join(', ')} — the control arm showed no foreign book, so "0 foreign" on the tenant arm proves nothing for these. ` +
    'The lane may be down (CLIP), or the queries may not reach it. Re-run with --verbose.');
  process.exit(2);
}
console.log('PASS: every route returned only the tenant\'s books, showed foreign books without a tenant, and answered an unknown tenant with nothing.');
