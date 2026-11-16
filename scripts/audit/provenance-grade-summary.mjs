#!/usr/bin/env node
/**
 * provenance-grade-summary.mjs — per book and field, how many pages carry each provenance grade, by
 * month written, and how many of the call-log-checked ones are corroborated (sourcelibrary-v3 #201).
 *
 * PRIOR ART: scripts/audit/provenance-grades.mjs — the grader (PR #210); this script imports its
 *   gradeField / corroborate / needsCorroboration / RECORD_PROJECT and copies none of them. That
 *   script grades a random SAMPLE and has no write path; this one walks every book and writes the
 *   counts. scripts/audit/provenance-ledger.mjs — the ai-partners rates, from a sample, no per-book
 *   rows. scripts/audit/provenance-coverage.mjs — the daily check of NEW writes, not a grade.
 *
 * Why a summary and not a table of grades: the grade is a pure function of the page record and the
 * call log, so a page's grade is computed where it is read (the dataset export,
 * src/lib/provenance-grade.ts — the TS twin of the grader). What cannot be computed on read is the
 * aggregate ("how well recorded is this book / this month"), and that is what this stores. Derek
 * approved this shape over a 46-million-row per-page table on 2026-11-13 (#201).
 *
 * Writes ONE collection, `provenance_grade_summary`: one row per book × field
 *   { book_id, field, pages, grades: { <grade>: n }, corroboration: { <grade>: { checked, corroborated } },
 *     months: { 'YYYY-MM': { n, <grade>: n, <grade>_corroborated: n } }, contradictions, pages_in_book,
 *     grader, run_id, built_at }
 * unique on { book_id, field }. A rebuild replaces a book's rows whole (replaceOne upsert per field,
 * delete the field it no longer has). After a COMPLETE run with no errors, rows from earlier runs
 * (books gone, or no text left) are removed. Never writes pages, books, gemini_usage or batch_jobs.
 *
 * The call log it corroborates against is the one the export reads, so a page's grade on read agrees
 * with the count it contributed here: the page's batch job (all of batch_jobs, read once, keyed id /
 * job_name / gemini_job_name / _id; one job can cover many books), and Mongo gemini_usage rows of the
 * page's book in the time window. Not
 * Supabase gemini_usage: it names jobs, never pages, and corroborated 0 pages of the 60,000-page dry
 * run (#201); its rows older than 90 days are moved monthly to gemini_usage_archive (pg_cron
 * gemini_usage_archive_run), not deleted. `cross_book_jobs` counts pages whose batch job is filed
 * under another book (the export finds those by id, not by book).
 *
 *   node --env-file=.env.production.local scripts/audit/provenance-grade-summary.mjs            # dry run: counts only
 *   node --env-file=.env.production.local scripts/audit/provenance-grade-summary.mjs --apply    # write the summary
 *     --books=N         first N books only (a partial run never removes old rows)
 *     --book=ID         one book (repeatable)
 *     --concurrency=8   books in flight
 *     --json=FILE       totals, timings, errors
 *
 * Exit 0 = done. Exit 2 = a book failed to read or write (its old rows stay; no stale-row cleanup).
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gradeField, corroborate, needsCorroboration, writtenAt, RECORD_PROJECT, GRADES, GRADER_VERSION } from './provenance-grades.mjs';

export const COLLECTION = 'provenance_grade_summary';
const D = 86400e3;

/** Fold a book's graded rows into its summary rows (one per field). Pure. */
export function summarize(bookId, graded, { pagesInBook, runId, builtAt }) {
  const rows = {};
  for (const { g, c } of graded) {
    const r = (rows[g.field] ??= { book_id: bookId, field: g.field, pages: 0, grades: {}, corroboration: {}, months: {}, contradictions: 0 });
    r.pages++;
    r.grades[g.grade] = (r.grades[g.grade] || 0) + 1;
    const m = (r.months[g.month] ??= { n: 0 });
    m.n++;
    m[g.grade] = (m[g.grade] || 0) + 1;
    if (c) {
      const k = (r.corroboration[g.grade] ??= { checked: 0, corroborated: 0 });
      k.checked++;
      if (c.corroborated) { k.corroborated++; m[`${g.grade}_corroborated`] = (m[`${g.grade}_corroborated`] || 0) + 1; }
      if (c.contradictions.length) r.contradictions++;
    }
  }
  return Object.values(rows).map((r) => ({ ...r, pages_in_book: pagesInBook, grader: GRADER_VERSION, run_id: runId, built_at: builtAt }));
}

