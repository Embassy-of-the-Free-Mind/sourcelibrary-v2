#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/build-pool.mjs — the same seeded
 * book/page draw, but over UNTRANSLATED books and OCR text only; here every page
 * needs BOTH texts (OCR and the stored translation) and the vector production
 * already holds, so it is a different query against different stores.
 * scripts/eval/librarian-search/ — the golden set this pool is built for; it
 * only ever ran against the live index, which a model with no stored vectors
 * cannot be scored on.
 *
 * build-pool-t — the translated-page pool for #6172 (gold sets B and C).
 *
 *   - Every book named in librarian-search/golden-set.json (visible or not; the
 *     set names them), up to EXPECTED_PAGES pages each.
 *   - Seeded distractor books: live translated books (pages_translated >= 30) by
 *     language, up to DISTRACTOR_PAGES pages each.
 *   - A page qualifies only if production holds a vector for it in
 *     page_translations and its text is >= 300 cleaned chars.
 *
 * Per page it records the two texts the dual-vector arm needs:
 *   trans — EXACTLY what the stored vector was made from: the stored
 *           `translation` column (cut at 8,000 like the embedder), or, when that
 *           column is empty, the cleaned OCR (pageEmbeddingInput's fallback).
 *   ocr   — the cleaned OCR (cleanPageText), what an original-language vector
 *           would be made from.
 * and the stored vector itself (vec-t-gemini-trans.jsonl), read, never written.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-models/build-pool-t.mjs --out /root/claude-jobs/embed-models-eval
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { withMongo } from '../../lib/mongo.mjs';
import { cleanPageText } from '../../lib/page-embedding-text.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const OUT = arg('--out');
const SEED = Number(arg('--seed', 6172));
const EXPECTED_PAGES = 40;
const DISTRACTOR_PAGES = 60;
const MIN_CHARS = 300;
const DISTRACTORS = { Latin: 50, German: 35, French: 12, Italian: 10, English: 13 };
if (!OUT) { console.error('--out DIR required'); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries;
const expectedSlugs = [...new Set(golden.flatMap((q) => q.expected.map((e) => e.book_slug)))];

const rng = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await sb.connect();
await sb.query('SET statement_timeout = 600000');

await withMongo(async (db) => {
  const proj = { id: 1, slug: 1, title: 1, language: 1 };
  const expected = await db.collection('books').find({ slug: { $in: expectedSlugs } }).project(proj).toArray();
  console.log(`expected books: ${expected.length} of ${expectedSlugs.length} slugs found`);
  const expectedIds = new Set(expected.map((b) => b.id));
  const books = expected.map((b) => ({ ...b, role: 'expected', cap: EXPECTED_PAGES }));
  for (const [lang, n] of Object.entries(DISTRACTORS)) {
    const all = await db.collection('books')
      .find({ visible: true, pages_count: { $gt: 0 }, language: lang, pages_translated: { $gte: 30 }, content_type: { $ne: 'artwork' } })
      .project(proj).sort({ id: 1 }).toArray();
    const pick = shuffle(all.filter((b) => !expectedIds.has(b.id))).slice(0, n);
    books.push(...pick.map((b) => ({ ...b, role: 'distractor', cap: DISTRACTOR_PAGES })));
  }

  const pool = [];
  const vecs = [];
  for (const b of books) {
    const { rows: stored } = await sb.query(
      'SELECT page_number, translation FROM page_translations WHERE book_id = $1 AND embedding IS NOT NULL',
      [b.id],
    );
    if (!stored.length) { console.log(`  no stored vectors: ${b.slug}`); continue; }
    const storedBy = new Map(stored.map((r) => [r.page_number, r.translation || '']));
    const pages = await db.collection('pages')
      .find({ book_id: b.id, page_number: { $in: [...storedBy.keys()] } })
      .project({ page_number: 1, 'ocr.data': 1 })
      .toArray();
    const usable = [];
    for (const p of pages) {
      const ocr = cleanPageText(p.ocr?.data);
      const st = storedBy.get(p.page_number);
      const trans = st ? cleanPageText(st) : ocr;
      if (trans.length < MIN_CHARS || ocr.length < MIN_CHARS) continue;
      usable.push({ page_number: p.page_number, trans, ocr, translated: Boolean(st) });
    }
    usable.sort((x, y) => x.page_number - y.page_number);
    const chosen = shuffle(usable).slice(0, b.cap).sort((x, y) => x.page_number - y.page_number);
    if (!chosen.length) { console.log(`  no usable pages: ${b.slug}`); continue; }
    const { rows: ev } = await sb.query(
      'SELECT page_number, embedding::text AS e FROM page_translations WHERE book_id = $1 AND page_number = ANY($2)',
      [b.id, chosen.map((p) => p.page_number)],
    );
    const eBy = new Map(ev.map((r) => [r.page_number, r.e]));
    for (const p of chosen) {
      // A concurrent writer can null a row between the two reads; skip it.
      const v = JSON.parse(eBy.get(p.page_number) ?? 'null');
      if (!Array.isArray(v)) continue;
      const n = Math.hypot(...v) || 1;
      vecs.push({ i: pool.length, v: v.map((x) => x / n) });
      pool.push({ book_id: b.id, slug: b.slug, role: b.role, lang: b.language, title: b.title || '', ...p });
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pool-t.jsonl'), pool.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'vec-t-gemini-trans.jsonl'), vecs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const by = (k) => pool.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  console.log(`pool-t: ${pool.length} pages, ${new Set(pool.map((r) => r.book_id)).size} books`, by('role'), by('lang'), `translated ${pool.filter((r) => r.translated).length}`);
}, { timeoutMs: 1_800_000 });
await sb.end();
