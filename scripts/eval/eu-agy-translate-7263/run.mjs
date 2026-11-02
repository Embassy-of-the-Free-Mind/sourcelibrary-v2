#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs — the stage layout (plan / arms / judge / analyze), the read-only
// Mongo preload for the readers and the paired verdict; it runs OCR routes only (stored lite, agy correction, agy read)
// and cannot run a translation arm. scripts/eval/route-judge-6740/judge.mjs — judgePrompt (translation form) and
// parseVerdict, imported unchanged; its opusCall reports no tool use, and this brief needs every verdict's transcript to
// show the image opened, so the call here is the same sealed call with stream-json output. The Tibetan translation router
// test (scripts/eval/experiments/2026-10-27-tibetan-translation-router-agy4-vs-opus10-6948.md) — the same design (agy@4
// against the cell's route, Opus judge with the image) on a diagnostic set, not a lane frame.
// scripts/lib/translate-batch-chained.mjs buildRoundRequest + translate-core parseBlockTranslations — the Flash-Lite
// chained lane's own request and parse, so arm R is the production route, not a re-implementation.
/**
 * #7263 European translation cell test: agy Gemini 3.8 Flash-low, 4 pages a call (claude-translate.mjs --cli=agy), against
 * the cell's current route, gemini-3.1-flash-lite (the routing table's `default` row, the chained Batch lane's block
 * request sent synchronously), on the SAME untranslated pages, judged blind by Opus with the page image.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/eu-agy-translate-7263/run.mjs plan [--n=30]
 *   ... run.mjs arm-a [--concurrency=2]     agy reads (AGY_HOME), then a dry apply + a dry pass through the write door
 *   ... run.mjs arm-r [--concurrency=4]     Flash-Lite, paid API (cents), then the same dry door
 *   ... run.mjs judge [--max-calls=300] [--concurrency=3]
 *   ... run.mjs analyze                      results/score.json + the per-cell rule
 *   ... run.mjs stage-writes                 the better ACCEPTED arm per page, into OUT/write/{a,r}
 *
 * FRAME, per language (Latin, German, Italian, French; the book's FIRST language label): visible books with pages,
 * translation_state.rung transcribed | translating, no pipeline hold other than scans-only-publish-* (a publication hold,
 * not a containment), not loop-quarantined. In each book, one page uniform among its UNTRANSLATED pages
 * (cli-translate-lane.mjs) that are translatable (isTranslatablePage), hold 200+ characters of OCR and sit between 15%
 * and 95% of the book; its image must load. Books in a seeded order, one page a book, n per language (fewer when the
 * frame is smaller: no second pages). The page's stored OCR engine and script class are recorded.
 *
 * BLOCKS. Each arm reads the test page as the FIRST page of a block of its book's following untranslated pages, as its
 * lane would: agy up to 4 a call (claude-translate planBlocks, per-call 4), Flash-Lite up to 8 (the chained lane's
 * planBlocks, 20K chars), each seeded from the stored English of the page before. Only the test page is judged.
 *
 * WHAT COUNTS AS AN ARM'S TEXT: what its lane would WRITE. agy: cli-translate.mjs apply's dry run (markers, chatter,
 * the <<<END>>> cut of #7784) and then translate-core's door (writePageTranslation with refuseUnhealthy, run against a
 * database proxy that drops every write). Flash-Lite: the block parse, echo-shift and drift guards of collectRound, the
 * single-page fallback once, then the same door. A page an arm does not write is NOT accepted, and is not judged.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { UNTRANSLATED } from '../../batch/cli-translate-lane.mjs';
import { isTranslatablePage, loadTranslationPrompts, parseBlockTranslations, assessTranslationHealth, writePageTranslation, sanitizeTranslationTags, contentHash } from '../../lib/translate-core.mjs';
import { planBlocks, batchRequest, maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { buildRoundRequest } from '../../lib/translate-batch-chained.mjs';
import { dropDriftedPages } from '../../lib/block-drift.mjs';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { judgePrompt, parseVerdict, QUOTA } from '../route-judge-6740/judge.mjs';
import { makeRng, resetSeed, bootstrapCI, binomTwoSided } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const PRELOAD = path.join(ROOT, 'scripts/eval/router-confirm/readonly-mongo.mjs');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'eu-agy-translate-7263'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, x) => fs.appendFileSync(path.join(OUT, f), JSON.stringify({ ...x, at: new Date().toISOString() }) + '\n');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const SEED = 7263_1101;
export const LANGS = ['Latin', 'German', 'Italian', 'French'];
export const LITE = 'gemini-3.1-flash-lite';
export const AGY_MODEL = 'gemini-3.8-flash-low';
const ALLOWED_HOLD = /^scans-only-publish-\d+$/;
const REASON = '#7263 European agy translation cell test (eu-agy-translate-cell-7263)';
const OCR_CHECKED = 'eval read (#7263 cell test): every drawn page is judged by Opus against its image; nothing is written from this read unless accepted';

async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 }); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }
export const firstLabel = (language) => String(language || '').split(/[,;/]| and /)[0].trim();

// ── plan ──
const PAGE_PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, script_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 };

/** The book's untranslated, translatable pages in page order (the lane's page rule). */
async function owedPages(db, book) {
  const rows = await db.collection('pages').find({ book_id: book.id, ...UNTRANSLATED }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
  return rows.filter((p) => isTranslatablePage(p).ok);
}

/** The run of consecutive owed pages from index i (by page number), at most max. */
export function runFrom(owed, i, max) {
  const out = [owed[i]];
  for (let j = i + 1; j < owed.length && out.length < max; j++) { if (owed[j].page_number !== out[out.length - 1].page_number + 1) break; out.push(owed[j]); }
  return out;
}

async function plan() {
  const n = Number(arg('n') || 30);
  const res = await withDb(async (db) => {
    const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, 'translation_state.rung': { $in: ['transcribed', 'translating'] }, language: { $regex: `^(${LANGS.join('|')})`, $options: 'i' } },
      { projection: { _id: 0, id: 1, title: 1, language: 1, year: 1, pages_count: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.held': 1, 'translation_state.rung': 1 } }).toArray())
      .filter((b) => b.id).sort((a, b) => a.id.localeCompare(b.id));
    const out = {};
    for (const [li, lang] of LANGS.entries()) {
      const inLang = books.filter((b) => firstLabel(b.language).toLowerCase() === lang.toLowerCase());
      const excluded = {};
      const frame = inLang.filter((b) => {
        const hr = b.pipeline_auto?.hold?.reason;
        const why = b.pipeline_auto?.status === 'loop_quarantine_hold' ? 'loop_quarantine_hold' : hr && !ALLOWED_HOLD.test(hr) ? `hold ${hr}` : (!hr && b.pipeline_auto?.held) ? 'held, no reason' : null;
        if (why) excluded[why] = (excluded[why] ?? 0) + 1;
        return !why;
      });
      const rnd = makeRng(SEED + li);
      const sel = [], skipped = {};
      for (const b of shuffle(frame, rnd)) {
        if (sel.length >= n) break;
        const owed = await owedPages(db, b);
        const lo = Math.ceil(0.15 * b.pages_count), hi = Math.floor(0.95 * b.pages_count);
        const cands = owed.map((p, i) => ({ p, i })).filter(({ p }) => p.page_number >= lo && p.page_number <= hi && (p.ocr?.data || '').length >= 200);
        if (!cands.length) { skipped['no owed interior page with 200+ chars'] = (skipped['no owed interior page with 200+ chars'] ?? 0) + 1; continue; }
        const { p, i } = cands[Math.floor(makeRng(SEED + li * 1e6 + parseInt(b.id.slice(-6), 16))() * cands.length)];
        const image = getPageSource(p);
        let bytes = 0;
        try { const r = await fetch(image, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' } }); bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0; } catch { bytes = 0; }
        if (bytes < 2000) { skipped['image does not load'] = (skipped['image does not load'] ?? 0) + 1; continue; }
        const sc = scriptClass(p.ocr.data, p.script_type, null);
        const key = `${lang.slice(0, 2).toLowerCase()}-${p.id}`;
        sel.push({ key, lang, book_id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, year: b.year ?? null, pages_count: b.pages_count,
          hold: b.pipeline_auto?.hold?.reason ?? null, status: b.pipeline_auto?.status ?? null, rung: b.translation_state?.rung,
          page_id: p.id, page_number: p.page_number, position: +(p.page_number / b.pages_count).toFixed(3), image, ocr_model: p.ocr?.model ?? null, ocr_source: p.ocr?.source ?? null,
          ocr_chars: p.ocr.data.length, ocr_sha: contentHash(p.ocr.data), script: sc.script_type, script_source: sc.script_source, owed_in_book: owed.length,
          block_a: runFrom(owed, i, 4).map((x) => x.id), block_r: runFrom(owed, i, 8).map((x) => x.id) });
        console.log(`  ${lang} ${sel.length}/${n} ${b.id} p.${p.page_number}/${b.pages_count} ${p.ocr?.model} ${sc.script_type} ${String(b.title || '').slice(0, 50)}`);
      }
      out[lang] = { books_with_label: inLang.length, frame_books: frame.length, excluded, skipped, selected: sel };
    }
    return out;
  });
  W('plan.json', { at: new Date().toISOString(), seed: SEED, n_target: n, frame_rule: 'see run.mjs header', langs: res });
  for (const [l, r] of Object.entries(res)) console.log(`${l}: frame ${r.frame_books} books (of ${r.books_with_label}; excluded ${JSON.stringify(r.excluded)}), drawn ${r.selected.length}; skipped ${JSON.stringify(r.skipped)}`);
}
const selected = () => Object.values(J('plan.json').langs).flatMap((l) => l.selected);

// ── the write door, dry ──
/** A db whose reads are the real database's and whose writes do nothing: writePageTranslation's verdict without a write. */
export function dryDb(db) {
  const WRITES = /^(insert|update|replace|delete|bulkWrite|findOneAnd)/;
  const noop = async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1, insertedId: null, upsertedCount: 0, deletedCount: 0 });
  return new Proxy(db, { get(t, k) {
    if (k !== 'collection') return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
    return (name) => { const c = t.collection(name); return new Proxy(c, { get(ct, m) { if (typeof m === 'string' && WRITES.test(m)) return noop; const v = ct[m]; return typeof v === 'function' ? v.bind(ct) : v; } }); };
  } });
}
export async function doorVerdict(db, pageId, text, { model, finishReason } = {}) {
  const page = await db.collection('pages').findOne({ id: pageId });
  const book = await db.collection('books').findOne({ id: page.book_id });
  const r = await writePageTranslation(dryDb(db), { page, book, text, model, jobId: 'eu-agy-translate-7263-dry', note: 'dry', refuseUnhealthy: true, finishReason,
    call: { call_site: 'scripts/eval/eu-agy-translate-7263/run.mjs (dry door)', api: 'realtime', model, promptText: 'dry door: no prompt', prompt_sent_hash: 'dry-door', prompt_sent_chars: 0, generationConfig: {}, run: { job_id: 'eu-agy-translate-7263-dry' } } });
  return r.written ? { ok: true, text: r.text } : { ok: false, why: r.protected ? 'human-edited' : r.truncated ? `truncated: ${r.reason}` : r.unhealthy ? `unhealthy: ${r.reason}` : `not written: ${r.reason ?? r.emptyResponse ?? '?'}` };
}

// ── arm A: agy@4 ──
function node(args, log, env = {}) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--import=${PRELOAD}`, ...args], { stdio: ['ignore', fd, fd], env: { ...process.env, ...env } });
    child.on('close', (code) => { fs.closeSync(fd); resolve(code); });
  });
}
async function armA() {
  const conc = Math.max(1, Math.min(3, Number(arg('concurrency') || 2)));
  const done = new Set(jsonl(path.join(OUT, 'arm-a.jsonl')).filter((r) => !r.quota).map((r) => r.key));
  const todo = selected().filter((s) => !done.has(s.key)).slice(0, Number(arg('limit') || Infinity));
  console.log(`arm A: ${todo.length} of ${selected().length} to read; AGY_HOME=${process.env.AGY_HOME || '(default)'}`);
  let i = 0, stop = null;
  await withDb(async (db) => {
    await Promise.all(Array.from({ length: conc }, async () => {
      while (!stop && i < todo.length) {
        const s = todo[i++];
        const dir = path.join(OUT, 'a', s.key); fs.mkdirSync(dir, { recursive: true });
        const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(s.block_a));
        const code = await node([path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', '--cli=agy', '--per-call=4', `--model=${AGY_MODEL}`, `--page-ids-file=${ids}`, `--out=${dir}`, '--job=eu-agy-translate-7263', '--fresh', `--ocr-checked=${OCR_CHECKED}`], path.join(dir, 'read.log'));
        if (code === 3) { append('arm-a.jsonl', { key: s.key, quota: true }); stop = 'agy quota'; break; }
        const ap = path.join(dir, 'apply.log'); fs.rmSync(ap, { force: true });
        const acode = await node([path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${REASON} (dry)`], ap);
        const log = fs.readFileSync(ap, 'utf8');
        const metaF = path.join(dir, `${s.page_id}.meta.json`), meta = fs.existsSync(metaF) ? JSON.parse(fs.readFileSync(metaF, 'utf8')) : null;
        const txtF = path.join(dir, `${s.page_id}.txt`), text = fs.existsSync(txtF) ? fs.readFileSync(txtF, 'utf8').trim() : '';
        const skipLine = new RegExp(`skip p\\.${s.page_number}: (.*)`).exec(log)?.[1] ?? null;
        const would = new RegExp(`would write p\\.${s.page_number} `).test(log);
        let served = null, why;
        if (!meta) why = 'not read';
        else if (skipLine) why = `apply: ${skipLine}`;
        else if (!would) why = `apply exit ${acode}: no line for the page`;
        else { const d = await doorVerdict(db, s.page_id, text, { model: meta.model }); if (d.ok) { served = d.text; why = 'written'; } else why = `door: ${d.why}`; }
        if (served != null) fs.writeFileSync(path.join(OUT, 'a', s.key, 'served.txt'), served);
        const calls = fs.existsSync(path.join(dir, 'raw')) ? fs.readdirSync(path.join(dir, 'raw')).length : null;
        append('arm-a.jsonl', { key: s.key, read_exit: code, apply_exit: acode, written: served != null, why, calls, block: s.block_a.length, meta_exit: meta?.exit ?? null, error_class: meta?.error_class ?? null, wrapper: meta?.wrapper ?? null });
        console.log(`  A ${s.key}: ${why} (${calls} calls)`);
      }
    }));
  });
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
}