/** Key every batch_jobs row by id / job_name / gemini_job_name / _id (the grader's lookup). */
export function jobsByKey(jobs) {
  const all = new Map();
  for (const j of jobs) for (const k of [j.id, j.job_name, j.gemini_job_name, String(j._id)]) if (k) all.set(k, j);
  return all;
}

/** Grade one book: its pages (index book_id+page_number), its gemini_usage in the window (index book_id+timestamp). */
export async function gradeBook(db, bookId, jobs, stats) {
  const pages = await db.collection('pages').aggregate([{ $match: { book_id: bookId } }, RECORD_PROJECT], { maxTimeMS: 300000 }).toArray();
  const graded = [];
  for (const p of pages) for (const [f, has] of [['ocr', p.has_ocr], ['translation', p.has_tr]]) {
    const g = gradeField(f, p[f], { has });
    if (g) graded.push({ p, g, c: null });
  }
  const needs = graded.filter((x) => needsCorroboration(x.g));
  if (needs.length) {
    let min = null, max = null;
    for (const { p, g } of needs) { const { at } = writtenAt(p[g.field]); if (!at) continue; if (!min || at < min) min = at; if (!max || at > max) max = at; }
    let usage = [];
    if (min) {
      usage = await db.collection('gemini_usage').find(
        { book_id: bookId, timestamp: { $gte: new Date(+min - 30 * D), $lte: new Date(+max + 3 * D) }, type: { $in: ['ocr', 'spread-ocr', 'translation', 'translate'] } },
        { projection: { id: 1, type: 1, model: 1, mode: 1, timestamp: 1, batch_job_id: 1, endpoint: 1, page_ids: 1 }, maxTimeMS: 120000 },
      ).toArray();
      stats.usage_rows += usage.length;
      stats.usage_books++;
    }
    const usageByJob = new Map();
    for (const u of usage) if (u.batch_job_id) (usageByJob.get(u.batch_job_id) ?? usageByJob.set(u.batch_job_id, []).get(u.batch_job_id)).push(u);
    for (const x of needs) {
      const sub = x.p[x.g.field];
      x.c = corroborate(x.g.field, sub, [x.p.id, String(x.p._id)], { jobs, usage, usageByJob });
      const j = sub?.batch_job_id && jobs.get(sub.batch_job_id);
      if (j && j.book_id !== bookId) stats.cross_book_jobs++;
    }
  }
  return { graded, pagesInBook: pages.length };
}

