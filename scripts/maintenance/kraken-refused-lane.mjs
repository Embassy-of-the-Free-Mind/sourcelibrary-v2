#!/usr/bin/env node
// PRIOR ART: scripts/workers/mineru-ocr-worker.mjs (#5280: the specialist-engine provenance block, the
// fill-only filter with the human-edit guard, the revision snapshot, sweep_log + book_events — the writer
// shape copied here); scripts/workers/syriac-kraken-lane.mjs + scripts/lib/syriac-kraken-lane.mjs (Kraken
// batches under nice, the Gemini stamps unset on the page they no longer describe — but Syriac models,
// routing by manuscript/print, and it REWRITES pages; this lane only fills empty ones); /root/kraken-on-refused.sh
// (the #4686 five-page probe, no writes). None fills Gemini RECITATION refusals on English print.
/**
 * kraken-refused-lane.mjs — fill pages Gemini refused as RECITATION with a Kraken read (#4686).
 *
 * WHY. Gemini (lite and flash, every tier) returns zero characters with finishReason RECITATION on pages of
 * famous English texts, and retrying never helps. Kraken has no policy layer. Measured before this lane was
 * allowed to write: `scripts/eval/experiments/2026-10-06-kraken-refused-english-4686.md` (20 refused pages,
 * blind by-eye references, preregistered gate) and #5660 r3 (CATMuS-Print on human-keyed EEBO-TCP English
 * 1600–1699: CER 0.046 vs lite 0.053; 1700+: 0.018 vs 0.022). The measured scope is ENGLISH PRINT 1600–1799,
 * and the lane refuses any other book.
 *
 * WHAT IT WRITES (only with --apply; a dry run reads, runs Kraken, and reports):
 *   - only pages with `ocr.recitation_blocked: true` and no `ocr.data`, never a page with `ocr.edited_by` or
 *     `ocr.source: 'manual'` (both in the update FILTER, so a page edited mid-run is not overwritten);
 *   - `ocr.data` (Kraken's lines, NFC, trailing blanks dropped), `ocr.content_hash`, `ocr.source: 'kraken'`,
 *     `ocr.model: 'kraken/<model>'`, `ocr.pipeline: 'kraken-refused-4686'`, `ocr.language` (the BOOK's catalogue
 *     language, named as such in the engine block: Kraken does not identify languages), and `ocr.engine`
 *     (`specialist-engine/1`: Kraken version, model file + sha256 + licence, segmenter, run, image, and the
 *     Gemini refusal stamps under `ladder`). The top-level refusal stamps are unset: they described the empty
 *     page, and the ladder keeps them.
 *   - a revision snapshot first (a no-op on a fill, doctrine), then per book a `sweep_log` row, a `book_events`
 *     row, and `recountBook()`.
 * WHAT IT NEVER TOUCHES: `translation.*` (English books are not translated: translate-core `english-book`),
 * `pipeline_auto.*`, `visible`/`hidden`, `language`. The lane is NOT in stale-translation's WITHHOLD_LANES and
 * queues no paid work.
 * PAGE GUARDS (a page that fails one is recorded in the run file and left empty — never stored as confident text):
 *   fewer than MIN_LETTERS letters (a plate or blank leaf), the degeneration-loop guard (#4850), and a garble
 *   guard (Kraken fails LOUD on a speckled page, #5660 r3: tokens with no vowel or a high non-letter share).
 *
 * DIGIT REPAIR (#4686 Amendment 1, job kraken-digits-4686). Kraken reads 17th-c. old-style figures as letters
 * ("66" → "cé", "10." → "io."). With `--precomputed <dir>` the lane does not run Kraken: it reads the text that
 * scripts/gpu/kraken-digits-4686-scw.sh produced on a leased GPU (Kraken CATMuS-Print on CUDA, number tokens
 * arbitrated against GLM-OCR by scripts/lib/glm-digit-repair.mjs, merged by
 * scripts/eval/kraken-refused-4686/glm-digits.mjs), and records GLM in `ocr.engine.digit_repair` (model,
 * revision, vLLM version, prompt, GPU run, and every token it changed on that page). The page guards still run.
 *
 * Usage (on Hetzner, where Kraken is installed; niced — the box is shared):
 *   node --env-file=.env.production.local scripts/maintenance/kraken-refused-lane.mjs --books <id,id> [--apply]
 *        [--limit N] [--batch 6] [--dir /root/kraken-refused-lane] [--kraken <bin>] [--model <file>]
 *        [--precomputed /root/kraken-digits-4686]
 * Resumable: Kraken outputs are cached under --dir/<book>/; a rerun reads what is there.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync, execFileSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { contentHash, codeVersion, host, notRecorded, missingProvenance } from '../lib/write-provenance.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';

export const LANE = 'kraken-refused-4686';
export const LANE_ISSUE = '#4686';
export const BOOK_EVENT = 'kraken_refused_fill';
export const EVAL = 'scripts/eval/experiments/2026-10-06-kraken-refused-english-4686.md';
export const EVAL_DIGITS = 'scripts/eval/experiments/2026-10-06-glm-digit-repair-4686.md';
export const GLM_PROMPT = 'Text Recognition:';
export const MAX_CHANGES_STORED = 60;
export const MIN_LETTERS = 40;
/** Measured scope: English print, 1600–1799 (see header). */
export const SCOPE = { language: /^english$/i, yearFrom: 1600, yearTo: 1799 };
const REFUSAL_STAMPS = ['recitation_count', 'recitation_blocked', 'last_recitation_at'];

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const BOOKS = String(opt('--books', '')).split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = Number(opt('--limit', '0')) || 0;
const BATCH = Number(opt('--batch', '6'));
const DIR = opt('--dir', '/root/kraken-refused-lane');
const KRAKEN_BIN = opt('--kraken', '/root/bench2-kraken/venv/bin/kraken');
const MODEL_FILE = opt('--model', '/root/.local/share/htrmopo/d96caf7a-122e-5576-ab2b-a246c4e64221/catmus-print-fondue-large.mlmodel');
const PRE = opt('--precomputed', null);

