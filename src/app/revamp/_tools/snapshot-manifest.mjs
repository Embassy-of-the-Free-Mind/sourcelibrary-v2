// Saves every work in a collection (the public API's manifest mode, then pages past its 1,000 cap) so the
// collection page can sort, filter and group the whole collection, not just the first 60.
// Run: node src/app/revamp/_tools/snapshot-manifest.mjs alchemy alchemical-emblem beguine-mystics
// GET only, one request per collection, two seconds apart.
import fs from 'node:fs';
import path from 'node:path';

const SNAP = path.join(process.cwd(), 'src/app/revamp/_data/snap');
const KEEP = ['id', 'slug', 'title', 'display_title', 'author', 'editor', 'year', 'language', 'pages_count', 'pages_ocr', 'pages_translated', 'pages_blank', 'pages_translatable', 'thumbnail', 'thumbnail_blob', 'thumbnail_frame', 'published', 'read_count', 'is_first_translation', 'resource_type'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const slug of process.argv.slice(2)) {
  const r = await fetch(`https://sourcelibrary.org/api/collections/${slug}?mode=manifest`, { headers: { 'User-Agent': 'sourcelibrary-revamp' } });
  if (!r.ok) { console.log(slug, 'failed', r.status); await sleep(5000); continue; }
  const j = await r.json();
  const all = j.books ?? [];
  // Manifest stops at 1,000; the rest come in pages of 200, in the same order (year, then title).
  for (let off = all.length; off < (j.total ?? 0); off += 200) {
    await sleep(2000);
    const p = await fetch(`https://sourcelibrary.org/api/collections/${slug}?limit=200&offset=${off}&sort=year_asc`, { headers: { 'User-Agent': 'sourcelibrary-revamp' } });
    if (!p.ok) break;
    all.push(...((await p.json()).books ?? []));
  }
  const seen = new Set();
  const books = all.filter((b) => !seen.has(b.id) && seen.add(b.id)).map((b) => Object.fromEntries(KEEP.filter((k) => b[k] != null).map((k) => [k, b[k]])));
  fs.writeFileSync(path.join(SNAP, `_manifest-${slug}.json`), JSON.stringify({ total: j.total ?? books.length, books }));
  console.log(slug, books.length, 'of', j.total);
  await sleep(2000);
}