async function main() {
  const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
  const APPLY = process.argv.includes('--apply');
  const LIMIT = Number(arg('books', 0));
  const ONLY = process.argv.filter((a) => a.startsWith('--book=')).map((a) => a.slice(7));
  const CONC = Number(arg('concurrency', 8));
  const JSON_OUT = arg('json', null);
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); return 2; }
  const { MongoClient } = await import('mongodb');
  // zlib wire compression: the page records are most of the egress (import-cost-and-egress.md).
  const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 600000, compressors: ['zlib'] });
  const db = client.db('bookstore');
  const runId = `pgs-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  const builtAt = new Date();
  const T0 = Date.now();
  const out = { run_id: runId, apply: APPLY, grader: GRADER_VERSION, started_at: builtAt.toISOString() };
  const stats = { books: 0, books_with_rows: 0, rows: 0, pages: 0, graded: 0, usage_rows: 0, usage_books: 0, cross_book_jobs: 0, month_cells: 0, errors: [] };
  const totals = {};
  try {
    const coll = db.collection(COLLECTION);
    if (APPLY) await coll.createIndex({ book_id: 1, field: 1 }, { unique: true, name: 'book_field_unique' });

    const jobs = await db.collection('batch_jobs').find({}, { projection: { id: 1, job_name: 1, gemini_job_name: 1, type: 1, model: 1, created_at: 1, completed_at: 1, updated_at: 1, book_id: 1 } }).maxTimeMS(300000).toArray();
    const allJobs = jobsByKey(jobs);
    out.batch_jobs = jobs.length;

    let books = ONLY.length ? ONLY : (await db.collection('pages').distinct('book_id', {}, { maxTimeMS: 600000 })).filter((b) => typeof b === 'string' && b).sort();
    out.books_with_pages = books.length;
    if (LIMIT) books = books.slice(0, LIMIT);
    const partial = ONLY.length > 0 || LIMIT > 0;
    console.log(`${runId}: ${books.length} books, ${jobs.length} batch_jobs, ${APPLY ? 'APPLY' : 'dry run'}${partial ? ' (partial)' : ''}`);

    let next = 0, lastLog = Date.now();
    const worker = async () => {
      while (next < books.length) {
        const b = books[next++];
        try {
          const { graded, pagesInBook } = await gradeBook(db, b, allJobs, stats);
          const rows = summarize(b, graded, { pagesInBook, runId, builtAt });
          stats.books++; stats.pages += pagesInBook; stats.graded += graded.length;
          if (rows.length) stats.books_with_rows++;
          stats.rows += rows.length;
          for (const r of rows) {
            stats.month_cells += Object.keys(r.months).length;
            const t = (totals[r.field] ??= { pages: 0, grades: {}, corroboration: {} });
            t.pages += r.pages;
            for (const [g, n] of Object.entries(r.grades)) t.grades[g] = (t.grades[g] || 0) + n;
            for (const [g, k] of Object.entries(r.corroboration)) { const x = (t.corroboration[g] ??= { checked: 0, corroborated: 0 }); x.checked += k.checked; x.corroborated += k.corroborated; }
          }
          if (APPLY) {
            const ops = rows.map((r) => ({ replaceOne: { filter: { book_id: b, field: r.field }, replacement: r, upsert: true } }));
            ops.push({ deleteMany: { filter: { book_id: b, field: { $nin: rows.map((r) => r.field) } } } });
            await coll.bulkWrite(ops, { ordered: true });
          }
        } catch (e) {
          stats.errors.push({ book_id: b, error: e.message });
          console.error(`book ${b}: ${e.message}`);
        }
        if (Date.now() - lastLog > 60000) {
          lastLog = Date.now();
          const s = (Date.now() - T0) / 1000;
          console.log(`  ${stats.books}/${books.length} books, ${stats.pages} pages, ${stats.rows} rows, ${Math.round(stats.pages / s)} pages/s, ${Math.round(s)} s, errors ${stats.errors.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));

    if (APPLY && !partial && stats.errors.length === 0) {
      const del = await coll.deleteMany({ run_id: { $ne: runId } });
      out.stale_rows_removed = del.deletedCount;
    } else if (APPLY) out.stale_rows_removed = `skipped (${partial ? 'partial run' : `${stats.errors.length} errors`})`;
    if (APPLY) {
      const s = await db.command({ collStats: COLLECTION });
      out.collection = { count: s.count, size_bytes: s.size, storage_bytes: s.storageSize, index_bytes: s.totalIndexSize, avg_obj_bytes: s.avgObjSize };
    }
  } catch (e) {
    stats.errors.push({ error: e.message });
    console.error(`could not build: ${e.message}`);
  }
  out.secs = Math.round((Date.now() - T0) / 1000);
  out.stats = { ...stats, errors: stats.errors.length, error_sample: stats.errors.slice(0, 20) };
  out.totals = totals;
  await client.close();
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, totals: undefined }, null, 1));
  for (const [f, t] of Object.entries(totals)) {
    console.log(`\n${f}: ${t.pages} pages`);
    for (const g of GRADES) if (t.grades[g]) console.log(`  ${g.padEnd(17)} ${String(t.grades[g]).padStart(10)}${t.corroboration[g] ? `   corroborated ${t.corroboration[g].corroborated}/${t.corroboration[g].checked}` : ''}`);
  }
  return stats.errors.length ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
