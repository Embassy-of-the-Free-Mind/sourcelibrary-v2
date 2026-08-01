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
 * when absent), stamping `field_provenance.contributing_library` in the SAME
 * update via scripts/lib/field-provenance.mjs — plus an append-only
 * `field_provenance_history` entry, because this sweep runs twice (fill, then
 * verify) over overlapping books and a single-slot stamp would let the second
 * pass erase the first pass's previous_value. It never
 * touches a book that already resolves to a usable custodian, and it never
 * writes a value the shared resolver would reject — so a run cannot introduce a
 * credit the site would refuse to render, and cannot make a good record worse.
 *
 * Selection and validation both go through scripts/lib/holding-library.mjs, the
 * twin of the module the site renders with (parity-pinned by
 * tests/unit/holding-library-credit.test.ts). Using anything else here would
 * let the sweep and the page disagree about what counts as a custodian.
 *
 * TWO MODES:
 *   (default)  fill  — books with no usable custodian
 *   --verify         — books that HAVE one, checked against IA and corrected
 *
 * Verify exists because a stored custodian can be confidently wrong. A batch
 * import blanket-assigned "Biblioteca Nazionale Centrale di Firenze" to 955
 * books; a 120-book random sample found 27.7% of them are actually held
 * elsewhere (National Central Library of Rome, John Carter Brown, Boston
 * Public…). Filling gaps while leaving those in place would ship ~265 confident
 * misattributions — the exact failure this credit is meant to avoid.
 *
 * For a book we imported FROM Internet Archive, IA's own contributor field is
 * the authority: it is where the value came from originally. Overwrites record
 * the previous value in `holding_library_harvest.previous`, so the change is
 * reversible.
 *
 *   node scripts/maintenance/harvest-holding-libraries.mjs --dry-run
 *   node scripts/maintenance/harvest-holding-libraries.mjs --verify --dry-run
 *   node scripts/maintenance/harvest-holding-libraries.mjs --limit 200
 *   node scripts/maintenance/harvest-holding-libraries.mjs --apply
 *   node scripts/maintenance/harvest-holding-libraries.mjs --verify --apply
 *
 * Read-only by default: pass --apply to write.
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { holdingLibraryName, canonicalHoldingLibrary, AGGREGATOR_PROVIDERS } from '../lib/holding-library.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const APPLY = has('--apply');
const VERIFY = has('--verify');
const LIMIT = Number(val('--limit', '0')) || Infinity;
const CONCURRENCY = Math.max(1, Number(val('--concurrency', '4')));
const SLEEP_MS = Number(val('--sleep', '250'));
// Restrict to books whose stored custodian is exactly this value. Corrections
// cluster by IMPORT BATCH, not evenly: every one of the 312 mismatches found in
// the first full verify pass came from a single blanket-assigned name. Checking
// that cohort alone is ~5x cheaper than re-walking the corpus, and archive.org
// timeouts (32% at concurrency 8) make an unfocused re-run unreliable anyway.
const STORED = val('--stored', null);
// A sweep that silently skips 15% of its candidates reports a clean result it
// did not earn. Failures are written here so the run's coverage is auditable
// and the gap can be closed without re-walking the whole corpus.
const FAILURES_OUT = val('--failures-out', '/tmp/harvest-failures.json');
const RETRY_FAILURES = val('--retry-failures', null);

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
async function fetchIaMetadata(identifier, attempts = 3) {
  // archive.org times out intermittently under sustained volume — a single-shot
  // fetch lost 885 of 5,956 candidates (15%) on the 2026-07-30 full pass, which
  // would have been reported as a clean sweep. Back off and retry instead.
  let lastErr;
  let res;
  for (let i = 0; i < attempts; i++) {
    try {
      res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; holding-library harvest)' },
      });
      if (res.ok) break;
      lastErr = new Error(`HTTP ${res.status}`);
      res = null;
    } catch (e) { lastErr = e; res = null; }
    if (i < attempts - 1) await sleep(1000 * 2 ** i);
  }
  if (!res) throw lastErr || new Error('fetch failed');
  const json = await res.json();
  const md = json?.metadata || {};
  // IA returns either a string or an array for multi-valued fields.
  const first = (v) => (Array.isArray(v) ? v.find((x) => typeof x === 'string' && x.trim()) : v);
  // …and sometimes an HTML anchor rather than a name:
  //   <a href="https://archive.org/details/…">Bibliothèque interuniversitaire de santé (Paris)</a>
  // Writing that raw would put markup in a field we render as text. Take the
  // link text, which is the institution name.
  const clean = (v) => {
    const s = first(v);
    if (typeof s !== 'string') return null;
    const text = s
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    return text || null;
  };
  const rawContributor = first(md.contributor);
  return { contributor: clean(md.contributor), sponsor: clean(md.sponsor), rawContributor: typeof rawContributor === 'string' ? rawContributor : null };
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const books = client.db('bookstore').collection('books');

  console.log(`Mode: ${VERIFY ? 'VERIFY existing custodians' : 'FILL missing custodians'} — ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);

  // Only IA exposes a re-harvestable contributor field. e-codices items carry
  // no per-item custodian in our records and Google Books does not publish the
  // holding library at all, so they are out of scope rather than silently
  // "attempted and failed".
  const cursor = books.find(
    {
      visible: true,
      pages_count: { $gt: 0 },
      'image_source.provider': 'internet_archive',
      ...(STORED ? { 'image_source.contributing_library': STORED } : {}),
    },
    { projection: { image_source: 1, ia_identifier: 1, slug: 1, title: 1 } },
  );
  if (STORED) console.log(`Restricted to books stored as ${JSON.stringify(STORED)}.`);

  let retrySet = null;
  if (RETRY_FAILURES) {
    if (!existsSync(RETRY_FAILURES)) { console.error(`no failure ledger at ${RETRY_FAILURES}`); process.exit(1); }
    retrySet = new Set(JSON.parse(readFileSync(RETRY_FAILURES, 'utf8')));
    console.log(`Retrying ${retrySet.size} identifiers from ${RETRY_FAILURES}.`);
  }

  const todo = [];
  let scanned = 0;
  for await (const b of cursor) {
    scanned++;
    if (!AGGREGATOR_PROVIDERS.has(b.image_source?.provider)) continue;
    const current = holdingLibraryName(b.image_source);
    // Fill mode wants the books with no credit; verify mode wants the rest.
    if (VERIFY ? !current : !!current) continue;
    const identifier = b.ia_identifier || b.image_source?.identifier;
    if (!identifier) continue;
    if (retrySet && !retrySet.has(identifier)) continue;
    todo.push({ _id: b._id, slug: b.slug, title: b.title, identifier, stored: b.image_source?.contributing_library ?? null });
    if (todo.length >= LIMIT) break;
  }

  console.log(`Scanned ${scanned} IA books; ${todo.length} ${VERIFY ? 'have a custodian to check' : 'need a custodian'} and have an IA identifier.\n`);

  const stats = { recovered: 0, noContributor: 0, rejected: 0, fetchFailed: 0, written: 0, agreed: 0, corrected: 0 };
  const recoveredNames = new Map();
  const rejectedNames = new Map();
  const corrections = new Map();
  const failedIdentifiers = [];

  let idx = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const item = todo[idx++];
      const n = idx;
      try {
        const { contributor, sponsor, rawContributor } = await fetchIaMetadata(item.identifier);
        if (!contributor) {
          stats.noContributor++;
        } else if (!holdingLibraryName({ contributing_library: contributor })) {
          // Upstream names the host, a fund, or a person — the same screen the
          // site applies. Recording it would only re-create the original bug.
          stats.rejected++;
          rejectedNames.set(contributor, (rejectedNames.get(contributor) || 0) + 1);
        } else if (VERIFY && canonicalHoldingLibrary(contributor) === canonicalHoldingLibrary(item.stored)) {
          // Same institution, possibly a different spelling — nothing to do.
          stats.agreed++;
        } else {
          if (VERIFY) {
            stats.corrected++;
            const k = `${canonicalHoldingLibrary(item.stored)}  ->  ${canonicalHoldingLibrary(contributor)}`;
            corrections.set(k, (corrections.get(k) || 0) + 1);
          } else {
            stats.recovered++;
            recoveredNames.set(contributor, (recoveredNames.get(contributor) || 0) + 1);
          }
          if (APPLY) {
            // Stamp provenance in the SAME update that writes the value, so the
            // two cannot diverge — the failure this sweep committed on its first
            // run, leaving 833 values under stamps that still named a March
            // provider_mapping pass. `raw_upstream` preserves IA's response
            // before HTML-stripping so a disputed credit is auditable.
            const prov = provenanceUpdate('contributing_library', {
              source: 'ia_metadata_harvest',
              script: 'scripts/maintenance/harvest-holding-libraries.mjs',
              method: 'archive.org/metadata contributor',
              mode: VERIFY ? 'verify' : 'fill',
              ia_identifier: item.identifier,
              raw_upstream: rawContributor,
              confidence: 'high',
              previous_value: item.stored,
            });
            // Bump updated_at or this write never reaches the site: the
            // books_catalog sync is incremental on `updated_at > lastSync`, and
            // contributing_library is a synced column. Without this the corrected
            // custodian sits in Mongo while /libraries keeps serving the old one
            // indefinitely — the write succeeds and changes nothing a reader sees.
            const set = { 'image_source.contributing_library': contributor, updated_at: new Date(), ...prov.$set };
            if (sponsor) set['image_source.sponsor'] = sponsor;
            const r = await books.updateOne(
              { _id: item._id },
              { $set: set, $push: prov.$push, $unset: { holding_library_harvest: '' } },
            );
            if (r.modifiedCount === 1) stats.written++;
            else console.warn(`  ! no write for ${item.slug} (modifiedCount=${r.modifiedCount})`);
          }
        }
        if (n % 100 === 0) console.log(VERIFY
          ? `  …${n}/${todo.length}  agreed=${stats.agreed} corrected=${stats.corrected} none=${stats.noContributor} rejected=${stats.rejected} failed=${stats.fetchFailed}`
          : `  …${n}/${todo.length}  recovered=${stats.recovered} none=${stats.noContributor} rejected=${stats.rejected} failed=${stats.fetchFailed}`);
      } catch (e) {
        stats.fetchFailed++;
        failedIdentifiers.push(item.identifier);
        if (stats.fetchFailed <= 10) console.warn(`  ! ${item.identifier}: ${e.message}`);
      }
      if (SLEEP_MS) await sleep(SLEEP_MS);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('\n=== Result ===');
  console.log(`  candidates      ${todo.length}`);
  if (VERIFY) {
    console.log(`  agreed          ${stats.agreed}  (stored value matches IA)`);
    console.log(`  CORRECTED       ${stats.corrected}  (stored value named a different institution)`);
    const n = stats.agreed + stats.corrected;
    if (n) console.log(`  error rate      ${(stats.corrected / n * 100).toFixed(1)}%  (n=${n})`);
  }
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
  if (corrections.size) {
    console.log(`\nCorrections (${corrections.size} distinct):`);
    for (const [k, v] of top(corrections, 30)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  if (rejectedNames.size) {
    console.log(`\nRejected upstream values (${rejectedNames.size} distinct):`);
    for (const [k, v] of top(rejectedNames, 15)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }

  // Write the coverage ledger LAST, after every counter is final. A sweep that
  // skips candidates and prints a clean result is claiming coverage it did not
  // earn — so the run must end by saying which it was.
  if (failedIdentifiers.length) {
    writeFileSync(FAILURES_OUT, JSON.stringify(failedIdentifiers, null, 0));
    console.log(`\n  COVERAGE INCOMPLETE — ${failedIdentifiers.length} of ${todo.length} candidates unchecked.`);
    console.log(`  ledger: ${FAILURES_OUT}`);
    console.log(`  close the gap with:  --retry-failures ${FAILURES_OUT}`);
  } else {
    console.log(`\n  coverage: all ${todo.length} candidates checked.`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