// ── arm R: Flash-Lite, the chained lane's request ──
async function liteCall(db, prompts, book, pages, kind, s) {
  const req = await buildRoundRequest(db, { prompts, book, pages, kind });
  const br = batchRequest({ key: s.key, prompt: req.prompt, maxOutputTokens: req.maxOutputTokens });
  const r = await callGemini({ model: LITE, prompt: req.prompt, endpoint: 'scripts/eval/eu-agy-translate-7263/run.mjs', maxOutputTokens: br.config.maxOutputTokens, thinkingBudget: 0,
    safetySettings: br.config.safetySettings, type: 'translation', bookId: book.id, pageIds: pages.map((p) => p.id), promptVersion: String(req.promptRef?.version ?? '') });
  return { text: r.text, finish: r.finishReason, inTok: r.inputTokens, outTok: r.outputTokens, prompt_sha: sha(req.prompt).slice(0, 16), context: req.context };
}
async function armR() {
  const conc = Math.max(1, Math.min(6, Number(arg('concurrency') || 4)));
  const done = new Set(jsonl(path.join(OUT, 'arm-r.jsonl')).map((r) => r.key));
  const todo = selected().filter((s) => !done.has(s.key)).slice(0, Number(arg('limit') || Infinity));
  const { costOf } = await import('../../lib/model-pricing.mjs');
  await withDb(async (db) => {
    const prompts = await loadTranslationPrompts(db);
    let i = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (i < todo.length) {
        const s = todo[i++];
        const book = await db.collection('books').findOne({ id: s.book_id });
        const docs = new Map((await db.collection('pages').find({ id: { $in: s.block_r } }, { projection: PAGE_PROJ }).toArray()).map((p) => [p.id, p]));
        const pages = s.block_r.map((id) => docs.get(id)).filter(Boolean);
        const block = planBlocks(pages)[0];
        const calls = []; let text = null, how;
        try {
          if (block.length > 1) {
            const c = await liteCall(db, prompts, book, block, 'block', s); calls.push(c);
            const parsed = parseBlockTranslations(c.text, block, { lang: book.language });
            const tr = parsed.translations;
            const echoed = block.some((p) => { const t = tr.get(p.page_number); return t && assessTranslationHealth(p.ocr?.data || '', t, { lang: book.language }).reason === 'echo'; });
            if (echoed) tr.clear();
            dropDriftedPages(block, tr);
            text = tr.get(s.page_number) ?? null;
            how = text ? 'block' : `block fallback (${echoed ? 'echo-shift' : parsed.discarded || (parsed.truncated?.length ? 'truncated' : 'drift or missing')})`;
          }
          if (!text) {   // the lane's single-page request: a page alone, or the block's fallback
            const c = await liteCall(db, prompts, book, [docs.get(s.page_id)], 'single', s); calls.push(c);
            text = String(c.text || '').trim() || null;
            how = how ? `${how} → single` : 'single';
          }
        } catch (e) { how = `error: ${String(e.message).slice(0, 120)}`; }
        let served = null, why = how;
        if (text) { const d = await doorVerdict(db, s.page_id, text, { model: LITE, finishReason: calls.at(-1)?.finish }); if (d.ok) served = d.text; else why = `${how}; door: ${d.why}`; }
        const dir = path.join(OUT, 'r', s.key); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(calls, null, 1));
        if (served != null) fs.writeFileSync(path.join(dir, 'served.txt'), served);
        const usd = calls.reduce((a, c) => a + costOf(LITE, c.inTok || 0, c.outTok || 0), 0);
        append('arm-r.jsonl', { key: s.key, written: served != null, why, calls: calls.length, block: block.length, in_tokens: calls.reduce((a, c) => a + (c.inTok || 0), 0), out_tokens: calls.reduce((a, c) => a + (c.outTok || 0), 0), usd: +usd.toFixed(5), finish: calls.map((c) => c.finish) });
        console.log(`  R ${s.key}: ${served != null ? 'written' : 'NOT written'} (${why}) $${usd.toFixed(4)}`);
      }
    }));
  });
}

