#!/usr/bin/env node
/**
 * Audit: does an artwork doc's R2 image actually depict the catalog record
 * it's attached to? (#3815)
 *
 * THE INVARIANT
 *   For a `resource_type` artwork doc with a museum/Commons source, the
 *   bytes served from the doc's own `thumbnail`/`thumbnail_blob`/
 *   `archived_full_url` R2 keys must match what the AUTHORITATIVE SOURCE
 *   (Cleveland/Met/AIC API, or the Commons file page) reports for that
 *   record's own id — never assumed from the slug or from a sibling record.
 *
 * WHY IT MATTERS
 *   Two Jain-art Cleveland records (#3815) carry correct title/author
 *   metadata (resolved via `source_ids.cleveland`, the CMA numeric object
 *   id) but serve a DIFFERENT artwork's image — a Greek red-figure krater
 *   and a Pahari Shaiva-ascetic painting, neither Jain nor Indian. Root
 *   cause traced 2026-08-09: the (never-committed, session-only) importer
 *   that created these docs on 2026-04-14 wrote a `source_url` accession
 *   number that does NOT match the accession CMA reports for
 *   `source_ids.cleveland` — e.g. doc says accession 1926.549, but CMA's
 *   own id 107362 is accession 1925.1340. The image that was fetched and
 *   uploaded to R2 corresponds to the WRONG accession in `source_url`, not
 *   the correct id used for the title. `scripts/normalize-artwork-images.mjs`
 *   (run 2026-05-03, since deleted from the repo — see git history at
 *   c3dadee0) later re-derived all 4 R2 tiers (display/thumb/grid/full) from
 *   this already-wrong image, which is why every tier is wrong and all
 *   share one `image_normalized_at` timestamp. See #3815 for the full
 *   writeup.
 *
 * DETECTION STRATEGY
 *   - cleveland: authoritative and CHEAP — no image download needed. Refetch
 *     CMA by `source_ids.cleveland`; if the accession it reports disagrees
 *     with the accession embedded in `source_url`, that's a confirmed
 *     mismatch on its own (this is exactly the #3815 mechanism).
 *   - met / aic / commons: dHash the source's own image and this doc's own
 *     R2 thumb (scripts/lib/dhash.mjs); Hamming distance >= HASH_DIFF (16,
 *     see scripts/lib/page-alignment.mjs) is a confirmed mismatch, <= 12 is
 *     a match, the small band between is "ambiguous" (kept, not auto-fixed).
 *   - rijksmuseum / nga / wellcome: NOT integrated (see
 *     scripts/lib/artwork-sources.mjs header) — reported as `unverifiable`.
 *   - no recognizable source at all: reported as `no-source`.
 *
 * SCOPE (per #3815 instructions — full sweep of ~24.8K docs is too slow)
 *   - Cleveland/Met/AIC: EXHAUSTIVE (only 230/617/48 docs respectively, and
 *     the Cleveland check needs no image fetch).
 *   - Commons: every dedup-touched doc (`dedup_date` exists) EXHAUSTIVE,
 *     plus a random sample (--sample, default 300) of the rest. Report the
 *     sampled mismatch rate separately from the exhaustive one.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/artwork-image-integrity.mjs                  # default scope
 *   node scripts/audit/artwork-image-integrity.mjs --sample 500     # bigger commons sample
 *   node scripts/audit/artwork-image-integrity.mjs --commons-cap 1000  # cap exhaustive commons dedup set
 *   node scripts/audit/artwork-image-integrity.mjs --json out.json
 *
 * READ-ONLY — never writes to Mongo or R2. Exits non-zero if any confirmed
 * mismatch is found, so it can be re-run standing-detector style.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { computeDHash } from '../lib/dhash.mjs';
import { hammingHex, HASH_MATCH, HASH_DIFF } from '../lib/page-alignment.mjs';
import { detectProvider, fetchSourceFor, fetchImageBuffer } from '../lib/artwork-sources.mjs';

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const SAMPLE = parseInt(argVal('--sample', '300'), 10);
const COMMONS_CAP = parseInt(argVal('--commons-cap', '0'), 10) || Infinity; // 0 = no cap
const JSON_OUT = argVal('--json', null);
const CONCURRENCY = parseInt(argVal('--concurrency', '4'), 10);
const DELAY_MS = parseInt(argVal('--delay', '250'), 10);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const PROJECTION = {
  _id: 1, id: 1, slug: 1, title: 1, author: 1, resource_type: 1,
  source_url: 1, commons_url: 1, commons_title: 1, source_ids: 1,
  dedup_date: 1, dedup_reason: 1, visible: 1, hidden: 1,
  thumbnail: 1, thumbnail_blob: 1, archived_full_url: 1, image_thumb: 1,
  image_width: 1, image_height: 1,
};

function r2ThumbUrl(doc) {
  // Prefer the actual thumb tier; fall back to the display tier if the
  // thumb field is missing (a normalize-style script sometimes leaves it
  // pointed at the same URL as -full).
  return doc.thumbnail_blob || doc.image_thumb || doc.thumbnail || null;
}

async function checkOne(doc) {
  const provider = detectProvider(doc);
  const base = { id: doc.id || String(doc._id), slug: doc.slug, title: doc.title, provider };

  if (!provider) return { ...base, status: 'no-source' };
  if (provider === 'rijksmuseum' || provider === 'nga' || provider === 'wellcome') {
    return { ...base, status: 'unverifiable', detail: `${provider} not integrated` };
  }

  const src = await fetchSourceFor(provider, doc);
  if (!src.ok) return { ...base, status: 'source-error', detail: src.error };

  if (provider === 'cleveland') {
    // Cheap, authoritative — no image download needed to call this confirmed.
    if (src.accessionMismatch) {
      return {
        ...base, status: 'mismatch', detail: `source_url accession ${src.urlAccession} != CMA accession ${src.sourceAccession} for id ${doc.source_ids.cleveland}`,
        correctImageUrl: src.imageUrl, correctTitle: src.title,
      };
    }
    // Still worth a dHash spot-check even when accessions agree, in case the
    // image upload itself failed independently of the accession bug.
  }

  const thumbUrl = r2ThumbUrl(doc);
  if (!thumbUrl) return { ...base, status: 'no-r2-thumb' };

  const [srcBuf, r2Buf] = await Promise.all([
    fetchImageBuffer(src.imageUrl),
    fetchImageBuffer(thumbUrl),
  ]);
  if (!srcBuf) return { ...base, status: 'source-fetch-failed', detail: 'source image did not download' };
  if (!r2Buf) return { ...base, status: 'r2-fetch-failed', detail: `R2 thumb did not download: ${thumbUrl}` };

  let srcHash, r2Hash;
  try {
    [srcHash, r2Hash] = await Promise.all([computeDHash(srcBuf), computeDHash(r2Buf)]);
  } catch (e) {
    return { ...base, status: 'hash-error', detail: e.message };
  }
  const dist = hammingHex(srcHash, r2Hash);

  if (dist >= HASH_DIFF) {
    return {
      ...base, status: 'mismatch', detail: `dHash distance ${dist} (>= ${HASH_DIFF})`,
      correctImageUrl: src.imageUrl, correctFullImageUrl: src.fullImageUrl || src.imageUrl, correctTitle: src.title,
    };
  }
  if (dist <= HASH_MATCH) {
    return { ...base, status: 'match', detail: `dHash distance ${dist}` };
  }
  return { ...base, status: 'ambiguous', detail: `dHash distance ${dist} (between ${HASH_MATCH} and ${HASH_DIFF})`, correctImageUrl: src.imageUrl };
}

async function runBatch(docs, label) {
  const results = [];
  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const batch = docs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(d => checkOne(d).catch(e => ({
      id: d.id || String(d._id), slug: d.slug, title: d.title, status: 'error', detail: e.message,
    }))));
    results.push(...batchResults);
    if ((i + CONCURRENCY) % 40 < CONCURRENCY) {
      const mism = results.filter(r => r.status === 'mismatch').length;
      console.log(`  [${label}] ${Math.min(i + CONCURRENCY, docs.length)}/${docs.length} — ${mism} mismatch(es) so far`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  return results;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  console.log('=== Artwork image integrity sweep (#3815) ===\n');

  const allResults = [];

  // ── Cleveland: exhaustive, cheap ──────────────────────────────────────
  const clevelandDocs = await books.find(
    { resource_type: { $exists: true }, 'source_ids.cleveland': { $exists: true } },
    { projection: PROJECTION }
  ).toArray();
  console.log(`Cleveland: ${clevelandDocs.length} docs (exhaustive, accession cross-check)`);
  allResults.push(...await runBatch(clevelandDocs, 'cleveland'));

  // ── Met: exhaustive ────────────────────────────────────────────────────
  const metDocs = await books.find(
    { resource_type: { $exists: true }, 'source_ids.met': { $exists: true } },
    { projection: PROJECTION }
  ).toArray();
  console.log(`\nMet: ${metDocs.length} docs (exhaustive, dHash)`);
  allResults.push(...await runBatch(metDocs, 'met'));

  // ── AIC: exhaustive ─────────────────────────────────────────────────────
  const aicDocs = await books.find(
    { resource_type: { $exists: true }, 'source_ids.aic': { $exists: true } },
    { projection: PROJECTION }
  ).toArray();
  console.log(`\nAIC: ${aicDocs.length} docs (exhaustive, dHash)`);
  allResults.push(...await runBatch(aicDocs, 'aic'));

  // ── Commons: dedup-touched exhaustive + random sample of the rest ─────
  const commonsQuery = { resource_type: { $exists: true }, commons_url: /commons\.wikimedia\.org/i };
  const commonsDedup = await books.find(
    { ...commonsQuery, dedup_date: { $exists: true } },
    { projection: PROJECTION }
  ).limit(COMMONS_CAP === Infinity ? 0 : COMMONS_CAP).toArray();
  console.log(`\nCommons (dedup-touched): ${commonsDedup.length} docs (exhaustive${COMMONS_CAP !== Infinity ? `, capped at ${COMMONS_CAP}` : ''}, dHash)`);
  allResults.push(...await runBatch(commonsDedup, 'commons-dedup'));

  const commonsRestIds = await books.find(
    { ...commonsQuery, dedup_date: { $exists: false } },
    { projection: { _id: 1 } }
  ).toArray();
  const sampleIds = shuffle(commonsRestIds).slice(0, SAMPLE).map(d => d._id);
  const commonsSample = await books.find(
    { _id: { $in: sampleIds } },
    { projection: PROJECTION }
  ).toArray();
  console.log(`\nCommons (random sample of non-dedup-touched, ${commonsRestIds.length} eligible): ${commonsSample.length} docs, dHash`);
  const commonsSampleResults = await runBatch(commonsSample, 'commons-sample');
  allResults.push(...commonsSampleResults);

  // ── Report ──────────────────────────────────────────────────────────────
  const byStatus = {};
  for (const r of allResults) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Total checked: ${allResults.length}`);
  for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${n}`);
  }

  const sampleMismatches = commonsSampleResults.filter(r => r.status === 'mismatch').length;
  const sampleChecked = commonsSampleResults.filter(r => ['mismatch', 'match', 'ambiguous'].includes(r.status)).length;
  if (sampleChecked > 0) {
    console.log(`\nCommons random-sample mismatch rate: ${sampleMismatches}/${sampleChecked} = ${(100 * sampleMismatches / sampleChecked).toFixed(1)}%`);
    console.log(`(Extrapolated to ${commonsRestIds.length} non-dedup-touched Commons docs: ~${Math.round(commonsRestIds.length * sampleMismatches / sampleChecked)} potential mismatches — NOT verified individually.)`);
  }

  const mismatches = allResults.filter(r => r.status === 'mismatch');
  if (mismatches.length) {
    console.log(`\n${mismatches.length} CONFIRMED mismatch(es):`);
    for (const m of mismatches) {
      console.log(`  ${m.id} "${(m.title || '').slice(0, 50)}" [${m.provider}] — ${m.detail}`);
    }
  }

  const outPath = JSON_OUT || `scripts/output/artwork-image-integrity-${new Date().toISOString().slice(0, 10)}.json`;
  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    counts: byStatus,
    commons_sample: { checked: sampleChecked, mismatches: sampleMismatches, eligible_population: commonsRestIds.length },
    results: allResults,
  }, null, 2));
  console.log(`\nFull results → ${outPath}`);

  await client.close();
  process.exit(mismatches.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
