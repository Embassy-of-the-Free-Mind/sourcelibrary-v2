#!/usr/bin/env node
// PRIOR ART: scripts/eval/paired-fifths-8405/run.mjs is the study that chose this design (#8405: 24 of 159 books good
// on 5 pages were bad on 10 paired pages; preregistered bar 5%). Its page judge (the #7866 judgeAbsolute), its join
// judge (joinPrompt, here v2), image fetch and text cleaning are imported, not restated. scripts/maintenance/
// judge-verdicts-to-book-checks.mjs maps route-judge verdicts to book_checks for judged-pages; the page mapping below
// follows it (fidelity <= 3 serious, <= 2 fix). scripts/lib/book-checks.mjs recordPageVerdicts() writes the row.
/**
 * paired-fifths-check v1: the standing Opus check of a book (scripts/eval/methods/paired-fifths-check.md).
 * For each book: the paired-fifths draw (scripts/lib/paired-fifths.mjs, seeded by the book id), every page judged
 * against its image, every break judged with both scans and both texts, one book_checks row.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paired-fifths-check.mjs \
 *        --books=<id,id,...> | --books-file=<file, one id a line>  [--apply] [--max-calls=N] [--concurrency=3] [--out=DIR]
 *
 * Dry run by default: judges (Opus on the subscription, behind the lane-judge pace guard) and prints the rows it
 * would write. --apply writes them. Evidence: scripts/eval/results/paired-fifths-check/<run_id>.json, written either
 * way; commit it with the run. Re-running a run_id resumes from its evidence file and never doubles a row.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { recordPageVerdicts } from '../lib/book-checks.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { pairedFifths, pairedReadingOrder, PAIRED_FIFTHS_VERSION } from '../lib/paired-fifths.mjs';
import { eligiblePage, imageUrl, judgeAbsolute, paceCheck, sha } from './confidence-7866/lib.mjs';
import { opusCall } from './route-judge-6740/judge.mjs';
import { joinPrompt, parseJoin, imageFor, clean, PAGE_PROJECTION } from './paired-fifths-8405/run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const METHOD = { id: 'paired-fifths-check', version: '1' };
const JOIN_VERSION = 2;
const KIND = { carry_over: 'carry_over', duplicated: 'carry_over', wrong_leaf: 'wrong_leaf', dropped: 'omission' };
const STAGE = (layer) => (layer === 'english' ? 'translation' : 'ocr');

/** One page verdict for recordPageVerdicts, from the page judge and the failed joins that name this page. */
export function pageVerdict(page, v, joinDefects) {
  const f = Number(v.fidelity);
  const pageErrors = f <= 3 ? (v.defects || []).filter((d) => d.severity === 'misleads' || d.severity === 'wrong_text')
    .map((d) => ({ stage: 'ocr', ...(d.class ? { class: d.class } : {}), problem: String(d.what ?? d.quote ?? '').slice(0, 300) })) : [];
  const joinErrors = joinDefects.map((d) => ({ stage: STAGE(d.layer), kind: KIND[d.kind], problem: `page break: ${d.kind} — "${String(d.quote ?? '').slice(0, 200)}"` }));
  const errors = [...pageErrors, ...joinErrors];
  const wrongLeaf = joinDefects.some((d) => d.kind === 'wrong_leaf') || (v.defects || []).some((d) => /^I1$/.test(d.class ?? ''));
  const serious = errors.length > 0 || wrongLeaf;
  const page_verdict = f <= 2 || wrongLeaf ? 'fix' : serious ? 'caveat' : 'show';
  return {
    page_id: page.id, outcome: serious ? 'serious' : f >= 5 ? 'clean' : 'minor', page_verdict,
    verdict: `fidelity ${f}${joinDefects.length ? `; page break: ${joinDefects.map((d) => d.kind).join(', ')}` : ''}`,
    note: [v.reader_note, ...joinDefects.map((d) => `Break: ${d.kind} (${d.layer}) "${String(d.quote ?? '').slice(0, 160)}"`)].filter(Boolean).join(' ').slice(0, 1500),
    ...(wrongLeaf ? { wrong_page: true } : {}),
    errors: serious && !errors.length ? [{ stage: 'other', kind: 'wrong_leaf', problem: 'another leaf\'s text' }] : errors,
    defects: v.defects ?? [],
    judged: { ocr: page.ocr?.data ?? '', translation: page.translation?.data ?? '' },
  };
}