// ── judge ──
const served = (arm, key) => { const f = path.join(OUT, arm, key, 'served.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
/** One item per distinct served text a page (arms that wrote nothing get no item), + 2 wrong-page controls a language. */
export function judgeItems(sel, textOf, seed = SEED) {
  const items = [];
  for (const s of sel) {
    const by = new Map();
    for (const arm of ['a', 'r']) { const t = textOf(arm, s.key); if (t == null) continue; const h = sha(t).slice(0, 12); if (!by.has(h)) by.set(h, { id: `${s.key}:${h}`, set: 'abs', key: s.key, arms: [] }); by.get(h).arms.push(arm); }
    items.push(...by.values());
  }
  const controls = [];
  for (const [li, lang] of LANGS.entries()) {
    const pool = shuffle(sel.filter((s) => s.lang === lang && (textOf('a', s.key) ?? textOf('r', s.key)) != null), makeRng(seed + 100 + li));
    for (let j = 0; j + 1 < pool.length && controls.filter((c) => c.lang === lang).length < 2; j += 2) {
      const arm = controls.length % 2 ? 'r' : 'a';
      const src = textOf(arm, pool[j + 1].key) != null ? arm : arm === 'a' ? 'r' : 'a';
      controls.push({ id: `wp-${pool[j].key}-${pool[j + 1].key}`, set: 'wrong_page', lang, key: pool[j].key, text_of: pool[j + 1].key, arm: src });
    }
  }
  return { items: shuffle(items, makeRng(seed + 2)), controls };
}

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** judge.mjs opusCall with stream-json: the reply, and whether the transcript shows ./page.jpg opened with Read. */
export function opusJudgeCall(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 900e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      const ev = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const reads = ev.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content || []).filter((c) => c.type === 'tool_use' && c.name === 'Read').map((c) => String(c.input?.file_path || ''));
      const fin = ev.find((e) => e.type === 'result') || {};
      const text = String(fin.result ?? '');
      resolve({ text, opened: reads.some((f) => /page\.jpg$/.test(f)), reads, cls: (fin.is_error || code !== 0) && QUOTA.test(text + out.slice(-2000) + err) ? 'quota' : code !== 0 ? `exit_${code}` : null,
        model: Object.keys(fin.modelUsage || {})[0] ?? null, usage: fin.usage ?? null, cost: fin.total_cost_usd ?? null, transcript: out });
    });
  });
}

