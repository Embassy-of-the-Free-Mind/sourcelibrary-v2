#!/usr/bin/env node
// Daily library-dashboard snapshot writer (#3943).
//
// Computes every breakdown the /admin dashboard shows that is too slow to run
// at render time (#2980) and writes ONE document to
// system_config.library_dashboard. The page reads that doc, plus the hourly
// dashboard_snapshot, the daily metrics_snapshot/metrics_history and
// homepage_stats, and never aggregates on request.
//
// PRIOR ART: src/lib/dashboard-snapshot.ts — the hourly Vercel snapshot keeps
// the canon/coverage/enrichment/economics totals; it runs inside a 60 s
// function budget, so the ~70 s of per-language, per-century, ladder and
// pipeline-series aggregations here cannot live there. The next-step rule is
// the read-only draft from #5469 (scratchpad remaining.mjs); when that issue's
// writer stamps a field on the book, read the field instead of recomputing.
//
// Read-only against Mongo `bookstore` apart from the one upsert. No cost.
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/snapshot-library-dashboard.mjs
// Cron (Hetzner, daily 05:55 UTC): scripts/workers/crontab.production.
import { withMongo } from '../lib/mongo.mjs';

const DOC_ID = 'library_dashboard';
const LIVE = { visible: true, pages_count: { $gt: 0 } };
const WITH_PAGES = { pages_count: { $gt: 0 } };
const RUNGS = ['no_text', 'transcribing', 'transcribed', 'translating', 'readable', 'complete'];
const FUNNEL = ['complete', 'archive_complete', 'needs_attention', 'archiving', 'held', 'images_complete', 'parked', 'failed'];

// Draft next-step rule (#5469), unchanged from the read-only measurement of 2026-10-01.
function nextStep(b) {
  const pa = b.pipeline_auto || {}; const ts = b.translation_state || {};
  const rung = ts.rung;
  if (b.content_type === 'artwork' || rung === 'no_pages') return 'done';
  if (pa.hold || pa.status === 'held') return 'blocked:held';
  if (!rung) return 'blocked:unstamped';
  const archived = (b.pages_archived || 0) >= 0.9 * b.pages_count;
  if (!archived && rung !== 'readable' && rung !== 'complete') {
    if (pa.archive_verdict === 'dead' || /403\/404\/410/.test(pa.error || '')) return 'blocked:source_dead';
    if (pa.archive_verdict === 'restricted' || /access-restricted/.test(pa.error || '')) return 'blocked:source_restricted';
    if (pa.archive_verdict === 'escalated' || /unreachable/.test(pa.error || '')) return 'blocked:source_unreachable';
    if (rung === 'no_text' || rung === 'transcribing') return 'archive';
  }
  if (rung === 'no_text' || rung === 'transcribing') return 'ocr';
  if (!ts.english_original && (rung === 'transcribed' || rung === 'translating')) return 'translate:body';
  if (!ts.english_original && rung === 'readable') return 'translate:tail';
  const hasSummary = !!b.summary || !!pa.summary_skipped_reason;
  const hasChapters = (Array.isArray(b.chapters) && b.chapters.length > 0) || !!pa.chapters_skipped_reason || b.pages_count < 10;
  if (!hasSummary || !hasChapters) return 'enrich';
  return 'done';
}

const t0 = Date.now();
const lap = (k) => console.log(`  ${k} ${((Date.now() - t0) / 1000).toFixed(1)}s`);

