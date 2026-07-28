#!/usr/bin/env node
// Engagement, retention, conversion, demand, and mission-action metrics.
// Third leg of the /metrics trio (audience-metrics.mjs = signups/DAU/dwell;
// usage-deepdive.mjs = traffic/content/search/journeys; this = everything those
// two leave on the table). All read-only against Mongo `bookstore`. No cost.
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/engagement-metrics.mjs [--days N]
//
// Sections:
//   1. Conversion & retention   (visitor->signup, verify %, returning, stickiness)
//   2. Reading depth            (pages read per reader-book, from page_read events)
//   3. Mission actions          (download / share / cite / gate_hit events)
//   4. Content demand           (not_found_reports — what people want we lack)
//   5. Social                   (likes, feedback)
//   6. AI surfaces              (ai_usage by feature; api_usage by route / agent)
//   7. Pipeline cost            (gemini_usage_daily)

import { withMongo } from '../lib/mongo.mjs';

const DAYS = (() => { const i = process.argv.indexOf('--days'); return i > -1 ? Number(process.argv[i + 1]) : 30; })();
const now = Date.now();
const since = (d) => new Date(now - d * 864e5);
const SINCE = since(DAYS), D7 = since(7), D1 = since(1);
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
const fmtUsd = (n) => '$' + (n || 0).toFixed(2);
const sec = (s) => `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;

// Section runner so one failing block never kills the rest.
async function section(title, fn) {
  console.log(`\n## ${title}`);
  try { await fn(); } catch (e) { console.log(`  (skipped: ${e.message})`); }
}

