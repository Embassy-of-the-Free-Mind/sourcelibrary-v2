#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/build-pool.mjs — draws the #5729 pool
 * from books with `pages_translated: 0`; that set has moved since (the seeded
 * draw of 2026-10-07 holds 13 of the 40 gold pages), and it has no pool for the
 * translated-books golden set. This script reuses its draw (pool A) and adds the
 * gold books; pool B is new. scripts/eval/librarian-search/run.mjs scores the
 * LIVE store, which cannot hold a re-embedded arm.
 *
 * build-pools — the two retrieval pools for #6170.
 *
 *  A (cross-lingual, gold = scripts/eval/orig-lang-recall/gold.json): the
 *    build-pool.mjs draw at seed 5729 as it comes out today (<dir>/A/draw.jsonl),
 *    plus every gold book the draw no longer holds: up to 60 pages with the same
 *    character floors, the gold page forced in. Text is the cleaned OCR, as in #5729.
 *  B (translated books, gold = scripts/eval/librarian-search/golden-set.json):
 *    every expected book plus DISTRACTORS random live translated books (seed 6170),
 *    PAGES seeded-random translated pages each (>= 300 cleaned chars). Text is the
 *    cleaned English translation, i.e. what production embeds for these pages.
 *
 *   node --env-file=.env.production.local scripts/eval/orig-lang-recall/build-pool.mjs --out <dir>/A && mv <dir>/A/pool.jsonl <dir>/A/draw.jsonl
 *   node --env-file=.env.production.local scripts/eval/embed-format/build-pools.mjs --dir <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { cleanPageText } from '../../lib/page-embedding-text.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { arg, readJsonl, SEED } from './common.mjs';

const DIR = arg('--dir');
const PAGES = Number(arg('--pages', 20));
const DISTRACTORS = Number(arg('--distractors', 300));
if (!DIR) { console.error('--dir required'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const goldA = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries;
const goldB = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries;
const MIN_CHARS = { Latin: 300, German: 300, French: 300, Chinese: 100 };
const rng = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const write = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

await withMongo(async (db) => {
  // ── Pool A ──
  const A = readJsonl(path.join(DIR, 'A/draw.jsonl'));
  const inDraw = new Set(A.map((r) => r.book_id));
  const nowTranslated = [];
  let added = 0;
  for (const q of goldA) {
    if (inDraw.has(q.book_id)) continue;
    inDraw.add(q.book_id);
    const b = await db.collection('books').findOne({ id: q.book_id }, { projection: { id: 1, title: 1, year: 1, pages_translated: 1 } });
    if (b?.pages_translated) nowTranslated.push(q.qid);
    const pages = await db.collection('pages').find({ book_id: q.book_id, page_number: { $gt: 0 }, 'ocr.data': { $exists: true } })
      .project({ page_number: 1, 'ocr.data': 1 }).sort({ page_number: 1 }).toArray();
    const usable = pages.map((p) => ({ page_number: p.page_number, text: cleanPageText(p.ocr?.data) })).filter((p) => p.text.length >= MIN_CHARS[q.lang]);
    const gold = usable.find((p) => p.page_number === q.page_number);
    if (!gold) throw new Error(`${q.qid}: gold page has no usable OCR now`);
    const rest = shuffle(usable.filter((p) => p !== gold)).slice(0, 59);
    for (const p of [gold, ...rest].sort((x, y) => x.page_number - y.page_number)) {
      A.push({ book_id: q.book_id, page_number: p.page_number, lang: q.lang, title: b?.title || q.title || '', year: b?.year ?? null, text: p.text });
      added++;
    }
  }
  const keysA = new Set(A.map((r) => `${r.book_id}:${r.page_number}`));
  const missing = goldA.filter((q) => !keysA.has(`${q.book_id}:${q.page_number}`)).map((q) => q.qid);
  if (missing.length) throw new Error(`gold pages not in pool A: ${missing}`);
  write(path.join(DIR, 'A/pool.jsonl'), A);
  console.log(`A: ${A.length} pages (${added} added for gold books outside today's draw); gold books that now have a translation: ${nowTranslated.join(',') || 'none'}`);

  // ── Pool B ──
  const slugs = [...new Set(goldB.flatMap((q) => q.expected.map((e) => e.book_slug)))];
  const expected = await db.collection('books').find({ slug: { $in: slugs } }).project({ id: 1, slug: 1, title: 1, language: 1 }).sort({ id: 1 }).toArray();
  const expectedIds = new Set(expected.map((b) => b.id));
  const live = await db.collection('books')
    .find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gte: PAGES }, content_type: { $ne: 'artwork' } })
    .project({ id: 1, slug: 1, title: 1, language: 1 }).sort({ id: 1 }).toArray();
  const distract = shuffle(live.filter((b) => !expectedIds.has(b.id))).slice(0, DISTRACTORS);
  const B = [];
  for (const [role, books] of [['expected', expected], ['distractor', distract]]) {
    for (const b of books) {
      const nums = (await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 }, 'translation.data': { $exists: true, $ne: '' } })
        .project({ page_number: 1 }).sort({ page_number: 1 }).toArray()).map((p) => p.page_number);
      // Draw twice the quota, keep the first PAGES that clear the character floor.
      const cand = shuffle([...new Set(nums)]).slice(0, PAGES * 2);
      const docs = await db.collection('pages').find({ book_id: b.id, page_number: { $in: cand } }).project({ page_number: 1, 'translation.data': 1 }).toArray();
      const byNum = new Map(docs.map((p) => [p.page_number, cleanPageText(p.translation?.data)]));
      const kept = cand.filter((n) => (byNum.get(n) || '').length >= 300).slice(0, PAGES).sort((x, y) => x - y);
      for (const n of kept) B.push({ book_id: b.id, slug: b.slug, page_number: n, role, lang: b.language || '', title: b.title || '', text: byNum.get(n) });
    }
  }
  write(path.join(DIR, 'B/pool.jsonl'), B);
  const eb = new Set(B.filter((r) => r.role === 'expected').map((r) => r.book_id)).size;
  console.log(`B: ${B.length} pages; expected books with pages ${eb}/${expected.length} (of ${slugs.length} slugs); distractor books ${new Set(B.filter((r) => r.role === 'distractor').map((r) => r.book_id)).size}`);
}, { timeoutMs: 1_800_000 });
