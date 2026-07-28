/**
 * Reading depth — the one product question that matters most ("do people who
 * open a book actually read it?") and the one we have repeatedly got wrong.
 *
 * Shared by scripts/analytics/engagement-metrics.mjs (the human-readable
 * report) and scripts/analytics/snapshot-metrics.mjs (which feeds
 * /platform/admin/metrics AND the weekly digest email). They had near-identical
 * copies of this aggregation; a correction applied to one and not the other is
 * how a bad number survives a fix, so there is exactly one implementation now.
 *
 * Two independent contaminations have to be handled, and the second is the
 * subtle one:
 *
 *  1. UNCLASSIFIED events. Before #3405 `page_read` was written with no bot
 *     filter and no user-agent, so those rows can never be attributed. They are
 *     counted, never included, and if they dominate the window the answer is
 *     "not measurable" rather than a plausible histogram.
 *
 *  2. Events classified 'human' that are not. Verified in production minutes
 *     after the #3405 deploy: the headless fleet in 43.172/43.173 presents a
 *     plain "Windows NT 10.0 … Chrome" user-agent, so UA matching correctly
 *     finds nothing wrong with it, and the per-IP cap is per serverless
 *     instance so it does not bind across a fleet. 353 of 1,528 events in a
 *     12-minute window (23%) were stored as human from those two /16s alone.
 *     Write-time classification cannot see this — only an aggregate over the
 *     whole window can.
 *
 * So depth excludes IPs whose volume is impossible for a person, and REPORTS
 * what it excluded. Never a silent cap: the caller prints both the excluded and
 * unexcluded figures, because the exclusion has a real false-positive mode
 * (`ip` is anonymized to a /24, so a large NAT or CGNAT range is many readers
 * sharing one key). Seeing both is what tells you whether the headline depends
 * on the heuristic.
 *
 * ── The second instrument: computeMemberReadingDepth ──────────────────────────
 *
 * `reading_history` answers the same question for signed-in readers and is
 * **structurally immune to all of the above**: it is written only behind a
 * session, so no crawler can appear in it, and it keys on `user_id` rather than
 * an anonymized IP, so two readers behind one NAT stay two readers. It was
 * sitting there, uncontaminated, the whole time the anonymous metric was being
 * quoted — nobody thought to check it because the broken instrument answered
 * confidently. When one instrument is compromised, look for a second one that
 * measures the same thing by different means before declaring the question
 * unanswerable.
 *
 * What it cannot do is speak for the whole audience: signed-in members are a
 * self-selected minority (946 of 3,851 accounts active in a recent 30-day
 * window) and are more engaged than a passer-by, so it is a CEILING, not an
 * average. Both numbers are reported side by side, each labelled with its
 * population, and neither is presented as "reading depth" unqualified.
 */

// Distinct page_read events from one anonymized /24 over the window, above
// which the source cannot be a person. 1,500 over 7 days is ~214 pages/day
// sustained, every day, with no gap — well beyond a devoted reader, and far
// below the fleet's observed ~1,575/day per address.
export const HEAVY_IP_EVENT_THRESHOLD = 1500;

// Below this share of classified events, the window is mostly pre-#3405 rows
// and no depth figure should be produced at all.
const MIN_CLASSIFIED_SHARE = 0.5;

/**
 * @param {import('mongodb').Db} db
 * @param {Date} since  start of the window (typically 7 days ago)
 * @param {{ threshold?: number }} [opts]  threshold is per-window, so a caller
 *   measuring a shorter span must scale it down — the default is sized for 7d.
 * @returns {Promise<object>} depth stats, or { contaminated: true, … }
 */
