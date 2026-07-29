#!/usr/bin/env node
// Daily metrics snapshot writer.
//
// Computes the headline audience + usage + engagement numbers (the same
// aggregations the /metrics skill runs across audience-metrics.mjs,
// usage-deepdive.mjs, and engagement-metrics.mjs) and writes ONE structured
// document to system_config.metrics_snapshot. The protected admin page at
// /platform/admin/metrics reads that doc and renders instantly — it never runs
// these aggregations on page load (the deep-dive scans are too slow for that).
//
// Same pattern as system_config.homepage_stats (refreshed daily by
// prewarm-browse.mjs). Purely read-only against Mongo `bookstore`. No cost.
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/snapshot-metrics.mjs [--days N]
//
// Cron (Hetzner, daily): see scripts/workers/crontab.production.

import { withMongo } from '../lib/mongo.mjs';
import { computeReadingDepth, computeMemberReadingDepth } from '../lib/reading-depth.mjs';

const DAYS = (() => { const i = process.argv.indexOf('--days'); return i > -1 ? Number(process.argv[i + 1]) : 30; })();
const norm = (e) => (e || '').trim().toLowerCase();
const BOT_RE = /(bot|crawler|spider|preview|monitor|uptime|wget|curl|python-requests|libwww|http-client|headless|chrome-lighthouse|MCP)/i;
const isBot = (ua) => !ua || BOT_RE.test(ua);

// Provider prefixes that PR #2025 now 308-redirects away. Before that they
// served live content; we collapse them so /internet-archive/book/foo counts as
// /book/foo (mirrors usage-deepdive.mjs::normalizePath so "top books" is faithful).
const PROVIDER_PREFIXES = new Set([
  'internet-archive', 'gallica', 'bavarian-state-library', 'e-codices', 'bodleian',
  'manchester', 'laurenziana', 'e-rara', 'library-of-congress', 'vatican-library',
  'wellcome-collection', 'bdrc', 'kloss-collection', 'allard-pierson', 'cambridge',
  'leiden', 'google-books', 'qatar-digital-library', 'oraec',
  'bibliotheca-philosophica-hermetica', 'tu-delft', 'kyoto', 'british-library',
]);

// Collapse a raw pageview path to its canonical form and classify it.
// Handles provider prefixes and /embed/<tenant>/book|collections/... so books
// reached through a tenant or legacy provider URL still count toward the totals.
function classifyPath(raw) {
  if (!raw) return { kind: 'other', slug: '' };
  let s = raw.split('?')[0];
  const parts = s.split('/').filter(Boolean);
  if (parts.length && PROVIDER_PREFIXES.has(parts[0])) parts.shift();
  if (parts[0] === 'embed' && parts.length > 2) {
    const inner = parts[2];
    if (inner === 'book') return { kind: 'book', slug: parts[3] || '' };
    if (inner === 'collections') return { kind: 'collection', slug: parts[3] || '' };
    return { kind: 'other', slug: '' };
  }
  if (parts[0] === 'book') return { kind: 'book', slug: parts[1] || '' };
  if (parts[0] === 'collections') return { kind: 'collection', slug: parts[1] || '' };
  return { kind: 'other', slug: '' };
}

