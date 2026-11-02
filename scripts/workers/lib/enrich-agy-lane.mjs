/**
 * PRIOR ART: ./enrich-batch-lane.mjs — selection by missing output (gapFilter), the exclusions and the write-time
 * recheck are imported from it, not copied; it is the paid Batch API transport (three rounds over 50K-char page
 * batches, sized for flash-lite). scripts/batch/cli-translate.mjs and scripts/batch/cli-ocr-lane.mjs — the agy
 * transport (gatedTextCall), pool choice (agy-pools.mjs) and quota floor (quotaFloor, imported); they write page text,
 * not book enrichment, so neither fits.
 *
 * enrich-agy-lane — enrich-worker Phase 6 (summary + index) and Phase 7 (chapters) through the agy CLI: Gemini 3.8
 * Flash on the subscription, $0 API (#7628). Called from enrich-worker.mjs --agy.
 *
 * ONE CONVERSATION PER BOOK. Flash has a ~1M-token context, so the whole English text goes to one conversation and the
 * reply is one JSON object: the per-section extractions (the index), the summary and the chapters. agy cuts a single
 * message at ~190K characters (probe, 2026-10-28), so the text goes as messages of at most 150K characters, each
 * answered "OK", with the tasks in the last: one model request per message, and the request is the unit counted. The prompt carries each phase's
 * own output schema and the reply goes through each phase's own parse and write (enrich-worker.mjs
 * buildAgyEnrichPrompt / parseAgyEnrichResponse → parseIndexBatchResponse, parseBookSummaryResponse,
 * finishEnrichBook, applyChapterExtraction), so `book_indexes`, `summary` / `reading_summary` and `chapters` have
 * the API lanes' shape. The sections are the API lane's own page batches (planPageBatches), so `pageSummaries` and
 * `pages_sampled` line up with theirs. A book whose text is over --max-chars is asked in parts: extractions per part,
 * then one call for summary + chapters over those extractions (the batch lane's reduce prompt).
 * The prompt goes on stdin (agy-cli.mjs stdinArgs): one argv string is capped at 128 KB.
 *
 * WHICH BOOKS. The batch lane's gap (gapFilter: live, translated, not held, not in a realtime-lane status, missing a
 * summary, an index or chapters), minus books with a withheld translation, minus books that lane has in flight.
 * CLAIM BEFORE THE CALL: a row in the batch lane's own state collection (enrich_batch_books, stage `agy_claimed`) is
 * what its admission skips, so the API lane never pays for a book this lane is reading. Done → stage `done`, lane
 * `agy`. A failed book → stage `failed`: the batch lane may then admit it, which is the fallback. A quota stop releases
 * the claim (the book waits for the next run, or the API lane).
 *
 * PACE. The budget is a share of one agy pool's week (Derek, #7628: about a quarter). Three stops, first wins:
 *   --max-calls-day  model requests this job made today (the agy job ledger, AGY_JOB=enrich-agy; a row per
 *                    message), default 600;
 *   the quota floor  the pool's weekly bucket under the other lanes' weekly reserve (agy-pools.mjs weeklyReserve,
 *                    0 in the last 36 h before the reset, #7911), or its 5-hour bucket under 25% (cli-ocr-lane.mjs
 *                    quotaFloor), read once at start: no pool open → no call;
 *   a quota reply    stops the run at once; agy-cli.mjs records the limit and never calls a locked model again.
 *
 * PROVENANCE. summary.engine, reading_summary.engine and book_indexes.engine carry a write-provenance.mjs engine
 * block (api 'cli', agy version, model, the hash of every prompt sent, run, issue); chapters get
 * field_provenance.chapters (+ history). The state row keeps calls, seconds and agy's token counts per book.
 *
 * Flags (after --agy): --limit=N books (20), --max-calls-day=N (600), --pace-off-until=ISO, --deadline-min=N (100), --concurrency=N (2),
 * --max-chars=N (text per conversation, see MAX_CHARS), --max-turns=N (messages per conversation, MAX_TURNS), --agy-home=auto|default|<path> (auto), --model=<gemini> (3.8 Flash
 * low), --floor-5h=F (0.25), --ignore-floor (a hand-run pilot only), --run-tag=TAG, --book=ID / --book-ids-file=PATH.
 *
 * --compare-out=DIR (the pilot): read the listed books (--book-ids-file, any book, enriched or not) and write each
 * reply, parsed, beside the stored API-lane output to DIR/<book>.json. Nothing is claimed and nothing is written to
 * the database.
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gatedTextCall, agyUsage, jobCallsToday, STDIN_MESSAGE_MAX } from '../../lib/agy-cli.mjs';
import { readPools, choosePool, poolName } from '../../lib/agy-pools.mjs';
import { quotaFloor } from '../../batch/cli-ocr-lane.mjs';
import { geminiEngine, notRecorded, codeVersion, host, contentHash } from '../../lib/write-provenance.mjs';
import { provenanceUpdate } from '../../lib/field-provenance.mjs';
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';
import { buildPageIndex, groundQuotes } from './quote-grounding.mjs';
import { gapFilter, hasWithheldPages, stillEligible, enrichPauseMode, BOOKS_COLL, MIN_CHAPTER_PAGES } from './enrich-batch-lane.mjs';

export const JOB = 'enrich-agy';
export const CALL_SITE = 'scripts/workers/lib/enrich-agy-lane.mjs';
export const ISSUE = '#7628';
export const DEFAULT_MODEL = 'gemini-3.8-flash-low';
/**
 * Text characters per conversation; a book over it is read in parts (see the header). Set from the pilot (#7628,
 * 2026-10-28; the measured times are on the issue): a call past --print-timeout returns a cut reply, a failure.
 */