async function judge() {
  const sel = selected(), bySel = new Map(sel.map((s) => [s.key, s]));
  const { items, controls } = judgeItems(sel, served);
  const VO = path.join(OUT, 'verdicts.jsonl');
  const have = jsonl(VO);
  const done = new Set(have.filter((r) => r.verdict && r.opened).map((r) => r.id));
  const tries = new Map(); for (const r of have.filter((x) => !(x.verdict && x.opened))) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const cap = Number(arg('max-calls') || 300), made = have.length;
  // --no-controls: judge the pages as their arms finish; the controls (drawn from the finished pages) come last
  const todo = [...(process.argv.includes('--no-controls') ? [] : controls), ...items].filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 2);
  console.log(`judge: ${items.length} items + ${controls.length} controls; ${todo.length} to do; ${made} calls made; cap ${cap}`);
  const limits = await import('../../lib/model-limits.mjs');
  const { paceCheck } = await import('../correction-pass-7818/lib.mjs');
  const state = {};
  let calls = 0, i = 0, stop = null;
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'transcripts'), { recursive: true });
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < todo.length) {
      if (made + calls >= cap) { stop = `call cap ${cap}`; break; }
      const why = await paceCheck(limits, state);
      if (why) { stop = `pace: ${why}`; break; }
      const it = todo[i++]; calls++;
      const s = bySel.get(it.key);
      const text = it.set === 'wrong_page' ? served(it.arm, it.text_of) : served(it.arms[0], it.key);
      const imgF = path.join(OUT, 'img', `${s.key}.jpg`);
      if (!fs.existsSync(imgF)) { const r = await fetch(s.image, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' } }); fs.writeFileSync(imgF, Buffer.from(await r.arrayBuffer())); }
      const source = (await withDb((db) => db.collection('pages').findOne({ id: s.page_id }, { projection: { 'ocr.data': 1 } })))?.ocr?.data ?? '';
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'eu7263-'));
      try {
        fs.copyFileSync(imgF, path.join(ws, 'page.jpg'));
        const prompt = judgePrompt({ task: 'translation', lang: s.lang, source, text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
        const t0 = Date.now();
        const r = await opusJudgeCall(prompt, ws);
        if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = 'quota reply'; break; }
        const v = parseVerdict(r.text);
        const tf = path.join(OUT, 'transcripts', `${it.id.replace(/[^a-z0-9-]/gi, '_')}.${Date.now()}.jsonl.gz`);
        fs.writeFileSync(tf, (await import('node:zlib')).gzipSync(r.transcript));
        append('verdicts.jsonl', { id: it.id, set: it.set, key: it.key, arms: it.arms ?? null, text_of: it.text_of ?? null, arm: it.arm ?? null, verdict: v, opened: r.opened, reads: r.reads, cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), text_sha: sha(text).slice(0, 12), transcript: path.relative(OUT, tf), secs: Math.round((Date.now() - t0) / 1000), raw: v ? undefined : r.text.slice(0, 400) });
        console.log(`  ${it.set} ${it.id}: ${v ? `accept=${v.accept} f${v.fidelity}${v.defects?.some((d) => d.severity === 'wrong_text') ? ' WRONG-TEXT' : ''}` : 'unparsed'}${r.opened ? '' : ' (IMAGE NOT OPENED)'}`);
      } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }
  }));
  console.log(`${calls} calls this run; ${stop ? `STOPPED: ${stop}` : 'queue done'}`);
  if (stop && /quota|pace/.test(stop)) process.exit(3);
}

