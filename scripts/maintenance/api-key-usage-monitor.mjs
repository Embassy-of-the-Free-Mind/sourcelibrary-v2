#!/usr/bin/env node
/**
 * api-key-usage-monitor.mjs — usage across ALL dataset API keys.
 *
 * Two independent usage signals exist and they measure different things:
 *   1. api_usage            — every gated content-API call (/text, /quote, …),
 *                             tagged with api_key_id + pages_served. THE real
 *                             per-key traffic log (millions of docs).
 *   2. dataset_access_log   — only the bulk dump route /api/dataset/v1/pages.
 * `api_keys.last_used_at` is bumped on every key validation (both paths), so it
 * shows liveness but not volume.
 *
 * Tier caps: pickLimit (src/lib/api-budget.ts) caps free Explorer keys at
 * their published daily page budget on /text AND on the image proxy; paid
 * tiers (pagesPerDay: 0) are uncapped by design — a paid key buys attributable
 * unlimited access, not a quota. (An older note here described Explorer keys
 * as uncapped on /text; that hole was closed in pickLimit.) The historical
 * all-time BULK flags below predate the caps and are kept as provenance.
 *
 * Since #4356, route:'image' rows count image-proxy pulls (1 page_served per
 * image) — keyed image traffic and budgeted anonymous non-browser pulls both
 * land here. Browser/reader image loads are never logged.
 *
 * Usage: node scripts/maintenance/api-key-usage-monitor.mjs [--days 7] [--json]
 */
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const days = Number(argv[argv.indexOf('--days') + 1]) || 7;
const asJson = argv.includes('--json');
const since = new Date(Date.now() - days * 24 * 3600 * 1000);

// Explorer keys pulling more than this many pages ever = bulk extraction worth a look.
const BULK_PAGE_FLAG = 50000;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// The `api_keys` collection is SHARED by two unrelated systems: dataset keys
// (generateApiKey — carry `key_hash`/`tier`/`rate_limit`, validated on /text)
// and collection-editor keys (editor-auth.ts — carry plaintext `key`/`role`/
// `scopes`/`active`, no tier). Only dataset keys are relevant here; scope to
// `key_hash` so editor keys aren't misreported as tier-less "malformed" rows.
const keys = await db.collection('api_keys')
  .find({ key_hash: { $exists: true } })
  .project({ key_hash: 0 })
  .toArray();
const kmap = new Map(keys.map((k) => [String(k._id), k]));

// All-time per-key content traffic.
const perKey = await db.collection('api_usage').aggregate([
  { $match: { api_key_id: { $ne: null } } },
  { $group: {
      _id: '$api_key_id',
      calls: { $sum: 1 },
      pages: { $sum: '$pages_served' },
      last: { $max: '$ts' },
      blocked: { $sum: { $cond: ['$blocked', 1, 0] } },
  } },
  { $sort: { pages: -1 } },
]).toArray();

// Windowed per-key traffic (last N days). `images` splits out the image-proxy
// share of `pages` so a key pulling page scans is distinguishable from one
// pulling text.
const perKeyWin = await db.collection('api_usage').aggregate([
  { $match: { api_key_id: { $ne: null }, ts: { $gte: since } } },
  { $group: {
      _id: '$api_key_id',
      calls: { $sum: 1 },
      pages: { $sum: '$pages_served' },
      images: { $sum: { $cond: [{ $eq: ['$route', 'image'] }, '$pages_served', 0] } },
  } },
]).toArray();
const winMap = new Map(perKeyWin.map((r) => [String(r._id), r]));

const rows = perKey.map((r) => {
  const k = kmap.get(String(r._id)) || {};
  const w = winMap.get(String(r._id)) || { calls: 0, pages: 0, images: 0 };
  const bulk = (k.tier === 'explorer') && r.pages >= BULK_PAGE_FLAG;
  return {
    name: k.name || '?', tier: k.tier || '?', status: k.status || '?',
    user_id: k.user_id, key_prefix: k.key_prefix,
    all_calls: r.calls, all_pages: r.pages, blocked: r.blocked,
    [`calls_${days}d`]: w.calls, [`pages_${days}d`]: w.pages, [`images_${days}d`]: w.images,
    last_used: r.last?.toISOString() || null, bulk_flag: bulk,
  };
});

// Global context.
const byKind = await db.collection('api_usage').aggregate([
  { $match: { ts: { $gte: since } } },
  { $group: { _id: '$identity_kind', calls: { $sum: 1 }, pages: { $sum: '$pages_served' } } },
  { $sort: { calls: -1 } },
]).toArray();

if (asJson) {
  console.log(JSON.stringify({ days, generated: new Date().toISOString(), rows, byKind }, null, 2));
} else {
  console.log(`\nAPI KEY USAGE — ${keys.length} keys total, window = last ${days}d\n`);
  console.log('  key                              tier       all-time pages   all-time calls   ' + `${days}d pages  ${days}d imgs   last used`);
  for (const r of rows) {
    const flag = r.bulk_flag ? '  ⚠ BULK' : '';
    console.log(
      '  ' + (r.name.slice(0, 30)).padEnd(32) +
      r.tier.padEnd(11) +
      String(r.all_pages).padStart(14) +
      String(r.all_calls).padStart(17) +
      String(r[`pages_${days}d`]).padStart(12) +
      String(r[`images_${days}d`]).padStart(10) +
      '   ' + (r.last_used?.slice(0, 16) || '-') + flag
    );
  }
  const idle = keys.length - rows.length;
  console.log(`\n  (${idle} keys have never made a gated content-API call)`);
  console.log(`\n  Traffic by identity, last ${days}d:`);
  for (const r of byKind) console.log(`    ${r._id.padEnd(9)} ${String(r.calls).padStart(10)} calls  ${String(r.pages).padStart(9)} pages`);
  const flagged = rows.filter((r) => r.bulk_flag);
  if (flagged.length) {
    console.log(`\n  ⚠ ${flagged.length} explorer key(s) over ${BULK_PAGE_FLAG.toLocaleString()} all-time pages — historical free-tier bulk extraction (predates the pickLimit tier caps):`);
    for (const r of flagged) console.log(`    ${r.name} — ${r.all_pages.toLocaleString()} pages (${r.user_id})`);
  }
}

await client.close();