await withMongo(async (db) => {
  const now = Date.now();
  const since = (d) => new Date(now - d * 864e5);
  const day = (d) => new Date(now - d * 864e5).toISOString().slice(0, 10);
  const SINCE = since(DAYS), d30 = since(30), d14 = since(14), d7 = since(7), d1 = since(1);
  const todayStr = new Date(now).toISOString().slice(0, 10);

  const fpGroup = { _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } };

  // ─── USERS / SIGNUPS ──────────────────────────────────────────────────────
  const users = db.collection('users');
  const [total, verified, hasLogin, everLoggedIn, repeatLogin, new30, new7, new1] = await Promise.all([
    users.countDocuments({}),
    users.countDocuments({ emailVerified: { $ne: null, $exists: true } }),
    users.countDocuments({ lastLogin: { $exists: true } }),
    users.countDocuments({ loginCount: { $gte: 1 } }),
    users.countDocuments({ loginCount: { $gte: 2 } }),
    users.countDocuments({ createdAt: { $gt: d30 } }),
    users.countDocuments({ createdAt: { $gt: d7 } }),
    users.countDocuments({ createdAt: { $gt: d1 } }),
  ]);
  const subscribers = {};
  for (const cn of ['beta_subscribers', 'newsletter_subscribers']) {
    try { subscribers[cn] = await db.collection(cn).countDocuments({}); } catch { subscribers[cn] = null; }
  }
  // Prior-period signups for week-over-week / month-over-month deltas.
  const [prev7, prev30] = await Promise.all([
    users.countDocuments({ createdAt: { $gt: d14, $lte: d7 } }),
    users.countDocuments({ createdAt: { $gt: since(60), $lte: d30 } }),
  ]);
  // Daily new signups over 90 days, for the growth chart (cumulative derived on read).
  const signupSeries = await users.aggregate([
    { $match: { createdAt: { $gt: since(90) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  const signupsByDay = signupSeries.map((r) => ({ date: r._id, n: r.n }));
  const signupsBefore90 = total - signupsByDay.reduce((s, r) => s + r.n, 0); // cumulative baseline

  // ─── DAU / MAU / DWELL ────────────────────────────────────────────────────
  const pv = db.collection('analytics_pageviews');
  const mau = (await pv.aggregate([
    { $match: { timestamp: { $gt: d30 } } }, { $group: fpGroup }, { $count: 'n' },
  ]).toArray())[0]?.n || 0;
  // 30-day DAU series (drives the trend chart); avg DAU uses the last 14 days.
  const dauSeries = await pv.aggregate([
    { $match: { timestamp: { $gt: d30 } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
    { $group: { _id: '$_id.day', users: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray();
  const dau = dauSeries.filter((d) => d._id >= day(14));
  const avgDau = Math.round(dau.reduce((s, d) => s + d.users, 0) / (dau.length || 1));

  // Dwell: per-session (ip+ua, 30-min idle gap) duration, last 7d, multi-hit only.
  const rows = await pv.find({ timestamp: { $gt: d7 } }, { projection: { ip: 1, userAgent: 1, timestamp: 1 } }).toArray();
  const byFp = new Map();
  for (const r of rows) {
    const k = r.ip + '|' + (r.userAgent || '').slice(0, 60);
    (byFp.get(k) || byFp.set(k, []).get(k)).push(+new Date(r.timestamp));
  }
  const durations = []; let multiHit = 0;
  for (const ts of byFp.values()) {
    ts.sort((a, b) => a - b);
    let start = ts[0], prev = ts[0], n = 1;
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - prev > 30 * 60 * 1000) { if (n > 1) { durations.push((prev - start) / 1000); multiHit++; } start = ts[i]; n = 1; }
      else n++;
      prev = ts[i];
    }
    if (n > 1) { durations.push((prev - start) / 1000); multiHit++; }
  }
  durations.sort((a, b) => a - b);
  const dwellMedian = Math.round(durations[Math.floor(durations.length / 2)] || 0);
  const dwellMean = Math.round(durations.reduce((s, x) => s + x, 0) / (durations.length || 1));

  // ─── CONVERSION / RETENTION ───────────────────────────────────────────────
  const uniqVisitors = (await pv.aggregate([{ $match: { timestamp: { $gt: SINCE } } }, { $group: fpGroup }, { $count: 'n' }]).toArray())[0]?.n || 0;
  const newSignupsWin = await users.countDocuments({ createdAt: { $gt: SINCE } });
  const byDays = await pv.aggregate([
    { $match: { timestamp: { $gt: SINCE } } },
    { $group: { _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] }, d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } } },
    { $group: { _id: { ip: '$_id.ip', ua: '$_id.ua' }, days: { $sum: 1 } } },
    { $group: { _id: '$days', n: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray();
  const totalFp = byDays.reduce((s, x) => s + x.n, 0);
  const multiDay = byDays.filter((x) => x._id > 1).reduce((s, x) => s + x.n, 0);

  // ─── READING DEPTH (page_read events, 7d) ─────────────────────────────────
  // Shared with engagement-metrics.mjs via scripts/lib/reading-depth.mjs so a
  // correction can't land in one and miss the other. This snapshot feeds
  // /platform/admin/metrics AND the weekly digest, so a wrong number here is a
  // number that gets emailed.
  const ev = db.collection('analytics_events');
  let reading = null;
  let readingMembers = null;
  try {
    reading = await computeReadingDepth(db, d7);
  } catch { /* events collection may be sparse */ }
  // Signed-in twin over the full window — no crawler can be in it, so this is
  // reportable today rather than after the anonymous instrument's window fills.
  try {
    readingMembers = await computeMemberReadingDepth(db, SINCE);
  } catch { /* reading_history may be absent */ }

  // ─── MISSION ACTIONS ──────────────────────────────────────────────────────
  let missionActions = {};
  try {
    const rowsM = await ev.aggregate([
      { $match: { timestamp: { $gt: SINCE }, event: { $in: ['download', 'share', 'cite', 'gate_hit', 'signin_view'] } } },
      { $group: { _id: '$event', n: { $sum: 1 } } },
    ]).toArray();
    missionActions = Object.fromEntries(rowsM.map((r) => [r._id, r.n]));
  } catch { /* noop */ }

  // ─── TRAFFIC SHAPE / TOP CONTENT / REFERRERS (last DAYS, human-filtered) ──
  const pvCursor = pv.find({ timestamp: { $gte: SINCE } }, { projection: { path: 1, userAgent: 1, referrer: 1, country: 1, timestamp: 1 } });
  let humanPvs = 0, botPvs = 0;
  const dailyHits = new Map(), bookHits = new Map(), collectionHits = new Map(), referrers = new Map(), countries = new Map();
  while (await pvCursor.hasNext()) {
    const d = await pvCursor.next();
    if (isBot(d.userAgent)) { botPvs++; continue; }
    humanPvs++;
    const cls = classifyPath(d.path || '');
    const dstr = new Date(d.timestamp).toISOString().slice(0, 10);
    dailyHits.set(dstr, (dailyHits.get(dstr) || 0) + 1);
    if (cls.kind === 'book' && cls.slug) bookHits.set(cls.slug, (bookHits.get(cls.slug) || 0) + 1);
    if (cls.kind === 'collection' && cls.slug) collectionHits.set(cls.slug, (collectionHits.get(cls.slug) || 0) + 1);
    const refDomain = (d.referrer || 'direct').replace(/^https?:\/\//, '').split('/')[0] || 'direct';
    referrers.set(refDomain, (referrers.get(refDomain) || 0) + 1);
    countries.set(d.country || 'unknown', (countries.get(d.country || 'unknown') || 0) + 1);
  }
  const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const dailyPageviews = [...dailyHits.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, hits]) => ({ date, hits }));
  // Pageviews week-over-week, from the per-day human series (last 7 vs prior 7).
  const pvLast7 = dailyPageviews.filter((r) => r.date >= day(7)).reduce((s, r) => s + r.hits, 0);
  const pvPrev7 = dailyPageviews.filter((r) => r.date >= day(14) && r.date < day(7)).reduce((s, r) => s + r.hits, 0);

  // Resolve top book slugs/ids to titles. Pageview keys are whatever the URL
  // path used: slug, Mongo _id hex, or the string `id` field — which is a
  // DIFFERENT 24-hex value than _id, so hex keys need both lookups. Then merge
  // rows that resolve to the same underlying book (one book viewed via both
  // its slug and an id otherwise appears twice with its hits split).
  const topBookKeys = topN(bookHits, 30);
  const { ObjectId } = await import('mongodb');
  const slugLike = [], hexLike = [];
  for (const [s] of topBookKeys) { if (/^[a-f0-9]{24}$/i.test(s)) hexLike.push(s); else slugLike.push(s); }
  const oidLike = hexLike.map((s) => { try { return new ObjectId(s); } catch { return null; } }).filter(Boolean);
  const proj = { projection: { slug: 1, id: 1, title: 1, author: 1, language: 1 } };
  const bMeta = new Map();
  for (const b of slugLike.length ? await db.collection('books').find({ slug: { $in: slugLike } }, proj).toArray() : []) bMeta.set(b.slug, b);
  for (const b of oidLike.length ? await db.collection('books').find({ _id: { $in: oidLike } }, proj).toArray() : []) bMeta.set(b._id.toString(), b);
  for (const b of hexLike.length ? await db.collection('books').find({ id: { $in: hexLike } }, proj).toArray() : []) { if (b.id) bMeta.set(b.id, b); }
  const mergedBooks = new Map(); // canonical _id (or unresolved raw key) -> row
  for (const [key, hits] of topBookKeys) {
    const m = bMeta.get(key);
    const canon = m ? m._id.toString() : key;
    const row = mergedBooks.get(canon);
    if (row) { row.hits += hits; continue; }
    mergedBooks.set(canon, { key: m?.slug || key, hits, title: (m?.title || key).slice(0, 70), author: (Array.isArray(m?.author) ? m.author[0] : m?.author || '') || '', language: m?.language || '' });
  }
  const topBooks = [...mergedBooks.values()].sort((a, b) => b.hits - a.hits).slice(0, 15);
  const topCollections = topN(collectionHits, 10).map(([slug, hits]) => ({ slug, hits }));
  const topReferrers = topN(referrers, 12).map(([referrer, hits]) => ({ referrer, hits }));
  const topCountries = topN(countries, 12).map(([country, hits]) => ({ country, hits }));

  // ─── SEARCH BEHAVIOR ──────────────────────────────────────────────────────
  let search = null;
  try {
    const sqAll = await db.collection('search_queries').find({ ts: { $gte: SINCE } }, { projection: { query: 1, total: 1, ms: 1, user_agent: 1 } }).toArray();
    const sqHuman = sqAll.filter((s) => !isBot(s.user_agent));
    const zero = sqHuman.filter((s) => (s.total || 0) === 0);
    const qCounts = new Map(), zCounts = new Map();
    for (const s of sqHuman) { const q = (s.query || '').toLowerCase().trim(); if (q) qCounts.set(q, (qCounts.get(q) || 0) + 1); }
    for (const s of zero) { const q = (s.query || '').toLowerCase().trim(); if (q) zCounts.set(q, (zCounts.get(q) || 0) + 1); }
    const lat = sqHuman.map((s) => s.ms).filter((n) => typeof n === 'number').sort((a, b) => a - b);
    search = {
      total: sqAll.length,
      human: sqHuman.length,
      zeroResult: zero.length,
      topQueries: topN(qCounts, 15).map(([query, count]) => ({ query: query.slice(0, 80), count })),
      zeroQueries: topN(zCounts, 15).map(([query, count]) => ({ query: query.slice(0, 80), count })),
      latencyP50: lat.length ? lat[Math.floor(lat.length * 0.5)] : null,
      latencyP90: lat.length ? lat[Math.floor(lat.length * 0.9)] : null,
    };
  } catch { /* noop */ }

  // ─── SOCIAL ───────────────────────────────────────────────────────────────
  let social = null;
  try {
    const likes = db.collection('likes');
    const lk = await likes.countDocuments({ created_at: { $gt: SINCE } });
    const lkVisitors = (await likes.aggregate([{ $match: { created_at: { $gt: SINCE } } }, { $group: { _id: '$visitor_id' } }, { $count: 'n' }]).toArray())[0]?.n || 0;
    const fb = db.collection('feedback');
    social = {
      likes: lk,
      likeVisitors: lkVisitors,
      feedback: await fb.countDocuments({ created_at: { $gt: SINCE } }),
      feedbackUnread: await fb.countDocuments({ created_at: { $gt: SINCE }, read: { $ne: true } }),
      feedbackWantsHelp: await fb.countDocuments({ created_at: { $gt: SINCE }, wants_to_help: true }),
    };
  } catch { /* noop */ }

  // ─── AI SURFACES ──────────────────────────────────────────────────────────
  let ai = null;
  try {
    const byFeat = await db.collection('ai_usage').aggregate([
      { $match: { timestamp: { $gt: SINCE } } },
      { $group: { _id: '$feature', calls: { $sum: 1 }, cost: { $sum: '$costUsd' }, avgMs: { $avg: '$ms' } } },
      { $sort: { calls: -1 } }, { $limit: 10 },
    ]).toArray();
    ai = byFeat.map((f) => ({ feature: String(f._id || 'unknown'), calls: f.calls, cost: Number((f.cost || 0).toFixed(2)), avgMs: Math.round(f.avgMs || 0) }));
  } catch { /* noop */ }

  // ─── PIPELINE COST ────────────────────────────────────────────────────────
  let pipelineCost = null;
  try {
    const gud = await db.collection('gemini_usage_daily').find({}).sort({ date: -1 }).limit(60).toArray();
    if (gud.length) {
      const cut7 = new Date(now - 7 * 864e5).toISOString().slice(0, 10);
      const cut30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
      const sumSince = (cut) => gud.filter((r) => r.date >= cut).reduce((s, r) => s + (r.totalCost || 0), 0);
      pipelineCost = {
        latestDay: gud[0].date,
        stale: gud[0].date < cut7,
        last7: Number(sumSince(cut7).toFixed(2)),
        last30: Number(sumSince(cut30).toFixed(2)),
        recentDays: gud.slice(0, 7).map((r) => ({ date: r.date, cost: Number((r.totalCost || 0).toFixed(2)), records: r.totalRecords || 0 })),
      };
    }
  } catch { /* noop */ }

  // ─── ASSEMBLE + WRITE ─────────────────────────────────────────────────────
  // `deltas` express period-over-period change so the page can show momentum,
  // not just a static level. Each is { now, prev } — the page derives the %.
  const snapshot = {
    generatedAt: new Date(now),
    windowDays: DAYS,
    schemaVersion: 2,
    users: {
      total, verified, hasLogin, everLoggedIn, repeatLogin,
      new30, new7, new1,
      ...subscribers,
    },
    deltas: {
      signups7: { now: new7, prev: prev7 },
      signups30: { now: new30, prev: prev30 },
      pageviews7: { now: pvLast7, prev: pvPrev7 },
    },
    series: {
      signupsByDay,          // [{date,n}] daily NEW signups, 90d
      signupsBaseline: signupsBefore90, // cumulative total before the 90d window
      dau: dauSeries.map((d) => ({ date: d._id, users: d.users })), // 30d
    },
    engagement: {
      mau, avgDau,
      dauLast3: dau.slice(-3).map((d) => ({ date: d._id, users: d.users })),
      dwellMedianSec: dwellMedian, dwellMeanSec: dwellMean, dwellSessions: multiHit,
    },
    conversion: {
      uniqVisitors, newSignups: newSignupsWin,
      returningVisitors: multiDay, returningTotal: totalFp,
    },
    reading,
    readingMembers,
    missionActions,
    traffic: { humanPvs, botPvs, dailyPageviews, topBooks, topCollections, topReferrers, topCountries },
    search,
    social,
    ai,
    pipelineCost,
  };

  const res = await db.collection('system_config').updateOne(
    { _id: 'metrics_snapshot' },
    { $set: { ...snapshot, _id: 'metrics_snapshot' } },
    { upsert: true },
  );

  // Accumulate a daily time series so trends for the EXPENSIVE rolling metrics
  // (MAU, dwell, stickiness) can be charted over time — these aren't
  // reconstructable from raw events after the fact the way signups/DAU are.
  // Idempotent per calendar day (a re-run overwrites the same dated doc).
  const histDoc = {
    date: todayStr, generatedAt: new Date(now),
    signupsTotal: total, verified, everLoggedIn,
    new7, new30, mau, avgDau,
    dwellMedianSec: dwellMedian, dwellMeanSec: dwellMean,
    uniqVisitors, returningVisitors: multiDay, returningTotal: totalFp,
    humanPvs7: pvLast7,
  };
  let histRes;
  try {
    histRes = await db.collection('metrics_history').updateOne(
      { date: todayStr }, { $set: histDoc }, { upsert: true },
    );
  } catch (e) { console.error(`  (metrics_history write skipped: ${e.message})`); }

  console.log(`metrics_snapshot written (matched=${res.matchedCount} upserted=${res.upsertedCount ? 1 : 0}). generatedAt=${snapshot.generatedAt.toISOString()}`);
  console.log(`  users.total=${total} (+${new7}/7d, prev ${prev7})  MAU=${mau}  avgDAU=${avgDau}  humanPV(${DAYS}d)=${humanPvs}  dwellMedian=${dwellMedian}s`);
  if (histRes) console.log(`  metrics_history[${todayStr}] ${histRes.upsertedCount ? 'inserted' : 'updated'}.`);
}, { timeoutMs: 240000 });