// ── analyze ──
export const wrongText = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
async function analyze() {
  const P = J('plan.json'), sel = selected();
  const V = jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => r.verdict && r.opened);
  const last = new Map(); for (const r of V) last.set(r.id, r);
  const { items, controls } = judgeItems(sel, served);
  const A = new Map(jsonl(path.join(OUT, 'arm-a.jsonl')).filter((r) => !r.quota).map((r) => [r.key, r]));
  const R = new Map(jsonl(path.join(OUT, 'arm-r.jsonl')).map((r) => [r.key, r]));
  const outcome = (arm, key) => {
    if (served(arm, key) == null) return { written: false, accept: false, wrong: false, fidelity: null, judged: false, why: (arm === 'a' ? A : R).get(key)?.why ?? 'not run' };
    const it = items.find((x) => x.key === key && x.arms.includes(arm)); const r = it && last.get(it.id);
    if (!r) return null;
    const words = served(arm, key).replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
    return { written: true, judged: true, words, accept: !!r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity, defects: (r.verdict.defects || []).map((d) => `${d.class}:${d.severity}`), reader_note: r.verdict.reader_note };
  };
  const cell = (rows) => {
    const ok = rows.filter((p) => p.a && p.r);
    const n = ok.length, kA = ok.filter((p) => p.a.accept).length, kR = ok.filter((p) => p.r.accept).length;
    const wA = ok.filter((p) => p.a.wrong).length, wR = ok.filter((p) => p.r.wrong).length;
    resetSeed(SEED);
    const ci = n >= 2 ? bootstrapCI(ok.map((p) => Number(p.a.accept) - Number(p.r.accept))).map((x) => +x.toFixed(3)) : null;
    const gained = ok.filter((p) => p.a.accept && !p.r.accept).length, lost = ok.filter((p) => !p.a.accept && p.r.accept).length;
    const w = (k) => (n ? wilson(k, n).map((x) => +x.toFixed(3)) : null);
    const d = n ? (kA - kR) / n : null;
    const within = 0.08, wtm = 0.04;
    const bar = n ? (d >= -within - 1e-12 && wA / n <= wR / n + wtm + 1e-12) : null;
    return { n, unjudged: rows.length - n, a: { k: kA, ci95: w(kA), wrong_text: wA, wrong_ci95: w(wA), written: ok.filter((p) => p.a.written).length },
      r: { k: kR, ci95: w(kR), wrong_text: wR, wrong_ci95: w(wR), written: ok.filter((p) => p.r.written).length },
      d: d == null ? null : +d.toFixed(3), d_ci95: ci, gained, lost, sign_p: +binomTwoSided(gained, gained + lost).toFixed(4), switch_bar: { within, wrong_text_max: wtm, passes: bar, lower_bound_clears: ci ? ci[0] >= -within : false } };
  };
  const per = sel.map((s) => ({ key: s.key, lang: s.lang, script: s.script, ocr_model: s.ocr_model, book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, title: s.title, a: outcome('a', s.key), r: outcome('r', s.key) }));
  const ctl = controls.map((c) => ({ ...c, verdict: last.get(c.id)?.verdict ?? null })).map((c) => ({ id: c.id, lang: c.lang, judged: !!c.verdict, accepted: !!c.verdict?.accept, fidelity: c.verdict?.fidelity ?? null }));
  const cells = {};
  for (const lang of LANGS) {
    const rows = per.filter((p) => p.lang === lang);
    cells[lang] = { all: cell(rows), by_script: Object.fromEntries([...new Set(rows.map((r) => r.script))].map((sc) => [sc, cell(rows.filter((r) => r.script === sc))])),
      by_ocr: Object.fromEntries([...new Set(rows.map((r) => r.ocr_model))].map((m) => [m, cell(rows.filter((r) => r.ocr_model === m))])),
      controls: ctl.filter((c) => c.lang === lang), frame: { books: P.langs[lang].frame_books, drawn: P.langs[lang].selected.length, excluded: P.langs[lang].excluded, skipped: P.langs[lang].skipped } };
  }
  // Where the wrong text comes from (dispatcher note 2026-11-01 23:46Z; the Siku study's OCR-CARRIED vs WRONG-SENSE split):
  // a wrong-text defect the judge tagged O*/I* follows the stored transcription (the OCR misread the leaf, or the image is not
  // this text's); T*/E2/D* is the translator's. A page is OCR-carried when every wrong-text defect on it is O/I.
  const origin = (lang, arm) => {
    const rows = per.filter((p) => p.lang === lang && p[arm]?.judged && p[arm].wrong);
    const ocr = rows.filter((p) => p[arm].defects.filter((d) => d.endsWith(':wrong_text')).every((d) => /^[OI]/.test(d))).length;
    return { wrong_pages: rows.length, ocr_carried_only: ocr, translator: rows.length - ocr };
  };
  for (const lang of LANGS) cells[lang].wrong_text_origin = { a: origin(lang, 'a'), r: origin(lang, 'r') };
  // The dispatcher's report form (2026-11-01 23:56Z): severe defects per 1,000 English words (paper decision 3: the judge's
  // misleads + wrong_text stand in) and pages with invented (O1, T10) or wrong-leaf / another page's (I1, I2, T4, T5) wrong text.
  const INVENTED = /^(O1|T10):wrong_text$/, WRONG_LEAF = /^(I1|I2|T4|T5):wrong_text$/;
  for (const lang of LANGS) for (const arm of ['a', 'r']) {
    const rows = per.filter((p) => p.lang === lang && p[arm]?.judged);
    const sev = rows.reduce((t, p) => t + p[arm].defects.filter((d) => /:(misleads|wrong_text)$/.test(d)).length, 0), w = rows.reduce((t, p) => t + p[arm].words, 0);
    (cells[lang].report ??= {})[arm] = { severe_per_1k_words: w ? +(sev * 1000 / w).toFixed(2) : null, english_words: w, invented_pages: rows.filter((p) => p[arm].defects.some((d) => INVENTED.test(d))).length, wrong_leaf_pages: rows.filter((p) => p[arm].defects.some((d) => WRONG_LEAF.test(d))).length };
  }
  const usage = { agy_calls: [...A.values()].reduce((a, r) => a + (r.calls || 0), 0), lite_calls: [...R.values()].reduce((a, r) => a + r.calls, 0), lite_usd: +[...R.values()].reduce((a, r) => a + r.usd, 0).toFixed(4), judge_calls: jsonl(path.join(OUT, 'verdicts.jsonl')).length,
    judge_opened: jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => r.opened).length };
  const res = { at: new Date().toISOString(), seed: SEED, judge: 'claude -p --model opus, sealed, Read only, stream-json transcript (page.jpg opened checked); route-judge judgePrompt translation form, image + stored OCR; blind (no arm in the prompt)', cells, usage, per_page: per };
  W('score.json', res);
  for (const [l, c] of Object.entries(cells)) console.log(`${l}: n ${c.all.n} | A ${c.all.a.k}/${c.all.n} wrong ${c.all.a.wrong_text} | R ${c.all.r.k}/${c.all.n} wrong ${c.all.r.wrong_text} | d ${c.all.d} ${JSON.stringify(c.all.d_ci95)} | bar ${c.all.switch_bar.passes} | controls ${c.controls.map((x) => (x.judged ? (x.accepted ? 'ACCEPTED' : 'rejected') : 'unjudged')).join(',')} | scripts ${JSON.stringify(Object.fromEntries(Object.entries(c.by_script).map(([k, v]) => [k, v.n])))}`);
  console.log(JSON.stringify(usage));
}

