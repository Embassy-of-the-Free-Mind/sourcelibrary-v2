#!/usr/bin/env node
/**
 * Backfill structured Commons provenance on artwork docs (#3838, item 1).
 *
 * For every artwork doc whose `commons_url` points at a true Wikimedia
 * Commons file page, write:
 *   - `source_ids.commons` — the CANONICAL File: title as Commons itself
 *     reports it (post-normalization, post-redirect), so the integrity
 *     detector (scripts/audit/artwork-image-integrity.mjs) has a stable,
 *     by-id verifiable pointer.
 *   - `commons_sha1` — the file's sha1 from `prop=imageinfo&iiprop=sha1`,
 *     only where missing. sha1 equality then gives an exact integrity
 *     check with no image download (#3815, #3037).
 *   - `commons_width`/`commons_height` — only where missing (free in the
 *     same response).
 *
 * NEVER overwrites an existing `commons_sha1`. If the stored sha1 differs
 * from what Commons reports now, that is an integrity signal (Commons
 * re-upload, or our record points at the wrong file) — it is recorded in
 * the JSON report for the detector/repair tooling to judge, not clobbered.
 * Files that no longer exist on Commons get no write; they are listed in
 * the report for the item-4 fuzzy-recovery pass.
 *
 * Reads the batched query API (up to 50 titles per request, POST) so the
 * whole corpus is ~230 requests. Serial, throttled, with 429/503 backoff —
 * Wikimedia rate-limits aggressively (see #3838 notes).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-commons-source-ids.mjs [--dry-run] [--limit=N] [--delay=2500]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || 0;
const DELAY_MS = parseInt(process.argv.find(a => a.startsWith('--delay='))?.split('=')[1] || '2500', 10);
const BATCH_SIZE = 50; // MediaWiki API max titles per query for non-bot clients

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org) commons-source-ids-backfill';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Resolve the File: title we believe this doc points at. Mirrors
// fetchCommonsSource in scripts/lib/artwork-sources.mjs: prefer the stored
// commons_title, else parse the commons_url.
function resolveFileTitle(doc) {
  if (doc.commons_title && /^File:/i.test(doc.commons_title)) {
    return doc.commons_title.replace(/_/g, ' ').trim();
  }
  if (!doc.commons_url) return null;
  let decoded;
  try { decoded = decodeURIComponent(doc.commons_url); } catch { decoded = doc.commons_url; }
  const m = decoded.match(/File:([^#]+)/i);
  if (!m) return null;
  return `File:${m[1].replace(/_/g, ' ').trim()}`;
}

async function fetchBatch(titles, attempt = 0) {
  const body = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', redirects: '1',
    prop: 'imageinfo', iiprop: 'sha1|size|url', titles: titles.join('|'),
    maxlag: '5',
  });
  let res;
  try {
    res = await fetch('https://commons.wikimedia.org/w/api.php', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (attempt >= 6) throw e;
    console.log(`  fetch error (${e.message}) — retry ${attempt + 1}/6 in ${15 * (attempt + 1)}s`);
    await sleep(15000 * (attempt + 1));
    return fetchBatch(titles, attempt + 1);
  }
  if (res.status === 429 || res.status === 503) {
    if (attempt >= 6) throw new Error(`HTTP ${res.status} after 6 retries`);
    const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
    const waitS = Math.max(retryAfter, 30 * (attempt + 1));
    console.log(`  HTTP ${res.status} — backing off ${waitS}s (retry ${attempt + 1}/6)`);
    await sleep(waitS * 1000);
    return fetchBatch(titles, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) {
    // maxlag and other soft errors: back off and retry
    if (attempt >= 6) throw new Error(`API error: ${data.error.code}`);
    console.log(`  API error ${data.error.code} — retry ${attempt + 1}/6 in 30s`);
    await sleep(30000);
    return fetchBatch(titles, attempt + 1);
  }
  return data.query || {};
}

// Map each requested title through the API's normalized[] and redirects[]
// chains to the canonical page it landed on.
function buildResolution(query) {
  const normalized = new Map((query.normalized || []).map(n => [n.from, n.to]));
  const redirects = new Map((query.redirects || []).map(r => [r.from, r.to]));
  const pagesByTitle = new Map((query.pages || []).map(p => [p.title, p]));
  return (requested) => {
    let t = normalized.get(requested) || requested;
    for (let hops = 0; redirects.has(t) && hops < 5; hops++) t = redirects.get(t);
    return pagesByTitle.get(t) || null;
  };
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const query = {
    resource_type: { $exists: true },
    commons_url: /commons\.wikimedia\.org/i,
    $or: [
      { 'source_ids.commons': { $exists: false } },
      { commons_sha1: { $in: [null, ''] } },
    ],
  };

  const total = await books.countDocuments(query);
  console.log(`=== Commons source_ids/sha1 backfill (#3838 item 1)${DRY_RUN ? ' — DRY RUN' : ''} ===`);
  console.log(`${new Date().toISOString()} — ${total} docs in scope, processing ${LIMIT ? Math.min(LIMIT, total) : total}\n`);

  const docs = await books.find(query, {
    projection: { _id: 1, id: 1, slug: 1, title: 1, commons_url: 1, commons_title: 1, commons_sha1: 1, source_ids: 1, commons_width: 1, commons_height: 1 },
  }).limit(LIMIT || 0).toArray();

  const stats = { processed: 0, updated: 0, sha1Written: 0, sha1Mismatch: 0, missing: 0, unresolvable: 0, noImageinfo: 0 };
  const mismatches = [];
  const missingFiles = [];
  const unresolvable = [];

  // Group docs by requested title so duplicates cost one lookup.
  const byTitle = new Map();
  for (const doc of docs) {
    const t = resolveFileTitle(doc);
    if (!t) {
      stats.unresolvable++;
      unresolvable.push({ id: doc.id || String(doc._id), slug: doc.slug, commons_url: doc.commons_url });
      continue;
    }
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(doc);
  }

  const titles = [...byTitle.keys()];
  const nBatches = Math.ceil(titles.length / BATCH_SIZE);
  console.log(`${titles.length} distinct File: titles (${stats.unresolvable} docs unresolvable) → ${nBatches} API batches of ${BATCH_SIZE}\n`);

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batchTitles = titles.slice(i, i + BATCH_SIZE);
    const queryResult = await fetchBatch(batchTitles);
    const resolve = buildResolution(queryResult);

    const ops = [];
    for (const requested of batchTitles) {
      const page = resolve(requested);
      for (const doc of byTitle.get(requested)) {
        stats.processed++;
        if (!page || page.missing) {
          stats.missing++;
          missingFiles.push({ id: doc.id || String(doc._id), slug: doc.slug, requestedTitle: requested });
          continue;
        }
        const info = page.imageinfo?.[0];
        if (!info?.sha1) {
          stats.noImageinfo++;
          missingFiles.push({ id: doc.id || String(doc._id), slug: doc.slug, requestedTitle: requested, note: 'no imageinfo' });
          continue;
        }
        const set = { 'source_ids.commons': page.title };
        if (!doc.commons_sha1) {
          set.commons_sha1 = info.sha1;
          stats.sha1Written++;
        } else if (doc.commons_sha1 !== info.sha1) {
          stats.sha1Mismatch++;
          mismatches.push({
            id: doc.id || String(doc._id), slug: doc.slug, title: doc.title,
            canonicalTitle: page.title, stored_sha1: doc.commons_sha1, commons_sha1: info.sha1,
          });
        }
        if (!doc.commons_width && info.width) set.commons_width = info.width;
        if (!doc.commons_height && info.height) set.commons_height = info.height;
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
      }
    }

    if (ops.length && !DRY_RUN) {
      const r = await books.bulkWrite(ops, { ordered: false });
      stats.updated += r.modifiedCount;
    } else if (ops.length && DRY_RUN) {
      stats.updated += ops.length;
    }

    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[${new Date().toISOString()}] batch ${batchNo}/${nBatches} — ${stats.processed} docs, ${stats.updated} ${DRY_RUN ? 'would-update' : 'updated'}, ${stats.sha1Written} sha1 written, ${stats.sha1Mismatch} sha1 MISMATCH, ${stats.missing} missing on Commons`);
    await sleep(DELAY_MS);
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(JSON.stringify(stats, null, 2));
  if (mismatches.length) {
    console.log(`\n${mismatches.length} sha1 mismatch(es) — stored sha1 kept, listed for integrity review:`);
    for (const m of mismatches.slice(0, 20)) console.log(`  ${m.id} ${m.slug} — stored ${m.stored_sha1.slice(0, 10)}… vs commons ${m.commons_sha1.slice(0, 10)}…`);
    if (mismatches.length > 20) console.log(`  … and ${mismatches.length - 20} more (see JSON report)`);
  }

  const outPath = `scripts/output/commons-source-ids-backfill-${new Date().toISOString().slice(0, 10)}.json`;
  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(), dry_run: DRY_RUN, stats,
    sha1_mismatches: mismatches, missing_on_commons: missingFiles, unresolvable,
  }, null, 2));
  console.log(`\nFull report → ${outPath}`);

  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