await withMongo(async (db) => {
  const books = db.collection('books');
  const agg = (match, group, extra = []) => books.aggregate([{ $match: match }, { $group: group }, ...extra], { allowDiskUse: true }).toArray();
  const sums = { books: { $sum: 1 }, pages: { $sum: '$pages_count' }, ocr: { $sum: '$pages_ocr' }, translated: { $sum: '$pages_translated' }, archived: { $sum: '$pages_archived' }, blank: { $sum: '$pages_blank' } };

  const [liveTotals] = await agg(LIVE, { _id: null, ...sums });
  const [allTotals] = await agg(WITH_PAGES, { _id: null, ...sums });
  lap('totals');

  // Languages: top 12 by books plus "other", live only; pages at each of three states.
  const langRows = await agg(LIVE, { _id: '$language', books: { $sum: 1 }, pages: { $sum: '$pages_count' }, ocr: { $sum: '$pages_ocr' }, translated: { $sum: '$pages_translated' } }, [{ $sort: { books: -1 } }]);
  const named = langRows.filter(r => r._id);
  const fold = (rows) => rows.reduce((o, r) => ({ books: o.books + r.books, pages: o.pages + r.pages, ocr: o.ocr + r.ocr, translated: o.translated + r.translated }), { books: 0, pages: 0, ocr: 0, translated: 0 });
  const byLanguage = [...named.slice(0, 12).map(r => ({ name: r._id, books: r.books, pages: r.pages, ocr: r.ocr, translated: r.translated })),
    { name: `Other (${named.length - 12} languages)`, ...fold(named.slice(12)) }];
  const noLanguage = langRows.find(r => !r._id)?.books || 0;

  const centRows = await agg({ ...LIVE, year: { $type: 'number' } }, { _id: { $multiply: [{ $floor: { $divide: ['$year', 100] } }, 100] }, books: { $sum: 1 }, pages: { $sum: '$pages_count' } }, [{ $sort: { _id: 1 } }]);
  const cent = {}; for (const r of centRows) { const k = r._id < 1000 ? 'before' : r._id; cent[k] ??= { books: 0, pages: 0 }; cent[k].books += r.books; cent[k].pages += r.pages; }
  const byCentury = [['before', 'Before 1000'], [1000, '11th c.'], [1100, '12th'], [1200, '13th'], [1300, '14th'], [1400, '15th'], [1500, '16th'], [1600, '17th'], [1700, '18th'], [1800, '19th'], [1900, '20th'], [2000, '21st']]
    .map(([k, label]) => ({ label, ...(cent[k] || { books: 0, pages: 0 }) }));
  const yearMissing = await books.countDocuments({ ...LIVE, year: { $not: { $type: 'number' } } });
  lap('languages, centuries');

  // Translation ladder, live and all, split by english_original.
  const ladderOf = async (match) => {
    const rows = await agg(match, { _id: { rung: '$translation_state.rung', en: '$translation_state.english_original' }, n: { $sum: 1 } });
    const o = { en: {}, other: {}, unstamped: 0 };
    for (const r of rows) { const k = r._id.rung; if (!k) { o.unstamped += r.n; continue; } if (k === 'no_pages') continue; const g = r._id.en ? 'en' : 'other'; o[g][k] = (o[g][k] || 0) + r.n; }
    return o;
  };
  const ladderLive = await ladderOf(LIVE), ladderAll = await ladderOf(WITH_PAGES);
  const readable = (l) => ['readable', 'complete'].reduce((a, r) => a + (l.other[r] || 0), 0) + ['transcribed', 'translating', 'readable', 'complete'].reduce((a, r) => a + (l.en[r] || 0), 0);
  const statusLive = (await agg(LIVE, { _id: '$pipeline_auto.status', n: { $sum: 1 } }, [{ $sort: { n: -1 } }])).map(r => ({ status: r._id || '(none)', n: r.n }));
  const held = await books.countDocuments({ 'pipeline_auto.hold': { $exists: true } });
  lap('ladder, status');

  const libRows = await agg(LIVE, { _id: '$contributing_library', books: { $sum: 1 } }, [{ $sort: { books: -1 } }, { $limit: 11 }]);
  const libraries = libRows.filter(r => r._id).slice(0, 10).map(r => ({ name: r._id, books: r.books }));
  const noLibrary = (await books.countDocuments({ ...LIVE, $or: [{ contributing_library: null }, { contributing_library: { $exists: false } }] }));
  const addedByMonth = (await books.aggregate([{ $match: LIVE }, { $project: { m: { $dateToString: { format: '%Y-%m', date: { $toDate: '$_id' } } }, pages_count: 1 } }, { $group: { _id: '$m', books: { $sum: 1 }, pages: { $sum: '$pages_count' } } }, { $sort: { _id: 1 } }], { allowDiskUse: true }).toArray())
    .filter(r => r._id >= '2025-11').map(r => ({ month: r._id, books: r.books, pages: r.pages }));
  const collections = (await db.collection('collections').find({ visible: true, collection_type: { $ne: 'visual_art' } }, { projection: { name: 1, slug: 1, book_count: 1, total_book_count: 1, artwork_count: 1 } }).sort({ total_book_count: -1 }).limit(10).toArray())
    .map(c => ({ name: c.name, slug: c.slug, texts: c.total_book_count || 0, readable: c.book_count || 0, art: c.artwork_count || 0 }));
  const visibleCollections = await db.collection('collections').countDocuments({ visible: true });
  const feedbackOpen = await db.collection('feedback').countDocuments({ status: { $nin: ['addressed', 'resolved', 'closed'] } });
  lap('libraries, collections');

  // Next step per book (draft rule #5469), summarised: books and pages per step, live/hidden; OCR backlog by language (live).
  const cur = books.find(WITH_PAGES, { projection: {
    content_type: 1, pages_count: 1, pages_archived: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, pages_translatable: 1, visible: 1, language: 1, translation_state: 1, summary: 1, chapters: { $slice: 1 },
    'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.archive_verdict': 1, 'pipeline_auto.error': 1, 'pipeline_auto.summary_skipped_reason': 1, 'pipeline_auto.chapters_skipped_reason': 1 } }).batchSize(5000);
  const steps = {}; const ocrByLang = {};
  for await (const b of cur) {
    const step = nextStep(b);
    const live = b.visible === true;
    const whole = Math.max(0, b.pages_count - (b.pages_blank || 0));
    const translatable = b.pages_translatable ?? whole;
    let pages = 0;
    if (step === 'archive') pages = Math.max(0, b.pages_count - (b.pages_archived || 0));
    else if (step === 'ocr') pages = Math.max(0, whole - (b.pages_ocr || 0));
    else if (step.startsWith('translate')) pages = Math.max(0, translatable - (b.pages_translated || 0));
    steps[step] ??= { live: 0, hidden: 0, pages_live: 0, pages_hidden: 0 };
    const s = steps[step]; if (live) { s.live++; s.pages_live += pages; } else { s.hidden++; s.pages_hidden += pages; }
    if (live && step === 'ocr') { const l = (b.language || 'unknown').split(/[ ,;(]/)[0]; ocrByLang[l] ??= { books: 0, pages: 0 }; ocrByLang[l].books++; ocrByLang[l].pages += pages; }
  }
  const ocrBacklog = Object.entries(ocrByLang).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.pages - a.pages);
  lap('next step');

  // Pipeline history: last snapshot of each day since the record began (2026-02-19).
  const pipelineDays = (await db.collection('pipeline_snapshots').aggregate([
    { $sort: { timestamp: 1 } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: "$timestamp" } }, books: { $last: '$books' }, pages: { $last: '$pages' }, funnel: { $last: '$funnel' } } },
    { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray()).map(d => ({ day: d._id, books: d.books, total: d.pages?.total ?? null, ocr: d.pages?.ocr ?? null, translated: d.pages?.translated ?? null,
    funnel: Object.fromEntries(FUNNEL.map(k => [k, d.funnel?.[k] ?? null])) }));
  lap('pipeline series');

  // Model spend per day by job, last 90 days, from the metered rollup (stale when the pipeline is paused; the page says so).
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const gemini = (await db.collection('gemini_usage_daily').find({ date: { $gte: since } }, { projection: { date: 1, byType: 1 } }).sort({ date: 1 }).toArray()).map(d => {
    const t = d.byType || {}; const cost = k => t[k]?.cost || 0;
    const other = Object.keys(t).filter(k => !['ocr', 'translation', 'index', 'summary', 'chapters'].includes(k)).reduce((a, k) => a + cost(k), 0);
    return { day: d.date, ocr: cost('ocr'), translation: cost('translation'), enrich: cost('index') + cost('summary') + cost('chapters'), other, pagesOcr: t.ocr?.pageCount || 0, pagesTranslated: t.translation?.pageCount || 0 };
  });
  lap('gemini');

  const doc = {
    _id: DOC_ID, generatedAt: new Date(), schemaVersion: 1, elapsedSec: Math.round((Date.now() - t0) / 10) / 100,
    totals: { live: liveTotals, all: allTotals, readableLive: readable(ladderLive), readableAll: readable(ladderAll), held, feedbackOpen, visibleCollections },
    byLanguage, noLanguage, byCentury, yearMissing, ladder: { rungs: RUNGS, live: ladderLive, all: ladderAll }, statusLive, libraries, noLibrary, addedByMonth, collections,
    nextStep: { steps, ocrBacklog },
    pipeline: { days: pipelineDays, funnel: FUNNEL },
    gemini,
  };
  for (const t of [doc.totals.live, doc.totals.all]) delete t._id;
  const res = await db.collection('system_config').replaceOne({ _id: DOC_ID }, doc, { upsert: true });
  console.log(`library_dashboard written (matched=${res.matchedCount} upserted=${res.upsertedCount ? 1 : 0}) in ${doc.elapsedSec}s: live ${liveTotals.books} books, readable ${doc.totals.readableLive}, ${pipelineDays.length} pipeline days, ${gemini.length} gemini days`);
});