// ── stage the writes: per page with no English, the better ACCEPTED arm ──
async function stageWrites() {
  const S = J('score.json');
  const pick = [], x0 = [];
  for (const p of S.per_page) {
    const a = p.a?.accept ? p.a : null, r = p.r?.accept ? p.r : null;
    if (!a && !r) continue;
    // Any accepted agy read is written, even where Flash-Lite's was also accepted at a higher fidelity: the brief's writer is
    // cli-translate.mjs apply, which writes CLI reads only (a synchronous API read has no meta it accepts). A page only
    // Flash-Lite got right is listed, not written; its lane can still translate it.
    const arm = a ? 'a' : 'r';
    if (a && r && r.fidelity > a.fidelity) x0.push({ key: p.key, agy: a.fidelity, lite: r.fidelity });
    pick.push({ key: p.key, page_id: p.page_id, book_id: p.book_id, arm });
  }
  const live = await withDb(async (db) => new Map((await db.collection('pages').find({ id: { $in: pick.map((x) => x.page_id) } }, { projection: { id: 1, 'translation.data': 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p])));
  const sel = new Map(selected().map((s) => [s.key, s]));
  const staged = { a: [], r: [], skipped: [] };
  const dirA = path.join(OUT, 'write', 'a'); fs.rmSync(dirA, { recursive: true, force: true }); fs.mkdirSync(dirA, { recursive: true });
  for (const x of pick) {
    const p = live.get(x.page_id);
    if (p?.translation?.data) { staged.skipped.push({ ...x, why: 'has English now' }); continue; }
    if (contentHash(p?.ocr?.data || '') !== sel.get(x.key).ocr_sha) { staged.skipped.push({ ...x, why: 'OCR changed' }); continue; }
    if (x.arm === 'a') {
      const src = path.join(OUT, 'a', x.key);
      const meta = JSON.parse(fs.readFileSync(path.join(src, `${x.page_id}.meta.json`), 'utf8'));
      fs.copyFileSync(path.join(src, `${x.page_id}.meta.json`), path.join(dirA, `${x.page_id}.meta.json`));
      fs.copyFileSync(path.join(src, `${x.page_id}.txt`), path.join(dirA, `${x.page_id}.txt`));
      if (meta.prompt_sent_file) { fs.mkdirSync(path.dirname(path.join(dirA, meta.prompt_sent_file)), { recursive: true }); fs.copyFileSync(path.join(src, meta.prompt_sent_file), path.join(dirA, meta.prompt_sent_file)); }
      staged.a.push(x);
    } else staged.r.push(x);
  }
  staged.lite_higher_but_agy_written = x0;
  W('write/staged.json', staged);
  console.log(`staged: agy ${staged.a.length} (cli-translate.mjs apply --out=${dirA}), flash-lite ${staged.r.length}, skipped ${staged.skipped.length}`);
}

// ── pages waiting: the frame's untranslated pages, per language and script class (the cell's pages_waiting) ──
async function waiting() {
  const res = await withDb(async (db) => {
    const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, 'translation_state.rung': { $in: ['transcribed', 'translating'] }, language: { $regex: `^(${LANGS.join('|')})`, $options: 'i' } },
      { projection: { _id: 0, id: 1, language: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.held': 1 } }).toArray())
      .filter((b) => b.id && b.pipeline_auto?.status !== 'loop_quarantine_hold' && (!b.pipeline_auto?.hold?.reason ? !b.pipeline_auto?.held : ALLOWED_HOLD.test(b.pipeline_auto.hold.reason)));
    const out = {};
    for (const lang of LANGS) {
      const ids = books.filter((b) => firstLabel(b.language).toLowerCase() === lang.toLowerCase()).map((b) => b.id);
      const rows = await db.collection('pages').aggregate([{ $match: { book_id: { $in: ids }, ...UNTRANSLATED } },
        { $project: { st: '$script_type', tag: { $regexFind: { input: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 400] }, regex: '<script>\\s*(printed|handwritten|mixed)' } }, m: '$ocr.model' } },
        { $group: { _id: { st: '$st', tag: { $arrayElemAt: ['$tag.captures', 0] }, m: '$m' }, n: { $sum: 1 } } }], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
      const by = { print: 0, manuscript: 0, unknown: 0 }, byOcr = {};
      const of = (v) => ({ printed: 'print', mixed: 'print', handwritten: 'manuscript' }[v]);
      for (const r of rows) { by[of(r._id.tag) || of(r._id.st) || 'unknown'] += r.n; byOcr[r._id.m ?? 'none'] = (byOcr[r._id.m ?? 'none'] ?? 0) + r.n; }
      const total = by.print + by.manuscript + by.unknown;
      out[lang] = { books: ids.length, pages: total, by_script: by, share: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, total ? +(v / total).toFixed(4) : 0])), by_ocr_model: byOcr };
      console.log(lang, JSON.stringify(out[lang]));
    }
    return out;
  });
  W('waiting.json', { at: new Date().toISOString(), rule: 'UNTRANSLATED pages (cli-translate-lane.mjs) of the frame books (plan rule); script class by the OCR <script> tag, else pages.script_type, else unknown (no book majority); mixed counts as print', langs: res });
}

