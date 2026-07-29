#!/usr/bin/env node
/**
 * Re-harvest the holding library (custodian) for books that don't have a usable
 * one, from the aggregator's own metadata.
 *
 * WHY: the book page credits "From the collection of <provider>", which on an
 * aggregator names the host rather than the library that owns the volume. The
 * custodian lives in `image_source.contributing_library`, but ~38% of visible
 * Internet Archive books either lack it or store a placeholder — most often the
 * literal string "Internet Archive", which our importer wrote even when IA's
 * own metadata named a real library. A probe of 25 such books found 13 with a
 * recoverable contributor upstream.
 *
 * WHAT IT WRITES: `image_source.contributing_library` (and `image_source.sponsor`
 * when absent), plus a `holding_library_harvest` provenance stamp. It never
 * touches a book that already resolves to a usable custodian, and it never
 * writes a value the shared resolver would reject — so a run cannot introduce a
 * credit the site would refuse to render, and cannot make a good record worse.
 *
 * Selection and validation both go through scripts/lib/holding-library.mjs, the
 * twin of the module the site renders with (parity-pinned by
 * tests/unit/holding-library-credit.test.ts). Using anything else here would
 * let the sweep and the page disagree about what counts as a custodian.
 *
 *   node scripts/maintenance/harvest-holding-libraries.mjs --dry-run
 *   node scripts/maintenance/harvest-holding-libraries.mjs --limit 200
 *   node scripts/maintenance/harvest-holding-libraries.mjs --apply
 *
 * Read-only by default: pass --apply to write.
 */

import { MongoClient } from 'mongodb';
import { holdingLibraryName, AGGREGATOR_PROVIDERS } from '../lib/holding-library.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const APPLY = has('--apply');
const LIMIT = Number(val('--limit', '0')) || Infinity;
const CONCURRENCY = Math.max(1, Number(val('--concurrency', '4')));
const SLEEP_MS = Number(val('--sleep', '250'));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is required. Run with:\n  set -a; source .env.production.local; set +a; node scripts/maintenance/harvest-holding-libraries.mjs --dry-run');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * IA's metadata API. `contributor` is the field that names the holding library
 * on scanned-book items; `sponsor` names who paid for digitization (Google,
 * MSN, CADAL), which is a different credit and is stored separately.
 *
 * Community uploads legitimately have no contributor — those stay uncredited
 * rather than being backfilled with a guess.
 */
async function fetchIaMetadata(identifier) {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    signal: AbortSignal.timeout(25_000),
    headers: { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; holding-library harvest)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const md = json?.metadata || {};
  // IA returns either a string or an array for multi-valued fields.
  const first = (v) => (Array.isArray(v) ? v.find((x) => typeof x === 'string' && x.trim()) : v);
  return {
    contributor: typeof first(md.contributor) === 'string' ? first(md.contributor).trim() : null,
    sponsor: typeof first(md.sponsor) === 'string' ? first(md.sponsor).trim() : null,
  };
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const books = client.db('bookstore').collection('books');

  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log('Scanning for books on aggregators without a usable custodian…\n');

  // Only IA exposes a re-harvestable contributor field. e-codices items carry
  // no per-item custodian in our records and Google Books does not publish the
  // holding library at all, so they are out of scope rather than silently
  // "attempted and failed".
  const cursor = books.find(
    { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': 'internet_archive' },
    { projection: { image_source: 1, ia_identifier: 1, slug: 1, title: 1 } },
  );

  const todo = [];
  let scanned = 0;
  for await (const b of cursor) {
    scanned++;
    if (!AGGREGATOR_PROVIDERS.has(b.image_source?.provider)) continue;
    // Already renders a credit — leave it alone.
    if (holdingLibraryName(b.image_source)) continue;
    const identifier = b.ia_identifier || b.image_source?.identifier;
    if (!identifier) continue;
    todo.push({ _id: b._id, slug: b.slug, title: b.title, identifier, stored: b.image_source?.contributing_library ?? null });
    if (todo.length >= LIMIT) break;
  }

  console.log(`Scanned ${scanned} IA books; ${todo.length} need a custodian and have an IA identifier.\n`);

  const stats = { recovered: 0, noContributor: 0, rejected: 0, fetchFailed: 0, written: 0 };
  const recoveredNames = new Map();
  const rejectedNames = new Map();

  let idx = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const item = todo[idx++];
      const n = idx;
      try {
        const { contributor, sponsor } = await fetchIaMetadata(item.identifier);
        if (!contributor) {
          stats.noContributor++;
        } else if (!holdingLibraryName({ contributing_library: contributor })) {
          // Upstream names the host, a fund, or a person — the same screen the
          // site applies. Recording it would only re-create the original bug.
          stats.rejected++;
          rejectedNames.set(contributor, (rejectedNames.get(contributor) || 0) + 1);
        } else {
          stats.recovered++;
          recoveredNames.set(contributor, (recoveredNames.get(contributor) || 0) + 1);
          if (APPLY) {
            const set = {
              'image_source.contributing_library': contributor,
              holding_library_harvest: { at: new Date(), source: 'archive.org/metadata', previous: item.stored },
            };
            if (sponsor) set['image_source.sponsor'] = sponsor;
            const r = await books.updateOne({ _id: item._id }, { $set: set });
            if (r.modifiedCount === 1) stats.written++;
            else console.warn(`  ! no write for ${item.slug} (modifiedCount=${r.modifiedCount})`);
          }
        }
        if (n % 100 === 0) console.log(`  …${n}/${todo.length}  recovered=${stats.recovered} none=${stats.noContributor} rejected=${stats.rejected} failed=${stats.fetchFailed}`);
      } catch (e) {
        stats.fetchFailed++;
        if (stats.fetchFailed <= 10) console.warn(`  ! ${item.identifier}: ${e.message}`);
      }
      if (SLEEP_MS) await sleep(SLEEP_MS);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('\n=== Result ===');
  console.log(`  candidates      ${todo.length}`);
  console.log(`  recovered       ${stats.recovered}`);
  console.log(`  no contributor  ${stats.noContributor}  (community uploads — legitimately uncredited)`);
  console.log(`  rejected        ${stats.rejected}  (upstream value is a placeholder / not a library)`);
  console.log(`  fetch failed    ${stats.fetchFailed}`);
  console.log(`  WRITTEN         ${stats.written}${APPLY ? '' : '  (dry run — nothing written)'}`);

  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  if (recoveredNames.size) {
    console.log(`\nTop recovered custodians (${recoveredNames.size} distinct):`);
    for (const [k, v] of top(recoveredNames, 25)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  if (rejectedNames.size) {
    console.log(`\nRejected upstream values (${rejectedNames.size} distinct):`);
    for (const [k, v] of top(rejectedNames, 15)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
