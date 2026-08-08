import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

const SNAPSHOT_ID = 'canon_dashboard_snapshot';
const STALE_AFTER_MS = 60 * 60 * 1000;

// Live = the public canon: visible AND actually processed. Totals are reported
// beside live everywhere — a live-only count silently excludes the hidden
// import backlog (#3769), which is exactly where resolution work remains.
const LIVE = { visible: true, pages_count: { $gt: 0 } };
const HAS = (field: string) => ({ [field]: { $exists: true, $nin: [null, ''] } });

async function computeWorks(db: any) {
  const books = db.collection('books');
  const [
    liveBooks, allBooks,
    workLive, workAll,
    editionKeyLive, aliasedLive,
    clusters,
    mergeQueue, mergesApplied,
  ] = await Promise.all([
    books.countDocuments(LIVE),
    books.countDocuments({}),
    books.countDocuments({ ...LIVE, ...HAS('work_id') }),
    books.countDocuments(HAS('work_id')),
    books.countDocuments({ ...LIVE, ...HAS('edition_key') }),
    books.countDocuments({ ...LIVE, 'work_id_aliases.0': { $exists: true } }),
    books.aggregate([
      { $match: { ...LIVE, ...HAS('work_id') } },
      { $group: { _id: '$work_id', editions: { $sum: 1 }, languages: { $addToSet: '$language' } } },
      {
        $group: {
          _id: null,
          works: { $sum: 1 },
          multiEdition: { $sum: { $cond: [{ $gte: ['$editions', 2] }, 1, 0] } },
          multiLanguage: { $sum: { $cond: [{ $gte: [{ $size: '$languages' }, 2] }, 1, 0] } },
          size1: { $sum: { $cond: [{ $eq: ['$editions', 1] }, 1, 0] } },
          size2to4: { $sum: { $cond: [{ $and: [{ $gte: ['$editions', 2] }, { $lte: ['$editions', 4] }] }, 1, 0] } },
          size5to9: { $sum: { $cond: [{ $and: [{ $gte: ['$editions', 5] }, { $lte: ['$editions', 9] }] }, 1, 0] } },
          size10plus: { $sum: { $cond: [{ $gte: ['$editions', 10] }, 1, 0] } },
        },
      },
    ], { maxTimeMS: 30000 }).toArray(),
    db.collection('work_merge_queue').aggregate(
      [{ $group: { _id: '$status', n: { $sum: 1 } } }], { maxTimeMS: 10000 },
    ).toArray(),
    db.collection('work_id_merges').countDocuments({}),
  ]);

  const c = clusters[0] || {};
  return {
    live_books: liveBooks,
    all_books: allBooks,
    work_id_live: workLive,
    work_id_all: workAll,
    edition_key_live: editionKeyLive,
    aliased_live: aliasedLive,
    distinct_works_live: c.works || 0,
    multi_edition_works: c.multiEdition || 0,
    multi_language_works: c.multiLanguage || 0,
    cluster_sizes: {
      '1 edition': c.size1 || 0,
      '2–4': c.size2to4 || 0,
      '5–9': c.size5to9 || 0,
      '10+': c.size10plus || 0,
    },
    merge_queue: Object.fromEntries(mergeQueue.map((r: any) => [r._id ?? 'unknown', r.n])),
    merges_applied: mergesApplied,
  };
}

