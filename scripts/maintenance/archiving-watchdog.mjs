#!/usr/bin/env node
/**
 * archiving-watchdog.mjs — keep the pipeline moving when archiving issues happen.
 *
 * Books wait at pipeline_auto.status:'archiving' until their page images are
 * copied to R2; only then do they advance to archive_complete -> OCR. When a
 * source 403s (IA lending books), 404s (stale IIIF URLs), or goes offline, the
 * affected books pile up in 'archiving' indefinitely and silently — the OCR
 * feed looks "stuck" when really nothing is wrong with OCR. See
 * .claude/handoffs and memory: lesson_archiving_provider_routing_gaps.
 *
 * This watchdog finds stuck books, probes their source, and self-heals:
 *   - restricted   (IA access-restricted / printdisabled)  -> park needs_attention
 *   - dead         (sample page 403/404/410)               -> park needs_attention
 *   - unreachable  (timeout / 000 / 5xx)                    -> stamp + retry; park only
 *                                                              after --escalate-days
 *   - archivable   (sample page 200, not yet on R2)         -> trigger on-demand
 *                                                              archive to R2 via API
 *   - progressing  (Mac-only worker actively archiving)     -> leave alone
 *
 * Everything is logged to the `watchdog_runs` collection and stdout — nothing
 * is parked silently. Reversible: parked books keep their pages and can be
 * re-queued by clearing pipeline_auto.status back to 'archiving'/'queued'.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/archiving-watchdog.mjs            # dry run
 *   ... node scripts/maintenance/archiving-watchdog.mjs --apply                                              # act
 *   ... --apply --stale-hours=12 --escalate-days=7 --probe-limit=400 --rearchive
 *
 * Flags:
 *   --apply           perform writes / trigger archiving (default: dry run)
 *   --stale-hours=N   only consider books unchanged for > N hours (default 6)
 *   --escalate-days=N park 'unreachable' books once they've been unreachable
 *                     this long (default 7)
 *   --probe-limit=N   max books to probe this run (default 500)
 *   --rearchive       trigger on-demand R2 archiving for 'archivable' books
 *                     (default off — classification still reports them)
 */
import { MongoClient } from 'mongodb';
import { ARCHIVABLE_SOURCES_REGEX } from '../lib/archivable-sources.mjs';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const REARCHIVE = ARGS.includes('--rearchive');
const numArg = (name, def) => {
  const m = ARGS.find(a => a.startsWith(`--${name}=`));
  return m ? Number(m.split('=')[1]) : def;
};
const STALE_HOURS = numArg('stale-hours', 6);
const ESCALATE_DAYS = numArg('escalate-days', 7);
const PROBE_LIMIT = numArg('probe-limit', 500);
const PROBE_TIMEOUT_MS = 12000;
const PROBE_CONCURRENCY = 6;

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;

// Providers archived by a local Mac launchd worker (Hetzner IPs are blocked).
// If they're making progress we leave them; the Mac worker owns them.
const MAC_ONLY_PROVIDERS = new Set(['harvard', 'e-rara', 'gallica']);
// What the on-demand /archive-images route (and Hetzner archiver) can fetch.
// Shared with the archive route — this list used to be private here and 6 hosts
// longer than the route's, so the watchdog classified books "archivable" that
// the route then silently refused. See scripts/lib/archivable-sources.mjs.
const ARCHIVABLE_RE = ARCHIVABLE_SOURCES_REGEX;

function log(...a) { console.log(...a); }