export const MAX_CHARS = 600_000;
/** Messages (model requests) one conversation may take; see `call` in enrichOne. A 600K-character part is 4-5. */
export const MAX_TURNS = 8;
const PRINT_TIMEOUT_S = 900;
const MSG_CHARS = STDIN_MESSAGE_MAX;
const SUFFIX = '\n\nDo not open, read or write any file and do not use any tool: everything you need is above. Write the one JSON object between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.\n';

const argOf = (args, k, d = null) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const textOf = (pages) => pages.reduce((t, p) => t + (p.translation?.data?.length || 0), 0);

/** Group the planned page batches into parts of at most `maxChars` of text each (a batch is never split). */
export function groupBatches(batches, maxChars) {
  const parts = [];
  let cur = [], chars = 0;
  for (const b of batches) {
    const c = textOf(b);
    if (cur.length && chars + c > maxChars) { parts.push(cur); cur = []; chars = 0; }
    cur.push(b); chars += c;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** Claim a book in the batch lane's state collection. Returns 'new' | 'from_failed' | null (someone has it). */
export async function claimBook(states, bookId, me) {
  const set = { book_id: bookId, stage: 'agy_claimed', lane: 'agy', run_tag: me.runTag, agy_run: me.run, claimed_at: new Date(), updated_at: new Date() };
  try { await states.insertOne({ _id: bookId, ...set, attempts: 0 }); return 'new'; } catch (e) { if (e.code !== 11000) throw e; }
  // A book the batch lane failed (any attempts) may be tried here; one this lane already failed is left to the API.
  const r = await states.updateOne({ _id: bookId, stage: 'failed', lane: { $ne: 'agy' } }, { $set: set, $unset: { error: '' } });
  return r.modifiedCount === 1 ? 'from_failed' : null;
}

async function releaseClaim(states, bookId, me, how) {
  if (how === 'new') await states.deleteOne({ _id: bookId, stage: 'agy_claimed', agy_run: me.run });
  else await states.updateOne({ _id: bookId, stage: 'agy_claimed', agy_run: me.run }, { $set: { stage: 'failed', updated_at: new Date() }, $unset: { lane: '', agy_run: '' } });
}

/**
 * @param {object} o
 * @param {import('mongodb').Db} o.db
 * @param {object} o.phases     enrich-worker's prompt / parse / write functions (see the header)
 * @param {object} o.control    processing_control
 * @param {string[]} o.args     the worker's argv
 * @param {object} o.scopeFilter
 * @param {string[]|null} o.bookIds
 * @param {boolean} o.dryRun
 */
export async function runEnrichAgyLane(o) {
  const { db, phases, args, dryRun } = o;
  const report = { written: 0, chaptersWritten: 0, calls: 0, failed: 0, dropped: 0, released: 0, considered: 0, stop: null, pool: null, errors: [], books: [] };
  const pause = enrichPauseMode(o.control, { batchMode: false });
  if (pause.mode !== 'run') { report.stop = pause.reason; console.log(`[ENRICH-AGY] ${pause.reason}: nothing called`); return report; }

  const limit = Number(argOf(args, 'limit', 20));
  const capDay = Number(argOf(args, 'max-calls-day', 600));
  const deadline = Date.now() + Number(argOf(args, 'deadline-min', 100)) * 60_000;
  const concurrency = Math.max(1, Math.min(4, Number(argOf(args, 'concurrency', 2))));
  const maxChars = Number(argOf(args, 'max-chars', MAX_CHARS));
  const maxTurns = Number(argOf(args, 'max-turns', MAX_TURNS));
  const model = argOf(args, 'model', DEFAULT_MODEL);
  const floor5h = Number(argOf(args, 'floor-5h', 0.25));
  // --pace-off-until=ISO: no weekly reserve until then (cli-ocr-lane.mjs quotaFloor, #7911); an override, no cron line needs it
  const paceOffUntil = argOf(args, 'pace-off-until', null) ? Date.parse(argOf(args, 'pace-off-until', null)) : null;
  const runTag = argOf(args, 'run-tag', 'enrich-agy-7628');
  const run = `enrich-agy-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}-${process.pid}`;
  const me = { run, runTag };
  process.env.AGY_JOB = JOB; // the agy job ledger counts this lane's calls under one name (agy-cli.mjs ledgerGate)

  const usedToday = jobCallsToday(JOB, { heavyOnly: false });
  if (usedToday >= capDay) { report.stop = `daily cap: ${usedToday}/${capDay} calls today`; console.log(`[ENRICH-AGY] ${report.stop}`); return report; }

  // Which pool. Children inherit process.env, so AGY_HOME set here is the pool every call of this run spends.
  const want = argOf(args, 'agy-home', 'auto');
  let home = null;
  if (want === 'auto') {
    const pools = readPools();
    const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
    for (const p of pools) console.log(`[ENRICH-AGY] pool ${poolName(p)}: ${p.reading ? `weekly ${(100 * p.reading.weekly).toFixed(1)}%, 5h ${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(1) + '%'}, ${quotaFloor(toBuckets(p.reading), { floor5h, paceOffUntil, lane: 'enrich' }).why || 'open'}` : 'NO READING'}${p.busy ? ` (busy, pid ${p.busy})` : ''}`);
    const pick = choosePool(pools, (r) => { const q = quotaFloor(toBuckets(r), { floor5h, paceOffUntil, lane: 'enrich' }); return { open: q.ok || args.includes('--ignore-floor'), why: q.why }; });
    if (!pick) { report.stop = 'no pool above its quota floor'; console.log(`[ENRICH-AGY] ${report.stop}: nothing called`); return report; }
    home = pick.home;
  } else if (want !== 'default') home = path.resolve(want);
  if (home) process.env.AGY_HOME = home; else delete process.env.AGY_HOME;
  process.env.AGY_POOL_SHARED = '1';
  report.pool = poolName({ home });
  const cliVersion = spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
  console.log(`[ENRICH-AGY] run ${run}: pool ${report.pool}, ${model}, agy ${cliVersion}, ${usedToday}/${capDay} calls used today, limit ${limit} books, ${maxChars} chars per call`);

  const states = db.collection(BOOKS_COLL);
  const compareDir = argOf(args, 'compare-out');
  if (compareDir && !o.bookIds?.length) { report.stop = '--compare-out needs --book-ids-file or --book'; console.log(`[ENRICH-AGY] ${report.stop}`); return report; }
  if (compareDir) fs.mkdirSync(compareDir, { recursive: true });
  // Compare mode writes nothing, so it may read a held book (the Siku cohort stays held, #5600).
  const filter = compareDir ? { id: { $in: o.bookIds } } : gapFilter(o.scopeFilter);
  if (o.bookIds?.length) filter.id = { $in: o.bookIds };
  const known = new Map((await states.find({}, { projection: { stage: 1, lane: 1 } }).toArray()).map(r => [r._id, r]));
  const cursor = db.collection('books').find(filter).batchSize(1000).sort({ read_count: -1, pages_translated: -1 })
    .project({ id: 1, summary: { $cond: [{ $ifNull: ['$summary', false] }, 1, 0] }, chapters: { $size: { $ifNull: ['$chapters', []] } }, chapters_extracted_at: 1, pages_count: 1 });

  let stop = null, claimed = 0;
  const work = [];
  // One cursor, read by every worker in turn (a `for await` per worker would close it on the first `return`).
  let lock = Promise.resolve();
  const next = () => { const p = lock.then(pick); lock = p.catch(() => {}); return p; };
  const pick = async () => {
    for (;;) {
      if (stop || claimed >= limit || Date.now() >= deadline) return null;
      const b = await cursor.next();
      if (!b) return null;
      report.considered++;
      if (compareDir) { claimed++; return { id: b.id, needIndex: true, needChapters: (b.pages_count || 0) >= MIN_CHAPTER_PAGES, compareDir }; }
      const prior = known.get(b.id);
      if (prior && !(prior.stage === 'failed' && prior.lane !== 'agy')) continue;
      if (await hasWithheldPages(db, b.id)) continue;
      const hasIndexRow = !!(await db.collection('book_indexes').findOne({ book_id: b.id }, { projection: { _id: 1 } }));
      const needIndex = !b.summary || !hasIndexRow;
      const needChapters = (b.pages_count || 0) >= MIN_CHAPTER_PAGES && !b.chapters_extracted_at && !b.chapters;
      if (!needIndex && !needChapters) continue;
      if (dryRun) { claimed++; console.log(`  would read ${b.id}: index=${needIndex} chapters=${needChapters}`); continue; }
      const how = await claimBook(states, b.id, me);
      if (!how) continue;
      claimed++;
      return { id: b.id, needIndex, needChapters, how };
    }
  };

  const worker = async () => {
    for (;;) {
      if (stop) return;
      if (jobCallsToday(JOB, { heavyOnly: false }) >= capDay) { stop ??= `daily cap of ${capDay} calls reached`; return; }
      const c = await next();
      if (!c) return;
      try {
        const r = await enrichOne(o, c, { model, maxChars, maxTurns, me, cliVersion, pool: report.pool });
        report.calls += r.calls;
        report.books.push(r.row);
        if (compareDir) { if (r.quota) stop ??= `quota: ${r.quota}`; else if (r.error) { report.failed++; report.errors.push(`${c.id}: ${r.error}`); fs.writeFileSync(path.join(compareDir, `${c.id}.failed.json`), JSON.stringify(r.row, null, 1)); } else report.written++; continue; }
        if (r.quota) {
          stop ??= `quota: ${r.quota}`;
          await releaseClaim(states, c.id, me, c.how); report.released++;
        } else if (r.dropped) {
          report.dropped++;
          await states.updateOne({ _id: c.id, agy_run: run }, { $set: { stage: 'dropped', error: r.dropped, updated_at: new Date() } });
        } else if (r.error) {
          report.failed++; report.errors.push(`${c.id}: ${r.error}`);
          await states.updateOne({ _id: c.id, agy_run: run }, { $set: { stage: 'failed', lane: 'agy', error: r.error.slice(0, 500), agy: r.row, updated_at: new Date() }, $inc: { attempts: 1 } });
        } else {
          report.written += r.written ? 1 : 0; report.chaptersWritten += r.chapters != null ? 1 : 0;
          await states.updateOne({ _id: c.id, agy_run: run }, { $set: { stage: 'done', lane: 'agy', agy: r.row, chapters: r.chapters, updated_at: new Date() } });
        }
      } catch (e) {
        report.failed++; report.errors.push(`${c.id}: ${e.message}`);
        await states.updateOne({ _id: c.id, agy_run: run }, { $set: { stage: 'failed', lane: 'agy', error: String(e.message).slice(0, 500), updated_at: new Date() }, $inc: { attempts: 1 } }).catch(() => {});
      }
    }
  };
  for (let i = 0; i < concurrency; i++) work.push(worker());
  await Promise.all(work);
  await cursor.close().catch(() => {});
  report.stop = stop || (Date.now() >= deadline ? 'deadline' : claimed >= limit ? 'limit' : 'queue empty');
  for (const e of report.errors.slice(0, 20)) console.log(`    ${e}`);
  console.log(`[ENRICH-AGY] run ${run} ended (${report.stop}): ${report.written} written, ${report.chaptersWritten} chapters, ${report.calls} calls, ${report.failed} failed, ${report.released} released, ${report.dropped} dropped`);
  return report;
}

/** One book: its calls, parse, recheck and writes. Never throws for a model failure; returns { error } instead. */
async function enrichOne(o, c, { model, maxChars, maxTurns, me, cliVersion, pool }) {
  const { db, phases } = o;
  const t0 = Date.now();
  const row = { book_id: c.id, run: me.run, pool, model, calls: 0, secs: 0, usage: { input: 0, output: 0, thinking: 0 }, parts: 1 };
  const book = await db.collection('books').findOne({ id: c.id, ...(c.compareDir ? {} : NOT_HELD) });
  if (!book) return { dropped: 'held or missing', calls: 0, row };
  const title = book.display_title || book.title, author = book.author || 'Unknown', lang = book.language || undefined;
  const sent = [];
  // `messages`: buildAgyEnrichPrompt's conversation. Counted in model requests (a turn each), the unit of the cap.
  const call = async (messages) => {
    // Every turn re-reads the conversation so far, so input grows with the square of the turns: an 18-turn chapter
    // prompt (a 3,043-page polyglot's heading list) read 11.7M tokens. Over the cap the book goes to the API lane,
    // where the same prompt is one request.
    if (messages.length > maxTurns) return { cls: 'too_long', problem: null, requests: 0, calls: 0, text: '', err: `${messages.length} messages, over --max-turns=${maxTurns}: left to the API lane` };
    const msgs = messages.map((m, i) => (i === messages.length - 1 ? m + SUFFIX : m));
    sent.push(msgs.join('\n\n'));
    const r = await gatedTextCall(msgs, { model, task: 'translate', attempts: 2, stdin: true, printTimeoutS: PRINT_TIMEOUT_S });
    row.calls += r.requests;
    // A JSON answer wrapped in a markdown fence outside the markers (pilot: a 640-page Nahuatl evangeliary) is a clean
    // answer for a parse; anything else outside the markers is not.
    if (r.problem === 'text outside the markers' && /^\s*(```\w*)?\s*<<<BEGIN>>>[\s\S]*<<<END>>>\s*(```)?\s*$/.test(r.text)) r.problem = null;
    row.agy_calls = (row.agy_calls || 0) + r.calls;
    const u = agyUsage(r.usage);
    if (u) { row.usage.input += u.input || 0; row.usage.output += u.output || 0; row.usage.thinking += u.thinking || 0; }
    if (c.compareDir) fs.appendFileSync(path.join(c.compareDir, `${c.id}.replies.txt`), `===== call ${sent.length} (${r.cls || 'ok'}, ${r.secs?.toFixed?.(0)} s)\n${r.text}\n`);
    // The reply of a call that is not a clean one, kept for the operator (scratch, not the database).
    if ((r.cls && r.cls !== 'quota') || r.problem) row.last_bad_reply = { cls: r.cls, problem: r.problem, err: r.err, head: String(r.text || '').slice(0, 300), tail: String(r.text || '').slice(-300) };
    return r;
  };
  const fail = (error) => ({ error, calls: row.calls, row: { ...row, secs: (Date.now() - t0) / 1000, error } });

  let prep = null;
  if (c.needChapters) {
    try { prep = await phases.prepareChapterExtraction(db, c.id); } catch (e) { row.chapters_skipped = e.message; }
  }
  const chaptersWanted = !!prep;
  const want = [];
  let extractions = null, summary = null, chaptersText = null, inputs = null;

  if (c.needIndex) {
    inputs = await phases.loadPhase6Inputs(db, book);
    const batches = phases.planPageBatches(inputs.pages, inputs.chapterTexts);
    if (!batches.length) return fail('no translated text');
    const rangeOf = (b) => ({ start: b[0].page_number, end: b[b.length - 1].page_number });
    row.text_chars = textOf(inputs.pages);
    const parts = groupBatches(batches, maxChars);
    row.parts = parts.length;
    const chapters = (book.chapters || []).map(ch => ({ title: ch.title, pageNumber: ch.pageNumber, level: ch.level || 1 }));
    if (parts.length === 1) {
      // The whole book in one call: extractions, summary and (when missing) chapters.
      want.push('extractions', 'summary', ...(chaptersWanted ? ['chapters'] : []));
      const ranges = batches.map(rangeOf);
      const summaryPrompt = phases.buildSummaryPrompt({
        bookTitle: book.title || title, englishTitle: book.display_title || undefined, bookAuthor: author,
        languageContext: lang ? ` The original text is in ${lang}.` : '',
        chapterSection: chapters.length ? `\n## Detected Chapter Structure\n${chapters.map(ch => `- Page ${ch.pageNumber}: ${ch.title}`).join('\n')}\n` : '',
        hasChapters: chapters.length > 0, material: phases.AGY_SUMMARY_MATERIAL,
      });
      const r = await call(phases.buildAgyEnrichPrompt({ want, pages: batches.flat(), ranges, bookTitle: title, bookAuthor: author, bookLanguage: lang, summaryPrompt, chapterPrompt: prep?.prompt, msgChars: MSG_CHARS }));
      if (r.cls === 'quota') return { quota: r.err || 'quota', calls: row.calls, row };
      if (r.cls || r.problem) return fail(`call: ${r.cls === 'too_long' ? r.err : r.cls || r.problem}`);
      let parsed;
      try { parsed = phases.parseAgyEnrichResponse(r.answer, { want, ranges }, agyUsage(r.usage)); } catch (e) { return fail(`parse: ${e.message}`); }
      ({ extractions, summary, chaptersText } = parsed);
    } else {
      // Over the cap: extractions part by part, then summary + chapters from them (the batch lane's reduce prompt).
      extractions = [];
      for (const part of parts) {
        const ranges = part.map(rangeOf);
        const r = await call(phases.buildAgyEnrichPrompt({ want: ['extractions'], pages: part.flat(), ranges, bookTitle: title, bookAuthor: author, bookLanguage: lang, msgChars: MSG_CHARS }));
        if (r.cls === 'quota') return { quota: r.err || 'quota', calls: row.calls, row };
        if (r.cls || r.problem) return fail(`call (part ${ranges[0].start}-${ranges[ranges.length - 1].end}): ${r.cls === 'too_long' ? r.err : r.cls || r.problem}`);
        try { extractions.push(...phases.parseAgyEnrichResponse(r.answer, { want: ['extractions'], ranges }, null).extractions); } catch (e) { return fail(`parse: ${e.message}`); }
      }
      want.push('summary', ...(chaptersWanted ? ['chapters'] : []));
      const summaryPrompt = phases.buildBookSummaryRequest(extractions, book.title || title, author, lang, chapters.length ? chapters : undefined, book.display_title || undefined);
      const r = await call(phases.buildAgyEnrichPrompt({ want, bookTitle: title, bookAuthor: author, bookLanguage: lang, summaryPrompt, chapterPrompt: prep?.prompt, msgChars: MSG_CHARS }));
      if (r.cls === 'quota') return { quota: r.err || 'quota', calls: row.calls, row };
      if (r.cls || r.problem) return fail(`call (summary): ${r.cls === 'too_long' ? r.err : r.cls || r.problem}`);
      try { ({ summary, chaptersText } = phases.parseAgyEnrichResponse(r.answer, { want }, agyUsage(r.usage))); } catch (e) { return fail(`parse: ${e.message}`); }
    }
    const useful = extractions.filter(e => e.summary || e.themes.length || e.people.length || e.concepts.length).length;
    row.extractions = { useful, of: extractions.length };
    if (!useful) return fail(`no usable extractions (0/${extractions.length})`);
    if (!summary?.brief) return fail('no summary brief in the reply');
  } else if (chaptersWanted) {
    want.push('chapters');
    const r = await call(phases.buildAgyEnrichPrompt({ want, bookTitle: title, bookAuthor: author, bookLanguage: lang, chapterPrompt: prep.prompt, msgChars: MSG_CHARS }));
    if (r.cls === 'quota') return { quota: r.err || 'quota', calls: row.calls, row };
    if (r.cls || r.problem) return fail(`call (chapters): ${r.cls === 'too_long' ? r.err : r.cls || r.problem}`);
    try { ({ chaptersText } = phases.parseAgyEnrichResponse(r.answer, { want }, null)); } catch (e) { return fail(`parse: ${e.message}`); }
  } else {
    return { dropped: `nothing to do (${row.chapters_skipped || 'chapters not wanted'})`, calls: 0, row };
  }
  if (chaptersWanted && chaptersText == null) return fail('no chapters array in the reply');

  if (c.compareDir) {
    row.secs = (Date.now() - t0) / 1000;
    // How many of the reply's quotes are on the pages (quote-grounding.mjs, the check finishEnrichBook applies).
    let grounding = null;
    if (inputs && extractions) {
      const all = extractions.flatMap(e => e.quotes);
      const g = await groundQuotes(all, buildPageIndex(inputs.pages), { deadline: Date.now() + 60_000 });
      grounding = { quotes: all.length, grounded: g.grounded.length, unattempted: g.unattempted };
    }
    const stored = {
      summary: book.summary || null, reading_summary: book.reading_summary || null, chapters: book.chapters || null,
      book_index: await db.collection('book_indexes').findOne({ book_id: c.id }, { projection: { _id: 0, people: { $slice: 40 }, places: { $slice: 40 }, concepts: { $slice: 40 }, sectionSummaries: 1, pageSummaries: 1, bookSummary: 1, generatedAt: 1, pagesCovered: 1, totalPages: 1 } }),
    };
    fs.writeFileSync(path.join(c.compareDir, `${c.id}.json`), JSON.stringify({ book: { id: c.id, title: book.title, display_title: book.display_title, author: book.author, language: book.language, pages_count: book.pages_count }, row: { ...row, grounding }, agy: { extractions, summary, chapters: chaptersText ? JSON.parse(chaptersText) : null }, stored }, null, 1));
    console.log(`  ${c.id}: ${row.calls} call(s), ${row.secs.toFixed(0)} s, ${row.text_chars ?? '-'} chars, in ${row.usage.input} out ${row.usage.output} tok, quotes grounded ${grounding ? `${grounding.grounded}/${grounding.quotes}` : '-'}`);
    return { written: false, calls: row.calls, row: { ...row, grounding } };
  }

  // Write-time recheck: the book may have been held or had a translation withheld during the call.
  const why = await stillEligible(db, c.id);
  if (why) return { dropped: why, calls: row.calls, row };
  const mine = await db.collection(BOOKS_COLL).findOne({ _id: c.id, agy_run: me.run, stage: 'agy_claimed' }, { projection: { _id: 1 } });
  if (!mine) return fail('claim lost before the write');

  row.secs = (Date.now() - t0) / 1000;
  const engine = geminiEngine({
    call_site: CALL_SITE, api: 'cli', cli: { name: 'agy', version: cliVersion }, model,
    prompt: { id: null, name: 'enrich-agy', version: phases.AGY_ENRICH_PROMPT_VERSION, text: sent.join('\n\n=====\n\n') },
    generationConfig: notRecorded('agy CLI: temperature, token caps and thinking are not exposed'),
    run: { job_id: me.run, code_version: await codeVersion(), host: host(), issue: ISSUE, pool, calls: row.calls, parts: row.parts, prompts_sent: sent.length, usage: row.usage },
    input: inputs ? { source_field: 'translation', pages_with_text: inputs.translatedCount, source_text_chars: row.text_chars, source_text_hash: contentHash(inputs.pages.map(p => p.translation?.data || '').join('\n')) } : notRecorded('chapters only: the prompt is the heading list'),
  });

  let written = false;
  if (c.needIndex) {
    await phases.finishEnrichBook(db, book, inputs, extractions, summary, { mode: 'agy', model, engine });
    written = true;
  }
  let chapters = null;
  if (chaptersText != null) {
    const prov = provenanceUpdate('chapters', {
      source: 'agy-enrich-7628', script: CALL_SITE, method: 'agy_one_call', model, run: me.run, issue: ISSUE,
      prompt_sent_hash: engine.prompt.sent_hash, previous_value: Array.isArray(book.chapters) && book.chapters.length ? { count: book.chapters.length } : null,
    });
    try { chapters = (await phases.applyChapterExtraction(db, c.id, prep, chaptersText, { provenance: prov })).length; } catch (e) { row.chapters_error = e.message.slice(0, 200); }
  }
  phases.revalidateBookPage(c.id).catch(() => {});
  console.log(`  ${c.id}: ${row.calls} call(s), ${row.secs.toFixed(0)} s, ${row.text_chars ?? '-'} chars, in ${row.usage.input} out ${row.usage.output} tok${written ? `, index ${row.extractions.useful}/${row.extractions.of} sections` : ''}${chapters != null ? `, ${chapters} chapters` : ''}`);
  return { written, chapters, calls: row.calls, row: { ...row, chapters } };
}
