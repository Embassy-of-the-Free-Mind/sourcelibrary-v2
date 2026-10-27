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
 *   value = 0.5 x demand + 0.5 x importance + first-translation bonus + completion bonus      (Derek 2026-10-27:
 *           demand and importance weigh the same, plus a bonus for first translations)
 *   demand      log-scaled human_read_count (#5048, PR #6809), 30 reading visits = 1
 *   importance  subject tier (v1's tiers), collection membership, language weight (v1's table)
 *   first-translation bonus  0.15 when the book's first-translation status says no English exists
 *   completion bonus         up to 0.2 for books whose remaining work is a small share of the whole
 *   x penalties  0.3 when another edition of the same work_id is already readable in English (only the best edition
 *                goes first); 0.6 for a poor scan (scan_quality.score < 50)
 *   / cost       sqrt(pages of work left / 50), floor 1: a 2,000-page book is not ruled out by forty pamphlets
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
const TIER1 = new Set(['alchemy', 'hermetica', 'kabbalah', 'magic', 'natural-philosophy', 'renaissance-philosophy', 'rosicrucianism']);
const TIER2 = new Set(['astrology', 'mysticism', 'secret-societies', 'demonology', 'classical-philosophy', 'sacred-texts', 'shwep']);
const TIER3 = new Set(['herbalism', 'medicine', 'theology', 'literature', 'art-illustrated', 'music-harmony', 'leonardo-da-vinci']);
const LANGUAGE = { Latin: 20, Greek: 17, Hebrew: 17, Arabic: 16, Aramaic: 15, German: 14, French: 13, Italian: 12, Spanish: 11, Dutch: 10, Portuguese: 9, English: 2, Tibetan: 4, Syriac: 5, "Ge'ez": 5, Geez: 5, Georgian: 5, Javanese: 4, Avestan: 4, Armenian: 6, Sanskrit: 6, Pali: 6 };
// First-translation statuses that say no English translation exists (first-translation-claims.md vocabulary).
const FT_NONE = new Set(['first_no_prior', 'confirmed_first_legacy', 'likely_first', 'first_modern', 'first_complete']);

const subjectOf = (cats = []) => {
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

export function scoreBook(b, w, readableWork) {
  const demand = Math.min(1, Math.log1p(b.human_read_count || 0) / Math.log1p(30));
  const subject = subjectOf(b.categories);
  const inCollection = (b.collections?.length || b.collection_slugs?.length) ? 1 : 0;
  const language = languageOf(b.language);
  const importance = 0.45 * subject + 0.3 * inCollection + 0.25 * language;
  const ft = !w.english && (FT_NONE.has(b.first_translation_status) || b.is_first_translation === true) ? 0.15 : 0;
  const done = w.total ? 1 - w.left / w.total : 0;
  const completion = 0.2 * done;
  let value = 0.5 * demand + 0.5 * importance + ft + completion;
  const dup = b.work_id && readableWork.has(b.work_id) && readableWork.get(b.work_id) !== String(b.id || b._id) ? 0.3 : 1;
  const poorScan = typeof b.scan_quality?.score === 'number' && b.scan_quality.score < 50 ? 0.6 : 1;
  value *= dup * poorScan;
  const cost = Math.sqrt(Math.max(1, w.left / 50));
  const raw = value / cost;
  return { raw, parts: { demand: +demand.toFixed(3), importance: +importance.toFixed(3), subject, inCollection, language: +language.toFixed(2), ft, completion: +completion.toFixed(3), dup, poorScan, cost: +cost.toFixed(2), left: w.left, ocrLeft: w.ocrLeft, trLeft: w.trLeft } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const proj = { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, visible: 1, pages_count: 1, pages_blank: 1, pages_ocr: 1, pages_translated: 1, pages_translatable: 1, human_read_count: 1, categories: 1, collections: 1, collection_slugs: 1, first_translation_status: 1, is_first_translation: 1, work_id: 1, 'scan_quality.score': 1, processing_priority: 1, content_type: 1 };
  const books = [];
  const readableWork = new Map();
  const cur = db.collection('books').find({ pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } }, { projection: proj, batchSize: 5000 });
  for await (const b of cur) {
    const w = workLeft(b);
    if (b.work_id && readable(b, w)) readableWork.set(b.work_id, String(b.id || b._id));
    if (w.left > 0) books.push({ b, w });
  }
  await client.close();

  const scored = books.map(({ b, w }) => ({ b, ...scoreBook(b, w, readableWork) }));
  const max = scored.reduce((m, s) => Math.max(m, s.raw), 0);
  for (const s of scored) s.score = Math.round(Math.min(89, (s.raw / max) * 89) * 10) / 10;
  scored.sort((a, b) => b.score - a.score);

  const row = (s, i) => `| ${i + 1} | ${s.score} | ${s.b.processing_priority ?? '—'} | [${(s.b.display_title || s.b.title || '').slice(0, 60).replace(/\|/g, '/')}](https://sourcelibrary.org/book/${s.b.id || s.b._id}) | ${(s.b.author || '').slice(0, 25).replace(/\|/g, '/')} | ${s.b.language || ''} | ${s.parts.left} | ${s.b.human_read_count || 0} | ${s.parts.inCollection ? 'yes' : ''} | ${s.parts.ft ? 'yes' : ''} | ${s.parts.dup < 1 ? 'dup' : ''} |`;
  const head = '| # | v2 | today | book | author | language | pages left | visits | collection | first tr. | edition |\n|---|---|---|---|---|---|---|---|---|---|---|';
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
