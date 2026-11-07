#!/usr/bin/env node
/**
 * One-off IndexNow backfill (#3755): submit the core URLs to Bing/Yandex/Seznam/Naver.
 *
 * PRIOR ART: scripts/lib/indexnow.mjs (the batch POST) and src/app/sitemap.ts (the URL set).
 * Rather than re-deriving the live filter, this reads the sitemap chunks production serves,
 * so the URLs match the canonicals exactly: chunk 0 (static), 1 (collections, libraries,
 * languages, works, authors) and 2..999 (books, `visible && pages_count > 0` with slug).
 * Reader-page (1000+), gallery (2000+) and artwork (3000+) chunks are out of scope.
 *
 * Usage:  node scripts/seo/indexnow-backfill.mjs            # dry run: counts only
 *         node scripts/seo/indexnow-backfill.mjs --send     # POST in batches of 10,000
 * Runs on any machine; no secrets and no database (reads the public sitemap over HTTP).
 */
import { pingIndexNow } from '../lib/indexnow.mjs';

const BASE = 'https://sourcelibrary.org';
const send = process.argv.includes('--send');

async function text(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

const chunks = locs(await text(`${BASE}/sitemap-index`))
  .map((u) => ({ u, n: Number(u.match(/\/sitemap\/(\d+)\.xml/)?.[1]) }))
  .filter((c) => Number.isInteger(c.n) && c.n < 1000);

const urls = new Set();
const counts = {};
for (const c of chunks) {
  const found = locs(await text(c.u)).filter((u) => u.startsWith(`${BASE}/`));
  counts[c.n] = found.length;
  found.forEach((u) => urls.add(u));
}
const all = [...urls];
const by = (re) => all.filter((u) => re.test(u)).length;
console.log(`chunks read: ${chunks.map((c) => c.n).join(',')}  per-chunk: ${JSON.stringify(counts)}`);
console.log(`unique URLs: ${all.length}  (books ${by(/\/book\/[^/]+$/)}, collections ${by(/\/collections\/[^/]+$/)}, authors ${by(/\/author\//)}, works ${by(/\/work\//)})`);
console.log(`batches of 10,000: ${Math.ceil(all.length / 10000)}`);

if (!send) {
  console.log('DRY RUN: nothing sent. Re-run with --send to submit.');
} else {
  const r = await pingIndexNow(all);
  console.log(`sent ${r.sent}, failed ${r.failed}`);
  process.exit(r.failed ? 1 : 0);
}
