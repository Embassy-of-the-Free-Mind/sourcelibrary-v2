#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/audit/gallery-visibility-leak.mjs` checks visibility only
 * INSIDE the database (frozen id lists vs `books.visible`) and never fetches a
 * page; `scripts/maintenance/prewarm-browse.mjs` fetches pages but to warm them,
 * asserting nothing about what came back. Neither can answer the question here:
 * does the page a READER gets agree with the database? Also checked
 * `scripts/audit/` for any *-live / *-render probe — none exists.
 *
 * collection-page-live — every visible collection must actually render.
 *
 * THE FAILURE THIS CATCHES
 * ------------------------
 * `/collections/<slug>` is ISR- and CDN-cached. Before the collection exists the
 * page renders as missing, and THAT gets cached; creating the document and
 * flipping `visible` changes Mongo and nothing else. The reader keeps getting
 * the cached miss, and the database looks perfectly correct the whole time.
 * Nobody notices until someone opens the page by hand — which is exactly how
 * this was found (Derek, 2026-09-04, on `forum-of-conscience`).
 *
 * A write-side helper (`scripts/lib/revalidate.mjs`) fixes the scripts we know
 * about. It cannot fix the next script someone writes, which is why this exists:
 * the check belongs on the READ side, where the truth is observable.
 *
 * WHAT "RENDERS" MEANS HERE
 * -------------------------
 * Not HTTP 200. A hidden or missing page returns **200 with a soft-404 body**,
 * so status is worthless as a signal (see `lesson_soft404_wears_real_metadata`).
 * A page passes only if all three hold:
 *   1. HTTP 200
 *   2. no `NEXT_HTTP_ERROR_FALLBACK;404` marker in the body
 *   3. the collection's own NAME appears in the body — the check that catches a
 *      page that renders but renders something else
 *
 * PACING: the edge rate-limits non-browser clients (10 req/60s), so this sends a
 * browser UA and sleeps between requests. A full sweep is minutes, not seconds;
 * that is fine for a nightly cron and the reason `--limit` exists.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/collection-page-live.mjs
 *   ... --slug forum-of-conscience      # one collection
 *   ... --limit 20                      # first N (by most recently updated)
 *   ... --fix                           # revalidate the ones that fail
 *
 * Exit 0 = every checked collection renders. Exit 1 = at least one does not.
 */

import { withMongo } from '../lib/mongo.mjs';
import { revalidateCollection } from '../lib/revalidate.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const BASE = process.env.SITE_URL || 'https://sourcelibrary.org';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PACE_MS = Number(val('pace') || 7000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Three checks, because HTTP status alone cannot tell a real page from a soft-404. */
async function probe(slug, name) {
  const url = `${BASE}/collections/${slug}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err.message}`, url };
  }
  if (res.status === 429) return { ok: null, reason: 'rate-limited — slow down (--pace)', url };
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, url };

  const body = await res.text();
  if (body.includes('NEXT_HTTP_ERROR_FALLBACK;404')) return { ok: false, reason: 'soft-404 (200 with a not-found body)', url };
  // The name is HTML-escaped in the markup; compare on a conservative subset.
  const needle = String(name || '').replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
  if (needle && !body.includes(needle)) return { ok: false, reason: `renders, but the collection name is absent`, url };
  return { ok: true, url };
}

await withMongo(async (db) => {
  const slug = val('slug');
  const limit = Number(val('limit') || 0);

  const query = slug ? { slug } : { visible: true };
  let cursor = db.collection('collections').find(query, { projection: { slug: 1, name: 1, visible: 1, updated_at: 1, _id: 0 } })
    .sort({ updated_at: -1 });
  if (limit) cursor = cursor.limit(limit);
  const collections = await cursor.toArray();

  if (!collections.length) {
    console.log(slug ? `No collection with slug '${slug}'.` : 'No visible collections.');
    process.exit(slug ? 1 : 0);
  }

  console.log(`Checking ${collections.length} collection page(s) at ${PACE_MS}ms intervals — ~${Math.ceil(collections.length * PACE_MS / 60000)} min.\n`);

  const broken = [];
  let skipped = 0;

  for (let i = 0; i < collections.length; i++) {
    const c = collections[i];
    const r = await probe(c.slug, c.name);
    if (r.ok === null) { skipped++; console.log(`  ?  ${c.slug} — ${r.reason}`); }
    else if (r.ok) { if (flag('verbose')) console.log(`  ok ${c.slug}`); }
    else { broken.push({ ...c, ...r }); console.log(`  ✘  ${c.slug} — ${r.reason}`); }
    if (i < collections.length - 1) await sleep(PACE_MS);
  }

  console.log('');
  if (skipped) console.log(`${skipped} skipped (rate-limited) — NOT counted as passing. Re-run with a longer --pace.`);

  if (!broken.length) {
    console.log(`✔ all ${collections.length - skipped} checked collection pages render.`);
    process.exit(skipped ? 1 : 0);
  }

  console.log(`✘ ${broken.length} collection page(s) do not render what the database says they should:\n`);
  for (const b of broken) console.log(`   ${b.url}\n     ${b.reason}`);

  if (flag('fix')) {
    console.log('\nRevalidating…');
    for (const b of broken) {
      try {
        await revalidateCollection(b.slug);
      } catch (err) {
        console.log(`  ${b.slug}: revalidate FAILED — ${err.message}`);
      }
      await sleep(PACE_MS);
    }
    console.log('\nRe-run without --fix to confirm. A purge is only a fix if the origin can refill it.');
  } else {
    console.log('\nRun again with --fix to revalidate these, or purge by hand.');
  }
  process.exit(1);
});