async function probeUrl(url) {
  // Returns { verdict: 'ok' | 'dead' | 'unreachable', why } — the WHY matters, because a
  // throttle and a dead host are the same verdict here and want opposite responses. BSB and
  // MDZ answer a single request with 200 and a sustained fetch with 429 (#4872): 2,784 books
  // read as "unreachable since" when the source was only refusing the rate we asked at, and
  // the fix is to fetch them from a residential connection, not to escalate them as gone.
  if (!url || !/^https?:\/\//.test(url)) return { verdict: 'dead', why: 'no url' };
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.ok) return { verdict: 'ok', why: `HTTP ${res.status}` };
    if ([401, 403, 404, 410].includes(res.status)) return { verdict: 'dead', why: `HTTP ${res.status}` };
    if (res.status === 429) return { verdict: 'unreachable', why: 'HTTP 429 (throttled — try a residential lane)' };
    return { verdict: 'unreachable', why: `HTTP ${res.status}` }; // 5xx etc. — transient
  } catch (e) {
    return { verdict: 'unreachable', why: (e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed')).slice(0, 60) };
  }
}

async function iaRestricted(identifier) {
  if (!identifier || identifier === 'manifest.json') return false;
  try {
    const r = await fetch(`https://archive.org/metadata/${identifier}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return false;
    const j = await r.json();
    if (!j.metadata) return false;
    const restricted = j.metadata['access-restricted-item'] === true || j.metadata['access-restricted-item'] === 'true';
    const coll = [].concat(j.metadata.collection || []);
    return restricted || coll.includes('printdisabled');
  } catch { return false; }
}

function iaIdentifier(b) {
  return b.image_source?.ia_identifier || b.ia_identifier ||
    (b.image_source?.source_url || '').replace(/\/$/, '').split('/').pop();
}

async function setStatus(db, book, status, extra) {
  if (!APPLY) return;
  await db.collection('books').updateOne({ id: book.id }, {
    $set: {
      'pipeline_auto.status': status,
      'pipeline_auto.last_updated': new Date(),
      ...Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [`pipeline_auto.${k}`, v])),
      updated_at: new Date(),
    },
  });
  await db.collection('audit_log').insertOne({
    action: 'pipeline_status_changed', book_id: book.id, book_title: book.title,
    metadata: { from: 'archiving', to: status, source: 'archiving-watchdog', ...(extra || {}) },
    timestamp: new Date(),
  }).catch(() => {});
}

async function triggerRearchive(book) {
  if (!APPLY || !REARCHIVE) return { triggered: false };
  if (!CRON_SECRET) return { triggered: false, error: 'no CRON_SECRET' };
  try {
    const r = await fetch(`${BASE_URL}/api/books/${book.id}/archive-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ limit: 1000 }),
      signal: AbortSignal.timeout(290000),
    });
    const j = await r.json().catch(() => ({}));
    return { triggered: true, status: r.status, archived: j.archived, failed: j.failed, remaining: j.remaining };
  } catch (e) {
    return { triggered: true, error: e.message?.slice(0, 80) };
  }
}