async function computeAuthors(db: any) {
  const books = db.collection('books');
  const authors = db.collection('authors');
  const [
    strLive, idLive, strAll, idAll,
    thesaurus, wikidata, viaf, entityLinked, nonPerson, tombstones,
    topUnresolved,
  ] = await Promise.all([
    books.countDocuments({ ...LIVE, ...HAS('author') }),
    books.countDocuments({ ...LIVE, ...HAS('author_id') }),
    books.countDocuments(HAS('author')),
    books.countDocuments(HAS('author_id')),
    authors.countDocuments({}),
    authors.countDocuments(HAS('wikidata_id')),
    authors.countDocuments(HAS('viaf_id')),
    authors.countDocuments({ 'entity_ids.0': { $exists: true } }),
    authors.countDocuments({ is_person: false }),
    authors.countDocuments(HAS('merged_into')),
    books.aggregate([
      {
        $match: {
          ...LIVE, ...HAS('author'),
          $or: [{ author_id: { $exists: false } }, { author_id: null }, { author_id: '' }],
        },
      },
      { $group: { _id: '$author', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ], { maxTimeMS: 30000 }).toArray(),
  ]);

  return {
    author_string_live: strLive,
    author_id_live: idLive,
    author_string_all: strAll,
    author_id_all: idAll,
    thesaurus: {
      total: thesaurus,
      wikidata_anchored: wikidata,
      viaf_anchored: viaf,
      entity_linked: entityLinked,
      non_person: nonPerson,
      tombstones,
    },
    top_unresolved: topUnresolved.map((r: any) => ({ author: r._id, books: r.n })),
  };
}

async function computeFirstTranslations(db: any) {
  const books = db.collection('books');
  const attempts = db.collection('first_translation_attempts');
  // attempts.date is an ISO-8601 string; lexicographic $gte is correct on it.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [
    badgedLive, badgedAll, verdictOnBadgedLive,
    verdictDist, strengthDist,
    attemptsTotal, attemptsByMethod, attemptsByDay, searchedBooks,
    reverifyProposals,
  ] = await Promise.all([
    books.countDocuments({ ...LIVE, is_first_translation: true }),
    books.countDocuments({ is_first_translation: true }),
    books.countDocuments({ ...LIVE, is_first_translation: true, 'first_translation.verdict': { $exists: true } }),
    books.aggregate([
      { $match: { 'first_translation.verdict': { $exists: true } } },
      { $group: { _id: '$first_translation.verdict', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ], { maxTimeMS: 20000 }).toArray(),
    books.aggregate([
      { $match: { ...LIVE, is_first_translation: true, 'first_translation.evidence_strength': { $exists: true } } },
      { $group: { _id: '$first_translation.evidence_strength', n: { $sum: 1 } } },
    ], { maxTimeMS: 20000 }).toArray(),
    attempts.countDocuments({}),
    attempts.aggregate([
      { $group: { _id: '$method', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ], { maxTimeMS: 20000 }).toArray(),
    attempts.aggregate([
      { $match: { date: { $gte: cutoff } } },
      { $group: { _id: { $substrCP: ['$date', 0, 10] }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ], { maxTimeMS: 20000 }).toArray(),
    attempts.aggregate([
      { $group: { _id: '$book_id' } },
      { $count: 'n' },
    ], { maxTimeMS: 30000 }).toArray(),
    db.collection('ft_reverify_proposal').countDocuments({}),
  ]);

  // Fill absent days with zeros — a sparse series rendered as equal-width bars
  // would distort the time axis (census activity comes in bursts).
  const byDay = new Map<string, number>(attemptsByDay.map((r: any) => [r._id, r.n]));
  const days: { day: string; n: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    days.push({ day, n: byDay.get(day) || 0 });
  }

  return {
    badged_live: badgedLive,
    badged_all: badgedAll,
    verdict_on_badged_live: verdictOnBadgedLive,
    verdicts: Object.fromEntries(verdictDist.map((r: any) => [r._id, r.n])),
    strengths: Object.fromEntries(strengthDist.map((r: any) => [r._id, r.n])),
    attempts_total: attemptsTotal,
    attempts_by_method: Object.fromEntries(attemptsByMethod.map((r: any) => [r._id ?? 'unknown', r.n])),
    attempts_by_day: days,
    books_searched: searchedBooks[0]?.n || 0,
    reverify_proposals: reverifyProposals,
  };
}

export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const snapshot = await db.collection('system_config').findOne({ _id: SNAPSHOT_ID as any });
  if (!snapshot?.data) {
    return NextResponse.json(
      { _computing: true, message: 'No snapshot yet — hit refresh to compute one.' },
      { status: 202 },
    );
  }
  const age = Date.now() - new Date(snapshot.updated_at).getTime();
  return NextResponse.json({
    ...snapshot.data,
    _snapshot: { updated_at: snapshot.updated_at, stale: age > STALE_AFTER_MS },
  });
});

export const POST = withAdminAuth(async () => {
  const db = await getDb();
  const [works, authors, ft] = await Promise.all([
    computeWorks(db),
    computeAuthors(db),
    computeFirstTranslations(db),
  ]);
  const data = { works, authors, first_translations: ft };
  await db.collection('system_config').updateOne(
    { _id: SNAPSHOT_ID as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, data });
});
