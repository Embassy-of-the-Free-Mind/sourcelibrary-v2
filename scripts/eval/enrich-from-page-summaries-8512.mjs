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

// ── judge packets ───────────────────────────────────────────────────────────────────────────────────────────────────
const prose = (s) => s ? { brief: s.brief, abstract: s.abstract, detailed: s.detailed, sections: (s.sections || []).map(x => ({ title: x.title, startPage: x.startPage, endPage: x.endPage, summary: x.summary })) } : null;
const chap = (cs) => (cs || []).map(c => `p.${c.pageNumber} [L${c.level || 1}] ${c.title}${c.titleEn ? ` (${c.titleEn})` : ''}`);

async function pack(db) {
  const ids = fs.readFileSync(opt('ids', path.join(OUT, 'ids.txt')), 'utf8').split(/\s+/).filter(Boolean);
  const aDir = opt('a-dir', path.join(OUT, 'a'));
  const dir = path.join(OUT, 'judge');
  fs.mkdirSync(dir, { recursive: true });
  const key = {};
  for (const id of ids) {
    const A = JSON.parse(fs.readFileSync(path.join(aDir, `${id}.json`), 'utf8'));
    const B = JSON.parse(fs.readFileSync(path.join(OUT, 'b', `${id}.json`), 'utf8'));
    if (!A.agy?.summary || !B.b?.summary) { console.log(`  ${id}: an arm has no summary; skipped`); continue; }
    const aFirst = parseInt(rank(id, 'order').slice(0, 8), 16) % 2 === 0;
    key[id] = { X: aFirst ? 'A' : 'B', Y: aFirst ? 'B' : 'A' };
    const out = { A: { summary: prose(A.agy.summary), chapters: chap(A.agy.chapters) }, B: { summary: prose(B.b.summary), chapters: chap(B.b.chapters) } };
    const book = await db.collection('books').findOne({ id });
    const inputs = await W.loadPhase6Inputs(db, book);
    let headings = [];
    try { headings = (await W.prepareChapterExtraction(db, id)).rawHeadings.map(h => `p.${h.pageNumber} (${h.source}): ${'#'.repeat(h.level)} ${h.title}`); } catch { /* none */ }
    const packet = { book: { id, title: book.title, display_title: book.display_title, author: book.author, language: book.language, pages_count: book.pages_count }, X: out[key[id].X], Y: out[key[id].Y], headings };
    fs.writeFileSync(path.join(dir, `${id}.outputs.json`), JSON.stringify(packet, null, 1));
    fs.writeFileSync(path.join(dir, `${id}.text.txt`), W.pagesTextBlock(inputs.pages));
    console.log(`  ${id}: X=${key[id].X}; text ${fs.statSync(path.join(dir, `${id}.text.txt`)).size} bytes`);
  }
  fs.writeFileSync(path.join(OUT, 'judge-key.json'), JSON.stringify(key, null, 1));
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
  else if (cmd === 'pack') await pack(db);
  else if (cmd === 'write') await write(db);
  else console.log('usage: select | armb | pack | write [--apply]');
} finally { await client.close(); }
process.exit(0);
