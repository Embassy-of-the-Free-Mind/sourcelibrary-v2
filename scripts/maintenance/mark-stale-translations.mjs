#!/usr/bin/env node
/**
 * PRIOR ART: `withhold-stale-translations.mjs` (#4523) re-derives the same
 * predicate but its DISPOSITION is withholding, and only for the lanes in
 * WITHHOLD_LANES; this sweep's disposition is a marker that a paid lane drains
 * (re-translation), for the whole corpus. `scripts/batch/retranslate-stale.mjs`
 * selects by model vintage, not by source text. The rule itself lives in
 * `scripts/lib/translation-source.mjs` — read its header first.
 *
 * Materialise the stale-translation verdict (#4927).
 *
 * For every candidate page, decide with `translationStaleness()` whether the
 * translation was made from the transcription the page currently holds, and
 * write the answer where an index can serve it:
 *
 *   stale   → $set  translation_stale: { reason, since }   (kept if already set)
 *   fresh   → $unset translation_stale                     (healed: retranslated,
 *                                                            or OCR restored)
 *
 * Candidates, by default (`--since-hours=26`, the daily run):
 *   • pages whose `ocr.updated_at` is within the window (pages_ocr_updated_idx) —
 *     an OCR writer that forgot `markStaleAfterOcrWrite` is caught here;
 *   • pages already carrying the marker (pages_translation_stale_partial) — so
 *     a page retranslated by a writer that forgot `CLEAR_STALE_UNSET` is cleared.
 * `--full` walks every translated page instead (the backfill's job; hours).
 * `--book=<id>` scopes to one book.
 *
 * Never bumps `pages.updated_at`: `embed-gemini --incremental` selects on it and
 * would re-embed every marked page at cost. Placeholders are never marked (the
 * rule excludes them). Text is never touched.
 *
 * ACTUATION (CLAUDE.md): the marker is read by translate-worker's page
 * selection (books it is already dispatching) and by
 * `scripts/batch/realtime-translate.mjs --stale` (the drain). Both are paid
 * lanes behind the daily spend dial; this sweep spends nothing itself.
 *
 * Default is DRY RUN. Run on Hetzner.
 *   node --env-file=.env.production.local scripts/maintenance/mark-stale-translations.mjs
 *   node --env-file=.env.production.local scripts/maintenance/mark-stale-translations.mjs --apply --since-hours=26
 *   node --env-file=.env.production.local scripts/maintenance/mark-stale-translations.mjs --apply --full
 */
import { MongoClient } from 'mongodb';
import {
  translationStaleness, staleMarker, STALE_FIELD, REAL_TRANSLATION_FILTER,
} from '../lib/translation-source.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const FULL = process.argv.includes('--full');
const SINCE_HOURS = Number(ARG('--since-hours', '26'));
const ONLY_BOOK = ARG('--book', null);
const LIMIT = Number(ARG('--limit', '0')); // 0 = no limit
const BATCH = 1000;
const WRITE_CHUNK = 200;
const WRITE_DELAY_MS = 50; // Atlas M30: keep the sweep under the IOPS ceiling

const PROJECTION = {
  id: 1, book_id: 1,
  'ocr.data': 1, 'ocr.updated_at': 1,
  'translation.data': 1, 'translation.source': 1, 'translation.source_hash': 1,
  'translation.updated_at': 1, 'translation.edited_at': 1,
  [STALE_FIELD]: 1,
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri, { socketTimeoutMS: 600_000 });
await client.connect();
const pages = client.db('bookstore').collection('pages');

const now = new Date();
const since = new Date(now.getTime() - SINCE_HOURS * 3_600_000);
const scope = ONLY_BOOK ? { book_id: ONLY_BOOK } : {};

// Two candidate arms, each served by its own index; run separately rather than
// as an $or so the planner never falls back to a collection scan.
const arms = FULL
  ? [{ label: 'full', filter: { ...scope, ...REAL_TRANSLATION_FILTER } }]
  : [
      { label: `ocr-updated-since-${SINCE_HOURS}h`, filter: { ...scope, 'ocr.updated_at': { $gte: since }, ...REAL_TRANSLATION_FILTER } },
      { label: 'already-marked', filter: { ...scope, [`${STALE_FIELD}.reason`]: { $exists: true } } },
    ];

console.log(`mark-stale-translations ${APPLY ? 'APPLY' : 'DRY RUN'} — ${FULL ? 'full walk' : `since ${since.toISOString()}`}${ONLY_BOOK ? ` book=${ONLY_BOOK}` : ''}`);

const totals = { scanned: 0, stale: 0, fresh: 0, newlyMarked: 0, cleared: 0, kept: 0, modified: 0 };
const byReason = {};
const seen = new Set();
let ops = [];

async function flush() {
  if (ops.length === 0) return;
  for (let i = 0; i < ops.length; i += WRITE_CHUNK) {
    const chunk = ops.slice(i, i + WRITE_CHUNK);
    const r = await pages.bulkWrite(chunk, { ordered: false });
    totals.modified += r.modifiedCount ?? 0;
    if (i + WRITE_CHUNK < ops.length) await new Promise((res) => setTimeout(res, WRITE_DELAY_MS));
  }
  ops = [];
}

for (const arm of arms) {
  let lastId = null;
  let armScanned = 0;
  for (;;) {
    const filter = lastId ? { ...arm.filter, _id: { $gt: lastId } } : arm.filter;
    const docs = await pages.find(filter, { projection: PROJECTION }).sort({ _id: 1 }).limit(BATCH).toArray();
    if (docs.length === 0) break;
    lastId = docs[docs.length - 1]._id;
    for (const p of docs) {
      if (seen.has(p.id)) continue; // a page can match both arms
      seen.add(p.id);
      totals.scanned++; armScanned++;
      const v = translationStaleness(p);
      const marked = !!p[STALE_FIELD]?.reason;
      if (v.stale) {
        totals.stale++;
        byReason[v.reason] = (byReason[v.reason] || 0) + 1;
        if (marked) { totals.kept++; continue; }
        totals.newlyMarked++;
        if (APPLY) ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { [STALE_FIELD]: staleMarker(v.reason, { now }) } } } });
      } else {
        totals.fresh++;
        if (!marked) continue;
        totals.cleared++;
        if (APPLY) ops.push({ updateOne: { filter: { _id: p._id }, update: { $unset: { [STALE_FIELD]: '' } } } });
      }
    }
    if (ops.length >= WRITE_CHUNK * 5) await flush();
    if (armScanned % 20000 < BATCH) process.stdout.write(`  [${arm.label}] scanned ${armScanned}…\n`);
    if (LIMIT && totals.scanned >= LIMIT) break;
  }
  await flush();
  console.log(`  [${arm.label}] done: ${armScanned} scanned`);
}

console.log(JSON.stringify({ ...totals, byReason, apply: APPLY }, null, 2));
if (APPLY) {
  const remaining = await pages.countDocuments({ [`${STALE_FIELD}.reason`]: { $exists: true } });
  console.log(`translation_stale count after sweep: ${remaining}`);
}
await client.close();
