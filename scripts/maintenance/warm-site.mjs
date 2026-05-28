#!/usr/bin/env node
/**
 * Warm priority pages — static pages, collections, then top books by view count.
 * First 200 pages at concurrency 3 (gentle, high success), rest at concurrency 6.
 *
 * Usage:
 *   node scripts/maintenance/warm-site.mjs
 */

const BASE = 'https://sourcelibrary.org';
const TIMEOUT = 15_000;

const STATIC_PAGES = [
  '/', '/collections', '/curated', '/browse', '/gallery', '/libraries',
  '/languages', '/search', '/about', '/librarian', '/blog',
  '/artwork', '/explore', '/timeline', '/browse/authors', '/taxonomy',
];

let total = 0;
let ok = 0;
let fail = 0;

async function warmUrl(url) {
  try {
    const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
      headers: { 'User-Agent': 'SourceLibrary-Warmer/1.0' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    await res.text();
    if (res.ok) ok++;
    else { fail++; }
  } catch {
    fail++;
  }
  const done = ok + fail;
  if (done % 25 === 0 || done === total) {
    process.stderr.write(`\r  ${done}/${total} (${ok} ok, ${fail} fail)`);
  }
}

async function warmBatch(urls, concurrency) {
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    await Promise.all(batch.map(warmUrl));
  }
}

async function fetchSitemapUrls() {
  // Sitemap uses Next.js chunked format: /sitemap/0.xml, /sitemap/1.xml, ...
  // /sitemap.xml is the index pointing to each chunk.
  // Chunk 0 is just the static-page entries (76 URLs today); books live in
  // chunks 1+. Stop only on 404 or empty body — never short-circuit on a
  // small chunk, or we miss ~13K book URLs whenever chunk 0 happens to be
  // below an arbitrary threshold (which it always is).
  const allUrls = [];
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${BASE}/sitemap/${i}.xml`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) break;
    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    if (urls.length === 0) break;
    allUrls.push(...urls);
  }
  return allUrls;
}

async function main() {
  console.log('Fetching sitemap...');
  const allUrls = await fetchSitemapUrls();
  const bookUrls = allUrls.filter(u => u.includes('/book/'));
  const collectionUrls = allUrls.filter(u => u.includes('/collections/'));

  console.log(`Sitemap: ${allUrls.length} total, ${bookUrls.length} books, ${collectionUrls.length} collections`);

  // Priority order: static pages, collections, then books (capped at ~1000 total)
  const priorityUrls = [
    ...STATIC_PAGES,
    ...collectionUrls,
    ...bookUrls.slice(0, 1000 - STATIC_PAGES.length - collectionUrls.length),
  ];

  total = priorityUrls.length;
  console.log(`Warming ${total} priority pages...\n`);

  const start = Date.now();

  // First 200: slow and gentle (concurrency 3)
  const tier1 = priorityUrls.slice(0, 200);
  console.log(`Tier 1: ${tier1.length} pages (concurrency 3)...`);
  await warmBatch(tier1, 3);

  // Remaining: concurrency 6
  const tier2 = priorityUrls.slice(200);
  if (tier2.length > 0) {
    console.log(`\nTier 2: ${tier2.length} pages (concurrency 6)...`);
    await warmBatch(tier2, 6);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\n\nDone in ${elapsed}s — ${ok} ok, ${fail} fail out of ${total}`);
}

main().catch(e => { console.error(e); process.exit(1); });
