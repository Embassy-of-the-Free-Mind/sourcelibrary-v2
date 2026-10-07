/**
 * PRIOR ART: scripts/maintenance/reread-loop-pages.mjs and scripts/batch/bulk-reocr-local.mjs —
 * the REST Batch-API shape copied here (resumable JSONL upload, batchGenerateContent, results
 * file download, input deleted after create, usage priced at submit). Neither enriches: both
 * write OCR. scripts/batch/batch-generate-indexes.mjs and batch-extract-chapters.mjs are older
 * realtime copies of Phase 6/7 with their own prompts. batch-collector.mjs is page-oriented and
 * REFUSES unknown `batch_jobs` types (#3725), so enrich jobs are tracked in their own
 * collections rather than taught to it.
 *
 * enrich-batch-lane — enrich-worker Phase 6 (summary + index) and Phase 7 (chapters) through the
 * Gemini Batch API, at half the realtime price (#2141). Called from enrich-worker.mjs --batch.
 *
 * THE SAME ENRICHER, A DIFFERENT TRANSPORT. Every prompt, parse and write is the worker's own
 * function, passed in as `phases`: buildIndexBatchPrompt / parseIndexBatchResponse,
 * buildBookSummaryRequest / parseBookSummaryResponse, finishEnrichBook, prepareChapterExtraction /
 * applyChapterExtraction. A book enriched here is written exactly as the realtime path writes it.
 *
 * THREE ROUNDS, because each depends on the last:
 *   index     one request per page batch (the map step)          → extractions stored per book
 *   summary   one request per book over its extractions (reduce)  → finishEnrichBook writes it all
 *   chapters  one request per book; reads the sectionSummaries the summary round just wrote
 * Each invocation: collect finished jobs → admit new books (index round, or straight to chapters
 * when only chapters are missing) → advance collected books to their next round.
 *
 * WHICH BOOKS. Selected by MISSING OUTPUT, not by status: the gap on #2141 is books already past
 * translate_complete (3,856 of 5,438 at `complete`), which the status-driven realtime lane never
 * sees again. Books IN that lane's statuses are left to it, so the two never pay twice. Held books
 * (status + NOT_HELD marker), books with any withheld translation (#4523/#4757 — the derived lane
 * waits for retranslation) and bad-read flags are excluded, and re-checked at write time because a
 * batch can sit for hours. Priority: reader views, then translated pages.
 *
 * MONEY. Admission prices every round of a book up front (index from its real prompt text, summary
 * and chapters from measured ratios) and stops at `maxUsd` for the run. Every submitted job writes a
 * gemini_usage row per book AT SUBMIT with that estimate (#4567 — the dial must see committed
 * spend), and completeBatchUsage replaces it with the billed tokens at collect. Collecting is free
 * and runs even when the dial is closed; submitting needs `dispatchAllowed`.
 *
 * Status is never written: a book here is already past Phase 6/7's statuses, or not selected.
 */
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';
import { createThenDeleteInput } from '../../lib/gemini-batch-input-file.mjs';
import { logUsage, completeBatchUsage, calculateUsageCost, outputTokensFrom } from './supabase-usage-logger.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const ENDPOINT = 'worker/hetzner-enrich-batch';
export const BOOKS_COLL = 'enrich_batch_books';
export const JOBS_COLL = 'enrich_batch_jobs';

/** Statuses owned by the realtime lane (or a hold): never admitted here. */
export const REALTIME_LANE_STATUSES = ['translate_complete', 'summarizing', 'summary_indexed', 'chapters', 'held', 'loop_quarantine_hold'];
/** Same floor as the realtime Phase 7 (< 10 pages → no chapters). */
export const MIN_CHAPTER_PAGES = 10;
/** A book whose rounds have failed this many times is not re-admitted by a sweep. */
export const MAX_ATTEMPTS = 2;
const MAX_JOB_BYTES = 150 * 1024 * 1024;