export async function computeReadingDepth(db, since, opts = {}) {
  const threshold = opts.threshold ?? HEAVY_IP_EVENT_THRESHOLD;
  const ev = db.collection('analytics_events');
  const base = { event: 'page_read', timestamp: { $gt: since } };

  const total = await ev.countDocuments(base);
  const classified = await ev.countDocuments({ ...base, traffic_class: { $exists: true } });

  if (total > 0 && classified / total < MIN_CLASSIFIED_SHARE) {
    return { contaminated: true, total, classified, unclassified: total - classified };
  }

  const human = { ...base, traffic_class: 'human', book_id: { $ne: null } };

  // Which anonymized /24s emit more than a person could?
  const heavy = await ev.aggregate([
    { $match: human },
    { $group: { _id: '$ip', n: { $sum: 1 } } },
    { $match: { n: { $gt: threshold } } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true }).toArray();

  const heavyIps = heavy.map((h) => h._id);
  const heavyEvents = heavy.reduce((s, h) => s + h.n, 0);

  const histogram = async (match) => {
    const rows = await ev.aggregate([
      { $match: match },
      { $group: { _id: { ip: '$ip', b: '$book_id' }, pages: { $addToSet: '$page_id' } } },
      { $project: { n: { $size: '$pages' } } },
      { $group: { _id: '$n', sessions: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ], { allowDiskUse: true }).toArray();

    const flat = [];
    for (const r of rows) for (let i = 0; i < r.sessions; i++) flat.push(r._id);
    flat.sort((a, b) => a - b);
    const n = flat.length;
    return {
      pairs: n,
      median: flat[Math.floor(n / 2)] || 0,
      p90: flat[Math.floor(n * 0.9)] || 0,
      oneOnly: rows.find((r) => r._id === 1)?.sessions || 0,
      deep: rows.filter((r) => r._id >= 10).reduce((s, r) => s + r.sessions, 0),
    };
  };

  const filtered = await histogram(
    heavyIps.length ? { ...human, ip: { $nin: heavyIps } } : human
  );
  // The same statistic without the heuristic. If the two disagree sharply, the
  // headline is a product of the exclusion rule and must be quoted as such.
  const unfiltered = heavyIps.length ? await histogram(human) : filtered;

  return {
    ...filtered,
    opens: await ev.countDocuments({
      event: 'book_read',
      timestamp: { $gt: since },
      traffic_class: 'human',
      ...(heavyIps.length ? { ip: { $nin: heavyIps } } : {}),
    }),
    // Clamped: the two counts are taken a moment apart against a live stream,
    // so on a busy window `classified` can exceed the `total` read just before
    // it. A negative "unclassified" in a report is a bug that reads as a data
    // anomaly, which is the last thing this section needs.
    unclassified: Math.max(0, total - classified),
    excludedIps: heavyIps.length,
    excludedEvents: heavyEvents,
    excludedTopIps: heavy.slice(0, 5).map((h) => ({ ip: h._id, events: h.n })),
    threshold,
    unfiltered,
  };
}

/**
 * Reading depth for SIGNED-IN members, from `reading_history`.
 *
 * One row is one reading session (the write path collapses activity on the same
 * user+book within 30 minutes into a single row), and `pages_read` is an
 * `$addToSet` of distinct pages — so its length is genuinely "how far into this
 * book did this person get in this sitting", not a page-turn counter.
 * `pages_viewed` counts every turn including re-reads, which is why the two are
 * reported separately rather than averaged into one misleading figure.
 *
 * @param {import('mongodb').Db} db
 * @param {Date} since
 * @returns {Promise<object|null>} null when the collection is empty/absent
 */
export async function computeMemberReadingDepth(db, since) {
  const rows = await db.collection('reading_history').aggregate([
    { $match: { updated_at: { $gte: since } } },
    {
      $project: {
        user_id: 1,
        book_id: 1,
        viewed: { $ifNull: ['$pages_viewed', 0] },
        distinct: { $size: { $ifNull: ['$pages_read', []] } },
      },
    },
  ], { allowDiskUse: true }).toArray();

  if (!rows.length) return null;

  const depths = rows.map((r) => r.distinct).sort((a, b) => a - b);
  const n = depths.length;
  const q = (p) => depths[Math.floor(n * p)] || 0;
  const count = (fn) => rows.filter(fn).length;

  const sessionsByUser = new Map();
  for (const r of rows) sessionsByUser.set(r.user_id, (sessionsByUser.get(r.user_id) || 0) + 1);
  const returning = [...sessionsByUser.values()].filter((v) => v > 1).length;

  return {
    sessions: n,
    users: sessionsByUser.size,
    books: new Set(rows.map((r) => r.book_id)).size,
    median: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p99: q(0.99),
    max: depths[n - 1] || 0,
    oneOnly: count((r) => r.distinct === 1),
    shallow: count((r) => r.distinct >= 2 && r.distinct <= 4),
    middling: count((r) => r.distinct >= 5 && r.distinct <= 9),
    deep: count((r) => r.distinct >= 10),
    veryDeep: count((r) => r.distinct >= 50),
    returningUsers: returning,
    totalPages: rows.reduce((s, r) => s + r.distinct, 0),
  };
}