async function main() {
  const c = new MongoClient(MONGO);
  await c.connect();
  const db = c.db('bookstore');

  const staleCutoff = new Date(Date.now() - STALE_HOURS * 3600_000);
  // Stuck in 'archiving' and not touched recently. (updated_at may be missing on
  // bulk-imported books — those count as stale, which is what we want.)
  const candidates = await db.collection('books').find({
    'pipeline_auto.status': 'archiving',
    $or: [{ updated_at: { $lt: staleCutoff } }, { updated_at: { $exists: false } }],
  }).project({
    id: 1, title: 1, image_source: 1, ia_identifier: 1, pages_count: 1, pages_archived: 1,
    'pipeline_auto.archive_stall': 1,
  }).limit(PROBE_LIMIT).toArray();

  log(`[watchdog] ${APPLY ? 'APPLY' : 'DRY RUN'} | ${candidates.length} books stuck in archiving >${STALE_HOURS}h | rearchive=${REARCHIVE}`);

  // 'owned' = handled by a dedicated local Mac worker; we never park or
  // API-rearchive these (the Vercel API can't fetch Mac-only hosts).
  const buckets = { restricted: [], dead: [], unreachable: [], archivable: [], owned: [], progressing: [], escalated: [] };

  for (let i = 0; i < candidates.length; i += PROBE_CONCURRENCY) {
    const chunk = candidates.slice(i, i + PROBE_CONCURRENCY);
    await Promise.all(chunk.map(async (b) => {
      const provider = b.image_source?.provider || 'unknown';
      const sample = await db.collection('pages').find({
        book_id: b.id,
        $or: [{ archived_photo: { $exists: false } }, { archived_photo: { $regex: /^failed:/ } }],
      }).sort({ page_number: 1 }).limit(1).project({ photo: 1, photo_original: 1 }).toArray();
      const url = sample[0]?.photo_original || sample[0]?.photo;

      // Mac-only providers: owned by the dedicated local launchd worker, which
      // fetches from hosts that block the Hetzner/Vercel IPs. Never park or
      // API-rearchive — just note whether they're actively progressing.
      if (MAC_ONLY_PROVIDERS.has(provider)) {
        if ((b.pages_archived || 0) > 0) buckets.progressing.push({ b, provider });
        else buckets.owned.push({ b, provider });
        return;
      }

      if (provider === 'internet_archive' && await iaRestricted(iaIdentifier(b))) {
        buckets.restricted.push({ b, provider, url }); return;
      }

      const { verdict, why } = await probeUrl(url);
      if (verdict === 'dead') { buckets.dead.push({ b, provider, url, why }); }
      else if (verdict === 'ok') { buckets.archivable.push({ b, provider, url, why }); }
      else {
        // unreachable — transient; escalate only if it's been failing for a while
        const since = b.pipeline_auto?.archive_stall?.unreachable_since;
        const sinceMs = since ? new Date(since).getTime() : null;
        // A throttle never escalates: "gone" is the wrong conclusion from 429, however long
        // it has been saying it. It needs a different lane, not a terminal status (#4872).
        const throttled = why.startsWith('HTTP 429');
        if (!throttled && sinceMs && (Date.now() - sinceMs) > ESCALATE_DAYS * 86400_000) {
          buckets.escalated.push({ b, provider, url, since, why });
        } else {
          buckets.unreachable.push({ b, provider, url, first: !sinceMs, why });
        }
      }
    }));
  }

  // Apply actions
  for (const { b } of buckets.restricted) {
    await setStatus(db, b, 'needs_attention', { error: 'IA access-restricted (lending/printdisabled) — page images undownloadable', archive_verdict: 'restricted' });
  }
  for (const { b, url } of buckets.dead) {
    await setStatus(db, b, 'needs_attention', { error: `source page returned 403/404/410 — stale URL: ${(url || '').slice(0, 120)}`, archive_verdict: 'dead' });
  }
  for (const { b, since } of buckets.escalated) {
    await setStatus(db, b, 'needs_attention', { error: `source unreachable since ${since} (>${ESCALATE_DAYS}d) — likely gone`, archive_verdict: 'escalated' });
  }
  for (const { b, first, why } of buckets.unreachable) {
    if (APPLY) {
      const set = { 'pipeline_auto.archive_stall.last_checked': new Date(), 'pipeline_auto.archive_stall.why': why, updated_at: new Date() };
      if (first) set['pipeline_auto.archive_stall.unreachable_since'] = new Date();
      await db.collection('books').updateOne({ id: b.id }, { $set: set });
    }
  }
  // THE FLAG MUST BE ABLE TO CLEAR. A book that probes 'ok' is not stalled, whatever it was
  // last week — without this the flag only ever accumulates, and 4,048 books were parked
  // behind it (#4872), 618 of them already fully archived. The archiver clears it too, on any
  // page that actually lands; this covers books the archiver has not reached yet.
  const recovered = buckets.archivable.filter(({ b }) => b.pipeline_auto?.archive_stall);
  for (const { b } of recovered) {
    if (APPLY) {
      await db.collection('books').updateOne({ id: b.id }, {
        $unset: { 'pipeline_auto.archive_stall': '' }, $set: { updated_at: new Date() },
      });
    }
  }
  if (recovered.length) log(`[watchdog] ${APPLY ? 'cleared' : 'would clear'} archive_stall on ${recovered.length} book(s) whose source answered this time`);
  const rearchiveResults = [];
  for (const { b } of buckets.archivable) {
    const res = await triggerRearchive(b);
    rearchiveResults.push({ id: b.id, title: (b.title || '').slice(0, 40), ...res });
  }

  // Report
  const summary = {
    restricted: buckets.restricted.length, dead: buckets.dead.length,
    unreachable: buckets.unreachable.length, escalated: buckets.escalated.length,
    archivable: buckets.archivable.length, progressing: buckets.progressing.length,
  };
  log('\n[watchdog] verdicts:', JSON.stringify(summary));
  const byProv = {};
  for (const k of Object.keys(buckets)) for (const { provider } of buckets[k]) {
    byProv[provider] = byProv[provider] || {}; byProv[provider][k] = (byProv[provider][k] || 0) + 1;
  }
  log('[watchdog] by provider:', JSON.stringify(byProv));
  if (buckets.dead.length) { log('\nDEAD (parked):'); buckets.dead.slice(0, 20).forEach(({ b, url }) => log(`  ${(b.title || '').slice(0, 40)} | ${(url || '').slice(0, 80)}`)); }
  if (REARCHIVE && rearchiveResults.length) { log('\nRE-ARCHIVE triggered:'); rearchiveResults.forEach(r => log(`  ${r.title} -> ${r.error ? 'ERR ' + r.error : `archived=${r.archived} remaining=${r.remaining}`}`)); }

  if (APPLY) {
    await db.collection('watchdog_runs').insertOne({
      ran_at: new Date(), stale_hours: STALE_HOURS, escalate_days: ESCALATE_DAYS,
      rearchive: REARCHIVE, candidates: candidates.length, summary, by_provider: byProv,
      rearchive_results: rearchiveResults,
    }).catch(() => {});
  }
  log(`\n[watchdog] done. ${APPLY ? 'Applied.' : 'Dry run — re-run with --apply to act.'}`);
  await c.close();
}
main().catch(e => { console.error('[watchdog] fatal:', e); process.exit(1); });