// Output-token estimates per request, from 60 days of worker/hetzner-enrich usage rows
// (2026-10-07): index 0.0645 out/in, summary 1,335 out, chapters 781 out. Rounded up.
const EST = {
  indexOutPerIn: 0.08, indexOutMin: 300, indexOutMax: 2000,
  summaryIn: 4500, summaryOut: 1500,
  chaptersOut: 900, chaptersInPerPage: 62, chaptersInBase: 1500,
};
const tokensOf = (text) => Math.ceil((text || '').length / 4);

/** Mongo filter for the gap. Exclusions that need a second collection are applied per candidate. */
export function gapFilter(scopeFilter = {}) {
  return {
    visible: true,
    pages_count: { $gt: 0 },
    pages_translated: { $gt: 0 },
    ...NOT_HELD,
    'pipeline_auto.status': { $nin: REALTIME_LANE_STATUSES },
    needs_resplit: { $in: [null, false] },
    source_unrecoverable: { $in: [null, false] },
    spread_translation_crisis: { $in: [null, false] },
    translation_stale_reason: { $in: [null, ''] },
    $or: [
      { summary: null },
      { 'index.generatedAt': null },
      { chapters_extracted_at: null, pages_count: { $gte: MIN_CHAPTER_PAGES }, $or: [{ chapters: null }, { chapters: { $size: 0 } }] },
    ],
    ...scopeFilter,
  };
}

async function hasWithheldPages(db, bookId) {
  return !!(await db.collection('pages').findOne(
    { 'translation_withheld.reason': { $exists: true }, book_id: bookId },
    { projection: { _id: 1 }, hint: 'pages_translation_withheld_partial' },
  ));
}

/** Re-checked at write time: a book may have been held or had a translation withheld since submit. */
async function stillEligible(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId, ...NOT_HELD, 'pipeline_auto.status': { $ne: 'held' } }, { projection: { _id: 1 } });
  if (!book) return 'held or missing';
  if (await hasWithheldPages(db, bookId)) return 'translation withheld';
  return null;
}

/** The lane only READS `books` here; its own writes go to BOOKS_COLL / JOBS_COLL. */
const booksOf = (db) => db.collection('books');

// ── Gemini Batch REST ──

function apiKey() {
  const k = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  if (!k) throw new Error('no GEMINI_API_KEY_TIER3 / GEMINI_API_KEY');
  return k;
}

async function uploadJsonl(body, displayName) {
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(Buffer.byteLength(body)), 'X-Goog-Upload-Header-Content-Type': 'text/plain',
    },
    body: JSON.stringify({ file: { displayName } }),
  });
  if (!start.ok) throw new Error(`upload start ${start.status}: ${await start.text()}`);
  const url = start.headers.get('X-Goog-Upload-URL');
  if (!url) throw new Error('no upload URL returned');
  for (let attempt = 1; ; attempt++) {
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body })
      .catch(e => ({ ok: false, status: e.message }));
    if (put.ok) {
      const info = await put.json();
      if (!info.file?.name) throw new Error('upload returned no file name');
      return info.file.name;
    }
    if (attempt >= 3) throw new Error(`upload PUT failed: ${put.status}`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

async function createBatch(model, fileName, displayName) {
  return createThenDeleteInput({
    fileName, apiKey: apiKey(),
    create: async () => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(`${API}/models/${model}:batchGenerateContent?key=${apiKey()}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) return body;
        if (r.status === 429 && attempt < 2) { await new Promise(res => setTimeout(res, 60000 * (attempt + 1))); continue; }
        throw new Error(`batch create ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      }
    },
  });
}

