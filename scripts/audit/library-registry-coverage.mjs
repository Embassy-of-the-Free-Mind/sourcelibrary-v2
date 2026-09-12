#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/holding-library-coverage.mjs — adjacent but measures
 * the citation copy-clause (how many books can name a physical holder), not
 * registry coverage. The one-off version of THIS check ran in-session on
 * 2026-09-03 (scratchpad audit.mjs, issue #4627) and found 16 unmapped keys /
 * ~1,050 invisible books, fixed in #4615. This ports it as a standing watch.
 *
 * Registry coverage: every image_source.provider that has visible books must
 * be mapped by a LIBRARY_PARTNERS entry (providerKey or aliasProviderKeys) —
 * otherwise those books are silently absent from /libraries, and the absence
 * reads as "we hold nothing from that institution". A new importer minting a
 * new provider key recreates the gap without failing anything, which is why
 * this is a scheduled watch (library-coverage-watch.yml) and not a PR gate:
 * the key usually starts existing when the import RUNS, not when code merges.
 *
 * The registry is a static TS literal, so we parse it textually rather than
 * import TS from .mjs. A positive control guards the parser: if it stops
 * finding well-known entries, we exit 2 (instrument broken), never 0.
 *
 * Exit codes (same convention as field-sprawl.mjs — the workflow depends on
 * distinguishing these):
 *   0 = ran, no findings
 *   1 = ran, unmapped provider(s) at/above threshold — report on stdout
 *   2 = could not measure (DB unreachable, registry unparseable)
 *
 *   node --env-file=.env.production.local scripts/audit/library-registry-coverage.mjs [--threshold 10]
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const thresholdArg = process.argv.indexOf('--threshold');
const THRESHOLD = thresholdArg > -1 ? parseInt(process.argv[thresholdArg + 1], 10) : 10;

// Infrastructure buckets, not institutions — mirrored from /libraries and
// /api/libraries (EXCLUDE_PROVIDERS there).
const INFRA_KEYS = new Set(['user_upload', 'other', 'library', 'iiif']);

// ---------- Parse the registry (with a positive control) ----------
let known;
try {
  const src = readFileSync(new URL('../../src/lib/library-partners.ts', import.meta.url), 'utf8');
  const providerKeys = [...src.matchAll(/providerKey: '([^']+)'/g)].map(m => m[1]);
  const aliasKeys = [...src.matchAll(/aliasProviderKeys: \[([^\]]+)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  known = new Set([...providerKeys, ...aliasKeys]);
  // Positive control: the parser must see entries we know exist. A refactor of
  // the registry's shape must break THIS loudly, not silently return an empty
  // set that makes every provider look unmapped (or, worse, a partial set).
  const mustContain = ['internet_archive', 'bph', 'mdz', 'bsb', 'gallica'];
  const missing = mustContain.filter(k => !known.has(k));
  if (missing.length || known.size < 40) {
    console.error(`Registry parse failed positive control (size=${known.size}, missing=${missing.join(',') || 'none'}) — library-partners.ts shape changed; update this parser.`);
    process.exit(2);
  }
} catch (err) {
  console.error('Could not read/parse src/lib/library-partners.ts:', err.message);
  process.exit(2);
}

// ---------- Census visible books per provider ----------
let rows;
const client = new MongoClient(process.env.MONGODB_URI ?? '');
try {
  await client.connect();
  rows = await client.db('bookstore').collection('books').aggregate([
    { $match: { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': { $type: 'string', $ne: '' } } },
    { $group: { _id: '$image_source.provider', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ], { maxTimeMS: 60_000 }).toArray();
} catch (err) {
  console.error('Could not census books by provider:', err.message);
  process.exit(2);
} finally {
  await client.close().catch(() => {});
}

// ---------- Compare ----------
const unmapped = rows.filter(r => !known.has(r._id) && !INFRA_KEYS.has(r._id));
const overThreshold = unmapped.filter(r => r.n >= THRESHOLD);
const invisible = unmapped.reduce((s, r) => s + r.n, 0);

console.log(`Registry: ${known.size} provider keys | census: ${rows.length} provider keys with visible books`);
console.log(`Unmapped: ${unmapped.length} keys / ${invisible} books invisible on /libraries (threshold for firing: >=${THRESHOLD} books)`);
for (const r of unmapped) {
  console.log(`  ${r.n >= THRESHOLD ? 'FIRE' : 'note'}\t${r._id}\t${r.n} books`);
}

if (overThreshold.length) {
  console.log(`\n${overThreshold.length} provider key(s) need a LIBRARY_PARTNERS entry (or an aliasProviderKeys fold into an existing partner). See #4615 for the pattern; singletons can stay unregistered deliberately.`);
  process.exit(1);
}
console.log('OK — every provider key at/above threshold is mapped.');
process.exit(0);
