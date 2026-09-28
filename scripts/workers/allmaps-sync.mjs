#!/usr/bin/env node
/**
 * Allmaps sync (#5076, step 2 of #5070): pull volunteer georeferencing back onto our map pages.
 *
 * PRIOR ART: scripts/workers/gallery-coverage-snapshot.mjs (walks gallery_images, writes a
 * `system_config` snapshot) and scripts/lib/iiif-utils.mjs#rateLimitedFetch (per-host rate
 * gate, 429 penalty, retry with backoff). Neither talks to Allmaps; the lookup/matching logic
 * is in scripts/lib/allmaps.mjs.
 *
 * For every `gallery_images` row with `type: "map"`:
 *   1. resolve the IIIF resource the Georeference button opens (same rule as src/lib/allmaps.ts:
 *      source image info.json → IA manifest → imported manifest → nothing);
 *   2. ask Allmaps for that resource's annotations — ONCE per resource across the run (an
 *      Internet Archive manifest covers a whole book; a per-image service is one call per page);
 *   3. match returned annotations to the page (image service id, IA canvas leaf, or the
 *      manifest's canvas order) and write `gallery_images.allmaps`:
 *        { annotation_id, viewer_url, gcps, modified, target, checked_at }
 *      `$unset` it when a stored annotation is gone.
 *
 * Failure looks different from zero (measurement-instruments.md): Allmaps answers 404 for a
 * resource nobody has georeferenced — that is `zero`. 5xx/network/timeouts are `error`, and a
 * row whose lookups errored is left untouched (never unset on a failed read). Both are counted
 * separately in the `allmaps_sync_snapshot` document and printed at the end. Per-book changes
 * are recorded as `sweep_log` rows (sweep `allmaps-sync`).
 *
 * Writes never touch `gallery_images.updated_at`: sync-worker.mjs uses max(updated_at) as its
 * "pages changed since" watermark. A page that sync-worker re-materialises loses `allmaps`
 * until the next nightly run restores it (same self-healing shape as `hires_url`).
 *
 * Cost: one HTTP call per distinct target. Measured 2026-09-25 over 6,138 map rows / 668 books:
 * see the PR for the count. Rate: 2 req/s to annotations.allmaps.org (DOMAIN_LIMITS).
 *
 * Usage (Hetzner, nightly — infrastructure/hetzner-crontab):
 *   set -a; source .env.production.local; set +a; node scripts/workers/allmaps-sync.mjs
 * Options: --dry-run   --limit=N (rows)   --book=<book id>   --verbose
 */

import { getScriptClient } from '../lib/mongo.mjs';
import { claimSlot, getDomainLimit, noteRateLimited } from '../lib/iiif-utils.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import {
  allmapsLookups,
  pickAnnotation,
  summarizeAnnotation,
  indexManifestCanvases,
} from '../lib/allmaps.mjs';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose');
const LIMIT = Number(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 0);
const ONLY_BOOK = argv.find((a) => a.startsWith('--book='))?.split('=')[1] || null;
const SWEEP = 'allmaps-sync';
const SNAPSHOT_ID = 'allmaps_sync_snapshot';
const USER_AGENT = 'SourceLibrary allmaps-sync (https://sourcelibrary.org; derek@sourcelibrary.org)';

function log(...args) { console.log(`[allmaps-sync]`, ...args); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a JSON resource through the shared per-host rate gate (claimSlot / noteRateLimited
 * from iiif-utils.mjs), with the retry policy this API needs:
 *   404  → `zero` immediately (Allmaps' "nobody georeferenced this"); never retried
 *   429  → penalise the host and retry
 *   5xx / network / timeout → retry with backoff, then `error`
 *   other 4xx → `error` immediately
 * Not `rateLimitedFetch`: it retries 4xx too (its 4xx throw lands in its own catch), which
 * would turn every one of ~3.5K nightly 404s into four requests and a 3.5 s backoff.
 *
 * @returns {{status:'ok', json:any}|{status:'zero'}|{status:'error', message:string}}
 */
async function getJson(url) {
  let host;
  try { host = new URL(url).hostname; } catch { host = 'unknown'; }
  const limit = getDomainLimit(url);
  let last = 'unknown';
  for (let attempt = 0; attempt < 4; attempt++) {
    await claimSlot(host, limit);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (res.status === 404) return { status: 'zero' };
      if (res.ok) return { status: 'ok', json: await res.json() };
      last = `HTTP ${res.status}`;
      if (res.status === 429) noteRateLimited(url, Number(res.headers.get('retry-after')));
      else if (res.status >= 400 && res.status < 500) return { status: 'error', message: last };
    } catch (e) {
      last = e?.message || String(e);
    } finally {
      clearTimeout(t);
    }
    await sleep(500 * 2 ** attempt);
  }
  return { status: 'error', message: last };
}

async function loadMapRows(db) {
  const match = { type: 'map' };
  if (ONLY_BOOK) match.book_id = ONLY_BOOK;
  const pipeline = [
    { $match: match },
    { $lookup: { from: 'pages', localField: 'page_id', foreignField: 'id', as: 'p' } },
    { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'b' } },
    { $unwind: { path: '$b', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        id: 1, book_id: 1, page_number: 1, allmaps: 1,
        photo: '$p.photo', photo_original: '$p.photo_original',
        ia_identifier: '$b.ia_identifier', iiif_manifest: '$b.image_source.iiif_manifest',
      },
    },
    { $sort: { book_id: 1, page_number: 1 } },
    ...(LIMIT > 0 ? [{ $limit: LIMIT }] : []),
  ];
  return db.collection('gallery_images').aggregate(pipeline, { allowDiskUse: true }).toArray();
}

