#!/usr/bin/env node
// Daily metrics snapshot writer.
//
// Computes the headline audience + usage + engagement numbers (the same
// aggregations the /metrics skill runs across audience-metrics.mjs,
// usage-deepdive.mjs, and engagement-metrics.mjs) and writes ONE structured
// document to system_config.metrics_snapshot. The Readers section of the /admin
// dashboard reads that doc and renders instantly — it never runs
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
import { activePoolFingerprints, excludePoolFilter, poolWindowFilter } from '../lib/suspected-pool.mjs';
import {
  LIKELY_HUMAN_METHOD, OWN_TOOL_UA, fingerprintSignals, isLikely, likelyHumanDailyChunked, likelyHumanTotal, median, mergeDaily,
} from '../lib/likely-human.mjs';
import { createSourceTally, UTM_SINCE } from '../lib/pageview-source.mjs';

const DAYS = (() => { const i = process.argv.indexOf('--days'); return i > -1 ? Number(process.argv[i + 1]) : 30; })();
// --dry-run computes everything and writes nothing: for testing a change to this
// script against production without touching the dashboard or the history.
const DRY_RUN = process.argv.includes('--dry-run');
// --backfill-likely rebuilds the whole likely-human daily series from raw page
// views (about two minutes). Run by hand: once after this field first ships,
// and again whenever the rule in scripts/lib/likely-human.mjs changes.
const BACKFILL_LIKELY = process.argv.includes('--backfill-likely');
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

