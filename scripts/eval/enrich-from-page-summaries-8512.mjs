#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/lib/enrich-agy-lane.mjs — the live one-call lane (arm A, run in its own --compare-out
 * mode); its transport, pool choice, quota floor, prompt builders, parse and write functions are imported here, not
 * copied. It reads the whole English text; this arm reads only the stored page summaries, so it cannot be the lane
 * itself. scripts/maintenance/resynthesize-summaries.mjs re-writes a summary from stored index data (the extractions),
 * not from the translation's per-page <summary> blocks, and calls the paid API.
 *
 * #8512 — can enrichment's book summary + chapters be built from the stored page summaries instead of the full text?
 *
 *   select   pick the books (seeded; rule in the experiment file) → ids file + selection.json
 *   armb     one agy call per book over the page summaries + keywords + the headings the lane's detector finds →
 *            OUT/<id>.json (summary + chapters, parsed by the lane's own parse functions) and the cost row
 *   pack     the blind judge packets: both arms' summary prose + chapters, A/B order by seed, the English text
 *   armc     (#8521) one agy call per book over a SAMPLE of the English text (≤120K characters, one message): the first
 *            15 pages, the first 1-2 pages of every planned section, then evenly spaced pages; same want (extractions +
 *            summary + chapters) and section ranges as the lane → OUT/c/<id>.json in the compare-out shape
 *   score    (#8521) index coverage (A's people/concepts/places the other arm also names), quote grounding, cost
 *   write    write the judged-better summary (+ chapters) through the lane's write path (finishEnrichBook /
 *            applyChapterExtraction) with an engine provenance block; the index from arm A's extractions
 *
 * Run from the main checkout's env: node --env-file=/root/sourcelibrary/.env.production.local <this> <cmd> …
 * Flags: --out=DIR (scratch), --ids=FILE, --a-dir=DIR (arm A compare output), --seed=N (8512), --apply (write only).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import * as W from '../workers/enrich-worker.mjs';
import { gatedTextCall, agyUsage, STDIN_MESSAGE_MAX } from '../lib/agy-cli.mjs';
import { readPools, poolName } from '../lib/agy-pools.mjs';
import { quotaFloor } from '../batch/cli-ocr-lane.mjs';
import { geminiEngine, notRecorded, codeVersion, host, contentHash } from '../lib/write-provenance.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';
import { gapFilter, enrichmentSkip, stillEligible, BOOKS_COLL, MIN_CHAPTER_PAGES } from '../workers/lib/enrich-batch-lane.mjs';
import { claimBook } from '../workers/lib/enrich-agy-lane.mjs';
import { buildPageIndex, groundQuotes } from '../workers/lib/quote-grounding.mjs';

const ISSUE = '#8512';
const CALL_SITE = 'scripts/eval/enrich-from-page-summaries-8512.mjs';
const MODEL = 'gemini-3.8-flash-low';
const PROMPT_VERSION = 'enrich-page-summaries-8512-v1';
const AGY_HOME = '/root/.agy-milo';
const SUFFIX = '\n\nDo not open, read or write any file and do not use any tool: everything you need is above. Write the one JSON object between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.\n';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = null) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = opt('out', path.join(process.env.JOB_SCRATCH || '/tmp', 'enrich-8512'));
const SEED = Number(opt('seed', 8512));
const rank = (id, salt = '') => crypto.createHash('sha256').update(`${SEED}:${salt}:${id}`).digest('hex');
const textOf = (pages) => pages.reduce((t, p) => t + (p.translation?.data?.length || 0), 0);
const hasSummaryTag = (t) => /<summary>[\s\S]*?<\/summary>|\[\[summary:/i.test(t || '');
const keywordsOf = (t) => (String(t || '').match(/<keywords>([\s\S]*?)<\/keywords>/i)?.[1] || '').replace(/\s+/g, ' ').trim();

// ── select ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rule (seed 8512): books ranked by sha256(seed:id) inside a length band; a book is taken when ≥70% of its translated
// pages carry a <summary>, its English is ≤600K characters, ≥50% of its pages are translated, enrichmentSkip passes
// with no withheld page, it has no row in the batch lane's state collection (nothing in flight or failed in either
// lane), and its language is under the cap. Bands: 5 short (100-199 pages), 5 long (400-600, then 250-399).
// Stage 1 draws from the agy lane's own gap (gapFilter allowHeld, as enrich-agy-lane reads it; language cap 3).
// Stage 2 fills what stage 1 could not from live, readable, unheld books outside the gap (language cap 2): on
// 2026-11-10 only 4 gap books passed the rule (63 of 298 looked-at gap books had ≥70% summaries, and 40 of those
// were held as untranslated), so the other 6 are already enriched and are judged, not written.
async function pageStats(db, id) {
  const [r] = await db.collection('pages').aggregate([
    { $match: { book_id: id, 'translation.data': { $exists: true, $ne: '' } } },
    { $project: { n: { $strLenCP: '$translation.data' }, s: { $cond: [{ $regexMatch: { input: '$translation.data', regex: /<summary>[\s\S]*?<\/summary>|\[\[summary:/i } }, 1, 0] } } },
    { $group: { _id: null, translated: { $sum: 1 }, chars: { $sum: '$n' }, withSum: { $sum: '$s' } } },
  ]).toArray();
  return r || { translated: 0, chars: 0, withSum: 0 };
}

async function select(db) {
  const states = new Set((await db.collection(BOOKS_COLL).find({}, { projection: { _id: 1 } }).toArray()).map(r => r._id));
  const bands = [{ name: 'short', min: 100, max: 199, want: 5 }, { name: 'long', min: 400, max: 600, want: 5 }, { name: 'long', min: 250, max: 399, want: 5 }];
  const gap = gapFilter({}, { allowHeld: true });
  const { $or: _gapOr, ...live } = gapFilter({}, { allowHeld: false });
  const stages = [
    { stage: 'gap', filter: gap, langCap: 3 },
    { stage: 'fill', filter: { ...live, summary: { $ne: null }, $nor: [{ chapters: null }, { chapters: { $size: 0 } }] }, langCap: 2 },
  ];
  const picked = [], looked = [];
  const byLang = {};
  const proj = { _id: 0, id: 1, title: 1, display_title: 1, language: 1, pages_count: 1, summary: { $cond: [{ $ifNull: ['$summary', false] }, 1, 0] }, chapters: { $size: { $ifNull: ['$chapters', []] } }, chapters_extracted_at: 1, pipeline_auto: 1, translation_state: 1 };
  for (const st of stages) for (const band of bands) {
    let got = picked.filter(p => p.band === band.name).length;
    if (got >= band.want) continue;
    const cands = (await db.collection('books').find({ ...st.filter, pages_count: { $gte: band.min, $lte: band.max } }, { projection: proj }).toArray())
      .filter(b => !states.has(b.id) && !picked.some(p => p.id === b.id))
      .sort((x, y) => rank(x.id).localeCompare(rank(y.id)));
    console.log(`${st.stage} ${band.min}-${band.max}: ${cands.length} candidates`);
    let n = 0;
    for (const b of cands) {
      if (got >= band.want || n >= 400) break;
      const lang = b.language || 'unknown';
      if ((byLang[lang] || 0) >= st.langCap) continue;
      n++;
      const { translated, chars, withSum } = await pageStats(db, b.id);
      const share = translated ? withSum / translated : 0;
      const row = { id: b.id, stage: st.stage, title: b.display_title || b.title, language: lang, pages_count: b.pages_count, translated, chars, summary_share: +share.toFixed(3), needs_summary: !b.summary, needs_chapters: !b.chapters && !b.chapters_extracted_at && b.pages_count >= MIN_CHAPTER_PAGES };
      looked.push(row);
      if (share < 0.7 || chars > 600_000 || translated < 0.5 * b.pages_count) continue;
      const sk = await enrichmentSkip(db, b, { allowHeld: st.stage === 'gap', tolerateWithheld: false });
      if (sk.skip) { row.skip = sk.skip; continue; }
      if (st.stage === 'gap' && !row.needs_summary && !row.needs_chapters) continue;
      picked.push({ ...row, band: band.name }); got++; byLang[lang] = (byLang[lang] || 0) + 1;
      console.log(`  + ${st.stage} ${b.id} ${lang} ${b.pages_count}pp ${chars} chars, summaries ${(100 * share).toFixed(0)}%  ${row.title?.slice(0, 60)}`);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'selection.json'), JSON.stringify({ seed: SEED, at: new Date(), picked, looked }, null, 1));
  fs.writeFileSync(path.join(OUT, 'ids.txt'), picked.map(p => p.id).join('\n') + '\n');
  console.log(`${picked.length} picked of ${looked.length} looked at → ${OUT}/ids.txt`);
}

// ── arm B ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The page-summary material: one line per translated page, in page order, with its page number and keywords. */
export function pageSummaryMaterial(pages, headings) {
  const sums = new Map(W.extractPageSummaries(pages).map(s => [s.page, s.summary]));
  const lines = [];
  for (const p of pages) {
    if (!p.translation?.data) continue;
    const s = sums.get(p.page_number);
    if (!s) continue;
    const kw = keywordsOf(p.translation.data);
    lines.push(`[Page ${p.page_number}] ${s.replace(/\s+/g, ' ').trim()}${kw ? ` (keywords: ${kw})` : ''}`);
  }
  const seen = new Set();
  const hs = headings.filter(h => h.source === 'translation').filter(h => { const k = `${h.pageNumber}|${h.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { lines, headingLines: hs.map(h => `p.${h.pageNumber}: ${'#'.repeat(h.level)} ${h.title}`) };
}

const MATERIAL_B = `## Material
The book's pages, summarised: one line per translated page, in page order, "[Page N] summary (keywords: …)". These are the summaries the library's translator wrote for each page; the full text is not given. Below them, the headings found in the English text, with their pages. Ground every statement in this material. Section quotes need the book's exact words, which you do not have: give "quotes": [] for every section.`;

async function armB(db) {
  const ids = fs.readFileSync(opt('ids', path.join(OUT, 'ids.txt')), 'utf8').split(/\s+/).filter(Boolean);
  const dir = path.join(OUT, 'b');
  fs.mkdirSync(dir, { recursive: true });
  // Same pool and floor as the lane: the brief names the pool (AGY_HOME=/root/.agy-milo); the floor is the lane's.
  const pool = readPools().find(p => p.home === AGY_HOME);
  const r0 = pool?.reading;
  const q = r0 ? quotaFloor([{ id: 'gemini-weekly', remaining_fraction: r0.weekly, reset_time: r0.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r0.fiveHour }], { floor5h: 0.25, lane: 'enrich' }) : { ok: false, why: 'no reading' };
  console.log(`pool ${poolName({ home: AGY_HOME })}: ${r0 ? `weekly ${(100 * r0.weekly).toFixed(1)}%, 5h ${r0.fiveHour == null ? '-' : (100 * r0.fiveHour).toFixed(1) + '%'}` : 'NO READING'}: ${q.ok ? 'open' : q.why}`);
  if (!q.ok && !args.includes('--ignore-floor')) { console.log('under the quota floor: nothing called'); return; }
  process.env.AGY_HOME = AGY_HOME; process.env.AGY_POOL_SHARED = '1'; process.env.AGY_JOB = 'enrich-summaries-8512';
  const cliVersion = spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
  for (const id of ids) {
    const outFile = path.join(dir, `${id}.json`);
    if (fs.existsSync(outFile) && !args.includes('--redo')) { console.log(`  ${id}: done already`); continue; }
    const t0 = Date.now();
    const book = await db.collection('books').findOne({ id });
    const title = book.display_title || book.title, author = book.author || 'Unknown', lang = book.language || undefined;
    const inputs = await W.loadPhase6Inputs(db, book);
    let prep = null;
    try { prep = await W.prepareChapterExtraction(db, id); } catch (e) { console.log(`  ${id}: no chapter prep (${e.message})`); }
    const wantChapters = (book.pages_count || 0) >= MIN_CHAPTER_PAGES && !!prep;
    const { lines, headingLines } = pageSummaryMaterial(inputs.pages, prep?.rawHeadings || []);
    const chapters = (book.chapters || []).map(ch => ({ title: ch.title, pageNumber: ch.pageNumber }));
    const summaryPrompt = W.buildSummaryPrompt({
      bookTitle: book.title || title, englishTitle: book.display_title || undefined, bookAuthor: author,
      languageContext: lang ? ` The original text is in ${lang}.` : '',
      chapterSection: chapters.length ? `\n## Detected Chapter Structure\n${chapters.map(ch => `- Page ${ch.pageNumber}: ${ch.title}`).join('\n')}\n` : '',
      hasChapters: chapters.length > 0, material: MATERIAL_B,
    });
    const want = ['summary', ...(wantChapters ? ['chapters'] : [])];
    // The lane's own prompt frame (head, tasks, style check, packing) with no page text; the summaries go first.
    const tail = W.buildAgyEnrichPrompt({ want, bookTitle: title, bookAuthor: author, bookLanguage: lang, summaryPrompt, chapterPrompt: prep?.prompt, msgChars: STDIN_MESSAGE_MAX });
    const materialText = `## The page summaries (${lines.length} pages)\n${lines.join('\n')}\n\n## Headings found in the English text\n${headingLines.join('\n') || '(none)'}`;
    let messages;
    if (tail.length === 1 && materialText.length + tail[0].length + 4 <= STDIN_MESSAGE_MAX) messages = [`${materialText}\n\n${tail[0]}`];
    else {
      const chunks = [];
      let cur = '';
      for (const l of materialText.split('\n')) { if (cur && cur.length + l.length + 1 > STDIN_MESSAGE_MAX) { chunks.push(cur); cur = ''; } cur = cur ? `${cur}\n${l}` : l; }
      if (cur) chunks.push(cur);
      const n = chunks.length + tail.length;
      messages = [...chunks.map((c, i) => (i === 0 ? `This comes in ${n} messages. Reply to every message except the last with only the word OK.\n\n${c}` : c)), ...tail];
    }
    const msgs = messages.map((m, i) => (i === messages.length - 1 ? m + SUFFIX : m));
    const r = await gatedTextCall(msgs, { model: MODEL, task: 'translate', attempts: 2, stdin: true, printTimeoutS: 900 });
    if (r.problem === 'text outside the markers' && /^\s*(```\w*)?\s*<<<BEGIN>>>[\s\S]*<<<END>>>\s*(```)?\s*$/.test(r.text)) r.problem = null;
    const row = { book_id: id, model: MODEL, pool: poolName({ home: AGY_HOME }), cli: cliVersion, requests: r.requests, agy_calls: r.calls, secs: (Date.now() - t0) / 1000, agy_secs: r.secs, usage: agyUsage(r.usage), input_chars: msgs.reduce((t, m) => t + m.length, 0), page_lines: lines.length, heading_lines: headingLines.length, translated: inputs.translatedCount, text_chars: textOf(inputs.pages) };
    fs.writeFileSync(path.join(dir, `${id}.reply.txt`), String(r.text || ''));
    fs.writeFileSync(path.join(dir, `${id}.prompt.txt`), msgs.join('\n\n=====\n\n'));
    if (r.cls === 'quota') { console.log(`  ${id}: quota (${r.err}); stop`); return; }
    let parsed = null, error = null;
    if (r.cls || r.problem) error = `call: ${r.cls || r.problem}`;
    else { try { parsed = W.parseAgyEnrichResponse(r.answer, { want }, agyUsage(r.usage)); } catch (e) { error = `parse: ${e.message}`; } }
    if (parsed && !parsed.summary?.brief) error = 'no summary brief';
    if (parsed && wantChapters && parsed.chaptersText == null) error = 'no chapters array';
    fs.writeFileSync(outFile, JSON.stringify({ row: { ...row, error }, b: parsed ? { summary: parsed.summary, chapters: parsed.chaptersText ? JSON.parse(parsed.chaptersText) : null } : null, prompt_hash: contentHash(msgs.join('\n\n')) }, null, 1));
    console.log(`  ${id}: ${row.requests} req, ${row.secs.toFixed(0)} s, in ${row.usage?.input} out ${row.usage?.output} tok, ${lines.length} page lines${error ? `, ERROR ${error}` : ''}`);
  }
}

// ── arm C (#8521): a sample of the real English text ─────────────────────────────────────────────────────────────
// One agy request over at most SAMPLE_CHARS of the book's English, so the conversation is one message: the first
// SAMPLE_HEAD text pages (title page, preface, contents), the first page of every planned section (planPageBatches),
// then the second, then pages spread evenly over what is left (van der Corput order over the unshown pages), each
// added while it fits. Same want and the same section ranges as the live lane; the prompt says it is a sample.
const SAMPLE_CHARS = 120_000;
const SAMPLE_HEAD = 15;
const C_JOB = 'enrich-sample-8521';
const C_HOME = '/root/.agy-james';
const C_PROMPT_VERSION = 'enrich-sampled-text-8521-v1';
const vdc = (i) => { let x = 0, f = 0.5; for (let n = i + 1; n; n >>= 1, f /= 2) if (n & 1) x += f; return x; };
const blockLen = (p) => W.pagesTextBlock([p]).length + 7; // + the '\n\n---\n\n' between pages

/** Pick the sample. Returns { pages (page order), whole, chars } — whole: the book's text already fits the budget. */
export function sampleTextPages(pages, batches, budget = SAMPLE_CHARS) {
  const text = pages.filter(p => p.translation?.data);
  const all = text.reduce((t, p) => t + blockLen(p), 0);
  if (all <= budget) return { pages: text, whole: true, chars: all };
  const chosen = new Set();
  let chars = 0;
  const add = (p) => { if (!p || chosen.has(p.page_number)) return; const n = blockLen(p); if (chars + n > budget) return; chosen.add(p.page_number); chars += n; };
  text.slice(0, SAMPLE_HEAD).forEach(add);
  const byBatch = batches.map(b => b.filter(p => p.translation?.data));
  for (const k of [0, 1]) for (const b of byBatch) add(b[k]);
  const rest = text.filter(p => !chosen.has(p.page_number));
  rest.map((p, i) => ({ p, at: vdc(i) })).sort((x, y) => x.at - y.at).forEach(({ p }) => add(p));
  return { pages: text.filter(p => chosen.has(p.page_number)), whole: false, chars };
}

const MATERIAL_C = (n, of) => `## Material
The book's English text above is a SAMPLE: ${n} of its ${of} translated pages (the opening pages, the first pages of every section, then pages spread through the book). The [Page N] heads give each shown page's number; the pages in between were not given to you. Ground every statement in the pages shown. Claim nothing about pages not shown: do not describe, count or order what is in them, and do not say the book or a section "ends with", "concludes", "throughout" or "in total" unless a shown page says so. Where the sample is thin, say less rather than guess.`;
const SAMPLE_NOTE = (n, of) => `This is a SAMPLE of the book's English text, not the whole of it: ${n} of its ${of} translated pages (the opening pages, the first pages of every section, then pages spread evenly through the book). Pages not shown were not given to you. For every task, draw only on the pages shown and claim nothing about pages that are not shown. Each extraction section lists its full page range, but only some of its pages are shown: draw its entry from those.`;

async function armC(db) {
  const ids = fs.readFileSync(opt('ids', path.join(OUT, 'ids.txt')), 'utf8').split(/\s+/).filter(Boolean);
  const dir = path.join(OUT, 'c');
  fs.mkdirSync(dir, { recursive: true });
  const pool = readPools().find(p => p.home === C_HOME);
  const r0 = pool?.reading;
  const q = r0 ? quotaFloor([{ id: 'gemini-weekly', remaining_fraction: r0.weekly, reset_time: r0.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r0.fiveHour }], { floor5h: 0.25, lane: 'enrich' }) : { ok: false, why: 'no reading' };
  console.log(`pool ${poolName({ home: C_HOME })}: ${r0 ? `weekly ${(100 * r0.weekly).toFixed(1)}%, 5h ${r0.fiveHour == null ? '-' : (100 * r0.fiveHour).toFixed(1) + '%'}` : 'NO READING'}: ${q.ok ? 'open' : q.why}`);
  if (!q.ok && !args.includes('--ignore-floor')) { console.log('under the quota floor: nothing called'); return; }
  // Its own job ledger, not the lane's (enrich-agy): this arm must not spend the live lane's daily cap.
  process.env.AGY_HOME = C_HOME; process.env.AGY_POOL_SHARED = '1'; process.env.AGY_JOB = C_JOB;
  const cliVersion = spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
  for (const id of ids) {
    const outFile = path.join(dir, `${id}.json`);
    if (fs.existsSync(outFile) && !args.includes('--redo')) { console.log(`  ${id}: done already`); continue; }
    const t0 = Date.now();
    const book = await db.collection('books').findOne({ id });
    const title = book.display_title || book.title, author = book.author || 'Unknown', lang = book.language || undefined;
    const inputs = await W.loadPhase6Inputs(db, book);
    const batches = W.planPageBatches(inputs.pages, inputs.chapterTexts);
    const ranges = batches.map(b => ({ start: b[0].page_number, end: b[b.length - 1].page_number }));
    let prep = null;
    try { prep = await W.prepareChapterExtraction(db, id); } catch (e) { console.log(`  ${id}: no chapter prep (${e.message})`); }
    const want = ['extractions', 'summary', ...((book.pages_count || 0) >= MIN_CHAPTER_PAGES && prep ? ['chapters'] : [])];
    const chapters = (book.chapters || []).map(ch => ({ title: ch.title, pageNumber: ch.pageNumber }));
    const of = inputs.translatedCount;
    const build = (budget) => {
      const s = sampleTextPages(inputs.pages, batches, budget);
      const summaryPrompt = W.buildSummaryPrompt({
        bookTitle: book.title || title, englishTitle: book.display_title || undefined, bookAuthor: author,
        languageContext: lang ? ` The original text is in ${lang}.` : '',
        chapterSection: chapters.length ? `\n## Detected Chapter Structure\n${chapters.map(ch => `- Page ${ch.pageNumber}: ${ch.title}`).join('\n')}\n` : '',
        hasChapters: chapters.length > 0, material: s.whole ? W.AGY_SUMMARY_MATERIAL : MATERIAL_C(s.pages.length, of),
      });
      let msgs = W.buildAgyEnrichPrompt({ want, pages: s.pages, ranges, bookTitle: title, bookAuthor: author, bookLanguage: lang, summaryPrompt, chapterPrompt: prep?.prompt, msgChars: STDIN_MESSAGE_MAX });
      if (!s.whole) {
        const before = msgs.join('\n');
        msgs = msgs.map(m => m.replace(' Its English text follows, page by page.', ` ${SAMPLE_NOTE(s.pages.length, of)} The sample follows, page by page.`).replace('That is the whole text.', `That is the whole sample (${s.pages.length} of ${of} pages).`));
        if (msgs.join('\n') === before || !msgs.join('\n').includes('That is the whole sample')) throw new Error('sample note not placed: the lane prompt changed');
      }
      return { s, msgs };
    };
    let budget = SAMPLE_CHARS, built = build(budget);
    // One message: shrink the sample by the overflow until the tasks (chapter heading list included) fit with it.
    while (built.msgs.length > 1 && budget > 40_000) { const over = built.msgs.join('').length - STDIN_MESSAGE_MAX + 2_000; budget -= Math.max(over, 5_000); built = build(budget); }
    if (built.msgs.length > 1) { console.log(`  ${id}: does not fit one message even at ${budget}; skipped`); continue; }
    const { s } = built;
    const msgs = built.msgs.map((m, i, a) => (i === a.length - 1 ? m + SUFFIX : m));
    if (args.includes('--dry')) { console.log(`  ${id}: dry: sample ${s.pages.length}/${of} pages, ${s.chars} chars (budget ${budget}${s.whole ? ', whole' : ''}), ${ranges.length} sections, message ${msgs[0].length} chars, want ${want}`); fs.writeFileSync(path.join(dir, `${id}.prompt.dry.txt`), msgs.join('\n')); continue; }
    const r = await gatedTextCall(msgs, { model: MODEL, task: 'translate', attempts: 2, stdin: true, printTimeoutS: 900 });
    if (r.problem === 'text outside the markers' && /^\s*(```\w*)?\s*<<<BEGIN>>>[\s\S]*<<<END>>>\s*(```)?\s*$/.test(r.text)) r.problem = null;
    const sample = { pages: s.pages.length, of, chars: s.chars, budget, whole: s.whole, text_chars: textOf(inputs.pages), page_numbers: s.pages.map(p => p.page_number) };
    const row = { book_id: id, model: MODEL, pool: poolName({ home: C_HOME }), cli: cliVersion, prompt_version: C_PROMPT_VERSION, requests: r.requests, agy_calls: r.calls, secs: (Date.now() - t0) / 1000, agy_secs: r.secs, usage: agyUsage(r.usage), input_chars: msgs.reduce((t, m) => t + m.length, 0), sample, sections: ranges.length };
    fs.writeFileSync(path.join(dir, `${id}.reply.txt`), String(r.text || ''));
    fs.writeFileSync(path.join(dir, `${id}.prompt.txt`), msgs.join('\n\n=====\n\n'));
    if (r.cls === 'quota') { console.log(`  ${id}: quota (${r.err}); stop`); return; }
    let parsed = null, error = null;
    if (r.cls || r.problem) error = `call: ${r.cls || r.problem}`;
    else { try { parsed = W.parseAgyEnrichResponse(r.answer, { want, ranges }, agyUsage(r.usage)); } catch (e) { error = `parse: ${e.message}`; } }
    if (parsed && !parsed.summary?.brief) error = 'no summary brief';
    if (parsed && want.includes('chapters') && parsed.chaptersText == null) error = 'no chapters array';
    let grounding = null;
    if (parsed) {
      // Verbatim on the page, against the WHOLE book's pages (the check finishEnrichBook applies).
      const all = parsed.extractions.flatMap(e => e.quotes);
      const g = await groundQuotes(all, buildPageIndex(inputs.pages), { deadline: Date.now() + 60_000 });
      grounding = { quotes: all.length, grounded: g.grounded.length, unattempted: g.unattempted };
    }
    fs.writeFileSync(outFile, JSON.stringify({ book: { id, title: book.title, display_title: book.display_title, language: book.language, pages_count: book.pages_count }, row: { ...row, grounding, error }, agy: parsed ? { extractions: parsed.extractions, summary: parsed.summary, chapters: parsed.chaptersText ? JSON.parse(parsed.chaptersText) : null } : null, prompt_hash: contentHash(msgs.join('\n\n')) }, null, 1));
    console.log(`  ${id}: ${row.requests} req, ${row.secs.toFixed(0)} s, in ${row.usage?.input} out ${row.usage?.output} tok, sample ${s.pages.length}/${of} pages ${s.chars} chars${s.whole ? ' (WHOLE TEXT: C = A)' : ''}, quotes ${grounding ? `${grounding.grounded}/${grounding.quotes}` : '-'}${error ? `, ERROR ${error}` : ''}`);
  }
}

// ── score (#8521): index coverage, quote grounding and cost, A against the arm named by --arm ──────────────────────
const normName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const namesOf = (ex, k) => new Set((ex || []).flatMap(e => e[k] || []).map(x => normName(typeof x === 'string' ? x : x?.name || x?.term)).filter(Boolean));
function score() {
  const ids = fs.readFileSync(opt('ids', path.join(OUT, 'ids.txt')), 'utf8').split(/\s+/).filter(Boolean);
  const aDir = opt('a-dir', path.join(OUT, 'a'));
  const arm = opt('arm', 'c');
  const rows = [];
  for (const id of ids) {
    const A = JSON.parse(fs.readFileSync(path.join(aDir, `${id}.json`), 'utf8'));
    const X = JSON.parse(fs.readFileSync(path.join(OUT, arm, `${id}.json`), 'utf8'));
    const cov = {};
    for (const k of ['people', 'concepts', 'places']) {
      const a = namesOf(A.agy.extractions, k), x = namesOf(X.agy?.extractions, k);
      // a name counts as named by the other arm when equal, or one contains the other as whole words (e.g. "Hermes" / "Hermes Trismegistus")
      const hit = [...a].filter(n => x.has(n) || [...x].some(m => ` ${m} `.includes(` ${n} `) || ` ${n} `.includes(` ${m} `))).length;
      cov[k] = { a: a.size, other: x.size, covered: hit };
    }
    rows.push({ id, title: A.book.display_title || A.book.title, language: A.book.language, pages: A.book.pages_count,
      a: { requests: A.row.calls, input: A.row.usage.input, output: A.row.usage.output, secs: A.row.secs, grounding: A.row.grounding, text_chars: A.row.text_chars },
      [arm]: { requests: X.row.requests, input: X.row.usage?.input, output: X.row.usage?.output, secs: X.row.secs, grounding: X.row.grounding, sample: X.row.sample && { pages: X.row.sample.pages, of: X.row.sample.of, chars: X.row.sample.chars, whole: X.row.sample.whole } },
      coverage: cov });
  }
  fs.writeFileSync(path.join(OUT, `score-${arm}.json`), JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(JSON.stringify(r));
}

// ── judge packets ───────────────────────────────────────────────────────────────────────────────────────────────────
const prose = (s) => s ? { brief: s.brief, abstract: s.abstract, detailed: s.detailed, sections: (s.sections || []).map(x => ({ title: x.title, startPage: x.startPage, endPage: x.endPage, summary: x.summary })) } : null;
const chap = (cs) => (cs || []).map(c => `p.${c.pageNumber} [L${c.level || 1}] ${c.title}${c.titleEn ? ` (${c.titleEn})` : ''}`);

async function pack(db) {
  const ids = fs.readFileSync(opt('ids', path.join(OUT, 'ids.txt')), 'utf8').split(/\s+/).filter(Boolean);
  const aDir = opt('a-dir', path.join(OUT, 'a'));
  // --arm=b (default, #8512) or --arm=c (#8521, the sampled-text arm; its order salt differs so it is a fresh draw)
  const arm = opt('arm', 'b'), L = arm.toUpperCase();
  const dir = path.join(OUT, arm === 'b' ? 'judge' : `judge-${arm}`);
  fs.mkdirSync(dir, { recursive: true });
  const key = {};
  for (const id of ids) {
    const A = JSON.parse(fs.readFileSync(path.join(aDir, `${id}.json`), 'utf8'));
    const Bj = JSON.parse(fs.readFileSync(path.join(OUT, arm, `${id}.json`), 'utf8'));
    const B = Bj.b ?? Bj.agy;
    if (!A.agy?.summary || !B?.summary) { console.log(`  ${id}: an arm has no summary; skipped`); continue; }
    const aFirst = parseInt(rank(id, arm === 'b' ? 'order' : `order-${arm}`).slice(0, 8), 16) % 2 === 0;
    key[id] = { X: aFirst ? 'A' : L, Y: aFirst ? L : 'A' };
    const out = { A: { summary: prose(A.agy.summary), chapters: chap(A.agy.chapters) }, [L]: { summary: prose(B.summary), chapters: chap(B.chapters) } };
    const book = await db.collection('books').findOne({ id });
    const inputs = await W.loadPhase6Inputs(db, book);
    let headings = [];
    try { headings = (await W.prepareChapterExtraction(db, id)).rawHeadings.map(h => `p.${h.pageNumber} (${h.source}): ${'#'.repeat(h.level)} ${h.title}`); } catch { /* none */ }
    const packet = { book: { id, title: book.title, display_title: book.display_title, author: book.author, language: book.language, pages_count: book.pages_count }, X: out[key[id].X], Y: out[key[id].Y], headings };
    fs.writeFileSync(path.join(dir, `${id}.outputs.json`), JSON.stringify(packet, null, 1));
    fs.writeFileSync(path.join(dir, `${id}.text.txt`), W.pagesTextBlock(inputs.pages));
    console.log(`  ${id}: X=${key[id].X}; text ${fs.statSync(path.join(dir, `${id}.text.txt`)).size} bytes`);
  }
  fs.writeFileSync(path.join(OUT, arm === 'b' ? 'judge-key.json' : `judge-key-${arm}.json`), JSON.stringify(key, null, 1));
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Per book: the judged-better arm's summary (+ chapters when the book needs them) through the lane's write path. The
// index (book_indexes) comes from arm A's extractions in both cases: every book here lacks a summary or chapters, and
// a book missing its summary is one the lane reads for summary + index together (needIndex), so it would write it.
async function write(db) {
  const verdicts = JSON.parse(fs.readFileSync(opt('verdicts', path.join(OUT, 'verdicts.json')), 'utf8'));
  const aDir = opt('a-dir', path.join(OUT, 'a'));
  const apply = args.includes('--apply');
  const run = `enrich-8512-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}-${process.pid}`;
  const states = db.collection(BOOKS_COLL);
  const cliVersion = spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
  for (const [id, v] of Object.entries(verdicts)) {
    const arm = v.winner === 'B' ? 'B' : 'A'; // a tie goes to the live lane's output
    const A = JSON.parse(fs.readFileSync(path.join(aDir, `${id}.json`), 'utf8'));
    const B = JSON.parse(fs.readFileSync(path.join(OUT, 'b', `${id}.json`), 'utf8'));
    const book = await db.collection('books').findOne({ id });
    const needSummary = !book.summary;
    const needChapters = !(Array.isArray(book.chapters) && book.chapters.length) && !book.chapters_extracted_at && (book.pages_count || 0) >= MIN_CHAPTER_PAGES;
    const chosen = arm === 'B' ? B.b : A.agy;
    const why = await stillEligible(db, id, { withheld: true, allowHeld: true });
    console.log(`  ${id}: ${arm}${v.winner === 'tie' ? ' (tie)' : ''}; summary ${needSummary ? 'needed' : 'present'}, chapters ${needChapters ? 'needed' : 'present'}${why ? `; NOT ELIGIBLE: ${why}` : ''}`);
    if (why || !apply) continue;
    const how = await claimBook(states, id, { run, runTag: 'enrich-summaries-8512' });
    if (!how) { console.log(`    claimed by someone else: skipped`); continue; }
    const inputs = await W.loadPhase6Inputs(db, book);
    const sentText = arm === 'B' ? fs.readFileSync(path.join(OUT, 'b', `${id}.prompt.txt`), 'utf8') : null;
    const engine = geminiEngine({
      call_site: arm === 'B' ? CALL_SITE : 'scripts/workers/lib/enrich-agy-lane.mjs', api: 'cli', cli: { name: 'agy', version: cliVersion }, model: MODEL,
      prompt: { id: null, name: arm === 'B' ? 'enrich-page-summaries' : 'enrich-agy', version: arm === 'B' ? PROMPT_VERSION : W.AGY_ENRICH_PROMPT_VERSION, text: sentText ?? `compare-mode reply, ${A.row.run}` },
      generationConfig: notRecorded('agy CLI: temperature, token caps and thinking are not exposed'),
      run: { job_id: run, code_version: await codeVersion(), host: host(), issue: ISSUE, arm, judged: v.winner, arm_a_run: A.row.run, ...(arm === 'B' ? { calls: B.row.requests, usage: B.row.usage } : { calls: A.row.calls, usage: A.row.usage }) },
      input: arm === 'B'
        ? { source_field: 'translation.<summary>', pages_with_text: inputs.translatedCount, page_summaries: B.row.page_lines, source_text_hash: contentHash(inputs.pages.map(p => p.translation?.data || '').join('\n')) }
        : { source_field: 'translation', pages_with_text: inputs.translatedCount, source_text_chars: textOf(inputs.pages), source_text_hash: contentHash(inputs.pages.map(p => p.translation?.data || '').join('\n')) },
    });
    try {
      if (needSummary) {
        await W.finishEnrichBook(db, book, inputs, A.agy.extractions, { ...chosen.summary, usage: null }, { mode: 'agy', model: MODEL, engine });
        console.log(`    summary + index written`);
      }
      if (needChapters && chosen.chapters) {
        const prep = await W.prepareChapterExtraction(db, id);
        const prov = provenanceUpdate('chapters', { source: `enrich-8512-arm-${arm}`, script: CALL_SITE, method: arm === 'B' ? 'agy_page_summaries' : 'agy_one_call', model: MODEL, run, issue: ISSUE, prompt_sent_hash: engine.prompt.sent_hash, previous_value: null });
        const n = (await W.applyChapterExtraction(db, id, prep, JSON.stringify(chosen.chapters), { provenance: prov })).length;
        console.log(`    ${n} chapters written`);
      }
      await states.updateOne({ _id: id, agy_run: run }, { $set: { stage: 'done', lane: 'agy', agy: { arm, judged: v.winner, issue: ISSUE }, updated_at: new Date() } });
      W.revalidateBookPage(id).catch(() => {});
    } catch (e) {
      console.log(`    FAILED: ${e.message}`);
      await states.updateOne({ _id: id, agy_run: run }, { $set: { stage: 'failed', lane: 'agy', error: String(e.message).slice(0, 500), updated_at: new Date() } });
    }
  }
  await W.drainBackgroundTasks();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
try {
  if (cmd === 'select') await select(db);
  else if (cmd === 'armb') await armB(db);
  else if (cmd === 'armc') await armC(db);
  else if (cmd === 'score') score();
  else if (cmd === 'pack') await pack(db);
  else if (cmd === 'write') await write(db);
  else console.log('usage: select | armb | armc | score | pack [--arm=b|c] | write [--apply]');
} finally { await client.close(); }
process.exit(0);