/** The model this lane was measured with; anything else is refused rather than mislabelled. */
const MODELS = {
  '1ed39e732b26ccdd0f14b9abd3edc66c4b04a02e3d827d7f9e96a7fe7b585b64': {
    key: 'catmus-print-fondue-large',
    label: 'CATMuS-Print (Large, 2024-01-30) — diachronic model for French prints and other languages',
    author: 'Simon Gabay (Université de Genève)',
    licence: 'CC-BY-4.0',
    source: 'HTRMoPo / Zenodo, installed by `kraken get` (htrmopo d96caf7a-122e-5576-ab2b-a246c4e64221)',
  },
};

// ── pure helpers (exported for the unit test) ──
/** Kraken's lines as stored: NFC, trailing whitespace off each line, no trailing blank lines. */
export function cleanKraken(raw) {
  const lines = String(raw || '').normalize('NFC').split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines.join('\n');
}
export const letterCount = (s) => (String(s).match(/\p{L}/gu) || []).length;
/**
 * Kraken's failure on a bad image is garble, not plausible prose (#5660 r3 by-eye 3): word-like tokens
 * without vowels, and a high share of non-letter characters. Thresholds checked on the 20 eval pages
 * (all pass) — see the experiment file.
 */
export function garbleVerdict(text) {
  const toks = String(text).toLowerCase().match(/[\p{L}ſ]{2,}/gu) || [];
  const noVowel = toks.filter(t => !/[aeiouyæœäöüéèàâêîôûſ]/u.test(t) && !/^(st|nd|rd|th|mr|dr|sr|ff|ll|ss|pp|cc|vv|ws|wch|cf|xx|xv|xi|vi|iv|ix|lx|cl|mm|ii|iii)$/.test(t)).length;
  const chars = String(text).replace(/\s+/g, '');
  const nonLetter = chars.length ? (chars.match(/[^\p{L}\p{N}.,;:'’()\-&]/gu) || []).length / chars.length : 0;
  const noVowelShare = toks.length ? noVowel / toks.length : 0;
  return { refuse: toks.length >= 20 && (noVowelShare > 0.2 || nonLetter > 0.12), noVowelShare: Math.round(noVowelShare * 1000) / 1000, nonLetter: Math.round(nonLetter * 1000) / 1000 };
}
/** The update filter: a refused page, still empty, no person's hand on it. */
export const fillFilter = (pageId) => ({
  id: pageId,
  'ocr.recitation_blocked': true,
  $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }],
  'ocr.edited_by': { $exists: false },
  'ocr.source': { $ne: 'manual' },
});
export function inScope(book) {
  const y = Number(book?.year);
  return SCOPE.language.test(String(book?.language || '')) && Number.isFinite(y) && y >= SCOPE.yearFrom && y <= SCOPE.yearTo;
}
/** The `ocr.engine` block. */
/**
 * The `ocr.engine.digit_repair` block: which GLM-OCR read supplied this page's numbers, and every token it changed.
 * `box` is the GPU run's box.json; `row` the page's line in merged/changes.jsonl.
 */
export function digitRepairBlock({ box, row, gpuRun }) {
  const vllm = (String(box?.versions || '').match(/vllm\s+([\d.]+)/) || [])[1] || notRecorded('vllm version not in box.json');
  return {
    engine: 'glm-ocr',
    model: 'zai-org/GLM-OCR',
    revision: box?.glm_revision || notRecorded('GLM revision not in box.json'),
    server: `vLLM ${vllm}`,
    prompt: GLM_PROMPT,
    temperature: 0,
    image: 'archived master, downscaled to ≤ 2400 px wide',
    rule: 'scripts/lib/glm-digit-repair.mjs (number tokens only; Kraken\'s letters, lines and furniture kept)',
    glm_read: !!row?.glm,
    tokens: row?.tokens ?? null,
    tokens_changed: row?.changed ?? 0,
    changes: (row?.changes || []).slice(0, MAX_CHANGES_STORED).map(c => ({ line: c.line, from: c.from, to: c.to })),
    changes_truncated: (row?.changes || []).length > MAX_CHANGES_STORED,
    run: gpuRun,
    eval: EVAL_DIGITS,
  };
}

export function engineBlock({ model, krakenVersion, run, imageUrl, priorOcr, secs, bookLanguage, device = 'cpu', digitRepair = null }) {
  const ladder = {};
  for (const k of [...REFUSAL_STAMPS, 'fail_count', 'fail_reason', 'fail_blocked', 'fail_blocked_model']) if (priorOcr && priorOcr[k] !== undefined) ladder[k] = priorOcr[k];
  return {
    schema: 'specialist-engine/1',
    name: 'kraken',
    version: krakenVersion,
    model: model.key,
    model_label: model.label,
    model_author: model.author,
    model_sha256: model.sha256,
    model_source: model.source,
    licence: model.licence,
    segmenter: 'blla default baseline segmenter (`segment -bl`)',
    device,
    post: `lines as Kraken wrote them${digitRepair ? ', number tokens arbitrated against GLM-OCR (digit_repair)' : ''}, NFC, trailing whitespace dropped; MIN_LETTERS, loop (#4850) and garble guards`,
    language_source: `books.language (${bookLanguage}); Kraken does not identify languages`,
    run: { ...run, secs_batch: secs },
    issue: LANE_ISSUE,
    eval: EVAL,
    ...(digitRepair ? { digit_repair: digitRepair } : {}),
    ladder: Object.keys(ladder).length ? ladder : null,
    input: imageUrl ? { image_url: imageUrl } : notRecorded('page had no image url'),
  };
}
export function setFields(text, { engine, language, now }) {
  return {
    'ocr.data': text,
    'ocr.content_hash': contentHash(text),
    'ocr.language': language,
    'ocr.model': `kraken/${engine.model}`,
    'ocr.source': 'kraken',
    'ocr.pipeline': LANE,
    'ocr.engine': engine,
    'ocr.updated_at': now,
    updated_at: now,
  };
}

// ── run ──
const imgUrl = (p) => p.archived_photo || p.display_photo || p.photo || null;
const append = (f, row) => fs.appendFileSync(f, JSON.stringify(row) + '\n');

async function main() {
  if (!BOOKS.length) throw new Error('--books <id,id,…> required (this lane runs on named books only)');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(MODEL_FILE)).digest('hex');
  if (!MODELS[sha]) throw new Error(`model ${MODEL_FILE} (sha256 ${sha.slice(0, 12)}…) is not the measured one; refusing`);
  const model = { ...MODELS[sha], sha256: sha, file: path.basename(MODEL_FILE) };
  const box = PRE ? JSON.parse(fs.readFileSync(path.join(PRE, 'box.json'), 'utf8')) : null;
  const preRows = new Map();
  if (PRE) for (const l of fs.readFileSync(path.join(PRE, 'merged', 'changes.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); preRows.set(`${r.bid}/${r.pn}`, r); }
  const krakenVersion = PRE
    ? ((String(box.versions).match(/kraken, version (\d+\.\d+(?:\.\d+)?)/) || [])[1] || notRecorded('kraken version not in box.json'))
    : ((String(execFileSync(KRAKEN_BIN, ['--version'])).match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || notRecorded('kraken --version unparsed'));
  const gpuRun = box ? { id: `kraken-digits-4686/${box.server_id}`, host: box.host, gpu: box.type, code_rev: box.code_rev } : null;
  const run = { id: `${LANE}/${new Date().toISOString().slice(0, 19)}/${host()}`, code_version: await codeVersion(), host: host(), started_at: new Date() };
  fs.mkdirSync(DIR, { recursive: true });
  const runFile = path.join(DIR, `run-${run.started_at.toISOString().slice(0, 19).replace(/:/g, '')}.jsonl`);
  console.log(`[${LANE}] ${APPLY ? 'APPLY' : 'DRY RUN'} · kraken ${krakenVersion} · ${model.key}${PRE ? ` · precomputed ${PRE} (GPU + GLM digits)` : ''} · run file ${runFile}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const pagesCol = db.collection('pages');
  const totals = {};
  try {
    for (const bookId of BOOKS) {
      const book = await db.collection('books').findOne({ $or: [{ id: bookId }, { _id: bookId }] }, { projection: { id: 1, title: 1, year: 1, language: 1 } });
      if (!book) { console.log(`${bookId}: not found`); continue; }
      const bid = book.id || String(book._id);
      if (!inScope(book)) { console.log(`${bid}: out of the measured scope (${book.language}, ${book.year}) — skipped`); totals[bid] = { skipped: 'out-of-scope' }; continue; }
      let pages = await pagesCol.find({
        book_id: bid, 'ocr.recitation_blocked': true,
        $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }],
        'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' },
      }).project({ id: 1, page_number: 1, archived_photo: 1, display_photo: 1, photo: 1, ocr: 1 }).sort({ page_number: 1 }).toArray();
      if (LIMIT) pages = pages.slice(0, LIMIT);
      const t = totals[bid] = { title: book.title, eligible: pages.length, read: 0, written: 0, empty: 0, loop: 0, garble: 0, failed: 0 };
      console.log(`${bid} ${book.title}: ${pages.length} refused empty pages`);
      const bookDir = path.join(DIR, bid);
      fs.mkdirSync(bookDir, { recursive: true });
      for (let i = 0; i < pages.length; i += BATCH) {
        const batch = pages.slice(i, i + BATCH);
        const todo = [];
        for (const p of batch) {
          if (PRE) break;
          const img = path.join(bookDir, `${p.page_number}.jpg`), out = path.join(bookDir, `${p.page_number}.txt`);
          if (fs.existsSync(out)) continue;
          if (!fs.existsSync(img)) {
            const res = await fetch(imgUrl(p));
            if (!res.ok) { append(runFile, { book: bid, page: p.page_number, status: 'image-fetch-failed', http: res.status }); t.failed++; continue; }
            fs.writeFileSync(img, Buffer.from(await res.arrayBuffer()));
          }
          todo.push([img, out]);
        }
        let secs = 0;
        if (todo.length) {
          const t0 = Date.now();
          const args = []; for (const [img, out] of todo) args.push('-i', img, out);
          args.push('segment', '-bl', 'ocr', '-m', MODEL_FILE);
          const r = spawnSync('nice', ['-n', '19', KRAKEN_BIN, ...args], { encoding: 'utf8', timeout: 3600_000, maxBuffer: 64 << 20, env: { ...process.env, OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '2' } });
          secs = Math.round((Date.now() - t0) / 1000);
          if (r.status !== 0) append(runFile, { book: bid, batch_from: batch[0].page_number, status: 'kraken-rc', rc: r.status, signal: r.signal, err: (r.stderr || '').slice(-400) });
        }
        const ops = [];
        for (const p of batch) {
          const out = PRE ? path.join(PRE, 'merged', bid, `${p.page_number}.txt`) : path.join(bookDir, `${p.page_number}.txt`);
          if (!fs.existsSync(out)) { t.failed++; append(runFile, { book: bid, page: p.page_number, status: 'no-output' }); continue; }
          t.read++;
          const text = cleanKraken(fs.readFileSync(out, 'utf8'));
          const g = garbleVerdict(text);
          const status = letterCount(text) < MIN_LETTERS ? 'empty' : loopVerdict(text).refuse ? 'loop' : g.refuse ? 'garble' : 'ok';
          append(runFile, { book: bid, page: p.page_number, page_id: p.id, status, letters: letterCount(text), ...g });
          if (status !== 'ok') { t[status]++; continue; }
          ops.push({ p, text });
        }
        if (!APPLY || !ops.length) { if (!APPLY) t.written += ops.length; continue; }
        await saveRevisionsBeforeOverwrite(db, ops.map(o => o.p.id), 'ocr', { reason: 'kraken_refused_fill_4686', keepMeta: true });
        const now = new Date();
        for (const { p, text } of ops) {
          const digitRepair = PRE ? digitRepairBlock({ box, row: preRows.get(`${bid}/${p.page_number}`), gpuRun }) : null;
          const engine = engineBlock({ model, krakenVersion, run, imageUrl: imgUrl(p), priorOcr: p.ocr, secs: PRE ? null : secs, bookLanguage: book.language, device: PRE ? `cuda (${box.type}, ${box.host})` : 'cpu', digitRepair });
          const $set = setFields(text, { engine, language: book.language, now });
          const check = missingProvenance('ocr', { data: text, content_hash: $set['ocr.content_hash'], updated_at: now, source: 'kraken', engine });
          if (check.missing.length) throw new Error(`provenance incomplete for ${p.id}: ${check.missing.join(', ')}`);
          const $unset = Object.fromEntries(REFUSAL_STAMPS.map(k => [`ocr.${k}`, '']));
          const r = await pagesCol.updateOne(fillFilter(p.id), { $set, $unset });
          if (r.modifiedCount) t.written++;
          else append(runFile, { book: bid, page: p.page_number, status: 'filter-no-match (filled or edited meanwhile)' });
        }
        console.log(`  ${bid}: through p${batch[batch.length - 1].page_number} · written ${t.written} · ${secs}s`);
      }
      if (APPLY) {
        const counts = await recountBook(db, bid, { reason: LANE });
        const { title: _title, ...tally } = t;
        const detail = { run: run.id, kraken: krakenVersion, model: model.key, ...(gpuRun ? { digit_repair: 'glm-ocr', gpu_run: gpuRun.id } : {}), ...tally, pages_ocr_after: counts.after?.pages_ocr ?? null };
        await recordSweepAction(db, { sweep: LANE, book_id: bid, action: t.written ? 'filled' : 'nothing-filled', detail });
        await db.collection('book_events').insertOne({ book_id: bid, type: BOOK_EVENT, at: new Date(), source: LANE, details: { ...detail, issue: LANE_ISSUE, eval: EVAL } });
      }
      console.log(`${bid}: ${JSON.stringify(t)}`);
    }
  } finally {
    await client.close();
  }
  console.log(`[${LANE}] done ${APPLY ? '' : '(dry run: nothing written) '}${JSON.stringify(totals)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