await withMongo(async (db) => {
  const pv = db.collection('analytics_pageviews');
  const ev = db.collection('analytics_events');
  const users = db.collection('users');

  console.log(`# Source Library — Engagement & Retention (last ${DAYS}d)`);
  console.log(`Window since ${SINCE.toISOString()}`);

  // ---- 1. CONVERSION & RETENTION ----
  await section('1. Conversion & retention', async () => {
    const fp = { _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } };
    const uniq = (await pv.aggregate([{ $match: { timestamp: { $gt: SINCE } } }, { $group: fp }, { $count: 'n' }]).toArray())[0]?.n || 0;
    const newSignups = await users.countDocuments({ createdAt: { $gt: SINCE } });
    const totalUsers = await users.countDocuments({});
    const verified = await users.countDocuments({ emailVerified: { $ne: null, $exists: true } });
    const everLoggedIn = await users.countDocuments({ loginCount: { $gte: 1 } });
    const repeatLogin = await users.countDocuments({ loginCount: { $gte: 2 } });
    console.log(`unique visitors (${DAYS}d)      ${uniq}`);
    console.log(`new signups (${DAYS}d)          ${newSignups}`);
    console.log(`visitor -> signup conversion  ${pct(newSignups, uniq)}`);
    console.log(`email verified                ${verified}/${totalUsers}  (${pct(verified, totalUsers)})`);
    console.log(`ever logged in                ${everLoggedIn}/${totalUsers}  (${pct(everLoggedIn, totalUsers)})`);
    console.log(`returning accounts (login>=2) ${repeatLogin}/${totalUsers}  (${pct(repeatLogin, totalUsers)})`);

    // Returning visitors: fingerprints active on >1 distinct calendar day in window.
    const byDays = await pv.aggregate([
      { $match: { timestamp: { $gt: SINCE } } },
      { $group: { _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] }, d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } } },
      { $group: { _id: { ip: '$_id.ip', ua: '$_id.ua' }, days: { $sum: 1 } } },
      { $group: { _id: '$days', n: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ], { allowDiskUse: true }).toArray();
    const totalFp = byDays.reduce((s, x) => s + x.n, 0);
    const multiDay = byDays.filter((x) => x._id > 1).reduce((s, x) => s + x.n, 0);
    console.log(`returning visitors (>1 day)   ${multiDay}/${totalFp}  (${pct(multiDay, totalFp)})`);

    // Stickiness DAU:MAU (avg DAU last 14d / MAU 30d).
    const dau = await pv.aggregate([
      { $match: { timestamp: { $gt: since(14) } } },
      { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
      { $group: { _id: '$_id.d', n: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray();
    const avgDau = Math.round(dau.reduce((s, d) => s + d.n, 0) / (dau.length || 1));
    console.log(`stickiness (DAU:MAU)          ${pct(avgDau, uniq)}  (avgDAU ${avgDau} / MAU ${uniq})`);
  });

  // ---- 2. READING DEPTH ----
  await section('2. Reading depth (page_read events, last 7d)', async () => {
    // HUMAN EVENTS ONLY. Until #3405 this section matched every page_read, and
    // page_read was written without any bot filter or user-agent — so the
    // histogram was describing a headless fleet walking one page per book
    // (839,701 events against 24,577 human book-page views in the same week).
    // Events written before the fix have no traffic_class and CANNOT be
    // classified retroactively; they are counted as unclassified, never as
    // human. If most of the window is unclassified the honest output is "not
    // measurable yet", not a plausible-looking histogram.
    const total = await ev.countDocuments({ event: 'page_read', timestamp: { $gt: D7 } });
    const classified = await ev.countDocuments({ event: 'page_read', timestamp: { $gt: D7 }, traffic_class: { $exists: true } });
    if (total > 0 && classified / total < 0.5) {
      console.log(`page_read events (7d)         ${total}`);
      console.log(`  classified (post-#3405)     ${classified}  (${pct(classified, total)})`);
      console.log(`NOT REPORTED: ${total - classified} of these events predate write-time bot`);
      console.log(`classification and cannot be attributed to humans or crawlers. Reading`);
      console.log(`depth is unmeasurable over this window — do not quote a number for it.`);
      console.log(`Re-run once a full 7d window sits after the #3405 deploy.`);
      const opens = await ev.countDocuments({ event: 'book_read', timestamp: { $gt: D7 }, traffic_class: 'human' });
      console.log(`book opens, human-only (7d)   ${opens}`);
      return;
    }
    // distinct pages read per (reader ip, book) — proxy for how far into a book a reader gets.
    const depth = await ev.aggregate([
      { $match: { event: 'page_read', timestamp: { $gt: D7 }, book_id: { $ne: null }, traffic_class: 'human' } },
      { $group: { _id: { ip: '$ip', b: '$book_id' }, pages: { $addToSet: '$page_id' } } },
      { $project: { n: { $size: '$pages' } } },
      { $group: { _id: '$n', sessions: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ], { allowDiskUse: true }).toArray();
    const all = []; for (const d of depth) for (let i = 0; i < d.sessions; i++) all.push(d._id);
    all.sort((a, b) => a - b);
    const n = all.length, med = all[Math.floor(n / 2)] || 0, p90 = all[Math.floor(n * 0.9)] || 0;
    const oneOnly = depth.find((d) => d._id === 1)?.sessions || 0;
    const deep = depth.filter((d) => d._id >= 10).reduce((s, d) => s + d.sessions, 0);
    console.log(`reader-book pairs (7d)        ${n}`);
    console.log(`pages read / pair  median=${med}  p90=${p90}`);
    console.log(`read only 1 page              ${oneOnly}  (${pct(oneOnly, n)})`);
    console.log(`read 10+ pages (deep read)    ${deep}  (${pct(deep, n)})`);
    const opens = await ev.countDocuments({ event: 'book_read', timestamp: { $gt: D7 }, traffic_class: 'human' });
    console.log(`book opens (book_read, 7d)    ${opens}`);
    console.log(`(human-classified events only; ${total - classified} unclassified pre-#3405 events excluded)`);
  });

  // ---- 3. MISSION ACTIONS ----
  await section(`3. Mission actions (events, last ${DAYS}d)`, async () => {
    const rows = await ev.aggregate([
      { $match: { timestamp: { $gt: SINCE }, event: { $in: ['download', 'share', 'cite', 'gate_hit', 'signin_view'] } } },
      { $group: { _id: '$event', n: { $sum: 1 } } }, { $sort: { n: -1 } },
    ]).toArray();
    const map = Object.fromEntries(rows.map((r) => [r._id, r.n]));
    for (const e of ['download', 'share', 'cite', 'gate_hit', 'signin_view']) console.log(`${e.padEnd(14)} ${map[e] || 0}`);
    console.log(`NOTE: share/cite near-zero = the core "quote the source" action is barely instrumented or barely used.`);
  });

  // ---- 4. CONTENT DEMAND ----
  await section(`4. Content demand — not_found_reports (last ${DAYS}d)`, async () => {
    const nf = db.collection('not_found_reports');
    const total = await nf.aggregate([{ $match: { created_at: { $gt: SINCE } } }, { $group: { _id: null, n: { $sum: { $ifNull: ['$hit_count', 1] } } } }]).toArray();
    console.log(`total 404 hits                ${total[0]?.n || 0}`);
    const top = await nf.aggregate([
      { $match: { created_at: { $gt: SINCE } } },
      { $group: { _id: '$url', n: { $sum: { $ifNull: ['$hit_count', 1] } } } },
      { $sort: { n: -1 } }, { $limit: 20 },
    ]).toArray();
    console.log('top 20 missing URLs:');
    for (const t of top) console.log(`  ${String(t.n).padStart(5)}  ${decodeURIComponent(t._id || '').slice(0, 70)}`);
  });

  // ---- 5. SOCIAL ----
  await section(`5. Social — likes & feedback (last ${DAYS}d)`, async () => {
    const likes = db.collection('likes');
    const lk = await likes.countDocuments({ created_at: { $gt: SINCE } });
    const lkVisitors = (await likes.aggregate([{ $match: { created_at: { $gt: SINCE } } }, { $group: { _id: '$visitor_id' } }, { $count: 'n' }]).toArray())[0]?.n || 0;
    const byType = await likes.aggregate([{ $match: { created_at: { $gt: SINCE } } }, { $group: { _id: '$target_type', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
    console.log(`likes (${DAYS}d)               ${lk}  from ${lkVisitors} distinct visitors`);
    console.log(`  by target: ${byType.map((b) => `${b._id}=${b.n}`).join('  ')}`);
    const fb = db.collection('feedback');
    const fbN = await fb.countDocuments({ created_at: { $gt: SINCE } });
    const fbUnread = await fb.countDocuments({ created_at: { $gt: SINCE }, read: { $ne: true } });
    const fbHelp = await fb.countDocuments({ created_at: { $gt: SINCE }, wants_to_help: true });
    console.log(`feedback (${DAYS}d)            ${fbN}   unread=${fbUnread}   wants_to_help=${fbHelp}`);
  });

  // ---- 6. AI SURFACES ----
  await section(`6. AI surfaces (last ${DAYS}d)`, async () => {
    const ai = db.collection('ai_usage');
    const byFeat = await ai.aggregate([
      { $match: { timestamp: { $gt: SINCE } } },
      { $group: { _id: '$feature', calls: { $sum: 1 }, cost: { $sum: '$costUsd' }, p50ms: { $avg: '$ms' } } },
      { $sort: { calls: -1 } }, { $limit: 12 },
    ]).toArray();
    console.log('ai_usage by feature:  calls | cost | avg_ms');
    for (const f of byFeat) console.log(`  ${String(f._id).padEnd(22)} ${String(f.calls).padStart(6)} | ${fmtUsd(f.cost).padStart(8)} | ${Math.round(f.p50ms || 0)}`);

    const api = db.collection('api_usage');
    const byKind = await api.aggregate([{ $match: { ts: { $gt: SINCE } } }, { $group: { _id: '$identity_kind', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
    console.log(`\napi_usage by identity: ${byKind.map((k) => `${k._id || 'null'}=${k.n}`).join('  ')}`);
    const topRoutes = await api.aggregate([{ $match: { ts: { $gt: SINCE } } }, { $group: { _id: '$route', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray();
    console.log('top API routes:');
    for (const r of topRoutes) console.log(`  ${String(r.n).padStart(7)}  ${r._id}`);
    const keyed = await api.aggregate([{ $match: { ts: { $gt: SINCE }, api_key_id: { $ne: null } } }, { $group: { _id: '$api_key_id', n: { $sum: 1 } } }, { $count: 'n' }]).toArray();
    console.log(`distinct API keys active      ${keyed[0]?.n || 0}`);
  });

  // ---- 7. PIPELINE COST ----
  await section('7. Pipeline cost (gemini_usage_daily)', async () => {
    const gud = db.collection('gemini_usage_daily');
    const rows = await gud.find({}).sort({ date: -1 }).limit(60).toArray();
    if (!rows.length) { console.log('  (no rows)'); return; }
    // date is a 'YYYY-MM-DD' string, so lexical >= is a valid date filter.
    const cut7 = new Date(now - 7 * 864e5).toISOString().slice(0, 10);
    const cut30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
    const sumSince = (cut) => rows.filter((r) => r.date >= cut).reduce((s, r) => s + (r.totalCost || 0), 0);
    const latest = rows[0].date;
    const stale = latest < cut7;
    console.log(`latest recorded day           ${latest}${stale ? '  ⚠ STALE — daily rollup not updating (pipeline pause? check the aggregator)' : ''}`);
    console.log(`Gemini spend  last 7 cal-days=${fmtUsd(sumSince(cut7))}  last 30=${fmtUsd(sumSince(cut30))}`);
    console.log('most recent recorded days (date | cost | records):');
    for (const r of rows.slice(0, 7)) console.log(`  ${r.date}  ${fmtUsd(r.totalCost).padStart(9)}  ${r.totalRecords || 0}`);
  });
}, { timeoutMs: 180000 });
