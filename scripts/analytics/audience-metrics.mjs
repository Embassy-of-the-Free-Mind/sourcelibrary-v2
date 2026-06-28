#!/usr/bin/env node
// Audience metrics: signups, verification funnel, DAU/MAU, dwell time, and the
// incomplete-signup nudge list. Companion to usage-deepdive.mjs (which covers
// traffic, content, search, and journeys). Run both for the full picture — the
// /metrics skill does exactly that.
//
// Source: users, analytics_pageviews, verification_tokens, beta_subscribers.
// Sessionization: (ip + first-60-chars-of-userAgent) within a 30-minute idle
//   window. IPs have their last octet zeroed at ingest, so this is a coarse but
//   honest proxy. Dwell only counts multi-pageview sessions (a single hit has
//   no measurable duration).
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/audience-metrics.mjs

import { withMongo } from '../lib/mongo.mjs';

const norm = (e) => (e || '').trim().toLowerCase();

await withMongo(async (db) => {
  const now = new Date();
  const d30 = new Date(now - 30 * 864e5), d7 = new Date(now - 7 * 864e5), d1 = new Date(now - 864e5);

  // ---- USERS / SIGNUPS ----
  const users = db.collection('users');
  const total = await users.countDocuments({});
  const verified = await users.countDocuments({ emailVerified: { $ne: null, $exists: true } });
  const new30 = await users.countDocuments({ createdAt: { $gt: d30 } });
  const new7 = await users.countDocuments({ createdAt: { $gt: d7 } });
  const new1 = await users.countDocuments({ createdAt: { $gt: d1 } });
  const hasLogin = await users.countDocuments({ lastLogin: { $exists: true } });
  console.log('=== USERS ===');
  console.log(`total signups        ${total}`);
  console.log(`emailVerified        ${verified}`);
  console.log(`has logged in        ${hasLogin}`);
  console.log(`new last 30d         ${new30}`);
  console.log(`new last 7d          ${new7}`);
  console.log(`new last 24h         ${new1}`);

  // beta / newsletter subscribers
  for (const cn of ['beta_subscribers', 'newsletter_subscribers']) {
    try { const c = await db.collection(cn).countDocuments({}); console.log(`${cn}: ${c}`); } catch {}
  }

  // ---- DAU / MAU / DWELL from analytics_pageviews ----
  const pv = db.collection('analytics_pageviews');
  // MAU = distinct fingerprints in 30d
  const mau = (await pv.aggregate([
    { $match: { timestamp: { $gt: d30 } } },
    { $group: { _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
    { $count: 'n' },
  ]).toArray())[0]?.n || 0;
  // avg DAU over last 14 days
  const dau = await pv.aggregate([
    { $match: { timestamp: { $gt: new Date(now - 14 * 864e5) } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
    { $group: { _id: '$_id.day', users: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  const avgDau = Math.round(dau.reduce((s, d) => s + d.users, 0) / (dau.length || 1));
  console.log('\n=== ENGAGEMENT ===');
  console.log(`MAU (30d unique ip+ua)   ${mau}`);
  console.log(`avg DAU (last 14d)       ${avgDau}`);
  console.log(`DAU last 3 days: ${dau.slice(-3).map((d) => d._id + '=' + d.users).join('  ')}`);

  // Dwell time: per session (ip+ua, 30-min gap) duration. last7d for speed.
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
  const med = durations[Math.floor(durations.length / 2)] || 0;
  const mean = durations.reduce((s, x) => s + x, 0) / (durations.length || 1);
  const fmt = (s) => `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  console.log('\n=== DWELL (last 7d, multi-pageview sessions only) ===');
  console.log(`multi-page sessions      ${multiHit}`);
  console.log(`median session duration  ${fmt(med)}`);
  console.log(`mean session duration    ${fmt(mean)}`);

  // ---- INCOMPLETE SIGNUPS: verification token issued, never became a user ----
  const userEmails = new Set((await users.find({}, { projection: { email: 1 } }).toArray()).map((u) => norm(u.email)).filter(Boolean));
  let vt = [];
  try { vt = await db.collection('verification_tokens').find({}).project({ identifier: 1, expires: 1 }).toArray(); } catch {}
  const pendingEmails = new Set();
  for (const t of vt) { const e = norm(t.identifier); if (e && !userEmails.has(e)) pendingEmails.add(e); }
  console.log('\n=== INCOMPLETE SIGNUPS (nudge candidates) ===');
  console.log(`verification_tokens rows      ${vt.length}`);
  console.log(`distinct emails started but never completed signup: ${pendingEmails.size}`);
}, { timeoutMs: 120000 });