// ── router-table evidence: the per-cell counts in build.py's score format, whole and cut by script type ──
export const CELL_OF = (lang) => `${lang.toLowerCase()}-tr-first`;
export const ROUTE_OF = { a: 'agy-flash-low@4', r: 'flash-lite' };
async function evidence() {
  const S = J('score.json');
  const RT = path.join(ROOT, 'scripts/eval/estimator/router-table/evidence');
  const scriptOf = (sc) => (sc === 'mixed' ? 'print' : ['print', 'manuscript'].includes(sc) ? sc : 'unknown');
  const block = (rows) => {
    const routes = {};
    for (const arm of ['a', 'r']) {
      const ok = rows.filter((p) => p.a && p.r);
      const cl = {};
      for (const p of ok) for (const c of new Set((p[arm].defects || []).map((d) => d.split(':')[0]))) cl[c] = (cl[c] ?? 0) + 1;
      routes[ROUTE_OF[arm]] = { n: ok.length, books: new Set(ok.map((p) => p.book_id)).size, accept: `${ok.filter((p) => p[arm].accept).length}/${ok.length}`, wrong_text_pages: `${ok.filter((p) => p[arm].wrong).length}/${ok.length}`,
        classes_k_of_n: Object.fromEntries(Object.entries(cl).sort((x, y) => y[1] - x[1]).map(([c, k]) => [c, `${k}/${ok.length}`])),
        written: `${ok.filter((p) => p[arm].written).length}/${ok.length}`, note: 'every drawn page counts: a page the lane would not write is not accepted' };
    }
    const ok = rows.filter((p) => p.a && p.r);
    const pair = { n: ok.length, books: new Set(ok.map((p) => p.book_id)).size, both: ok.filter((p) => p.a.accept && p.r.accept).length, a_only: ok.filter((p) => p.a.accept && !p.r.accept).length, b_only: ok.filter((p) => !p.a.accept && p.r.accept).length, neither: ok.filter((p) => !p.a.accept && !p.r.accept).length };
    return { routes, paired: { [`${ROUTE_OF.a}|${ROUTE_OF.r}`]: pair } };
  };
  const whole = { generated_by: 'scripts/eval/eu-agy-translate-7263/run.mjs evidence (job eu-agy-translate-cell-7263, #7263)', judge: S.judge, cells: {} };
  const bys = { generated_by: whole.generated_by, cells: {} };
  for (const lang of LANGS) {
    const rows = S.per_page.filter((p) => p.lang === lang);
    whole.cells[CELL_OF(lang)] = { task: 'translation', lang, ...block(rows) };
    for (const sc of ['print', 'manuscript', 'unknown']) { const r = rows.filter((p) => scriptOf(p.script) === sc); if (r.length) bys.cells[`${CELL_OF(lang)}|${sc}`] = block(r); }
  }
  fs.writeFileSync(path.join(RT, 'eu-agy-translate-7263.score.json'), JSON.stringify(whole, null, 1) + '\n');
  fs.writeFileSync(path.join(RT, 'by-script', 'eu-agy-translate-7263.score.json'), JSON.stringify(bys, null, 1) + '\n');
  console.log(Object.keys(bys.cells).join(', '));
}

const stages = { waiting, plan, evidence, 'arm-a': armA, 'arm-r': armR, judge, analyze, 'stage-writes': stageWrites };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
