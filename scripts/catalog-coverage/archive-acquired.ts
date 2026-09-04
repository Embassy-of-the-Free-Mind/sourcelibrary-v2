#!/usr/bin/env node
/**
 * Archive newly-acquired gap books to R2 (companion to acquire-gap-batch.mjs).
 * Acquisitions import HIDDEN and the standard archiver doesn't reach them, so
 * this sweeps acquisition_queue status:'acquired' books not yet on R2.
 *   IA books    -> archive-ia-bulk (datacenter-safe).
 *   e-rara IIIF -> per-page fetch + R2 (e-rara is datacenter-tolerant).
 * Run with tsx. Bounded per run; marks queue.archived so runs advance.
 *   npx tsx scripts/catalog-coverage/archive-acquired.ts --batch 60
 *
 * `--provider <name>` sweeps HIDDEN imports by `image_source.provider` instead
 * of the acquisition queue — the generalization #4225 Phase 2 asks for, so
 * imports that never went through `acquisition_queue` (e.g. the #4311 Wellcome
 * Sanskrit wave) still get their masters onto R2:
 *   npx tsx scripts/catalog-coverage/archive-acquired.ts --provider wellcome --batch 20
 * Provider mode records completion on the BOOK (there is no queue row) and is
 * idempotent: archiveIiif only fetches pages that lack `archived_photo`.
 */
import { MongoClient } from 'mongodb';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { storagePut } from '../../src/lib/storage';
import {
  upgradeToFullRes, rateLimitedFetch,
  fetchIiifInfo, fetchIiifNativeRes, shouldTileStitch, SILENT_CAP_HOSTS,
} from '../lib/iiif-utils.mjs';
import { createHostBreaker, classifyFetchError } from '../lib/host-breaker.mjs';
const execFileP = promisify(execFile);
const CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || '6');
// Pages in flight per book. Unchanged from the chunk width it replaces —
// CONCURRENCY × PAGE_CONCURRENCY is the memory budget, and PR #4527 measured
// that budget against `opj_decompress` (~1.0 GB per JP2 decode, 687 OOM events,
// one of which killed cron.service itself). This PR is about scheduling, not
// about buying throughput with memory, so the width stays where it was.
const PAGE_CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--page-concurrency') + 1] || '6');