/** @returns {Promise<{state: string, lines: object[]|null}>} lines only once SUCCEEDED and downloadable */
async function fetchBatch(name) {
  const r = await (await fetch(`${API}/${name}?key=${apiKey()}`)).json();
  const state = r.metadata?.state || r.state || 'UNKNOWN';
  if (!/SUCCEEDED/.test(state)) return { state, lines: null };
  let lines = r.response?.inlinedResponses?.inlinedResponses || r.response?.inlinedResponses || null;
  const outFile = r.response?.responsesFile || r.metadata?.output?.responsesFile || r.dest?.fileName;
  if (outFile) {
    const f = await fetch(`https://generativelanguage.googleapis.com/download/v1beta/${outFile}:download?alt=media&key=${apiKey()}`);
    if (!f.ok) return { state: `${state} (results not downloadable yet: ${f.status})`, lines: null };
    lines = (await f.text()).split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }
  return { state, lines: lines || [] };
}

function responseText(line) {
  const c = line.response?.candidates?.[0];
  return c?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ── The lane ──

/**
 * @param {object} o
 * @param {import('mongodb').Db} o.db
 * @param {object} o.phases          the worker's prompt/parse/write functions and gen configs (see header)
 * @param {string} o.model
 * @param {object} o.scopeFilter     selective-unpause / envelope confinement (same as the realtime lane)
 * @param {boolean} o.dispatchAllowed  the spend gate's answer; false → collect only
 * @param {number} o.maxUsd          ceiling on NEW admissions this run, priced across all three rounds
 * @param {number} o.limit           max new books this run
 * @param {string[]|null} o.bookIds  explicit candidates (still subject to every exclusion)
 * @param {boolean} o.dryRun
 * @param {string} o.runTag          recorded on every state row (e.g. the envelope tag)
 */
export async function runEnrichBatchLane(o) {
  const { db, phases, model, dryRun } = o;
  const states = db.collection(BOOKS_COLL);
  const jobs = db.collection(JOBS_COLL);
  const report = { collected: 0, written: 0, chaptersWritten: 0, admitted: 0, admittedUsd: 0, submitted: [], pending: 0, failed: 0, dropped: 0, errors: [] };
  if (!dryRun) {
    await states.createIndex({ stage: 1 }).catch(() => {});
    await jobs.createIndex({ status: 1 }).catch(() => {});
  }

  // ── 1. Collect ──
  for (const job of await jobs.find({ status: 'submitted' }).toArray()) {
    let res;
    try { res = await fetchBatch(job.gemini_name); } catch (e) { report.errors.push(`${job._id}: ${e.message}`); continue; }
    if (/FAILED|CANCELLED|EXPIRED/.test(res.state)) {
      if (!dryRun) {
        await jobs.updateOne({ _id: job._id }, { $set: { status: 'failed', state: res.state, collected_at: new Date() } });
        await states.updateMany({ [`${job.stage}_job`]: job._id }, { $set: { stage: 'failed', error: `${job.stage} job ${res.state}`, updated_at: new Date() }, $inc: { attempts: 1 } });
        for (const id of job.book_ids) {
          await completeBatchUsage({ batch_job_id: `${job._id}:${id}`, model: job.model, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: res.state, insertIfMissing: false }, db);
        }
      }
      report.failed += job.book_ids.length;
      continue;
    }
    if (!res.lines) { console.log(`  [batch] ${job._id} (${job.stage}, ${job.book_ids.length} books): ${res.state}`); continue; }
    if (dryRun) { console.log(`  [batch] would collect ${job._id} (${job.stage}): ${res.lines.length} responses`); continue; }

    // Group responses by book. Key: <bookId>|<n>
    const byBook = new Map();
    for (const line of res.lines) {
      const key = line.key ?? line.metadata?.key;
      if (!key) continue;
      const sep = key.lastIndexOf('|');
      const bookId = key.slice(0, sep), n = Number(key.slice(sep + 1));
      if (!byBook.has(bookId)) byBook.set(bookId, []);
      byBook.get(bookId).push({ n, line });
    }
    let actualUsd = 0;
    for (const bookId of job.book_ids) {
      const got = byBook.get(bookId) || [];
      let inTok = 0, outTok = 0;
      for (const { line } of got) {
        inTok += line.response?.usageMetadata?.promptTokenCount || 0;
        outTok += outputTokensFrom(line.response?.usageMetadata);
      }
      actualUsd += calculateUsageCost(job.model, inTok, outTok, true);
      await completeBatchUsage({
        batch_job_id: `${job._id}:${bookId}`, model: job.model, input_tokens: inTok, output_tokens: outTok,
        status: got.length ? 'success' : 'failed', type: job.type, mode: 'batch', book_id: bookId, page_count: got.length, endpoint: ENDPOINT,
      }, db);
      try {
        await collectBook(o, job, bookId, got, report);
      } catch (e) {
        report.errors.push(`${bookId} (${job.stage}): ${e.message}`);
        await states.updateOne({ _id: bookId }, { $set: { stage: 'failed', error: `${job.stage}: ${e.message}`.slice(0, 500), updated_at: new Date() }, $inc: { attempts: 1 } });
      }
    }
    await jobs.updateOne({ _id: job._id }, { $set: { status: 'collected', state: res.state, collected_at: new Date(), actual_usd: +actualUsd.toFixed(4) } });
    report.collected++;
    console.log(`  [batch] collected ${job._id} (${job.stage}): ${job.book_ids.length} books, $${actualUsd.toFixed(4)} billed (est $${(job.est_usd || 0).toFixed(4)})`);
  }

  // ── 2. Admit new books ──
  if (o.dispatchAllowed && o.limit > 0 && o.maxUsd > 0) await admit(o, report);
  else if (!o.dispatchAllowed) console.log('  [batch] spend gate closed — collect only, no new submissions');

  // ── 3. Advance collected books to their next round ──
  if (o.dispatchAllowed) await advance(o, report);

  report.pending = await jobs.countDocuments({ status: 'submitted' });
  return report;
}

/** Apply one book's responses from a collected job. */
async function collectBook(o, job, bookId, got, report) {
  const { db, phases } = o;
  const states = db.collection(BOOKS_COLL);
  const state = await states.findOne({ _id: bookId });
  // Idempotent re-collect: a run killed mid-job leaves the job `submitted` with some books already
  // applied. Those have moved past `<stage>_submitted`; only the rest are applied again.
  if (!state || state.stage !== `${job.stage}_submitted`) return;
  const why = await stillEligible(db, bookId);
  if (why) {
    await states.updateOne({ _id: bookId }, { $set: { stage: 'dropped', error: why, updated_at: new Date() } });
    report.dropped++;
    return;
  }

  if (job.stage === 'index') {
    const byN = new Map(got.map(g => [g.n, g.line]));
    const extractions = state.page_ranges.map((pageRange, n) => {
      const line = byN.get(n);
      if (!line) return phases.emptyExtraction(pageRange);
      const usage = { input_tokens: line.response?.usageMetadata?.promptTokenCount || 0, output_tokens: outputTokensFrom(line.response?.usageMetadata) };
      try { return phases.parseIndexBatchResponse(responseText(line), pageRange, usage); } catch { return phases.emptyExtraction(pageRange, usage); }
    });
    const useful = extractions.filter(e => e.summary || e.themes.length || e.people.length || e.concepts.length).length;
    if (!useful) throw new Error(`no usable extractions (${got.length}/${state.page_ranges.length} responses)`);
    await states.updateOne({ _id: bookId }, { $set: { stage: 'index_collected', extractions, updated_at: new Date() } });
    return;
  }

  if (job.stage === 'summary') {
    const book = await booksOf(db).findOne({ id: bookId });
    let generated = null;
    const line = got[0]?.line;
    if (line) {
      const usage = { input_tokens: line.response?.usageMetadata?.promptTokenCount || 0, output_tokens: outputTokensFrom(line.response?.usageMetadata) };
      generated = phases.parseBookSummaryResponse(responseText(line), usage); // throws → book failed, nothing written
    }
    if (!generated?.brief) throw new Error('summary round returned no brief');
    const inputs = await phases.loadPhase6Inputs(db, book);
    await phases.finishEnrichBook(db, book, inputs, state.extractions, generated, { mode: 'batch' });
    phases.revalidateBookPage(bookId).catch(() => {});
    report.written++;
    await states.updateOne({ _id: bookId }, {
      $set: { stage: state.need_chapters ? 'indexed' : 'done', indexed_at: new Date(), updated_at: new Date() },
      $unset: { extractions: '' },
    });
    return;
  }

  if (job.stage === 'chapters') {
    const line = got[0]?.line;
    if (!line) throw new Error('no chapters response');
    const prep = await phases.prepareChapterExtraction(db, bookId);
    const chapters = await phases.applyChapterExtraction(db, bookId, prep, responseText(line));
    phases.revalidateBookPage(bookId).catch(() => {});
    report.chaptersWritten++;
    await states.updateOne({ _id: bookId }, { $set: { stage: 'done', chapters: chapters.length, updated_at: new Date() } });
  }
}

/** Select gap books, price all their rounds, submit the index round (or mark chapter-only books). */
async function admit(o, report) {
  const { db, phases, model, dryRun } = o;
  const stateColl = db.collection(BOOKS_COLL);
  const filter = gapFilter(o.scopeFilter);
  if (o.bookIds?.length) filter.id = { $in: o.bookIds };
  const cursor = booksOf(db).find(filter)
    .sort({ read_count: -1, pages_translated: -1 })
    .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, summary: { $cond: [{ $ifNull: ['$summary', false] }, 1, 0] }, chapters: 1, chapters_extracted_at: 1, pages_count: 1, read_count: 1, pages_translated: 1 });

  const known = new Map((await stateColl.find({}, { projection: { stage: 1, attempts: 1 } }).toArray()).map(r => [r._id, r]));
  const lines = [];
  const admitted = [];
  let usd = 0;
  for await (const b of cursor) {
    if (admitted.length >= o.limit) break;
    const prior = known.get(b.id);
    if (prior && (prior.stage !== 'failed' || (prior.attempts || 0) >= MAX_ATTEMPTS)) continue; // in flight, done, dropped, or out of attempts
    if (await hasWithheldPages(db, b.id)) continue;
    const hasIndexRow = !!(await db.collection('book_indexes').findOne({ book_id: b.id }, { projection: { _id: 1 } }));
    const needIndex = !b.summary || !hasIndexRow;
    const needChapters = (b.pages_count || 0) >= MIN_CHAPTER_PAGES && !b.chapters_extracted_at && !(Array.isArray(b.chapters) && b.chapters.length);
    if (!needIndex && !needChapters) continue;

    let estIndexUsd = 0, estUsd = 0;
    const pageRanges = [], bookLines = [];
    if (needIndex) {
      const inputs = await phases.loadPhase6Inputs(db, b);
      const batches = phases.planPageBatches(inputs.pages, inputs.chapterTexts);
      batches.forEach((pages) => {
        const { pageRange, prompt } = phases.buildIndexBatchPrompt(pages, b.display_title || b.title, b.author || 'Unknown', b.language || undefined);
        if (!prompt) return;
        const n = pageRanges.length;
        pageRanges.push(pageRange);
        bookLines.push({ key: `${b.id}|${n}`, request: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: phases.INDEX_BATCH_GEN_CONFIG } });
        const inTok = tokensOf(prompt);
        estIndexUsd += calculateUsageCost(model, inTok, Math.min(EST.indexOutMax, Math.max(EST.indexOutMin, inTok * EST.indexOutPerIn)), true);
      });
      if (!bookLines.length) continue; // no translated text after all
      estUsd = estIndexUsd + calculateUsageCost(model, EST.summaryIn, EST.summaryOut, true);
    }
    if (needChapters) estUsd += calculateUsageCost(model, EST.chaptersInBase + EST.chaptersInPerPage * (b.pages_count || 0), EST.chaptersOut, true);
    if (usd + estUsd > o.maxUsd) {
      if (admitted.length === 0) console.log(`  [batch] next book ${b.id} alone is estimated at $${estUsd.toFixed(2)} > run cap $${o.maxUsd}`);
      break;
    }
    usd += estUsd;
    admitted.push({ b, needIndex, needChapters, pageRanges, estUsd, estIndexUsd, nLines: bookLines.length });
    lines.push(...bookLines);
  }

  report.admitted = admitted.length;
  report.admittedUsd = +usd.toFixed(4);
  console.log(`  [batch] admitting ${admitted.length} book(s), ${lines.length} index request(s), est $${usd.toFixed(2)} across all rounds (cap $${o.maxUsd})`);
  if (dryRun || !admitted.length) {
    if (dryRun) for (const a of admitted) console.log(`    ${a.b.id}  reads=${a.b.read_count || 0}  pt=${a.b.pages_translated}  index=${a.needIndex}(${a.nLines} req)  chapters=${a.needChapters}  est $${a.estUsd.toFixed(3)}`);
    return;
  }

  const now = new Date();
  for (const a of admitted) {
    await stateColl.updateOne({ _id: a.b.id }, {
      $set: {
        book_id: a.b.id, run_tag: o.runTag, stage: a.needIndex ? 'index_pending' : 'indexed',
        need_index: a.needIndex, need_chapters: a.needChapters, page_ranges: a.pageRanges,
        est_usd: +a.estUsd.toFixed(4), read_count: a.b.read_count || 0, admitted_at: now, updated_at: now,
      },
      $unset: { error: '', extractions: '' },
      $setOnInsert: { attempts: 0 },
    }, { upsert: true });
  }
  const indexBooks = admitted.filter(a => a.needIndex);
  if (indexBooks.length) {
    await submitJob(o, 'index', 'index', indexBooks.map(a => ({ bookId: a.b.id, estUsd: a.estIndexUsd, title: a.b.title })), lines, report);
    // A failed submit leaves nothing in flight: forget those books so the next run re-admits them.
    await stateColl.deleteMany({ _id: { $in: indexBooks.map(a => a.b.id) }, stage: 'index_pending' });
  }
}

