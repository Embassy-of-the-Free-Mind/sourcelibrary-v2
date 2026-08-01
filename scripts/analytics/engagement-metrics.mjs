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
import { computeReadingDepth, computeMemberReadingDepth } from '../lib/reading-depth.mjs';

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
    // Implementation lives in scripts/lib/reading-depth.mjs and is shared with
    // snapshot-metrics.mjs — see the header there for both contaminations this
    // has to survive (unclassifiable pre-#3405 rows, and a fleet that passes
    // UA classification as human).
    const d = await computeReadingDepth(db, D7);

    if (d.contaminated) {
      console.log(`page_read events (7d)         ${d.total}`);
      console.log(`  classified (post-#3405)     ${d.classified}  (${pct(d.classified, d.total)})`);
      console.log(`NOT REPORTED: ${d.unclassified} of these events predate write-time bot`);
      console.log(`classification and cannot be attributed to humans or crawlers. Reading`);
      console.log(`depth is unmeasurable over this window — do not quote a number for it.`);
      console.log(`Re-run once a full 7d window sits after the #3405 deploy.`);
      const opens = await ev.countDocuments({ event: 'book_read', timestamp: { $gt: D7 }, traffic_class: 'human' });
      console.log(`book opens, human-only (7d)   ${opens}`);
      return;
    }

    console.log(`reader-book pairs (7d)        ${d.pairs}`);
    console.log(`pages read / pair  median=${d.median}  p90=${d.p90}`);
    console.log(`read only 1 page              ${d.oneOnly}  (${pct(d.oneOnly, d.pairs)})`);
    console.log(`read 10+ pages (deep read)    ${d.deep}  (${pct(d.deep, d.pairs)})`);
    console.log(`book opens (book_read, 7d)    ${d.opens}`);
    console.log(`\nbasis — read these before quoting anything above:`);
    console.log(`  unclassified events dropped  ${d.unclassified}  (pre-#3405, unattributable)`);
    console.log(`  heavy IPs excluded           ${d.excludedIps}  (>${d.threshold} events/7d from one /24)`);
    console.log(`  their events                 ${d.excludedEvents}`);
    for (const h of d.excludedTopIps) console.log(`      ${h.ip}  ${h.events}`);
    if (d.excludedIps) {
      console.log(`  WITHOUT that exclusion:      pairs=${d.unfiltered.pairs} median=${d.unfiltered.median} 1-page=${pct(d.unfiltered.oneOnly, d.unfiltered.pairs)}`);
      console.log(`  If those two rows disagree, the headline is a product of the heuristic,`);
      console.log(`  not of the data. The /24 anonymization means a large NAT can be excluded`);
      console.log(`  as a fleet — check the addresses above before trusting either figure.`);
    }
  });

  // ---- 2b. READING DEPTH, SIGNED-IN MEMBERS ----
  await section(`2b. Reading depth — signed-in members (reading_history, last ${DAYS}d)`, async () => {
    // The uncontaminated twin of section 2: written only behind a session, so no
    // crawler can be in it, and keyed on user_id so a shared NAT stays several
    // readers. Narrower population, much higher confidence.
    const m = await computeMemberReadingDepth(db, SINCE);
    if (!m) { console.log('no reading_history rows in window'); return; }
    console.log(`reading sessions              ${m.sessions}   (one user+book sitting, 30min gap)`);
    console.log(`distinct members / books      ${m.users} / ${m.books}`);
    console.log(`pages read / session  median=${m.median}  p75=${m.p75}  p90=${m.p90}  p99=${m.p99}  max=${m.max}`);
    console.log(`  1 page only                 ${m.oneOnly}  (${pct(m.oneOnly, m.sessions)})`);
    console.log(`  2-4 pages                   ${m.shallow}  (${pct(m.shallow, m.sessions)})`);
    console.log(`  5-9 pages                   ${m.middling}  (${pct(m.middling, m.sessions)})`);
    console.log(`  10+ pages (deep read)       ${m.deep}  (${pct(m.deep, m.sessions)})`);
    console.log(`  50+ pages                   ${m.veryDeep}  (${pct(m.veryDeep, m.sessions)})`);
    console.log(`\nsame split by PAGES, not sessions — this is where the reading is:`);
    console.log(`  pages in 1-page sessions    ${m.pagesOneOnly}  (${pct(m.pagesOneOnly, m.totalPages)})`);
    console.log(`  pages in 10+ sessions       ${m.pagesDeep}  (${pct(m.pagesDeep, m.totalPages)})`);
    console.log(`  pages in 50+ sessions       ${m.pagesVeryDeep}  (${pct(m.pagesVeryDeep, m.totalPages)})`);
    console.log(`  distinct pages read, total  ${m.totalPages}`);
    console.log(`\nreturning members (a session is one user+BOOK, so >1 session is not a return):`);
    console.log(`  read on >1 calendar day     ${m.multiDayUsers}  (${pct(m.multiDayUsers, m.users)})   <- the retention figure`);
    console.log(`  read on 3+ days             ${m.threeDayUsers}  (${pct(m.threeDayUsers, m.users)})`);
    console.log(`  activity spanning >24h      ${m.spanOver24hUsers}  (${pct(m.spanOver24hUsers, m.users)})`);
    console.log(`  everything inside one hour  ${m.singleHourUsers}  (${pct(m.singleHourUsers, m.users)})   <- one-and-done`);
    console.log(`  opened >1 book              ${m.multiBookUsers}  (${pct(m.multiBookUsers, m.users)})`);
    console.log(`  >1 book-session             ${m.multiSessionUsers}  (${pct(m.multiSessionUsers, m.users)})   NOT a return — for comparison only`);
    console.log(`\nbasis — read these before quoting any TOTAL above:`);
    console.log(`  sessions faster than ${m.machinePacePpm}pp/min  ${m.fastSessions} of ${m.pacedSessions} timed  (${m.fastPages} pages, ${pct(m.fastPages, m.totalPages)} of all pages)`);
    console.log(`  top 1% of members            ${(m.top1PctPageShare * 100).toFixed(1)}% of pages`);
    console.log(`  top 10% of members           ${(m.top10PctPageShare * 100).toFixed(1)}% of pages`);
    console.log(`  Auth-gating keeps anonymous crawlers out; it does not keep a signed-in`);
    console.log(`  account from bulk-fetching. Per-session shares survive dropping the`);
    console.log(`  heaviest accounts — totals do not.`);
    console.log(`CEILING, not average: members are self-selected and more engaged than a`);
    console.log(`passer-by. This answers "do our members read?", not "do visitors read?".`);
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
