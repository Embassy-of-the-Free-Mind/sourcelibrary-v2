#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/spot-check/served-score.mjs and curation-shelf.mjs write book_checks rows from their own
 * reviewer runs; scripts/eval/confidence-7866/analyze.mjs writes lane_judge_verdicts and never book_checks. Nothing
 * carried a route-judge verdict onto the book a reader opens. This does (#7896).
 *
 * judge-verdicts-to-book-checks — lane_judge_verdicts → book_checks, method judged-pages v1.
 *
 * Takes `kind: item` OCR verdicts whose judged text is still the page's text (write.text_sha = sha256 of the trimmed
 * text, or write.text_hash = contentHash of it, equals the live ocr.data), and writes one book_checks row per book per
 * source run through recordBookCheck(): pages read, the reader, the rule verdict, page_findings for serious pages
 * (fidelity ≤ 3) and page_notes for every page, in the judge's own words. Controls, drafts, translation verdicts and
 * candidate reads that were never written are skipped; so is any page rewritten since it was judged.
 *
 * The evidence, one JSON per source run, goes to scripts/eval/results/judged-pages/<run>.json, and the row cites it,
 * so the checks page may show the judge's sentences (public evidence). Commit that file in the same PR as the rows.
 *
 *   node --env-file=.env.production.local scripts/maintenance/judge-verdicts-to-book-checks.mjs [--run=<run_id>] [--lane=<lane>]
 *       dry run: writes the evidence files, prints what would be recorded
 *   ... --apply   also writes the rows (write-once: a rerun inserts nothing it already holds)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { recordBookCheck, ensureBookCheckIndexes, provenanceFromPage, pageExposure, readMethod } from '../lib/book-checks.mjs';
import { contentHash } from '../lib/write-provenance.mjs';

const METHOD = 'judged-pages';
const SERIOUS_FIDELITY = 3;   // judged-pages.md: fidelity ≤ 3 is a serious page
const FIX_FIDELITY = 2;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(REPO, 'scripts', 'eval', 'results', 'judged-pages');

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const sha16 = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const slug = (s) => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '');

/** The judged text is the live text: either hash convention the verdict writers use. */
export function judgedTextIsLive(write, liveText) {
  if (typeof liveText !== 'string' || !liveText.trim()) return false;
  const want = [write?.text_sha, write?.text_hash].filter(Boolean);
  if (!want.length) return false;
  const have = new Set([sha16(liveText.trim()), sha16(liveText), contentHash(liveText), contentHash(liveText.trim())]);
  return want.some((h) => have.has(h));
}

/** One book's rows from its verdicts (one per page, newest kept). Pure: tests use it without Mongo. */
export function checkFields(verdicts) {
  const pages = [...verdicts].sort((a, b) => a.page_number - b.page_number);
  const fid = (v) => v.verdict.fidelity;
  const serious = pages.filter((v) => fid(v) <= SERIOUS_FIDELITY);
  const page_findings = serious.map((v) => {
    const ds = (v.verdict.defects || []).filter((d) => d.severity !== 'cosmetic' && typeof d.what === 'string' && d.what.trim());
    const wrongPage = ds.some((d) => /^I1\b/.test(String(d.class)));
    const errors = ds.filter((d) => !/^I1\b/.test(String(d.class))).map((d) => ({ stage: 'ocr', ...(d.class ? { class: String(d.class) } : {}), problem: d.what.trim() }));
    // A serious page whose defects are all cosmetic still counts: say so in the judge's words.
    if (!errors.length && !wrongPage) errors.push({ stage: 'ocr', problem: (v.verdict.reader_note || 'The reviewer scored this page low without naming a serious error.').trim() });
    return { page_number: v.page_number, ...(wrongPage ? { wrong_page: true } : {}), errors };
  });
  const page_notes = pages.map((v) => ({
    page_number: v.page_number,
    ...(v.verdict.reader_note?.trim() ? { note: v.verdict.reader_note.trim() } : {}),
    fidelity: fid(v), accepted: !!v.verdict.accept,
    defects: (v.verdict.defects || []).filter((d) => ['cosmetic', 'misleads', 'wrong_text'].includes(d.severity) && typeof d.what === 'string' && d.what.trim())
      .map((d) => ({ severity: d.severity, what: d.what.trim(), ...(d.class ? { class: String(d.class) } : {}), ...(typeof d.quote === 'string' && d.quote.trim() ? { quote: d.quote.trim() } : {}) })),
  }));
  const verdict = pages.some((v) => fid(v) <= FIX_FIDELITY) ? 'fix' : serious.length ? 'caveat' : 'show';
  const classes = [...new Set(serious.flatMap((v) => (v.verdict.defects || []).filter((d) => d.severity !== 'cosmetic' && d.class).map((d) => String(d.class).match(/^[A-Z]\d+/)?.[0] ?? String(d.class))))];
  return { pages_read: pages.map((v) => v.page_number), page_findings, page_notes, verdict, classes };
}