async function judgeJoin(lang, a, b) {
  const A = { ocr: clean(a.ocr?.data), tr: clean(a.translation?.data) }, B = { ocr: clean(b.ocr?.data), tr: clean(b.translation?.data) };
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pfc-'));
  try {
    fs.writeFileSync(path.join(ws, 'a.jpg'), await imageFor(a.id, imageUrl(a)));
    fs.writeFileSync(path.join(ws, 'b.jpg'), await imageFor(b.id, imageUrl(b)));
    const prompt = joinPrompt(lang, A, B, { version: JOIN_VERSION });
    const r = await opusCall(prompt, ws);
    return { verdict: r.cls === 'quota' ? null : parseJoin(r.text), cls: r.cls, model: r.model, prompt_sha: sha(prompt).slice(0, 16) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

async function main() {
  const ids = (arg('books') ?? (arg('books-file') ? fs.readFileSync(arg('books-file'), 'utf8') : '')).split(/[\s,]+/).filter(Boolean);
  if (!ids.length) { console.error('usage: --books=<id,...> | --books-file=<file> [--apply]'); process.exit(2); }
  const runId = arg('run-id') ?? `pfc-${new Date().toISOString().slice(0, 10)}-${sha(ids.join(',')).slice(0, 8)}`;
  const evDir = path.resolve(HERE, '..', 'eval', 'results', 'paired-fifths-check');
  const evFile = path.join(evDir, `${runId}.json`);
  const ev = fs.existsSync(evFile) ? JSON.parse(fs.readFileSync(evFile, 'utf8')) : { run_id: runId, method: METHOD, draw: PAIRED_FIFTHS_VERSION, join_prompt_version: JOIN_VERSION, books: {} };
  const save = () => { fs.mkdirSync(evDir, { recursive: true }); fs.writeFileSync(evFile, JSON.stringify(ev, null, 1) + '\n'); };
  const limits = await import('../lib/model-limits.mjs');
  const state = {};
  const maxCalls = Number(arg('max-calls') ?? Infinity);
  let calls = 0, stop = null;
  const report = { books: ids.length, judged: 0, written: 0, already: 0, failed: [] };

  await withMongo(async (db) => {
    for (const bookId of ids) {
      if (stop) break;
      const meta = await db.collection('books').findOne({ $or: [{ id: bookId }, { _id: bookId }] }, { projection: { id: 1, language: 1 } });
      if (!meta) { report.failed.push({ book: bookId, error: 'book not found' }); continue; }
      const all = await db.collection('pages').find({ book_id: bookId }, { projection: PAGE_PROJECTION }).sort({ page_number: 1 }).toArray();
      const byNum = new Map(all.map((p) => [p.page_number, p]));
      const pairs = pairedFifths(all.map((p) => ({ page_number: p.page_number, eligible: eligiblePage(p) })), bookId);
      if (pairs.length < 4) { report.failed.push({ book: bookId, error: `only ${pairs.length} pairs drawable` }); continue; }
      const rec = ev.books[bookId] ?? (ev.books[bookId] = { lang: meta.language ?? 'unknown', pairs, pages: {}, joins: {} });
      // Judge what is missing for this book, pages then breaks; stop cleanly on the pace guard or the call cap.
      const todo = [...pairedReadingOrder(pairs).filter((n) => !rec.pages[n]).map((n) => ({ kind: 'page', n })),
        ...pairs.filter((p) => !rec.joins[`${p.first}/${p.second}`]).map((p) => ({ kind: 'join', p }))];
      for (const t of todo) {
        if (calls >= maxCalls) { stop = `call cap ${maxCalls}`; break; }
        const why = await paceCheck(limits, state);
        if (why) { stop = `pace: ${why}`; break; }
        calls++;
        try {
          if (t.kind === 'page') {
            const p = byNum.get(t.n);
            const r = await judgeAbsolute({ lang: rec.lang, text: p.ocr?.data ?? '' }, await imageFor(p.id, imageUrl(p)));
            if (r.cls === 'quota') { stop = 'quota'; break; }
            if (r.verdict) rec.pages[t.n] = { verdict: r.verdict, ocr_hash: contentHash(p.ocr?.data ?? ''), model: r.model, prompt_sha: r.prompt_sha };
          } else {
            const r = await judgeJoin(rec.lang, byNum.get(t.p.first), byNum.get(t.p.second));
            if (r.cls === 'quota') { stop = 'quota'; break; }
            if (r.verdict) rec.joins[`${t.p.first}/${t.p.second}`] = { verdict: r.verdict, model: r.model, prompt_sha: r.prompt_sha };
          }
        } catch (e) { report.failed.push({ book: bookId, item: t.kind === 'page' ? t.n : `${t.p.first}/${t.p.second}`, error: e.message }); }
        save();
      }
      const order = pairedReadingOrder(pairs);
      if (stop || order.some((n) => !rec.pages[n]) || pairs.some((p) => !rec.joins[`${p.first}/${p.second}`])) continue;
      report.judged++;
      // A page whose text changed since it was judged is left out: the row then covers what was judged.
      const verdicts = [];
      for (const n of order) {
        const p = byNum.get(n);
        if (rec.pages[n].ocr_hash !== contentHash(p.ocr?.data ?? '')) continue;
        const joinDefects = pairs.flatMap((pr) => {
          const j = rec.joins[`${pr.first}/${pr.second}`].verdict;
          const side = pr.first === n ? 'A' : pr.second === n ? 'B' : null;
          return side ? (j.defects || []).filter((d) => d.material === true && KIND[d.kind] && d.page === side) : [];
        });
        verdicts.push(pageVerdict(p, rec.pages[n].verdict, joinDefects));
      }
      const out = await recordPageVerdicts(db, {
        method_id: METHOD.id, method_version: METHOD.version, run_id: runId, checked_at: new Date(),
        selection: 'random', stages: ['ocr', 'translation'],
        reader: { kind: 'model', model: Object.values(rec.pages)[0]?.model ?? 'claude-opus', image_opened: true },
        evidence_path: path.relative(path.resolve(HERE, '..', '..'), evFile),
        reader_warning: true,
        frame: { draw: PAIRED_FIFTHS_VERSION, pairs: pairs.length, join_prompt_version: JOIN_VERSION },
        note: `${verdicts.length} pages (two adjacent pages from each fifth of the book) and ${pairs.length} page breaks read against the page images.`,
        verdicts,
      }, { apply: APPLY });
      report.written += out.inserted; report.already += out.already; report.failed.push(...out.failed);
      if (!APPLY) console.log(JSON.stringify({ book: bookId, verdict: out.rows[0]?.verdict, findings: out.rows[0]?.page_findings?.length }));
    }
  }, { noTimeout: true }); // a run judges many books, 15 calls each; the 300s default killed it after one (#8478)
  save();
  console.log(`${APPLY ? 'APPLY' : 'dry run'} ${runId}: ${report.judged}/${report.books} books fully judged, ${calls} calls; written ${report.written}, already ${report.already}, failed ${report.failed.length}${stop ? `; stopped: ${stop}` : ''}`);
  for (const f of report.failed) console.log(`  FAILED ${JSON.stringify(f)}`);
  if (report.failed.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
