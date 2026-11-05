#!/usr/bin/env node
// PRIOR ART: labels.mjs / features.mjs / image.mjs / assemble.mjs in this directory (the same label rules, families and
// table rows: imported, not copied); judged-expand-7263's own scratch (sample.json, key.json, route.jsonl) is its
// output. Nothing else turns that job's verdicts into a book table for a model.
/**
 * The second, later test of #7263 book-grade-model: judged-expand-7263's books (one random page each, judged after this
 * model's features were fixed). Same label rules as labels.mjs, same features; the lexicon and trigram model come from
 * the label books only. Read-only on Mongo (the sample pages and their revisions, paced one book at a time).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/book-grade-7263/expand.mjs
 *     → OUT/expand/{labels,fetch}.json.gz, OUT/expand/table-{pages,books}.json.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, EXPAND, J, W, jsonl, sha256, words, unitOf, pageGradeOf, bandOf, seriousSpans } from './lib.mjs';
import { fetchAll, buildFor } from './features.mjs';
import { imageFeatures } from './image.mjs';
import { textKeysOf, pageRowsOf, bookRowsOf } from './assemble.mjs';

/** Features and table rows for a set of judged pages that no fit has seen: OUT/<dir>/{labels,fetch,table-pages,table-books}. */
export async function buildSet(dir, rows, imgOf = () => null, { refetch = false } = {}) {
  const main = new Set(J('labels.json.gz').rows.map((r) => r.book_id));
  const overlap = rows.filter((r) => main.has(r.book_id)).length;
  if (overlap) throw new Error(`${overlap} ${dir} pages are in label books`);
  W(`${dir}/labels.json.gz`, { built_at: new Date().toISOString(), rows });
  if (refetch || !fs.existsSync(path.join(OUT, dir, 'fetch.json.gz'))) await fetchAll(rows, `${dir}/fetch.json.gz`);
  const F = J(`${dir}/fetch.json.gz`);
  const have = rows.filter((r) => F.books[r.book_id]);
  const { pageFeats, bookMeta } = buildFor(have, { ...F, books: Object.fromEntries(have.map((r) => [r.book_id, F.books[r.book_id]])) });
  const img = {};
  for (const r of have) {
    const f = imgOf(r);
    if (f && fs.existsSync(f)) try { img[r.page_id] = await imageFeatures(f); } catch (e) { console.error(r.page_id, e.message); }
  }
  const TK = textKeysOf(J('feat-pages.json.gz'));
  const pages = pageRowsOf(have, pageFeats, bookMeta, img, TK);
  const books = bookRowsOf(pages, pageFeats, bookMeta, TK);
  W(`${dir}/table-pages.json.gz`, pages);
  W(`${dir}/table-books.json.gz`, books);
  console.log(`${dir}: ${pages.length} pages, ${books.length} books, ${Object.keys(img).length} images; bad books ${books.filter((x) => x.bad).length}`);
}

/** The route-judge label fields, the same as labels.mjs. */
export function labelFields(r) {
  const v = r.verdict;
  r.units = words(r.text, r.lang); r.unit = unitOf(r.lang);
  r.serious = seriousSpans(v); r.fidelity = Number(v.fidelity); r.wrong_page = r.fidelity <= 2;
  r.page_grade = pageGradeOf(v); r.band = bandOf(v); r.many = r.serious >= 3 || r.wrong_page;
  return r;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const sample = J(path.join(EXPAND, 'sample.json'));
  const key = J(path.join(EXPAND, 'key.json'));
  const verdicts = new Map();
  for (const v of jsonl(path.join(EXPAND, 'route.jsonl'))) if (v.verdict) verdicts.set(v.id, v); // the last good row of a retried id

  const why = {};
  const rows = [];
  for (const k of key.filter((x) => x.kind === 'item')) {
    const v = verdicts.get(k.id); const s = sample.find((x) => x.page_id === k.page_id);
    if (!v || !s) { why.unjudged = (why.unjudged ?? 0) + 1; continue; }
    if (sha256(s.stored) !== k.text_sha) { why.text_mismatch = (why.text_mismatch ?? 0) + 1; continue; }
    const r = { study: 'expand', book_id: k.book_id, page_id: k.page_id, page_number: k.page_number, lang: s.language, route: s.model, cell: null,
      script: s.script === 'print' ? 'printed' : s.script === 'manuscript' ? 'handwritten' : (s.script ?? 'unknown'), judged_at: v.at, verdict: v.verdict, text: s.stored, lockbox: false };
    rows.push(labelFields(r));
  }
  console.log(`${rows.length} judged expand pages (${new Set(rows.map((r) => r.book_id)).size} books); skipped`, why);
  await buildSet('expand', rows, (r) => path.join(EXPAND, 'img', `${r.page_id}.jpg`), { refetch: process.argv.includes('--refetch') });
}