async function main() {
  const method = readMethod(METHOD);
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  try {
    // The route-judge instrument only: it is the one that reads the page image (judged-pages.md, reader and input).
    const q = { kind: 'item', task: { $ne: 'translation' }, 'judge.instrument': 'route-judge-6740 judgePrompt', 'verdict.fidelity': { $type: 'number' } };
    if (arg('lane')) q.lane = arg('lane');
    if (arg('run')) q.run_id = arg('run');
    const verdicts = await db.collection('lane_judge_verdicts').find(q).toArray();
    console.log(`${verdicts.length} item verdicts${arg('lane') ? ` in lane ${arg('lane')}` : ''}${arg('run') ? ` in run ${arg('run')}` : ''}`);

    // Live text of every judged page, by page id (one query per 500 ids).
    const ids = [...new Set(verdicts.map((v) => v.page_id).filter(Boolean))];
    const live = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await db.collection('pages').find({ id: { $in: ids.slice(i, i + 500) } }, {
        projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1,
          'translation.model': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.content_hash': 1 },
      }).toArray();
      for (const r of rows) live.set(r.id, r);
    }

    const skipped = { no_page: 0, rewritten_or_unwritten: 0, soft_hidden: 0, older_duplicate: 0 };
    const runs = new Map();   // run → book → page_number → verdict
    for (const v of verdicts) {
      const page = live.get(v.page_id);
      if (!page) { skipped.no_page++; continue; }
      if (!(page.page_number > 0)) { skipped.soft_hidden++; continue; }
      if (!judgedTextIsLive(v.write, page.ocr?.data)) { skipped.rewritten_or_unwritten++; continue; }
      const run = v.run_id || v.lane;
      if (!runs.has(run)) runs.set(run, new Map());
      const books = runs.get(run);
      if (!books.has(page.book_id)) books.set(page.book_id, new Map());
      const byPage = books.get(page.book_id);
      const prev = byPage.get(page.page_number);
      if (prev && new Date(prev.v.judged_at) >= new Date(v.judged_at)) { skipped.older_duplicate++; continue; }
      if (prev) skipped.older_duplicate++;
      byPage.set(page.page_number, { v, page });
    }
    console.log('skipped:', JSON.stringify(skipped));

    if (APPLY) await ensureBookCheckIndexes(db);
    const tally = { books: 0, inserted: 0, already: 0, show: 0, caveat: 0, fix: 0, no_book: 0 };
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [run, books] of runs) {
      const evidence = { method: `${METHOD} v${method.version}`, source: 'lane_judge_verdicts', run_id: run, written_at: new Date().toISOString(), books: [] };
      const file = join(OUT_DIR, `${slug(run)}.json`);
      const rows = [];
      for (const [bookId, byPage] of books) {
        const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, title: 1 } });
        if (!book) { tally.no_book++; continue; }
        const entries = [...byPage.values()];
        const vs = entries.map(({ v, page }) => ({ ...v, page_number: page.page_number }));
        const f = checkFields(vs);
        const first = vs[0];
        evidence.books.push({ book_id: bookId, title: book.title, pages: vs.map((v) => ({ page_number: v.page_number, page_id: v.page_id, lane: v.lane, route: v.route ?? null, judged_at: v.judged_at, text: v.write?.text_sha || v.write?.text_hash, verdict: v.verdict })) });
        rows.push({
          book_id: bookId,
          checked_at: new Date(Math.max(...vs.map((v) => new Date(v.judged_at).getTime()))),
          method_id: METHOD, method_version: method.version, run_id: run,
          frame: { source: 'lane_judge_verdicts', lanes: [...new Set(vs.map((v) => v.lane))], strata: [...new Set(vs.map((v) => v.draw?.stratum).filter(Boolean))], prompt_sha: first.judge?.prompt_sha ?? null, instrument: first.judge?.instrument ?? null },
          reader: { kind: 'model', model: first.judge?.model_reported || first.judge?.by || 'unrecorded judge', image_opened: true },
          verdict_source: 'rule',
          ...f,
          note: `${f.page_notes.length} page${f.page_notes.length === 1 ? '' : 's'} of stored text judged against the page images; ${f.page_findings.length} at fidelity ≤ ${SERIOUS_FIDELITY}.`,
          text_provenance: entries.map(({ page }) => provenanceFromPage(page, 'live')),
          exposure: await pageExposure(db, bookId, f.pages_read),
          evidence_path: relative(REPO, file),
        });
      }
      writeFileSync(file, JSON.stringify(evidence, null, 1) + '\n');
      console.log(`run ${run}: ${rows.length} books → ${relative(REPO, file)}`);
      for (const row of rows) {
        tally.books++; tally[row.verdict]++;
        if (!APPLY) continue;
        const r = await recordBookCheck(db, row);
        r.inserted ? tally.inserted++ : tally.already++;
      }
    }
    console.log(JSON.stringify(tally));
    if (!APPLY) console.log('DRY RUN: evidence files written, no rows. Commit the evidence, then rerun with --apply.');
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