async function main() {
  const start = Date.now();
  const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });
  const counts = {
    rows: 0, rows_with_target: 0, rows_no_target: 0,
    lookups_total: 0, lookups_found: 0, lookups_zero: 0, lookups_error: 0,
    manifests_fetched: 0, manifests_error: 0,
    rows_matched: 0, set: 0, refreshed: 0, unset: 0, unchanged: 0, skipped_lookup_error: 0,
  };

  try {
    const rows = await loadMapRows(db);
    counts.rows = rows.length;
    log(`${rows.length} map rows${ONLY_BOOK ? ` (book ${ONLY_BOOK})` : ''}${DRY_RUN ? ' — DRY RUN' : ''}`);

    // 1. Resolve every row's lookups; dedupe the API calls across rows.
    const perRow = new Map(); // row.id → lookups[]
    const apis = new Map();   // api url → lookup (kind/target) for the fetch phase
    for (const row of rows) {
      const lookups = allmapsLookups({
        pageImageUrls: [row.photo_original, row.photo],
        iaIdentifier: row.ia_identifier,
        iiifManifest: row.iiif_manifest,
      });
      perRow.set(row.id, lookups);
      if (lookups.length) counts.rows_with_target++; else counts.rows_no_target++;
      for (const l of lookups) if (!apis.has(l.api)) apis.set(l.api, l);
    }
    counts.lookups_total = apis.size;
    log(`${apis.size} distinct Allmaps lookups for ${counts.rows_with_target} rows with a target (${counts.rows_no_target} rows have nothing Allmaps can tile)`);

    // 2. Fetch each lookup once. Sequential on purpose — the limiter paces the host and a
    //    single lane keeps a bad night (Allmaps down) from fanning out into thousands of retries.
    const results = new Map(); // api → {status, items}
    let done = 0;
    for (const [api, l] of apis) {
      const r = await getJson(api);
      if (r.status === 'ok') {
        const items = Array.isArray(r.json?.items) ? r.json.items : [];
        results.set(api, { status: 'ok', items });
        if (items.length) counts.lookups_found++; else counts.lookups_zero++;
        if (VERBOSE && items.length) log(`found ${items.length} annotation(s) for ${l.target}`);
      } else if (r.status === 'zero') {
        results.set(api, { status: 'zero', items: [] });
        counts.lookups_zero++;
      } else {
        results.set(api, { status: 'error', items: [], message: r.message });
        counts.lookups_error++;
        if (VERBOSE) log(`lookup error ${l.target}: ${r.message}`);
      }
      done++;
      if (done % 250 === 0) log(`  ${done}/${apis.size} lookups (found ${counts.lookups_found}, zero ${counts.lookups_zero}, error ${counts.lookups_error})`);
    }

    // 3. Manifest canvas order, only for non-IA manifest lookups that actually returned
    //    annotations (IA canvases carry their leaf in the id, so no fetch is needed there).
    const manifestIndex = new Map(); // manifest url → {byCanvasId, byService} | null
    for (const [api, l] of apis) {
      if (l.kind !== 'manifest' || /iiif\.archive\.org\//.test(l.target)) continue;
      if (!results.get(api)?.items?.length) continue;
      const r = await getJson(l.target);
      if (r.status === 'ok') {
        manifestIndex.set(l.target, indexManifestCanvases(r.json));
        counts.manifests_fetched++;
      } else {
        manifestIndex.set(l.target, null);
        counts.manifests_error++;
        log(`manifest fetch failed ${l.target}: ${r.message || r.status}`);
      }
    }

    // 4. Match per row and write the diff.
    const changesByBook = new Map(); // book_id → { linked: [], unlinked: [] }
    const noteChange = (row, kind, annotationId) => {
      if (!changesByBook.has(row.book_id)) changesByBook.set(row.book_id, { linked: [], unlinked: [] });
      changesByBook.get(row.book_id)[kind].push(annotationId ? `${row.id} → ${annotationId}` : row.id);
    };
    const now = new Date();
    for (const row of rows) {
      const lookups = perRow.get(row.id) || [];
      const items = [];
      let anyError = false;
      let manifestUnreadable = false;
      let ctx = { pageNumber: row.page_number, iaIdentifier: row.ia_identifier || undefined };
      let matchTarget = null;
      let picked = null;
      for (const l of lookups) {
        const r = results.get(l.api);
        if (!r || r.status === 'error') { anyError = true; continue; }
        if (!r.items.length) continue;
        const lookupCtx = { ...ctx };
        if (l.kind === 'image') lookupCtx.serviceId = l.serviceId;
        else if (!/iiif\.archive\.org\//.test(l.target)) {
          const idx = manifestIndex.get(l.target);
          if (!idx) { manifestUnreadable = true; continue; }
          lookupCtx.canvasIndexById = idx.byCanvasId;
          lookupCtx.canvasIndexByService = idx.byService;
        }
        const hit = pickAnnotation(r.items, lookupCtx);
        if (hit && !picked) { picked = hit; matchTarget = l.target; }
        items.push(...r.items);
      }

      if (picked) {
        counts.rows_matched++;
        const next = summarizeAnnotation(picked, matchTarget, now);
        const prev = row.allmaps;
        const changed = !prev || prev.annotation_id !== next.annotation_id || String(prev.modified || '') !== String(next.modified || '');
        if (!DRY_RUN) {
          await db.collection('gallery_images').updateOne({ id: row.id }, { $set: { allmaps: next } });
        }
        if (changed) { counts.set++; noteChange(row, 'linked', next.annotation_id); }
        else counts.refreshed++;
        if (VERBOSE) log(`${changed ? 'LINK' : 'keep'} ${row.id} p.${row.page_number} ← ${next.annotation_id} (${next.gcps} gcps)`);
        continue;
      }
      if (anyError || manifestUnreadable) {
        // A failed read is not evidence of absence — leave whatever is stored.
        counts.skipped_lookup_error++;
        continue;
      }
      if (row.allmaps) {
        if (!DRY_RUN) await db.collection('gallery_images').updateOne({ id: row.id }, { $unset: { allmaps: '' } });
        counts.unset++;
        noteChange(row, 'unlinked', row.allmaps.annotation_id);
        if (VERBOSE) log(`UNLINK ${row.id} p.${row.page_number} (was ${row.allmaps.annotation_id})`);
      } else {
        counts.unchanged++;
      }
    }

    // 5. Record what changed, per book (a ROW, not a column — field-sprawl.md).
    if (!DRY_RUN) {
      for (const [bookId, ch] of changesByBook) {
        if (ch.linked.length) {
          await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'allmaps-linked', detail: { images: ch.linked } });
        }
        if (ch.unlinked.length) {
          await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'allmaps-unlinked', detail: { images: ch.unlinked } });
        }
      }
    }

    const status = counts.lookups_total > 0 && counts.lookups_error === counts.lookups_total
      ? 'failed'
      : counts.lookups_error > 0 ? 'degraded' : 'ok';
    const snapshot = {
      _id: SNAPSHOT_ID,
      computed_at: new Date(),
      computation_ms: Date.now() - start,
      status,
      dry_run: DRY_RUN,
      scope: ONLY_BOOK ? { book_id: ONLY_BOOK } : LIMIT ? { limit: LIMIT } : 'all',
      counts,
      linked_rows_after_run: DRY_RUN ? null : await db.collection('gallery_images').countDocuments({ type: 'map', allmaps: { $exists: true } }),
    };
    if (!DRY_RUN && !ONLY_BOOK && !LIMIT) {
      await db.collection('system_config').replaceOne({ _id: SNAPSHOT_ID }, snapshot, { upsert: true });
    }

    log(`done in ${Math.round(snapshot.computation_ms / 1000)}s — status ${status}`);
    log(`  lookups: ${counts.lookups_total} (found ${counts.lookups_found}, zero ${counts.lookups_zero}, error ${counts.lookups_error}); manifests fetched ${counts.manifests_fetched}`);
    log(`  rows: ${counts.rows} (target ${counts.rows_with_target}, none ${counts.rows_no_target}); matched ${counts.rows_matched}: set ${counts.set}, refreshed ${counts.refreshed}; unset ${counts.unset}; skipped on lookup error ${counts.skipped_lookup_error}`);
    if (snapshot.linked_rows_after_run !== null) log(`  map rows carrying allmaps now: ${snapshot.linked_rows_after_run}`);
    if (status === 'failed') process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => { console.error('[allmaps-sync] fatal:', err); process.exit(1); });
