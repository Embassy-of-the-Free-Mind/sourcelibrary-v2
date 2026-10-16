#!/usr/bin/env node
// PRIOR ART: scripts/eval/greek-ms-census-5619.mjs (the 385-book Greek manuscript census: it classifies, and its
// books.json is read here, not re-run — the image classification was metered) and scripts/eval/hard-hands-6731/
// (rashi-classification.json: 28 rashi + 10 mixed by image). Neither prices what a re-read would set off downstream.
// The gap-fill and trust-gate rules are restated from scripts/workers/pipeline-orchestrator.mjs (Phase 4 partialBooks),
// scripts/workers/translate-worker.mjs (selfDispatch) and scripts/lib/ocr-trust-gate.mjs (ocrTrustVerdictForBook, called).
/**
 * #6769 step 4 + the full-run plan, READ-ONLY.
 *
 *   node --env-file=.env.production.local scripts/eval/g4-reread-pilot-6769/plan.mjs \
 *        --greek-census=<5619 census books.json> --rashi-class=scripts/eval/results/hard-hands-6731/rashi-classification.json \
 *        [--edition-match=<5619 census-edition-match.json>] [--secs-greek=S --secs-rashi=S (measured wall seconds per
 *        page of one concurrency-2 read)] --out=FILE.json [--csv=FILE.csv]
 *
 * Per book: pages (page_number > 0), with OCR, with a real translation, status, hold, the #5700 trust-gate verdict, and
 * what an OCR apply of EVERY page would set off:
 *  - mark-stale (07:30 daily, --since-hours=26) stamps `translation_stale` on every rewritten page that carries English;
 *  - orchestrator gap-fill picks a book at translate_partial/translate_complete/chapters_complete/complete whose
 *    pages_translated < 0.9 x (pages_ocr - pages_blank) — an apply that fills EMPTY pages raises pages_ocr and can push
 *    a book under the bar — and then dispatches every page whose translation is older than its OCR, i.e. the whole
 *    re-read book; translate-worker self-dispatch does the same for any book at translate_partial or ocr_complete;
 *  - both refuse a book the trust gate refuses or a held book; the model is getTranslateModelForBook (Greek, Hebrew →
 *    gemini-3-flash-preview).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { ocrTrustVerdictForBook } from '../../lib/ocr-trust-gate.mjs';
import { getTranslateModelForBook } from '../../lib/translate-core.mjs';
import { REAL_TRANSLATION_FILTER } from '../../lib/stale-translation.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const GAPFILL = ['translate_partial', 'translate_complete', 'chapters_complete', 'complete'];
const SELF = ['translate_partial', 'ocr_complete'];
// Measured flash translation tokens per page on Greek/Hebrew books (gemini_usage, realtime-translate.mjs, last 45 days:
// 4,435 in / 1,581 out) at MODEL_PRICING gemini-3-flash-preview $0.50 / $3.00 per M; Batch (the chained lane) is half.
const USD_PAGE_REALTIME = (4435 * 0.5 + 1581 * 3.0) / 1e6;

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const control = await db.collection('system_config').findOne({ _id: 'processing_control' }, { projection: { daily_budget_usd: 1, paused: 1 } });

async function bookRows(ids, labelOf) {
  const books = await db.collection('books').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, language: 1, year: 1, published: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, needs_splitting: 1, split_completed: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'image_source.provider': 1 } }).toArray();
  const counts = new Map((await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids }, page_number: { $gt: 0 } } },
    { $group: { _id: '$book_id', pages: { $sum: 1 },
      ocr: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] }, 1, 0] } },
      tr: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] }] }, 1, 0] } } } },
  ]).toArray()).map((c) => [c._id, c]));
  // REAL_TRANSLATION_FILTER is a regex filter: count it with a find per book set (placeholders like "[Blank page]" out).
  const real = new Map((await db.collection('pages').aggregate([{ $match: { book_id: { $in: ids }, page_number: { $gt: 0 }, ...REAL_TRANSLATION_FILTER } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }]).toArray()).map((c) => [c._id, c.n]));
  const rows = [];
  for (const b of books) {
    const c = counts.get(b.id) || { pages: 0, ocr: 0, tr: 0 };
    const trust = await ocrTrustVerdictForBook(db, b);
    const status = b.pipeline_auto?.status ?? null, held = !!b.pipeline_auto?.hold;
    const english = /^(english|eng|en)$/i.test(String(b.language ?? ''));
    const splitOk = b.needs_splitting !== true || b.split_completed === true;
    const share = (ocr) => (b.pages_translated ?? 0) / Math.max(1, ocr - (b.pages_blank ?? 0));
    // After an apply of every page, pages_ocr becomes (at most) every page with an image: use the page count.
    const after = c.pages;
    const lane = held || english || !splitOk || !trust.ok ? null
      : SELF.includes(status) ? 'translate-worker self-dispatch'
      : GAPFILL.includes(status) && share(after) < 0.9 ? 'orchestrator gap-fill' : null;
    rows.push({ id: b.id, label: labelOf(b.id), title: (b.display_title || b.title || '').slice(0, 80), language: b.language, year: b.year ?? null, visible: !!b.visible, provider: b.image_source?.provider ?? null,
      pages: c.pages, with_ocr: c.ocr, with_translation: real.get(b.id) || 0, status, held,
      trust: trust.ok ? 'ok' : (String(trust.reason || '').match(/\(([\w-]+);/)?.[1] || 'refused'), model: getTranslateModelForBook(b),
      share_translated_now: Math.round(100 * share(b.pages_ocr ?? 0)) / 100, share_after_apply: Math.round(100 * share(after)) / 100,
      auto_retranslate_lane: lane, retranslate_pages_if_dispatched: lane ? c.pages : 0 });
  }
  return rows;
}

const census = JSON.parse(fs.readFileSync(arg('greek-census'), 'utf8')).filter((b) => b.kind === 'manuscript');
const cls = JSON.parse(fs.readFileSync(arg('rashi-class'), 'utf8')).books.filter((b) => ['rashi', 'mixed'].includes(b.label));
const censusBy = new Map(census.map((b) => [b.id, b]));
const matchFile = arg('edition-match');
const matched = new Map(matchFile ? JSON.parse(fs.readFileSync(matchFile, 'utf8')).map((b) => [b.id, b.matched || null]) : []);
const greek = (await bookRows(census.map((b) => b.id), () => 'greek-ms')).map((r) => ({ ...r, greek_share: Math.round(100 * (censusBy.get(r.id)?.greek_share_median ?? 0)) / 100, open_edition: matched.get(r.id) ?? null }));
const clsBy = new Map(cls.map((b) => [b.book, b.label]));
const rashi = await bookRows(cls.map((b) => b.book), (id) => clsBy.get(id));
await client.close();

const secs = { greek: Number(arg('secs-greek', 0)) || null, rashi: Number(arg('secs-rashi', 0)) || null };
const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
const summarise = (rows, s) => {
  const vis = rows.filter((r) => r.visible);
  const pages = sum(vis, (r) => r.pages);
  return {
    books: rows.length, visible_books: vis.length, visible_pages: pages,
    visible_pages_with_translation: sum(vis, (r) => r.with_translation),
    trust_refused_books: vis.filter((r) => r.trust !== 'ok').length,
    held_books: vis.filter((r) => r.held).length,
    auto_retranslate_books: vis.filter((r) => r.auto_retranslate_lane).length,
    auto_retranslate_pages: sum(vis, (r) => r.retranslate_pages_if_dispatched),
    full_retranslate_usd_realtime: Math.round(sum(vis, (r) => r.with_translation) * USD_PAGE_REALTIME),
    full_retranslate_usd_batch: Math.round(sum(vis, (r) => r.with_translation) * USD_PAGE_REALTIME / 2),
    cli_days_at_measured_rate: s ? Math.round((pages * s) / 86400 * 10) / 10 : null,
  };
};
const out = { at: new Date().toISOString(), dial: control, usd_page_realtime: USD_PAGE_REALTIME, secs_per_page_wall: secs,
  greek: { summary: summarise(greek, secs.greek), rows: greek }, rashi: { summary: summarise(rashi, secs.rashi), rows: rashi } };
fs.writeFileSync(arg('out', '/dev/stdout'), JSON.stringify(out, null, 1));
// One CSV row per book, both lists, for the issue comment's link.
if (arg('csv')) {
  const cols = ['label', 'id', 'title', 'language', 'year', 'visible', 'provider', 'pages', 'with_ocr', 'with_translation', 'status', 'held', 'trust', 'greek_share', 'open_edition', 'auto_retranslate_lane'];
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.writeFileSync(arg('csv'), [cols.join(','), ...[...greek, ...rashi].map((r) => cols.map((c) => q(r[c])).join(','))].join('\n') + '\n');
}
console.error(JSON.stringify({ dial: control, greek: out.greek.summary, rashi: out.rashi.summary }, null, 1));