const BATCH = parseInt(process.argv[process.argv.indexOf('--batch') + 1] || '60');
const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI!); await mc.connect();
  const db = mc.db('bookstore');
  const queue = db.collection('acquisition_queue');
  const books = db.collection('books');
  const pages = db.collection('pages');

  // A blocked host must stop the run, not be retried page after page. On
  // 2026-08-29 Wellcome's CloudFront WAF began answering every image request
  // with 403 "Request blocked" while info.json still returned 200; the empty
  // catch below meant the loop kept firing thousands of doomed requests and
  // reported "partial" progress instead of a failure. Per
  // invariants/archive-fetch-failures.md a 403 is never auto-retried.
  //
  // 429 is deliberately NOT in that set. Lumping it in with 401/403 conflated
  // two different verdicts: "you may not have this" (stop, ask a human) versus
  // "you are going too fast" (slow down, keep going). MDZ 429'd every run from
  // 2026-08-29 and the conflation turned each hourly cron into abort-at-25 →
  // sleep an hour → retry at the identical rate → abort again, netting ~10
  // books/hour against a 3.2k backlog (#4395). A 429 now feeds the rate limiter
  // in iiif-utils, which halves the host's rate and honours Retry-After, so the
  // run converges on a rate the host will serve instead of stopping.
  const hostFailures = new Map<string, number>();
  const hostThrottles = new Map<string, number>();
  const FAIL_ABORT = 25;
  class HostBlocked extends Error {}

  // ── Per-host outcome ledger + circuit breaker ────────────────────────────
  //
  // Until now a page failure was recorded only if it carried 401, 403 or 429;
  // every other error was dropped on the floor. So the log could report "617
  // failed" and say nothing whatever about why, and #4588 spent three rounds of
  // diagnosis guessing at a cause that a status histogram would have handed
  // over in one line. Measured on the box 2026-09-04 the answer was three
  // different things at once — iiif.archive.org 400 "Invalid size", gallica 429
  // on every request, MDZ 100% healthy at 0.3s — and the run's own instrument
  // could not tell them apart.
  //
  // The breaker itself lives in scripts/lib/host-breaker.mjs, lifted from
  // archive-ocr.mjs rather than re-invented here; see that file's header for
  // the rules and why a fourth hand-rolled copy was the wrong move.
  const breaker = createHostBreaker({ log: (m: string) => log(m) });
  const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return 'unknown'; } };

  const noteFailure = (url: string, err: unknown) => {
    const host = hostOf(url);
    const msg = String((err as Error)?.message ?? err);
    breaker.failure(host, classifyFetchError(err));
    if (/\b429\b/.test(msg)) {
      // Throttling is not a block. Count it for visibility only — the backoff
      // itself already happened inside rateLimitedFetch.
      hostThrottles.set(host, (hostThrottles.get(host) ?? 0) + 1);
      return;
    }
    // Only auth/blocking statuses count toward the abort — a slow or oversized
    // page is a per-page problem, not a host verdict.
    if (!/\b(401|403)\b/.test(msg)) return;
    const n = (hostFailures.get(host) ?? 0) + 1;
    hostFailures.set(host, n);
    if (n >= FAIL_ABORT) {
      throw new HostBlocked(`${host}: ${n} consecutive auth/block responses (${msg.slice(0, 120)}). Stopping — do NOT auto-retry a 403.`);
    }
  };

  // ── Heartbeat ────────────────────────────────────────────────────────────
  // This run emits nothing between start and finish. At the post-#4395 rate a
  // batch of 40 books is over an hour of silence, during which a healthy run and
  // a hung one are indistinguishable — on 2026-08-30 a stalled run held the
  // flock for 1h24m and silently no-op'd every subsequent cron, and the only way
  // to tell progress from a hang was to query Mongo by hand.
  //
  // A silent long-running script reads as a hang; the fix is a heartbeat, not an
  // index (invariants/archive-fetch-failures.md). Counters are PAGE-grain
  // because book-grain moves too slowly to separate "working" from "stuck": a
  // 250-page book is minutes of apparent silence on its own.
  //
  // The rate shown is now the rate over the LAST MINUTE, not since the run
  // started. A cumulative average cannot report a stall: on 2026-09-04 the
  // archiver did 53 pages in minute 4 and 5 pages in every minute after, and
  // the heartbeat drifted smoothly from 0.86 to 0.15 pages/s — a shape that
  // reads as gradual decay when it was in fact a cliff. `since` is what the
  // archiver is doing now; the run summary still reports the whole-run figure.
  const runStart = Date.now();
  let pagesDone = 0;
  let pagesFailed = 0;
  let pagesSkipped = 0;
  let localFailures = 0;   // failed AFTER the bytes arrived: sharp, R2 or Mongo, never the source
  let booksDone = 0;
  let workTotal = 0;
  let currentHost = '-';
  let lastTick = Date.now();
  let lastPages = 0;
  const hb = setInterval(() => {
    const mins = (Date.now() - runStart) / 60000;
    const now = Date.now();
    const since = (now - lastTick) / 1000;
    const recent = since > 0 ? (pagesDone - lastPages) / since : 0;
    lastTick = now; lastPages = pagesDone;
    const thr = [...hostThrottles.entries()].map(([h, n]) => `${h.split('.')[0]}:${n}`).join(' ');
    const paused = breaker.openHosts().map(h => h.split('.')[0]).join(' ');
    log(`heartbeat ${mins.toFixed(1)}m | books ${booksDone}/${workTotal} | pages ${pagesDone} ok, ${pagesFailed} failed${pagesSkipped ? `, ${pagesSkipped} skipped` : ''} | ${recent.toFixed(2)} pages/s now | host ${currentHost}${thr ? ` | throttled ${thr}` : ''}${paused ? ` | PAUSED ${paused}` : ''}`);
  }, 60_000);
  // Never let the heartbeat hold the process open past the work.
  if (typeof hb.unref === 'function') hb.unref();

  async function archiveIiif(bookId: string) {
    const ps = await pages.find({ book_id: bookId, archived_photo: { $exists: false }, $or: [{ photo: /^https?:/ }, { photo_original: /^https?:/ }] }, { projection: { _id: 1, page_number: 1, photo: 1, photo_original: 1 } }).toArray();
    // Pages ran in chunks of 6 behind `await Promise.all(chunk)`. That barrier
    // paces the whole chunk at its slowest member, and the slowest member of a
    // chunk is routinely a page burning 4 attempts × 30s of timeout — so five
    // healthy pages waited two minutes on one doomed one. A pool of the same
    // width keeps 6 requests genuinely in flight instead.
    let next = 0;
    let pageBlocked: Error | null = null;
    const worker = async (): Promise<void> => {
      while (true) {
        if (pageBlocked) return;
        const p: any = ps[next++];
        if (!p) return;
        const url = upgradeToFullRes(p.photo_original || p.photo);
        const host = hostOf(url);
        currentHost = host;
        // A paused host is skipped without a request, and cheaply: the point is
        // to hand this worker back to the pool, not to fail faster.
        if (!breaker.allow(host)) { breaker.skipped(host); pagesSkipped++; continue; }
        // Did the bytes arrive? Everything after that point is OUR machinery —
        // sharp, R2, Mongo — and a failure there says nothing about the source.
        // Charging an R2 outage to the institution's breaker would pause every
        // healthy host at once and stall the run for the same reason a bad
        // `archived_photo` write hides a readable page: an error we did not
        // attribute became a fact about someone else
        // (invariants/archive-fetch-failures.md).
        let fetched = false;
        try {
          // `/full/full/` is a REQUEST, not a guarantee. Seven hosts silently
          // cap the response below native — measured losses up to 8.69x (Kyoto),
          // 5.92x (TU Delft), 3.25x (Manchester) — and until #4406 the only
          // callers that defeated the cap were archive-eap.mjs and the repair
          // sweep. Everything else stored the capped derivative AS the master,
          // permanently, because nothing ever compared what we asked for against
          // what came back.
          //
          // info.json is fetched ONLY for hosts already known to cap. That keeps
          // request volume unchanged for the ~78% of pages from honest hosts —
          // three institutions blocked us inside 48 hours in August 2026, so an
          // extra probe per page is not free. New cappers are found by the
          // sampled audit (scripts/audit/archive-coverage.mjs) and added to
          // SILENT_CAP_HOSTS, which is what makes them take effect here.
          const capSuspect = SILENT_CAP_HOSTS.some((h: string) => url.includes(h));
          const info = capSuspect ? await fetchIiifInfo(url).catch(() => null) : null;

          let buf: Buffer;
          let stitchedTiles = 0;
          if (info && shouldTileStitch(info, url)) {
            const stitch = await fetchIiifNativeRes(url, { info });
            buf = stitch.buffer;
            stitchedTiles = stitch.tiles;
          } else {
            buf = await rateLimitedFetch(url);
          }
          fetched = true;
          // The host served us: that is the breaker's whole question, and
          // settling it here (rather than after the write) is also what releases
          // a half-open probe slot on every path out of this block.
          breaker.success(host);

          // Archive at source fidelity: no resolution cap (#3897, matches archive-ia-bulk).
          const jpg = await sharp(buf).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
          const padded = String(p.page_number).padStart(4, '0');
          const blob = await storagePut(`pages/${bookId}/${padded}.jpg`, jpg, { contentType: 'image/jpeg', access: 'public' });
          const upd: any = { $set: { archived_photo: blob.url } };
          // Record what we actually stored, and (when we know it) what the source
          // says native is. Without this, "did we get the master?" can only be
          // answered by re-fetching from the institution — which is why the
          // MASTER tier is sampled rather than known, and why this debt went
          // uncounted for months. Stored dims are free: sharp already decoded it.
          try {
            const dims = await sharp(jpg).metadata();
            if (dims.width) upd.$set.image_width = dims.width;
            if (dims.height) upd.$set.image_height = dims.height;
          } catch { /* dimensions are a nice-to-have; never fail an archive over them */ }
          if (info?.width) {
            upd.$set['iiif_info.width'] = info.width;
            upd.$set['iiif_info.height'] = info.height;
          }
          if (stitchedTiles) upd.$set.stitched_tiles = stitchedTiles;
          try { const th = await sharp(buf).rotate().resize(150, null, { withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer(); upd.$set.thumbnail_blob = (await storagePut(`pages/${bookId}/${padded}-thumb.jpg`, th, { contentType: 'image/jpeg', access: 'public' })).url; } catch {}
          await pages.updateOne({ _id: p._id }, upd);
          pagesDone++;
          hostFailures.clear(); // a success clears the streak
        } catch (e) {
          if (e instanceof HostBlocked) { pageBlocked = e; return; }
          pagesFailed++;
          if (!fetched) {
            try {
              noteFailure(url, e); // rethrows HostBlocked once the host looks blocked
            } catch (h) {
              if (h instanceof HostBlocked) { pageBlocked = h; return; }
              throw h;
            }
          } else {
            // The source did its part. Count it so the run still reports the
            // loss, but never against the host — pausing an institution because
            // our own bucket is down is precisely backwards.
            localFailures++;
            if (localFailures <= 5) log(`local failure after a good fetch (${classifyFetchError(e)}): ${String((e as Error)?.message ?? e).slice(0, 140)}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, ps.length) }, () => worker()));
    if (pageBlocked) throw pageBlocked;
  }

  // Work list: acquisition_queue rows by default, or hidden imports of one
  // provider when --provider is passed. Provider rows are shaped like queue
  // rows ({ book_id, source }) with sn:null so the queue writes below no-op.
  const provIdx = process.argv.indexOf('--provider');
  const PROVIDER = provIdx > -1 ? process.argv[provIdx + 1] : null;
  let todo: any[];
  if (PROVIDER) {
    const cand = await books.find(
      {
        'image_source.provider': PROVIDER,
        pages_count: { $gt: 0 },
        archive_status: { $ne: 'archive_complete' },
      },
      { projection: { id: 1 } },
    ).limit(BATCH).toArray();
    todo = cand.map((b: any) => ({ sn: null, book_id: b.id, source: 'iiif' }));
    log(`provider mode: ${PROVIDER} — ${todo.length} book(s) not yet archive_complete`);
  } else {
    // Least-attempted first. The selection had no sort, so it returned the same
    // head of the queue every hour — and once that head was a set of books on a
    // host that was refusing us, every run for days re-attempted exactly those
    // books and never reached the healthy ones behind them. Ordering by attempt
    // count makes the queue rotate: a book that could not be archived this hour
    // goes to the back rather than to the front. Rows written before this field
    // existed sort first (missing < 0 in BSON), which is what we want — an
    // untried book outranks one we have already failed on.
    todo = await queue.find({ status: 'acquired', book_id: { $exists: true }, archived: { $ne: true } })
      .sort({ archive_attempts: 1, _id: 1 })
      .limit(BATCH).toArray();
  }
  let ok = 0, partial = 0, stalled = 0;
  // How many runs a book may make zero progress on before it is parked out of
  // the queue. Eight hours of hourly runs is long enough to ride out a source
  // outage and short enough that a permanently-dead book stops taking a slot.
  const MAX_ATTEMPTS = 8;
  // Provider-mode rows have no queue row. `{ sn: null }` would MATCH queue docs
  // whose sn is null/missing, so every queue write goes through this guard.
  const markQueue = async (w: any, set: Record<string, unknown>) => {
    if (w.sn == null) return;
    await queue.updateOne({ sn: w.sn }, { $set: set });
  };
  async function processBook(w: any) {
    const b = await books.findOne({ id: w.book_id }, { projection: { id: 1, pages_count: 1 } });
    if (!b) { await markQueue(w, { archived: true, archive_note: 'no-book' }); return; }
    const have0 = await pages.countDocuments({ book_id: w.book_id, archived_photo: /^https?:/ });
    if (have0 < (b.pages_count || 0) * 0.99) {
      if (w.source === 'erara' || w.source === 'iiif' || w.source === 'mdz' || w.source === 'gallica') { await archiveIiif(w.book_id); }
      else { try { await execFileP('node', ['scripts/maintenance/archive-ia-bulk.mjs', `--book-id=${w.book_id}`], { timeout: 300000 }); } catch {} }
    }
    const r2 = await pages.countDocuments({ book_id: w.book_id, archived_photo: /^https?:/ });
    if (r2 >= (b.pages_count || 0) * 0.99 && r2 > 0) {
      await books.updateOne({ id: w.book_id }, { $set: { archive_status: 'archive_complete', pages_archived: r2, updated_at: new Date() } });
      await markQueue(w, { archived: true });
      ok++;
    } else {
      // Record partial progress on the book too, so provider-mode runs are
      // resumable and a later run can see how far it got.
      await books.updateOne({ id: w.book_id }, { $set: { pages_archived: r2, updated_at: new Date() } });
      // A book that archived NOTHING was being marked `archived: true` and
      // dropped from the queue for good, with the truth demoted to a note
      // ("partial:0/424") that nothing reads. That is the shape CLAUDE.md's
      // Data Protection rule names: a write that erases its own repair path.
      // It was invisible only because the run was killed at the 50-minute
      // ceiling before it ever reached this line — fixing the throughput above
      // is precisely what makes it reachable, so it has to be fixed here too.
      //
      // A book stays in the queue while it is still making progress, or until
      // it has been tried MAX_ATTEMPTS times without any. Then it is parked
      // with a note that SAYS it was parked, so the archiving watchdog and a
      // human can both find it.
      const attempts = (w.archive_attempts ?? 0) + 1;
      const progressed = r2 > have0;
      if (!progressed && attempts >= MAX_ATTEMPTS) {
        await markQueue(w, { archived: true, archive_stalled: true, archive_attempts: attempts, archive_note: `stalled:${r2}/${b.pages_count} after ${attempts} attempts` });
        stalled++;
      } else {
        await markQueue(w, { archive_attempts: attempts, archive_note: `partial:${r2}/${b.pages_count}` });
      }
      partial++;
    }
  }
  let blocked: Error | null = null;
  workTotal = todo.length;
  log(`starting: ${workTotal} book(s), concurrency ${CONCURRENCY} × ${PAGE_CONCURRENCY} pages — heartbeat every 60s`);
  // Books ran in fixed slices of CONCURRENCY behind `await Promise.all(slice)`.
  // A slice does not advance until its SLOWEST book finishes, and its finished
  // workers sit idle in the meantime — so a slice containing one book on a
  // blocked host runs at that book's speed with most of its capacity parked.
  // Measured 2026-09-04: a run completed its first book at minute 5 and then
  // held the remaining seven slots on gallica and Internet Archive books that
  // could not fetch a single page, for 45 more minutes, while 7,559 healthy
  // MDZ/BSB books waited in the same 240-row batch and were never reached.
  //
  // A pool keeps CONCURRENCY books genuinely in flight: a finished book is
  // replaced immediately by the next one in the queue.
  let nextBook = 0;
  const bookWorker = async (): Promise<void> => {
    while (!blocked) {
      const w = todo[nextBook++];
      if (!w) return;
      try {
        await processBook(w);
      } catch (e) {
        // Per-book failures stay swallowed (one bad book must not stop a sweep),
        // but a blocked HOST is a verdict about the source: stop the whole run
        // and say so, rather than grinding out thousands of doomed requests.
        if (e instanceof HostBlocked) blocked = e as Error;
      } finally {
        booksDone++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => bookWorker()));
  clearInterval(hb);
  const remaining = PROVIDER
    ? await books.countDocuments({ 'image_source.provider': PROVIDER, pages_count: { $gt: 0 }, archive_status: { $ne: 'archive_complete' } })
    : await queue.countDocuments({ status: 'acquired', archived: { $ne: true } });
  const throttled = [...hostThrottles.entries()].map(([h, n]) => `${h}:${n}`).join(' ');
  const runMins = (Date.now() - runStart) / 60000;
  const runRate = runMins > 0 ? pagesDone / (runMins * 60) : 0;
  log(`archive-acquired: complete ${ok}, partial ${partial}, stalled ${stalled} | pages ${pagesDone} ok, ${pagesFailed} failed, ${pagesSkipped} skipped${localFailures ? `, ${localFailures} local (store/encode)` : ''} in ${runMins.toFixed(1)}m (${runRate.toFixed(2)} pages/s) | un-archived acquired remaining ${remaining}${throttled ? ` | throttled ${throttled}` : ''}`);
  // Per-host triage, printed every run. A failure count without the source's
  // own answer next to it is not a measurement — it is what made #4588 take
  // three wrong diagnoses to reach a cause that this table states outright.
  if (breaker.size()) log(`per-host outcomes this run:\n${breaker.report()}`);
  if (blocked) {
    // Exit non-zero so a wrapper loop stops instead of re-running into the block.
    log(`ABORTED — SOURCE BLOCKED: ${(blocked as Error).message}`);
    log('Back off and check with the institution before retrying. Do not change user-agent to route around a block.');
    await mc.close();
    process.exit(3);
  }
  await mc.close();
}
main().catch(e => { console.error(e); process.exit(1); });
