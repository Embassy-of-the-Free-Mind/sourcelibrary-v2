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

const DAYS = (() => { const i = process.argv.indexOf('--days'); return i > -1 ? Number(process.argv[i + 1]) : 30; })();
const norm = (e) => (e || '').trim().toLowerCase();
const BOT_RE = /(bot|crawler|spider|preview|monitor|uptime|wget|curl|python-requests|libwww|http-client|headless|chrome-lighthouse|MCP)/i;
const isBot = (ua) => !ua || BOT_RE.test(ua);

await withMongo(async (db) => {
  const now = Date.now();
  const since = (d) => new Date(now - d * 864e5);
  const SINCE = since(DAYS), d30 = since(30), d14 = since(14), d7 = since(7), d1 = since(1);

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

  // ─── DAU / MAU / DWELL ────────────────────────────────────────────────────
  const pv = db.collection('analytics_pageviews');
  const mau = (await pv.aggregate([
    { $match: { timestamp: { $gt: d30 } } }, { $group: fpGroup }, { $count: 'n' },
  ]).toArray())[0]?.n || 0;
  const dau = await pv.aggregate([
    { $match: { timestamp: { $gt: d14 } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
    { $group: { _id: '$_id.day', users: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray();
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
  const ev = db.collection('analytics_events');
  let reading = null;
  try {
    const depth = await ev.aggregate([
      { $match: { event: 'page_read', timestamp: { $gt: d7 }, book_id: { $ne: null } } },
      { $group: { _id: { ip: '$ip', b: '$book_id' }, pages: { $addToSet: '$page_id' } } },
      { $project: { n: { $size: '$pages' } } },
      { $group: { _id: '$n', sessions: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ], { allowDiskUse: true }).toArray();
    const flat = []; for (const d of depth) for (let i = 0; i < d.sessions; i++) flat.push(d._id);
    flat.sort((a, b) => a - b);
    const rn = flat.length;
    reading = {
      pairs: rn,
      median: flat[Math.floor(rn / 2)] || 0,
      p90: flat[Math.floor(rn * 0.9)] || 0,
      oneOnly: depth.find((d) => d._id === 1)?.sessions || 0,
      deep: depth.filter((d) => d._id >= 10).reduce((s, d) => s + d.sessions, 0),
      opens: await ev.countDocuments({ event: 'book_read', timestamp: { $gt: d7 } }),
    };
  } catch { /* events collection may be sparse */ }

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
  const kindOf = (p) => {
    if (!p) return 'other';
    const s = p.split('?')[0];
    if (s.startsWith('/book/')) return 'book';
    if (s.startsWith('/collections/')) return 'collection';
    return 'other';
  };
  while (await pvCursor.hasNext()) {
    const d = await pvCursor.next();
    if (isBot(d.userAgent)) { botPvs++; continue; }
    humanPvs++;
    const s = (d.path || '').split('?')[0];
    const day = new Date(d.timestamp).toISOString().slice(0, 10);
    dailyHits.set(day, (dailyHits.get(day) || 0) + 1);
    if (kindOf(s) === 'book') { const slug = s.split('/')[2] || ''; if (slug) bookHits.set(slug, (bookHits.get(slug) || 0) + 1); }
    if (kindOf(s) === 'collection') { const slug = s.split('/')[2] || ''; if (slug) collectionHits.set(slug, (collectionHits.get(slug) || 0) + 1); }
    const refDomain = (d.referrer || 'direct').replace(/^https?:\/\//, '').split('/')[0] || 'direct';
    referrers.set(refDomain, (referrers.get(refDomain) || 0) + 1);
    countries.set(d.country || 'unknown', (countries.get(d.country || 'unknown') || 0) + 1);
  }
  const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const dailyPageviews = [...dailyHits.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, hits]) => ({ date, hits }));

  // Resolve top book slugs/ids to titles.
  const topBookKeys = topN(bookHits, 15);
  const { ObjectId } = await import('mongodb');
  const slugLike = [], idLike = [];
  for (const [s] of topBookKeys) { if (/^[a-f0-9]{24}$/i.test(s)) { try { idLike.push(new ObjectId(s)); } catch {} } else slugLike.push(s); }
  const proj = { projection: { slug: 1, title: 1, author: 1, language: 1 } };
  const bMeta = new Map();
  for (const b of slugLike.length ? await db.collection('books').find({ slug: { $in: slugLike } }, proj).toArray() : []) bMeta.set(b.slug, b);
  for (const b of idLike.length ? await db.collection('books').find({ _id: { $in: idLike } }, proj).toArray() : []) bMeta.set(b._id.toString(), b);
  const topBooks = topBookKeys.map(([key, hits]) => {
    const m = bMeta.get(key) || {};
    return { key, hits, title: (m.title || key).slice(0, 70), author: (Array.isArray(m.author) ? m.author[0] : m.author || '') || '', language: m.language || '' };
  });
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
  const snapshot = {
    generatedAt: new Date(now),
    windowDays: DAYS,
    users: {
      total, verified, hasLogin, everLoggedIn, repeatLogin,
      new30, new7, new1,
      ...subscribers,
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
  console.log(`metrics_snapshot written (matched=${res.matchedCount} upserted=${res.upsertedCount ? 1 : 0}). generatedAt=${snapshot.generatedAt.toISOString()}`);
  console.log(`  users.total=${total}  MAU=${mau}  avgDAU=${avgDau}  humanPV(${DAYS}d)=${humanPvs}  dwellMedian=${dwellMedian}s`);
}, { timeoutMs: 240000 });
