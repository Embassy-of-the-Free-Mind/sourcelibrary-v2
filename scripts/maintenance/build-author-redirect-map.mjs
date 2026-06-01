#!/usr/bin/env node
/**
 * Build the variant→canonical author-slug redirect map (#2250 read-path).
 *
 * Why this exists: the canonical read-path resolver lives in the `/author/[name]`
 * RSC page, but a server `redirect()` there does NOT emit an HTTP 307 — the page
 * is ISR/streamed, so the 200 shell commits before the redirect resolves and it
 * silently degrades (curl + crawlers see 200, never the canonical URL). URL-level
 * dedup must therefore happen in MIDDLEWARE, before the page renders. Middleware
 * runs on the edge with no DB access, so we precompute a static slug→slug map here
 * and bundle it. (Content-level dedup already works: the page loads the canonical
 * person's merged book set even at a variant URL.)
 *
 * Output: src/lib/author-canonical-redirects.json  — { "<variant-slug>": "<canonical-slug>", ... }
 * Only includes variants that differ from their canonical slug, and EXCLUDES any
 * variant slug that is itself another person's canonical slug (never 308 a real page).
 * Quarantined non-person docs (is_person:false) are skipped.
 *
 * Regenerate whenever the `authors` collection changes (new variants/merges):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/build-author-redirect-map.mjs
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const OUT = 'src/lib/author-canonical-redirects.json';

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const authors = mc.db('bookstore').collection('authors');
const docs = await authors.find(
  { is_person: { $ne: false }, variant_slugs: { $exists: true, $ne: [] } },
  { projection: { slug: 1, variant_slugs: 1 } },
).toArray();

// Canonical slug set — a variant that is ALSO someone's canonical must not redirect.
const canonical = new Set(docs.map((d) => d.slug || d._id).filter(Boolean));

const map = {};
let conflicts = 0;
for (const d of docs) {
  const canon = d.slug || d._id;
  if (!canon) continue;
  for (const v of (d.variant_slugs || [])) {
    if (!v || v === canon) continue;
    if (canonical.has(v)) { conflicts++; continue; }   // v is a real canonical page elsewhere
    // If two canonicals claim the same variant, first writer wins; log the rare clash.
    if (map[v] && map[v] !== canon) { conflicts++; continue; }
    map[v] = canon;
  }
}

// Deterministic key order so the committed file diffs cleanly across regens.
const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${Object.keys(sorted).length} variant→canonical entries (${conflicts} excluded as conflicts).`);
await mc.close();