/** Submit summary rounds for index_collected books and chapter rounds for indexed books. */
async function advance(o, report) {
  const { db, phases, model } = o;
  const stateColl = db.collection(BOOKS_COLL);

  const toSummarize = await stateColl.find({ stage: 'index_collected' }).toArray();
  if (toSummarize.length) {
    const lines = [], entries = [];
    for (const s of toSummarize) {
      const book = await booksOf(db).findOne({ id: s._id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, chapters: 1 } });
      if (!book) continue;
      const chapters = (book.chapters || []).map(c => ({ title: c.title, pageNumber: c.pageNumber, level: c.level || 1 }));
      const prompt = phases.buildBookSummaryRequest(
        s.extractions, book.title || book.display_title, book.author || 'Unknown', book.language || undefined,
        chapters.length ? chapters : undefined, book.display_title || undefined,
      );
      lines.push({ key: `${s._id}|0`, request: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: phases.SUMMARY_GEN_CONFIG } });
      entries.push({ bookId: s._id, title: book.title, estUsd: calculateUsageCost(model, tokensOf(prompt), EST.summaryOut, true) });
    }
    await submitJob(o, 'summary', 'summary', entries, lines, report);
  }

  const toChapter = await stateColl.find({ stage: 'indexed', need_chapters: true }).toArray();
  if (toChapter.length) {
    const lines = [], entries = [];
    for (const s of toChapter) {
      let prep;
      try { prep = await phases.prepareChapterExtraction(db, s._id); } catch (e) {
        await stateColl.updateOne({ _id: s._id }, { $set: { stage: 'done', chapters_skipped: e.message, updated_at: new Date() } });
        continue;
      }
      lines.push({ key: `${s._id}|0`, request: { contents: [{ role: 'user', parts: [{ text: prep.prompt }] }], generationConfig: phases.CHAPTERS_GEN_CONFIG } });
      entries.push({ bookId: s._id, estUsd: calculateUsageCost(model, tokensOf(prep.prompt), EST.chaptersOut, true) });
    }
    await submitJob(o, 'chapters', 'extract_chapters', entries, lines, report);
  }
  await stateColl.updateMany({ stage: 'indexed', need_chapters: { $ne: true } }, { $set: { stage: 'done', updated_at: new Date() } });
}

