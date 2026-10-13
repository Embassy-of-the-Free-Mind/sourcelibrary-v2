#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/stray-script-scan.mjs — walks every English translation for stray
 * non-Latin letters; it cannot see a whole page of German or Latin (Latin script), which is the
 * failure here. scripts/audit/language-vs-ocr.mjs — adjudicates `books.language` against OCR
 * tags (source side). The per-page judgement lives in scripts/lib/english-translation-check.mjs.
 *
 * translation-language-label — does a page whose translation is labelled English contain
 * English? (#4937)
 *
 * The ORAEC paginate fallback wrote the German source into `translation.data` as
 * `language: en` on every failed call, for months, and nothing read it back (#4936). This samples
 * pages per book whose `translation.language` claims English (or is absent — the default), runs
 * the stopword/script classifier over the TEXT, and flags books where several sampled pages are
 * not English. READ-ONLY: writes a report, touches no store.
 *
 * Scope:
 *   --oraec            the ORAEC books (`image_source.provider: oraec`), the #4936 incident
 *   --book-ids=a,b     named books
 *   (default)          every book with `pages_translated > 0`, newest first, up to --limit
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/translation-language-label.mjs \
 *     [--oraec | --book-ids=ID,ID] [--limit=N] [--sample=12] [--out=DIR]
 *
 * Output: DIR/books.jsonl (one line per book, checkpointed — a rerun skips books already
 * written) and DIR/flagged.json (the flagged books with their worst pages). Exit 1 when any book
 * is flagged, so a scheduled run can alarm on it.
 *
 * Out of scope: fixing data. A flagged ORAEC book is repaired by re-running the fixed
 * scripts/import/oraec-paginate-translate.mjs on it; anything else goes to a human first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { claimsEnglish, judgeTranslationSample } from '../lib/english-translation-check.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const ORAEC = argv.includes('--oraec');
const BOOK_IDS = arg('book-ids', '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(arg('limit', '2000'), 10);
const SAMPLE = parseInt(arg('sample', '12'), 10);
const OUT = arg('out', `scripts/output/translation-language-label${ORAEC ? '-oraec' : ''}`);
fs.mkdirSync(OUT, { recursive: true });
const BOOKS_OUT = path.join(OUT, 'books.jsonl');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Evenly spaced picks across the book, so front matter cannot fill the sample. */
function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step + step / 2)]);
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
try {
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pagesCol = db.collection('pages');

  let filter;
  if (BOOK_IDS.length) filter = { id: { $in: BOOK_IDS } };
  else if (ORAEC) filter = { 'image_source.provider': 'oraec' };
  else filter = { pages_translated: { $gt: 0 } };
  const targets = await books.find(filter, { projection: { id: 1, title: 1, language: 1 } })
    .sort({ _id: -1 }).limit(BOOK_IDS.length || ORAEC ? 0 : LIMIT).toArray();

  const done = new Set(fs.existsSync(BOOKS_OUT)
    ? fs.readFileSync(BOOKS_OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  log(`${targets.length} books in scope, ${done.size} already in ${BOOKS_OUT}`);

  for (const b of targets) {
    const bid = b.id || String(b._id);
    if (done.has(bid)) continue;
    const meta = await pagesCol.find(
      { book_id: bid, 'translation.data': { $type: 'string', $gt: '' } },
      { projection: { _id: 0, id: 1, page_number: 1, 'translation.language': 1, 'translation.model': 1 } },
    ).sort({ page_number: 1 }).toArray();
    const claimed = meta.filter((p) => claimsEnglish(p.translation?.language));
    const picks = spread(claimed, SAMPLE);
    const texts = picks.length ? await pagesCol.find(
      { id: { $in: picks.map((p) => p.id) } },
      { projection: { _id: 0, id: 1, 'translation.data': 1 } },
    ).toArray() : [];
    const byId = new Map(texts.map((p) => [p.id, p.translation?.data || '']));
    const verdict = judgeTranslationSample(picks.map((p) => byId.get(p.id) || ''));
    const models = {};
    for (const p of claimed) { const m = p.translation?.model || '(none)'; models[m] = (models[m] || 0) + 1; }
    const row = {
      book_id: bid, title: b.title, language: b.language ?? null,
      translated: meta.length, claims_english: claimed.length, models,
      sampled: verdict.sampled, judged: verdict.judged, bad: verdict.bad, share: +verdict.share.toFixed(3),
      detected: verdict.detected, flagged: verdict.flagged,
      pages: picks.map((p, i) => ({
        page: p.page_number, label: p.translation?.language ?? null, model: p.translation?.model ?? null,
        verdict: verdict.pages[i].verdict, detected: verdict.pages[i].detected, words: verdict.pages[i].words,
        english: +verdict.pages[i].english.toFixed(3), top: +verdict.pages[i].top.toFixed(3),
      })),
    };
    fs.appendFileSync(BOOKS_OUT, JSON.stringify(row) + '\n');
    if (row.flagged) log(`FLAG ${bid} ${row.bad}/${row.judged} not English ${JSON.stringify(row.detected)} — ${b.title?.slice(0, 60)}`);
  }

  const all = fs.readFileSync(BOOKS_OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const flagged = all.filter((r) => r.flagged);
  fs.writeFileSync(path.join(OUT, 'flagged.json'), JSON.stringify({
    generated_at: new Date().toISOString(), scope: BOOK_IDS.length ? 'book-ids' : ORAEC ? 'oraec' : `pages_translated>0 limit ${LIMIT}`,
    books: all.length, judged_books: all.filter((r) => r.judged > 0).length, flagged: flagged.length,
    rows: flagged.map(({ pages, ...r }) => ({ ...r, worst: pages.filter((p) => p.verdict === 'not-english' || p.verdict === 'script').slice(0, 5) })),
  }, null, 2));
  log(`${all.length} books, ${all.filter((r) => r.judged > 0).length} with judgeable pages, ${flagged.length} flagged → ${path.join(OUT, 'flagged.json')}`);
  process.exitCode = flagged.length ? 1 : 0;
} finally {
  await client.close();
}