// ─── PostHog (#8541): reader geography from the browser's own address ──────
// Mongo `country` was the Cloudflare edge's location until #8532 (#8531).
// PostHog geolocates the browser itself, so it is right for past months too.
// Readers = pageviews from a phone or referred from another site (automated
// fleets are desktop and direct). Pageviews, not persons: PostHog runs
// cookieless before consent, so every full page load is a new "person".
// Each query is optional: no key or a failure omits the field, and the
// snapshot's $set then keeps the previous value. Both start here so they run
// alongside the Mongo work (the script has a 240 s budget; ~60 s without them).
const PH_EXTERNAL = "properties.$referring_domain not in ('$direct', 'sourcelibrary.org', 'www.sourcelibrary.org')";
const PH_READER = `(properties.$device_type = 'Mobile' or ${PH_EXTERNAL})`;
async function posthog(query) {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://eu.posthog.com/api/projects/148667/query/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.results)) throw new Error(String(body.error || 'no results').slice(0, 200));
    return body.results;
  } catch (e) {
    console.error(`  [snapshot] posthog query failed, keeping the previous value: ${e.message}`);
    return null;
  }
}
const phGeo30 = posthog(`select properties.$geoip_country_code c, count() pv, countIf(${PH_EXTERNAL}) ref from events where event = '$pageview' and timestamp > now() - interval 30 day and ${PH_READER} group by c having pv >= 3 order by pv desc limit 300`);
const phMonthly = posthog(`select toString(toStartOfMonth(timestamp)) m, properties.$geoip_country_code c, count() pv from events where event = '$pageview' and timestamp >= toDateTime('2026-06-01') and ${PH_READER} group by m, c having pv >= 5 order by m, pv desc limit 5000`);

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
  // `newsletter_subscribers` was snapshotted here until #77; nothing ever wrote
  // that collection, so the field was a constant 0. The newsletter's reach is
  // the Resend audience, not a Mongo count.
  const subscribers = {};
  try { subscribers.beta_subscribers = await db.collection('beta_subscribers').countDocuments({}); } catch { subscribers.beta_subscribers = null; }
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

  // Residential-proxy fingerprints flagged by traffic-anomaly-alert. This
  // snapshot writes system_config.metrics_snapshot, which IS the admin metrics
  // dashboard — the most-read numbers we publish. Without this exclusion the
  // 2026-09-19 pool would have been charted as a 10x DAU record and then
  // accumulated into metrics_history, where it is permanent. `isBot` below
  // cannot see it: the pool wears a stock Chrome UA. (#4947)
  // 30 days: MAU and the DAU trend series both span 30 days.
  const poolUas = await activePoolFingerprints(db, { staleDays: 30 });
  const notPool = excludePoolFilter(poolUas, 'userAgent');
  if (poolUas.size) console.log(`  [snapshot] excluding ${poolUas.size} proxy-pool fingerprint(s) from traffic metrics`);

  const mau = (await pv.aggregate([
    { $match: { timestamp: { $gt: d30 }, ...notPool } }, { $group: fpGroup }, { $count: 'n' },
  ]).toArray())[0]?.n || 0;
  // 30-day DAU series (drives the trend chart); avg DAU uses the last 14 days.
  const dauSeries = await pv.aggregate([
    { $match: { timestamp: { $gt: d30 }, ...notPool } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
    { $group: { _id: '$_id.day', users: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray();
  const dau = dauSeries.filter((d) => d._id >= day(14));
  const avgDau = Math.round(dau.reduce((s, d) => s + d.users, 0) / (dau.length || 1));

  // ─── LIKELY-HUMAN READERS: the headline (#48) ─────────────────────────────
  // `mau` and `avgDau` above count fingerprints, and most fingerprints are
  // fleets the bot pattern and the pool list cannot see. The rule, its test
  // against known humans and a known fleet, and what a fingerprint is not:
  // scripts/lib/likely-human.mjs.
  //
  // The daily series is kept in the snapshot and topped up: each run recomputes
  // the last LIKELY_REFRESH_DAYS full days from raw page views and merges them
  // over the stored series. Recomputing the whole series every morning does not
  // fit this script's 240 s budget (30 days is ~20 s; 90 days timed out), and a
  // snapshot that times out leaves the whole dashboard stale. History comes
  // from one hand run with --backfill-likely, which is also what a change to
  // the rule needs: a stored series under another method is discarded, never
  // spliced, so the line cannot carry a step where the definition changed.
  const LIKELY_KEEP_DAYS = 220, LIKELY_REFRESH_DAYS = 7, LIKELY_FIRST_RUN_DAYS = 30;
  const humanMatch = { userAgent: { $exists: true, $not: BOT_RE } };
  const prevSnap = await db.collection('system_config').findOne(
    { _id: 'metrics_snapshot' }, { projection: { 'likely.method': 1, 'series.likelyDaily': 1 } },
  );
  const storedDaily = prevSnap?.likely?.method === LIKELY_HUMAN_METHOD ? (prevSnap.series?.likelyDaily || []) : [];
  const refreshDays = BACKFILL_LIKELY ? LIKELY_KEEP_DAYS : storedDaily.length ? LIKELY_REFRESH_DAYS : LIKELY_FIRST_RUN_DAYS;
  if (!storedDaily.length && !BACKFILL_LIKELY) console.log(`  [snapshot] no stored likely-human series under ${LIKELY_HUMAN_METHOD}: starting from ${LIKELY_FIRST_RUN_DAYS} days. Run once with --backfill-likely for the full history.`);
  // A flagged string is excluded only on the days its pool ran: over 220 days
  // a blanket exclusion would drop the real readers who wear the same stock
  // Chrome string in every other week (suspected-pool.mjs, poolWindowFilter).
  const notPoolSeries = await poolWindowFilter(db);
  const likelyDaily = mergeDaily(
    BACKFILL_LIKELY ? [] : storedDaily,
    await likelyHumanDailyChunked(pv, { days: refreshDays, match: { ...humanMatch, ...notPoolSeries }, now }),
    { keepDays: LIKELY_KEEP_DAYS, now },
  );
  const likely30 = await likelyHumanTotal(pv, { from: d30, match: { ...humanMatch, ...notPool } });
  const last14 = likelyDaily.slice(-14);
  const likely = {
    method: LIKELY_HUMAN_METHOD,
    mau: likely30.likely, mauStrict: likely30.strict, mauAll: likely30.all,
    pageviews30: likely30.likelyPageviews, pageviewsAll30: likely30.pageviews,
    // Median, not mean: 2026-11-06 alone (46,668 fingerprints) put the 14-day mean at 6,844.
    dau: median(last14.map((d) => d.likely)),
    dauStrict: median(last14.map((d) => d.strict)),
    dauAll: median(last14.map((d) => d.all)),
    dauDays: last14.length,
  };

  // --backfill-likely rebuilds this one series and stops. The rest of the
  // snapshot is the 05:45 cron's job and stays as that run wrote it.
  if (BACKFILL_LIKELY) {
    console.log(`likely-human series rebuilt: ${likelyDaily.length} days, ${likelyDaily[0]?.date} to ${likelyDaily.at(-1)?.date}; ${likely.dau}/day median of the last ${likely.dauDays} (strict ${likely.dauStrict}, all fingerprints ${likely.dauAll}); 30 days ${likely.mau} of ${likely.mauAll}.`);
    if (DRY_RUN) { console.log('DRY RUN, nothing written.'); console.log(likelyDaily.map((d) => `${d.date.slice(5)}:${d.likely}/${d.strict}/${d.all}`).join(' ')); return; }
    const r = await db.collection('system_config').updateOne({ _id: 'metrics_snapshot' }, { $set: { likely, 'series.likelyDaily': likelyDaily } });
    console.log(`metrics_snapshot.likely and series.likelyDaily written (matched=${r.matchedCount} modified=${r.modifiedCount}).`);
    return;
  }

  // ─── GEOGRAPHY: likely-human visitors by country (#8522) ──────────────────
  // The same rule, grouped by country. On 2026-11-11 it kept 26,778 of 141,124
  // thirty-day fingerprints, and the three signals agreed on the Latin America
  // share (6.0-6.9%), which is the two-instrument check.
  const geoByCountry = async (from) => (await pv.aggregate([
    { $match: { timestamp: { $gt: from }, ...humanMatch, ...notPool } },
    { $group: {
      _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } },
      country: { $first: '$country' },
      ...fingerprintSignals,
    } },
    { $group: {
      _id: { $ifNull: ['$country', 'unknown'] },
      all: { $sum: 1 },
      referred: { $sum: '$referred' },
      likely: { $sum: { $cond: [isLikely, 1, 0] } },
    } },
  ], { allowDiskUse: true }).toArray())
    .map((r) => ({ country: r._id, all: r.all, likely: r.likely, referred: r.referred }))
    .sort((a, b) => b.likely - a.likely);
  // Before the #8532 release `country` was the Cloudflare EDGE's location, not the
  // reader's: Mexican readers ride US edges and were stored as US (#8531). Those
  // rows cannot be repaired, so the map counts only rows written after the fix.
  // The window grows to 30 days by itself. If the release slipped, move this date.
  const GEO_RELIABLE_FROM = new Date('2026-11-12T00:00:00Z');
  const geoFrom = new Date(Math.max(+d30, +GEO_RELIABLE_FROM));
  const geo30 = await geoByCountry(geoFrom);
  const geo = {
    windowDays: 30, since: geoFrom.toISOString(), method: 'likely-human-v1',
    countries: geo30,
  };
  // A day that started before the fix would mix edge and reader countries: skip it.
  const geoLikely = +d1 >= +GEO_RELIABLE_FROM
    ? Object.fromEntries((await geoByCountry(d1)).filter((r) => r.likely > 0).map((r) => [r.country, r.likely]))
    : undefined;

  // ─── WHO READERS SAY THEY ARE: /welcome introductions (#8541) ─────────────
  // Free text in users.profile.aboutYou. Only TALLIES leave this script: the
  // public /about/readers page shows counts, never a word of what anyone wrote.
  // INTRO_KINDS gives each introduction ONE main kind: the first rule that
  // matches, in this order, so a retired professor is an academic and a student
  // who reads tarot is a student. No match = "curious" (no occupation given).
  // Spot-checked by eye on 40 random introductions, 2026-11-11: right for most,
  // wrong where a word means something else in context, so the page says
  // "roughly". INTRO_INTERESTS overlap: one introduction can mention several.
  const INTRO_KINDS = [
    ['academic', /\b(professor|profesor|lecturer|docente universitari|phd\b|ph\.d|doctor (in|of|en) |doctora? en |postdoc|scholar|academic|acad[eé]mic|historian|historiador|philologist|fil[oó]log|archaeolog|arque[oó]log|egyptolog|research(er)?\b|investigador|privatdozent|fellow)/i],
    ['student', /\b(student|estudiante|alumn|undergrad|studying|estudio |estudo |licenciatura|master'?s|maestr[ií]a|thesis|tesis|universit|pursuing a degree|carrera de)/i],
    ['library', /\b(librarian|bibliotec|archivist|archiv[ií]st|museum|museo|curator|curador)/i],
    ['teacher', /\b(teacher|profesora?|maestr[oa]\b|docente|educat|tutor)/i],
    ['clergy', /\b(monk|monje|priest|sacerdote|minister|pastor|rabbi|rabino|nun\b|monja|theologian|te[oó]log)/i],
    ['retired', /\b(retired|jubilad|pensioner|pensionad|met pensioen|gepensioneerd)/i],
    ['health', /\b(therap|terapeut|psycholog|psic[oó]log|psychiatr|physician|doctor\b|m[eé]dic[oa]\b|nurse|enfermer|herbalist|herbolari|naturopath|acupunct|reiki|healer|sanador|pharmac|farmac)/i],
    ['practitioner', /\b(astrolog|tarot|magician|mago\b|maga\b|witch|bruj|occultist|ocultista|freemason|free mason|mas[oó]n\b|rosicrucian|rosacruz|druid|shaman|cham[aá]n|practitioner|practicante|initiate|iniciad|alchemist\b|alquimista)/i],
    ['artist', /\b(artist|artista|painter|pintor|writer|escritor|poet|poeta|novelist|novelista|author of|autor|musician|m[uú]sic[oa]|composer|compositor|designer|diseñador|illustrat|ilustrad|filmmaker|cineasta|actor|actriz|photographer|fot[oó]graf|tattoo|sculpt|escultor)/i],
    ['tech', /\b(engineer|ingenier|developer|desarrollador|programmer|programador|software|computer|inform[aá]tic|data scien|it professional|it consultant|it specialist)/i],
    ['professional', /\b(lawyer|abogad|entrepreneur|emprendedor|business|empresari|manager|gerente|accountant|contador|consultant|consultor|journalist|periodista|architect|arquitect|translator|traductor|economist|economista|veterinar|vet\b|founder|fundador)/i],
    ['seeker', /\b(seeker|buscador|spiritual|espiritual|esoteric|esot[eé]ric|mystic|m[ií]stic|occult|ocult|hermet|herm[eé]t|gnos|alchem|alquim|kabbal|cabal|magic|magia)/i],
  ];
  const INTRO_INTERESTS = {
    esoteric: /esot[eé]r|occult|ocult|magic|magia|mágic|mystic|místic|mistic|gnos/i,
    alchemy: /alqu?im|alchem/i,
    hermetic: /herm[eé]t/i,
    philosophy: /philosoph|filosof/i,
    history: /\bhistor/i,
    religion: /theolog|teolog|religi|\bbibl(e|ia)|spiritual|espiritual|buddh|budis/i,
    science_medicine: /scien|cienc|medic|médic|botan|astronom|chemi|quím|herb/i,
    astrology_tarot: /astrolog|tarot/i,
    kabbalah: /kab+al|cab+al|qabal/i,
    languages: /\blatin|lat[ií]n|\bgreek|griego|hebrew|hebreo|sanskrit|s[aá]nscrito|arabic|[aá]rabe|languages|idiomas|lenguas/i,
  };
  const intros = (await users.find(
    { 'profile.aboutYou': { $exists: true, $nin: ['', null] } },
    { projection: { 'profile.aboutYou': 1 } },
  ).toArray()).map((u) => String(u.profile.aboutYou));
  const kinds = {};
  for (const t of intros) {
    const k = (INTRO_KINDS.find(([, re]) => re.test(t)) || ['curious'])[0];
    kinds[k] = (kinds[k] || 0) + 1;
  }
  const introductions = {
    n: intros.length,
    kinds,
    interests: Object.fromEntries(Object.entries(INTRO_INTERESTS).map(([k, re]) => [k, intros.filter((t) => re.test(t)).length])),
  };

  // PostHog results (queries started before the Mongo work, top of file).
  const phGeoRows = await phGeo30;
  const phMonthRows = await phMonthly;
  const geoReaders = phGeoRows && {
    windowDays: 30, source: 'posthog', method: 'reader-pageviews-v1',
    countries: phGeoRows.filter(([c]) => c).map(([country, pv, ref]) => ({ country, all: pv, likely: pv, referred: ref })),
  };
  const readersMonthly = phMonthRows && {
    source: 'posthog', method: 'reader-pageviews-v1',
    months: phMonthRows.reduce((acc, [m, c, n]) => {
      if (!c) return acc;
      (acc[String(m).slice(0, 7)] ||= {})[c] = n;
      return acc;
    }, {}),
  };


  // Dwell: per-session (ip+ua, 30-min idle gap) duration, last 7d, multi-hit only.
  const rows = await pv.find({ timestamp: { $gt: d7 }, ...notPool }, { projection: { ip: 1, userAgent: 1, timestamp: 1 } }).toArray();
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
  // the /admin dashboard AND the weekly digest, so a wrong number here is a
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
  const pvCursor = pv.find({ timestamp: { $gte: SINCE }, ...notPool }, { projection: { path: 1, userAgent: 1, referrer: 1, utm: 1, ip: 1, country: 1, timestamp: 1 } }).batchSize(1000);
  let humanPvs = 0, botPvs = 0;
  const dailyHits = new Map(), bookHits = new Map(), collectionHits = new Map(), countries = new Map();
  // A row's source is its utm tag, else its referrer, else direct (scripts/lib/pageview-source.mjs).
  // Reading the referrer alone filed every ChatGPT arrival under "direct" (v2#8161).
  const sources = createSourceTally();
  while (await pvCursor.hasNext()) {
    const d = await pvCursor.next();
    if (isBot(d.userAgent)) { botPvs++; continue; }
    humanPvs++;
    const cls = classifyPath(d.path || '');
    const dstr = new Date(d.timestamp).toISOString().slice(0, 10);
    dailyHits.set(dstr, (dailyHits.get(dstr) || 0) + 1);
    if (cls.kind === 'book' && cls.slug) bookHits.set(cls.slug, (bookHits.get(cls.slug) || 0) + 1);
    if (cls.kind === 'collection' && cls.slug) collectionHits.set(cls.slug, (collectionHits.get(cls.slug) || 0) + 1);
    sources.add(d, `${d.ip}::${(d.userAgent || '').slice(0, 60)}`, dstr);
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
  // `referrer` and `hits` keep their names for readers of older snapshots; `referrer` now
  // holds the source. `visitors` (address + user agent, distinct over the window) is the
  // figure to compare sources by, and the order here: a tag or a referrer repeats on
  // several pages of one visit, so `hits` are pageviews, not arrivals.
  const topReferrers = sources.rows().slice(0, 15).map((r) => ({ referrer: r.source, hits: r.pageviews, visitors: r.visitors }));
  // Readers arriving from an assistant, all assistants together. Tags exist from utmSince,
  // so the window's earlier days hold only the assistants that send a referrer.
  const fromAssistants = { ...sources.assistants(), utmSince: UTM_SINCE };
  const topCountries = topN(countries, 12).map(([country, hits]) => ({ country, hits }));

  // ─── SEARCH BEHAVIOR ──────────────────────────────────────────────────────
  let search = null;
  try {
    const sqAll = await db.collection('search_queries').find({ ts: { $gte: SINCE } }, { projection: { query: 1, total: 1, ms: 1, user_agent: 1 } }).toArray();
    // Our own tools are not readers. The search probe replays a fixed panel of
    // ten queries all day under `sl-search-probe/1`, which the crawler pattern
    // does not match: it filled the whole top-ten table at ~5,000 each (#48).
    const sqOwn = sqAll.filter((s) => OWN_TOOL_UA.test(s.user_agent || ''));
    const sqHuman = sqAll.filter((s) => !isBot(s.user_agent) && !OWN_TOOL_UA.test(s.user_agent));
    const zero = sqHuman.filter((s) => (s.total || 0) === 0);
    const qCounts = new Map(), zCounts = new Map();
    for (const s of sqHuman) { const q = (s.query || '').toLowerCase().trim(); if (q) qCounts.set(q, (qCounts.get(q) || 0) + 1); }
    for (const s of zero) { const q = (s.query || '').toLowerCase().trim(); if (q) zCounts.set(q, (zCounts.get(q) || 0) + 1); }
    const lat = sqHuman.map((s) => s.ms).filter((n) => typeof n === 'number').sort((a, b) => a - b);
    search = {
      total: sqAll.length,
      human: sqHuman.length,
      ownTools: sqOwn.length,
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
      likelyDaily, // [{date,all,likely,strict,pageviews,likelyPageviews}] full UTC days, up to 220 (#48)
    },
    likely,
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
    traffic: { humanPvs, botPvs, dailyPageviews, topBooks, topCollections, topReferrers, fromAssistants, topCountries },
    geo,
    ...(geoReaders ? { geoReaders } : {}),
    ...(readersMonthly ? { readersMonthly } : {}),
    introductions,
    search,
    social,
    ai,
    pipelineCost,
  };

  if (DRY_RUN) {
    console.log('DRY RUN, nothing written.');
    console.log(JSON.stringify({ likely, likelyDailyDays: likelyDaily.length, likelyDailyFirst: likelyDaily[0], likelyDailyLast: likelyDaily.at(-1), search: search && { total: search.total, human: search.human, ownTools: search.ownTools, topQueries: search.topQueries.slice(0, 5) } }, null, 1));
    return;
  }

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
    // The rolling 30-day likely-human total cannot be rebuilt cheaply later, so it is kept per day (#48).
    likelyMau: likely.mau, likelyMauStrict: likely.mauStrict, likelyDau: likely.dau, likelyDauStrict: likely.dauStrict,
    ...(geoLikely ? { geoLikely } : {}), // likely-human visitors per country, last 24h (#8522)
  };
  // The two headline corpus counts, copied from homepage_stats (recomputed 05:00
  // by prewarm-browse) so "books made readable per day" can be read off history
  // instead of reconstructed (#7577). Copied, never recomputed: one definition.
  const hs = await db.collection('system_config').findOne(
    { _id: 'homepage_stats' },
    { projection: { readableInEnglish: 1, readableInEnglishAt: 1, firstTranslatedWorks: 1, firstTranslatedWorksProvisional: 1 } },
  );
  if (hs) {
    Object.assign(histDoc, {
      readableInEnglish: hs.readableInEnglish ?? null,
      readableInEnglishAt: hs.readableInEnglishAt ?? null,
      firstTranslatedWorks: hs.firstTranslatedWorks ?? null,
      firstTranslatedWorksProvisional: hs.firstTranslatedWorksProvisional ?? null,
    });
  }
  let histRes;
  try {
    histRes = await db.collection('metrics_history').updateOne(
      { date: todayStr }, { $set: histDoc }, { upsert: true },
    );
  } catch (e) { console.error(`  (metrics_history write skipped: ${e.message})`); }

  console.log(`metrics_snapshot written (matched=${res.matchedCount} upserted=${res.upsertedCount ? 1 : 0}). generatedAt=${snapshot.generatedAt.toISOString()}`);
  console.log(`  users.total=${total} (+${new7}/7d, prev ${prev7})  MAU=${mau}  avgDAU=${avgDau}  humanPV(${DAYS}d)=${humanPvs}  dwellMedian=${dwellMedian}s`);
  console.log(`  likely human: ${likely.dau}/day median of ${likely.dauDays} days (strict ${likely.dauStrict}, all fingerprints ${likely.dauAll}); 30 days ${likely.mau} of ${likely.mauAll} fingerprints; own-tool searches removed ${search?.ownTools ?? 'n/a'}`);
  if (histRes) console.log(`  metrics_history[${todayStr}] ${histRes.upsertedCount ? 'inserted' : 'updated'}.`);
}, { timeoutMs: BACKFILL_LIKELY ? 900000 : 240000 });
