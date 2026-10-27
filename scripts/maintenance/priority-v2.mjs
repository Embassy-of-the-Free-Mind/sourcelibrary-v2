#!/usr/bin/env node
// PRIOR ART: src/lib/processing-priority.ts (scoreBookPriority) — the v1 scorer: 0-100 on subject, language, scan,
// scholarly signal, illustrations and length, computed at import time only, and on the bot-inflated `read_count`
// (#5048). It is TypeScript the scripts cannot import, and it has no demand, cost, completion or edition terms; the
// subject tiers and language weights below are copied from it so v1 and v2 agree where they overlap.
// scripts/maintenance/set-pipeline-priority.mjs — a manual boost for named books, not a ranking.
/**
 * Queue priority v2 (#7502): one value-per-cost score for every book with work left.
 *
 * WHO RUNS IT: a session or a box, read-only by default. It walks `books` once (projection only) and writes a report:
 *   node --env-file=.env.production.local scripts/maintenance/priority-v2.mjs --out=DIR
 * DIR/priority-v2.json (every scored book, ranked) and DIR/priority-v2.md (top 200 visible, top 50 hidden, the
 * distribution, and how the new order differs from today's). Nothing is written to Mongo: applying the score
 * (step 3 of #7502) is a separate change on the hold tier, because it reorders the paid queues.
 *
 * THE SCORE (0-89; 90 and above stays reserved for reader requests and sponsors, which the realtime lane keys on —
 * translate-batch-chained.mjs REALTIME_PRIORITY_FLOOR):
 *   value = 0.5 x demand + 0.5 x importance + first-translation bonus + completion bonus + shelf bonus      (Derek 2026-10-27:
 *           demand and importance weigh the same, plus a bonus for first translations)
 *   demand      log-scaled human_read_count (#5048, PR #6809), 30 reading visits = 1 (an author's visits spill over to
 *               the author's other books at half weight)
 *   shelf bonus scripts/lib/priority-shelves.json: authors and subjects Derek named (Steiner, Goethe, harmony)
 *   importance  subject tier (v1's tiers), collection membership, language weight (v1's table)
 *   first-translation bonus  0.15 when the book's first-translation status says no English exists
 *   completion bonus         up to 0.2 for books whose remaining work is a small share of the whole
 *   x penalties  0.3 when another edition of the same work_id is already readable in English (only the best edition
 *                goes first); 0.6 for a poor scan (scan_quality.score < 50)
 *   / cost       sqrt(pages of work left / 50), floor 1: a 2,000-page book is not ruled out by forty pamphlets
 *                (books on a named shelf, scripts/lib/priority-shelves.json, skip this: a shelf goes whole)
 * Work left = pages still to OCR + (for a non-English edition) pages still to translate, on the ladder's
 * denominators (.claude/docs/translation-state.md: whole = pages_count - pages_blank; translatable =
 * pages_translatable, else whole).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out');
if (!OUT) { console.error('usage: priority-v2.mjs --out=DIR'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

// v1's subject tiers and language weights (src/lib/processing-priority.ts), as fractions.
// v1's tiers named 7 + 7 + 7 slugs; the library's own categories carry many more esoteric ones (2026-10-27 count of
// visible books: hermeticism 1,468, paracelsian 605, theosophy 568, ritual-magic 401, natural-magic 389, ...), which
// v1 scored as "no tier". The additions below are those categories, sorted by the same rule v1 used.
const TIER1 = new Set(['alchemy', 'hermetica', 'kabbalah', 'magic', 'natural-philosophy', 'renaissance-philosophy', 'rosicrucianism',
  'hermeticism', 'paracelsian', 'theosophy', 'anthroposophy', 'christian-theosophy', 'ritual-magic', 'natural-magic', 'jewish-kabbalah',
  'christian-cabala', 'spiritual-alchemy', 'occult-philosophy', 'prisca-theologia', 'theurgy', 'gnosticism', 'esoteric', 'esoterica',
  'occult', 'occultism', 'ars-notoria', 'initiation', 'lullism', 'florentine-platonism']);
const TIER2 = new Set(['astrology', 'mysticism', 'secret-societies', 'demonology', 'classical-philosophy', 'sacred-texts', 'shwep',
  'christian-mysticism', 'divination', 'neoplatonism', 'pythagoreanism', 'freemasonry', 'sufism', 'daoism', 'witchcraft',
  'psychical-research', 'mystery-religions', 'graeco-arabic-transmission', 'cosmology', 'metaphysics']);
const TIER3 = new Set(['herbalism', 'medicine', 'theology', 'literature', 'art-illustrated', 'music-harmony', 'leonardo-da-vinci',
  'astronomy', 'mathematics', 'botany', 'chemistry', 'music', 'music-theory', 'natural-history', 'philosophy', 'early-science',
  'history-of-medicine', 'islamic-science', 'islamic-sciences', 'encyclopedism']);
const SHELVES = JSON.parse(fs.readFileSync(new URL('../lib/priority-shelves.json', import.meta.url), 'utf8'));
const shelfMatchers = SHELVES.shelves.map((s) => ({
  id: s.id,
  authorIds: new Set(s.author_ids || []),
  authorRe: s.author_pattern ? new RegExp(s.author_pattern, 'i') : null,
  cats: new Set(s.categories || []),
  cols: new Set(s.collections || []),
}));
export function shelvesOf(b) {
  const cats = (b.categories || []).map((c) => String(c).toLowerCase());
  return shelfMatchers.filter((m) => m.authorIds.has(b.author_id)
    || (m.authorRe && m.authorRe.test(String(b.author || '')))
    || cats.some((c) => m.cats.has(c))
    || (b.collections || []).some((c) => m.cols.has(c))).map((m) => m.id);
}
const LANGUAGE = { Latin: 20, Greek: 17, Hebrew: 17, Arabic: 16, Aramaic: 15, German: 14, French: 13, Italian: 12, Spanish: 11, Dutch: 10, Portuguese: 9, English: 2, Tibetan: 4, Syriac: 5, "Ge'ez": 5, Geez: 5, Georgian: 5, Javanese: 4, Avestan: 4, Armenian: 6, Sanskrit: 6, Pali: 6 };
// First-translation statuses that say no English translation exists (first-translation-claims.md vocabulary).
const FT_NONE = new Set(['first_no_prior', 'confirmed_first_legacy', 'likely_first', 'first_modern', 'first_complete']);

const subjectOf = (raw = []) => {
  const cats = raw.map((c) => String(c).toLowerCase());
  if (cats.some((c) => TIER1.has(c))) return 1;
  if (cats.some((c) => TIER2.has(c))) return 0.7;
  if (cats.some((c) => TIER3.has(c))) return 0.4;
  return cats.length ? 0.2 : 0.3;
};
const languageOf = (lang) => {
  const first = String(lang || '').split(/[,;/&]| and /)[0].trim();
  const key = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return (LANGUAGE[key] ?? 12) / 20;
};
const isEnglish = (lang) => /^english\b/i.test(String(lang || '').trim());

export function workLeft(b) {
  const whole = Math.max(0, (b.pages_count || 0) - (b.pages_blank || 0));
  const ocrLeft = Math.max(0, whole - (b.pages_ocr || 0));
  const english = isEnglish(b.language);
  const translatable = b.pages_translatable ?? whole;
  const trLeft = english ? 0 : Math.max(0, translatable - (b.pages_translated || 0));
  const total = whole + (english ? 0 : translatable);
  return { whole, ocrLeft, trLeft, left: ocrLeft + trLeft, total, english };
}
// Readable in English: an English edition fully OCR'd, or a translation at the ladder's 90% bar.
const readable = (b, w) => (w.english ? w.ocrLeft <= 0.1 * w.whole : (b.pages_translated || 0) >= 0.9 * ((b.pages_translatable ?? w.whole) || 1) && w.ocrLeft <= 0.1 * w.whole);

export function scoreBook(b, w, readableWork, authorReads = new Map()) {
  // An author's readers spill over to the author's other books at half weight.
  const reads = Math.max(b.human_read_count || 0, 0.5 * (authorReads.get(b.author_id) || 0));
  const demand = Math.min(1, Math.log1p(reads) / Math.log1p(30));
  const shelves = shelvesOf(b);
  const shelf = shelves.length ? SHELVES.bonus : 0;
  const subject = subjectOf(b.categories);
  const inCollection = (b.collections?.length || b.collection_slugs?.length) ? 1 : 0;
  const language = languageOf(b.language);
  const importance = 0.45 * subject + 0.3 * inCollection + 0.25 * language;
  const ft = !w.english && (FT_NONE.has(b.first_translation_status) || b.is_first_translation === true) ? 0.15 : 0;
  const done = w.total ? 1 - w.left / w.total : 0;
  const completion = 0.2 * done;
  let value = 0.5 * demand + 0.5 * importance + ft + completion + shelf;
  const dup = b.work_id && readableWork.has(b.work_id) && readableWork.get(b.work_id) !== String(b.id || b._id) ? 0.3 : 1;
  const poorScan = typeof b.scan_quality?.score === 'number' && b.scan_quality.score < 50 ? 0.6 : 1;
  value *= dup * poorScan;
  // A named shelf goes whole: its books skip the size penalty (Derek 2026-10-27 wanted Steiner and Goethe high; with
  // the penalty, the Divan's 1,095 pages put it behind ~2.1M pages of smaller books).
  const cost = shelf ? 1 : Math.sqrt(Math.max(1, w.left / 50));
  const raw = value / cost;
  return { raw, parts: { demand: +demand.toFixed(3), importance: +importance.toFixed(3), subject, inCollection, language: +language.toFixed(2), ft, completion: +completion.toFixed(3), shelves, dup, poorScan, cost: +cost.toFixed(2), left: w.left, ocrLeft: w.ocrLeft, trLeft: w.trLeft } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const proj = { id: 1, title: 1, display_title: 1, author: 1, author_id: 1, language: 1, published: 1, visible: 1, pages_count: 1, pages_blank: 1, pages_ocr: 1, pages_translated: 1, pages_translatable: 1, human_read_count: 1, categories: 1, collections: 1, collection_slugs: 1, first_translation_status: 1, is_first_translation: 1, work_id: 1, 'scan_quality.score': 1, processing_priority: 1, content_type: 1 };
  const books = [];
  const readableWork = new Map();
  const authorReads = new Map();
  const cur = db.collection('books').find({ pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } }, { projection: proj, batchSize: 5000 });
  for await (const b of cur) {
    const w = workLeft(b);
    if (b.author_id && b.human_read_count) authorReads.set(b.author_id, (authorReads.get(b.author_id) || 0) + b.human_read_count);
    if (b.work_id && readable(b, w)) readableWork.set(b.work_id, String(b.id || b._id));
    if (w.left > 0) books.push({ b, w });
  }
  let scored = books.map(({ b, w }) => ({ b, w, ...scoreBook(b, w, readableWork, authorReads) }));

  // THE HEAD, TRIED VS NEVER TRIED. A page with an `ocr` object but no text was read and failed (refused, cut,
  // looped): it is the refused-pages fallback lane's work (ocr-routing-table.json `refused-pages`), not the bulk
  // lanes'. The flags (ocr.fail_blocked, ocr.recitation_blocked) miss most of them (`ocr: {}` carries none), and a
  // corpus-wide scan of `pages` exceeds 5 minutes, so only the head is checked, book by book on the book_id index.
  scored.sort((a, b) => b.raw - a.raw);
  const HEAD = Number(arg('head') || 5000);
  for (const s of scored.slice(0, HEAD)) {
    const unread = await db.collection('pages').find(
      { book_id: String(s.b.id || s.b._id), page_number: { $gt: 0 }, 'ocr.data': { $in: [null, ''] } },
      { projection: { _id: 0, ocr: 1 } },
    ).toArray();
    const failed = unread.filter((p) => p.ocr && typeof p.ocr === 'object').length;
    if (!failed) continue;
    const w = { ...s.w, ocrLeft: Math.max(0, s.w.ocrLeft - failed) };
    w.left = w.ocrLeft + w.trLeft;
    Object.assign(s, scoreBook(s.b, w, readableWork, authorReads));
    s.parts.failed = failed;
    s.fallbackOnly = w.left === 0;
  }
  await client.close();
  scored = scored.filter((s) => !s.fallbackOnly);
  const fallback = books.length - scored.length;
  const max = scored.reduce((m, s) => Math.max(m, s.raw), 0);
  for (const s of scored) s.score = Math.round(Math.min(89, (s.raw / max) * 89) * 10) / 10;
  scored.sort((a, b) => b.score - a.score);

  const row = (s, i) => `| ${i + 1} | ${s.score} | ${s.b.processing_priority ?? '—'} | [${(s.b.display_title || s.b.title || '').slice(0, 60).replace(/\|/g, '/')}](https://sourcelibrary.org/book/${s.b.id || s.b._id}) | ${(s.b.author || '').slice(0, 25).replace(/\|/g, '/')} | ${s.b.language || ''} | ${s.parts.left} | ${s.b.human_read_count || 0} | ${s.parts.inCollection ? 'yes' : ''} | ${s.parts.ft ? 'yes' : ''} | ${s.parts.dup < 1 ? 'dup' : ''} | ${(s.parts.shelves || []).join(', ')} |`;
  const head = '| # | v2 | today | book | author | language | pages left | visits | collection | first tr. | edition | shelf |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
  const vis = scored.filter((s) => s.b.visible === true);
  const hid = scored.filter((s) => s.b.visible !== true);
  const band = (arr) => { const c = {}; for (const s of arr) { const k = s.score >= 60 ? '60-89' : s.score >= 40 ? '40-59' : s.score >= 20 ? '20-39' : s.score >= 10 ? '10-19' : '<10'; c[k] = c[k] || { books: 0, left: 0 }; c[k].books++; c[k].left += s.parts.left; } return c; };
  const top1k = vis.slice(0, 1000);
  const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
  const md = [
    `# Queue priority v2, dry run (#7502), ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Books with work left: ${scored.length.toLocaleString()} (visible ${vis.length.toLocaleString()}, hidden ${hid.length.toLocaleString()}). Pages of work left: visible ${sum(vis, (s) => s.parts.left).toLocaleString()}, hidden ${sum(hid, (s) => s.parts.left).toLocaleString()}. Nothing written.`,
    '',
    `Head check (top ${HEAD.toLocaleString()} by score): ${fallback.toLocaleString()} books have only tried-and-failed pages left and leave this list for the refused-pages fallback lane; ${scored.filter((s) => s.parts.failed).length.toLocaleString()} more had failed pages taken out of their work left. Below the head, failed pages are still counted as work.`,
    '',
    `Visible top 1,000: ${sum(top1k, (s) => s.parts.left).toLocaleString()} pages of work; ${top1k.filter((s) => s.b.human_read_count).length} have reader visits, ${top1k.filter((s) => s.parts.inCollection).length} are in a collection, ${top1k.filter((s) => s.parts.ft).length} have no English translation anywhere, ${top1k.filter((s) => s.b.processing_priority == null).length} have no priority today.`,
    '',
    '## Distribution (visible)', '', '| band | books | pages left |', '|---|---|---|',
    ...Object.entries(band(vis)).sort().reverse().map(([k, v]) => `| ${k} | ${v.books.toLocaleString()} | ${v.left.toLocaleString()} |`),
    '', '## Top 200 visible', '', head, ...vis.slice(0, 200).map(row),
    '', '## Top 50 hidden', '', head, ...hid.slice(0, 50).map(row), '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'priority-v2.md'), md);
  fs.writeFileSync(path.join(OUT, 'priority-v2.json'), JSON.stringify(scored.map((s) => ({ id: String(s.b.id || s.b._id), visible: s.b.visible === true, score: s.score, today: s.b.processing_priority ?? null, ...s.parts })), null, 0));
  console.log(`scored ${scored.length} books (visible ${vis.length}); report ${path.join(OUT, 'priority-v2.md')}`);
}