/** Upload, create, record the job, move its books to `<stage>_submitted`, and price it at submit. */
async function submitJob(o, stage, usageType, entries, lines, report) {
  const { db, model } = o;
  if (!entries.length) return;
  // One Gemini job per ~150 MB of JSONL; entries never straddle a split (all a book's lines share a key prefix).
  const groups = [];
  let cur = { entries: [], lines: [], bytes: 0 };
  const linesByBook = new Map();
  for (const l of lines) {
    const id = l.key.slice(0, l.key.lastIndexOf('|'));
    if (!linesByBook.has(id)) linesByBook.set(id, []);
    linesByBook.get(id).push(JSON.stringify(l));
  }
  for (const e of entries) {
    const ls = linesByBook.get(e.bookId) || [];
    const bytes = ls.reduce((t, l) => t + l.length + 1, 0);
    if (cur.entries.length && cur.bytes + bytes > MAX_JOB_BYTES) { groups.push(cur); cur = { entries: [], lines: [], bytes: 0 }; }
    cur.entries.push(e); cur.lines.push(...ls); cur.bytes += bytes;
  }
  if (cur.entries.length) groups.push(cur);

  for (const g of groups) {
    const jobId = `enrich-${stage}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const fileName = await uploadJsonl(g.lines.join('\n'), jobId);
      const created = await createBatch(model, fileName, jobId);
      const estUsd = g.entries.reduce((t, e) => t + e.estUsd, 0);
      await db.collection(JOBS_COLL).insertOne({
        _id: jobId, gemini_name: created.name, stage, type: usageType, model, run_tag: o.runTag,
        book_ids: g.entries.map(e => e.bookId), requests: g.lines.length, bytes: g.bytes,
        est_usd: +estUsd.toFixed(4), status: 'submitted', created_at: new Date(),
      });
      await db.collection(BOOKS_COLL).updateMany(
        { _id: { $in: g.entries.map(e => e.bookId) } },
        { $set: { stage: `${stage}_submitted`, [`${stage}_job`]: jobId, updated_at: new Date() } },
      );
      // Priced at submit so the dial and the envelope see committed spend (#4567).
      for (const e of g.entries) {
        await logUsage({
          type: usageType, mode: 'batch', model, book_id: e.bookId, book_title: e.title || null,
          batch_job_id: `${jobId}:${e.bookId}`, input_tokens: 0, output_tokens: 0, status: 'submitted',
          cost_usd: +e.estUsd.toFixed(6), endpoint: ENDPOINT,
        }, db);
      }
      report.submitted.push({ jobId, stage, books: g.entries.length, requests: g.lines.length, estUsd: +estUsd.toFixed(4) });
      console.log(`  [batch] submitted ${jobId} → ${created.name}: ${stage}, ${g.entries.length} books, ${g.lines.length} requests, est $${estUsd.toFixed(4)}`);
    } catch (e) {
      report.errors.push(`submit ${stage}: ${e.message}`);
      console.error(`  [batch] submit ${stage} failed: ${e.message}`);
      // Books stay at their current stage and are retried next run.
    }
  }
}
