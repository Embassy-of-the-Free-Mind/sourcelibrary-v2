#!/usr/bin/env node
/**
 * embed-link-leaks — does any link on a partner's embedded page leave the embed?
 *
 * PRIOR ART: scripts/audit/r2-key-book-scope.mjs and the other audits check data, not rendered
 * links; src/lib/EmbedContext.tsx useEmbedHref() prefixes CLIENT links but cannot reach links a
 * server component builds; .claude/docs/invariants/tenant-lockdown.md records the subdomain leak
 * (#5038) found by reading pages, with no standing check. none of them fetch /embed/<tenant>/…
 *
 * WHY. /embed/<tenant>/book/<slug> is what a partner's site loads in its iframe. A server-built
 * href like /book/<slug>/page/<id> or /gallery drops the /embed/<tenant> prefix, so a click
 * swaps the partner's reader for sourcelibrary.org's own, inside the partner's frame. The main
 * site looks fine, so nobody notices (EFM, 2026-10-29: the Illustrations strip and the
 * "N images" link on every EFM book with extracted illustrations).
 *
 * METHOD. Fetch the embedded landing page and one page-reader URL for a sample of the tenant's
 * visible books, extract every root-relative href, and report each one that is not under
 * /embed/<tenant>/ and not an asset or API path. Exit 1 when any leak is found.
 *
 * READS ONLY (Mongo for the sample, public HTTP for the pages).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/embed-link-leaks.mjs [--tenant bph] [--books 20] [--base https://sourcelibrary.org] [--slug <slug>]
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const tenantSlug = opt('tenant', 'bph');
const nBooks = Number(opt('books', 20));
const base = opt('base', 'https://sourcelibrary.org').replace(/\/$/, '');
const onlySlug = opt('slug');

// Paths that are fine to leave the namespace: assets, APIs, icons, feeds.
const ALLOWED = [/^\/_next\//, /^\/api\//, /^\/icon/, /^\/apple-icon/, /^\/favicon/, /^\/opensearch\.xml$/, /^\/manifest/];
// Sign-in links leave the embed too, but they are owned by a separate fix (sign-in inside the
// partner frame, #7702): listed as KNOWN, not counted as a failure. Drop this once that lands.
const KNOWN = [/^\/auth\//];

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const tenant = await db.collection('tenants').findOne({ slug: tenantSlug }, { projection: { id: 1, _id: 1 } });
const tenantId = tenant?.id ?? String(tenant?._id ?? '');
const books = onlySlug
  ? await db.collection('books').find({ slug: onlySlug }, { projection: { id: 1, slug: 1 } }).toArray()
  : await db.collection('books').aggregate([
      { $match: { tenantId, visible: true, pages_count: { $gt: 0 } } },
      { $sample: { size: nBooks } },
      { $project: { id: 1, slug: 1 } },
    ]).toArray();
if (!books.length) { console.error(`no books for tenant ${tenantSlug} (tenantId ${tenantId || 'not found'})`); process.exit(2); }

const leaks = new Map(); // normalised href -> { count, example }
const known = new Map();
let fetched = 0;
for (const b of books) {
  const page = await db.collection('pages').findOne({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { id: 1 }, sort: { page_number: 1 } });
  const urls = [`/embed/${tenantSlug}/book/${b.slug}`];
  if (page?.id) urls.push(`/embed/${tenantSlug}/book/${b.slug}/page/${page.id}`);
  for (const path of urls) {
    const res = await fetch(base + path, { headers: { 'user-agent': 'SourceLibrary-embed-link-audit' } });
    if (!res.ok) { console.error(`${res.status} ${path}`); continue; }
    fetched++;
    const html = await res.text();
    for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (href.startsWith(`/embed/${tenantSlug}`) || ALLOWED.some(re => re.test(href))) continue;
      const key = href.replace(/[0-9a-f]{24}/g, ':id').replace(/\?.*$/, '').replace(new RegExp(b.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ':slug');
      const bucket = KNOWN.some(re => re.test(href)) ? known : leaks;
      const e = bucket.get(key) ?? { count: 0, example: `${path} -> ${href}` };
      e.count++; bucket.set(key, e);
    }
  }
}
await client.close();

console.log(`${fetched} embedded pages fetched from ${books.length} ${tenantSlug} books at ${base}`);
for (const [k, e] of known) console.log(`KNOWN (sign-in, fixed separately): ${e.count}  ${k}    e.g. ${e.example}`);
if (!leaks.size) { console.log('PASS: no link leaves the embed'); process.exit(0); }
console.log(`FAIL: ${leaks.size} link pattern(s) leave /embed/${tenantSlug}/`);
for (const [k, e] of [...leaks].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${String(e.count).padStart(4)}  ${k}    e.g. ${e.example}`);
process.exit(1);
