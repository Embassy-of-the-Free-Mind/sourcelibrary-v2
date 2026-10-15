#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs — its `read` stage is the template here (one .txt + .meta.json per page, the
// live OCR prompt, the image's url/bytes/sha256, nothing written to the database), and its `apply` stage is THE writer
// for these reads too (it gained `cli: 'claude'` support for this, #6559): this script writes no page.
// scripts/eval/second-reader/run-readers.sh — the sealed `claude -p --restricted --tools Read` reader (a folder holding
// only what the model may see). scripts/batch/ocr-convergence/driver.mjs — the Opus adjudicate step, whose
// `claudeEnv()` strip (subscription, never the API key) is copied here. None of them reads a whole book with Opus.
/**
 * OCR pages with Anthropic's Opus through the Claude CLI, on the subscription — the reader Derek chose for the
 * Nahuatl and Mayan-language books (#6559: Gemini normalised their orthography 2-4x more and alone failed or filled
 * pages). READ stage only; `cli-ocr.mjs apply` writes.
 *
 *   node --env-file=.env.production.local scripts/batch/claude-ocr.mjs --out=DIR (--books-file=F | --page-ids-file=F)
 *        [--model=opus] [--per-call=10] [--concurrency=2] [--max-pages=N] [--job=NAME] [--language=NAME]
 *   node --env-file=.env.production.local scripts/batch/cli-ocr.mjs apply --out=DIR --reason="..." [--apply]
 *
 * --books-file: book ids, one per line; reads every page of each that has NO OCR yet (a page with text is never
 * re-read here). --page-ids-file: a JSON array of page ids (as cli-ocr.mjs), pages that have OCR are still skipped.
 * --language: the CONTENT language for the prompt's language slot, overriding `books.language` for every book in the
 * run — for a dictionary or grammar catalogued under its front-matter language (Spanish, French…) whose pages are
 * mostly Maya. `books.language` is the edition's language and is not changed (language-fields.md); each page's meta
 * records the language sent (`language`) and the book's own (`book_language`).
 *
 * WHAT A CALL IS. Up to --per-call consecutive pages of ONE book are copied into a sealed folder as p01.jpg … pNN.jpg
 * (neutral names) and `claude -p --model opus --restricted --tools Read` is asked to transcribe each on the live
 * production OCR prompt (scripts/lib/live-ocr-prompt.mjs) with its language slot naming the book's language and the
 * letters of its colonial orthography, then a per-call instruction to answer page by page under
 * `===== PAGE pNN =====` markers. A reply whose markers are not exactly p01..pNN in order is REFUSED whole; the call
 * is retried once, then each of its pages is read alone. The exact prompt sent is saved under DIR/prompts/<hash>.txt
 * and each page's meta points at it, so `apply` hashes the text that was sent rather than rebuilding it.
 *
 * HOW IT FAILS. A usage-limit reply stops the run (exit 3) with the pages done so far saved; re-running skips them.
 * Any other failed page gets an empty .txt and a non-zero `exit` in its meta, which `apply` skips and counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readPageIdsFile, parseBookIds } from '../lib/ocr-targeting.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { ocrReadProblem } from '../lib/cli-chatter.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { liveOcrPrompt } from '../lib/live-ocr-prompt.mjs';

const READ_SITE = 'scripts/batch/claude-ocr.mjs';
const CLI = 'claude';

/**
 * The letters of each language's colonial orthography that are LETTERS, not abbreviations. The live prompt tells the
 * model to expand tildes, macrons and ꝯ/ɔ as Latin abbreviations; in these languages several of those signs are part
 * of the spelling, and normalising them is the error both #6559 judges found in Gemini's reads.
 */
const ORTHOGRAPHY = {
  Nahuatl: 'ç and z, tz, tl, hu/uh and cu/uc, x; saltillo and vowel-length marks where the book uses them (grave, circumflex or acute accents, macrons in grammars such as Carochi\'s); the long s (ſ) and the tironian et as printed',
  'Yucatec Maya': 'the reversed c ɔ (dz) and its capital Ɔ; the barred letters ꜧ / ħ and barred forms of th, ch, k (keep the bar: never write plain h, th, ch); the barred p ꝑ (for pp) and doubled letters pp, tt, cc, kk; the long s (ſ) as printed',
  Kaqchikel: 'the cuatrillo ꜭ (capital Ꜭ), the cuatrillo with comma ꜯ (Ꜯ), the tresillo ꜫ (Ꜫ), and cuatrillo-h / tresillo-h combinations; when the book prints these as the digits 4 or 3 (4h, 3), keep the digit; the barred h ħ; never write ch, k, tz or E for them',
};
ORTHOGRAPHY["K'iche' Maya"] = ORTHOGRAPHY.Kaqchikel;
ORTHOGRAPHY.Tzeltal = ORTHOGRAPHY.Tzotzil = ORTHOGRAPHY.Mam = ORTHOGRAPHY["Q'eqchi'"] = ORTHOGRAPHY.Kaqchikel;

/** The `{language_instruction}` slot for a book whose principal language is `language`. */
export function languageInstruction(language) {
  const letters = ORTHOGRAPHY[language];
  return `**Source language:** This book is in ${language}; pages may also carry Spanish or Latin. Transcribe every language on the page, and report the primary language of THIS page in the <language> tag (e.g. <language>${language}</language>).`
    + (letters ? `\n**${language} orthography (CRITICAL):** keep the colonial spelling exactly as written, never modernised and never moved toward Spanish. These signs are LETTERS of the language, not abbreviations, and are kept as printed or written: ${letters}. The abbreviation rules below apply to Latin and Spanish scribal abbreviations (a tilde or macron standing for an omitted n or m, q̃ = que, and the like); a sign that is a letter of ${language} is never expanded or replaced, and when you cannot tell which it is, keep it as written.` : '');
}

/**
 * The language the prompt's slot names for a book: the --language override when given, else the book's language.
 * An override must name a language this script has an orthography for — a typo would otherwise silently drop the
 * orthography paragraph, which is the reason to override at all.
 */
export function slotLanguage(bookLanguage, override) {
  if (override == null || override === '') return bookLanguage;
  if (!ORTHOGRAPHY[override]) throw new Error(`--language=${override}: no orthography for it (known: ${Object.keys(ORTHOGRAPHY).join(', ')})`);
  return override;
}

/** The per-call instruction that follows the prompt. Part of the prompt SENT, so part of what is hashed. */
export function callInstruction(n) {
  const names = Array.from({ length: n }, (_, i) => pageName(i));
  return `\n\n**This call: ${n} page image${n > 1 ? 's' : ''}.** The files ${names.join(', ')} in this folder are ${n > 1 ? 'consecutive pages of one book, in order' : 'one page of a book'}. Open each with the Read tool. Transcribe each page separately and completely, following every rule above as if it were the only page: never carry text, a header or a heading over from a neighbouring page.\nAnswer with, for each page in order, a line \`===== PAGE pNN =====\` (the file name without .jpg) followed by that page's transcription in the format above. Output nothing before the first marker and no commentary anywhere.\n`;
}
const pageName = (i) => `p${String(i + 1).padStart(2, '0')}`;

/**
 * Split a reply into pages. Returns the n texts in order, or null when the markers are not exactly p01..pNN in order
 * (a dropped, merged, repeated or reordered page): the whole call is refused rather than mis-attributed.
 */
export function splitPages(reply, n) {
  const re = /^[ \t]*=====\s*PAGE\s+(p\d{2})\s*=====[ \t]*$/gm;
  const marks = [...String(reply || '').matchAll(re)];
  if (marks.length !== n) return null;
  if (marks.some((m, i) => m[1] !== pageName(i))) return null;
  if (String(reply).slice(0, marks[0].index).trim()) return null;
  return marks.map((m, i) => String(reply).slice(m.index + m[0].length, i + 1 < n ? marks[i + 1].index : undefined).trim());
}

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;

// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

/** One sealed `claude -p` call. Resolves {text, model, usage, code, cls, err, secs}. */
function claudeCall(prompt, model, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLI, ['-p', prompt, '--model', model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON: an error before the session */ }
      const text = String(j.result ?? '').trim();
      const models = Object.keys(j.modelUsage || {});
      const resolved = models.find((m) => /opus|sonnet|haiku|fable/.test(m) && m.includes(String(model).replace(/^claude-/, ''))) || models[0] || null;
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}${j.subtype ? `_${j.subtype}` : ''}` : !text ? 'empty' : null;
      resolve({ text, model: resolved, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, cache_creation: j.usage.cache_creation_input_tokens, turns: j.num_turns, list_cost_usd: j.total_cost_usd } : null, code, cls, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

async function main() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const OUT = arg('out') && path.resolve(arg('out'));
  const MODEL = arg('model') || 'opus';
  const PER_CALL = Math.max(1, Math.min(10, Number(arg('per-call') || 10)));
  const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('concurrency') || 2)));
  const MAX_PAGES = Number(arg('max-pages') || Infinity);
  const JOB = arg('job') || 'claude-ocr';
  const LANGUAGE = arg('language');
  if (LANGUAGE) slotLanguage(null, LANGUAGE);   // refuse an unknown override before touching anything
  if (!OUT || !(arg('books-file') || arg('page-ids-file'))) { console.error('usage: claude-ocr.mjs --out=DIR (--books-file=F | --page-ids-file=F) (see the header)'); process.exit(2); }
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  if (!/--restricted/.test(spawnSync(CLI, ['--help'], { encoding: 'utf8' }).stdout || '')) { console.error('this claude CLI has no --restricted: refusing to run an unsealed reader'); process.exit(2); }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const NO_OCR = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] };
  const PAGE_FIELDS = { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 };
  const filter = arg('books-file')
    ? { book_id: { $in: parseBookIds(fs.readFileSync(arg('books-file'), 'utf8')) }, ...NO_OCR }
    : { id: { $in: readPageIdsFile(arg('page-ids-file')) }, ...NO_OCR };
  const pages = await db.collection('pages').find(filter, { projection: PAGE_FIELDS }).sort({ book_id: 1, page_number: 1 }).toArray();
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }, { projection: { id: 1, language: 1, title: 1 } }).toArray()).map((b) => [b.id, b]));
  const { base, ref } = await liveOcrPrompt(db);   // the auto-detect base, for the log line; each book's slot is filled here
  const promptFor = {};
  for (const b of books.values()) {
    const live = await liveOcrPrompt(db, languageInstruction(slotLanguage(b.language, LANGUAGE)));
    if (live.ref.hash !== ref.hash || live.ref.version !== ref.version) throw new Error('the live OCR prompt changed during setup; re-run');
    promptFor[b.id] = live.base;
  }
  await client.close();

  fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify(ref));
  const done = (p) => fs.existsSync(path.join(OUT, `${p.id}.meta.json`)) && JSON.parse(fs.readFileSync(path.join(OUT, `${p.id}.meta.json`), 'utf8')).exit === 0;
  const todo = pages.filter((p) => !done(p)).slice(0, MAX_PAGES);
  // Calls: up to PER_CALL consecutive pages of one book.
  const calls = [];
  for (const p of todo) {
    const last = calls[calls.length - 1];
    if (last && last[0].book_id === p.book_id && last.length < PER_CALL) last.push(p); else calls.push([p]);
  }
  console.log(`${pages.length} pages without OCR in ${books.size} books; ${todo.length} to read in ${calls.length} calls; model ${MODEL}; ${CLI} ${version}; ${CONCURRENCY} calls at a time; prompt ${ref.name} v${ref.version} (base ${contentHash(base)})${LANGUAGE ? `; language slot ${LANGUAGE} (override)` : ''}`);

  const sealRoot = path.join(process.env.TMPDIR || os.tmpdir(), 'claude-ocr-sealed', path.basename(OUT));
  const callLog = path.join(OUT, 'calls.jsonl');
  let stop = null;
  const imgCache = new Map();
  const fetchImage = async (p) => {
    if (imgCache.has(p.id)) return imgCache.get(p.id);
    const src = getPageSource(p);
    if (!src) return { error: 'no usable image' };
    const res = await fetch(src);
    if (!res.ok) return { error: `image HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const v = { src, buf, sha: createHash('sha256').update(buf).digest('hex') };
    imgCache.set(p.id, v);
    return v;
  };
  const writePage = (p, text, meta) => {
    fs.writeFileSync(path.join(OUT, `${p.id}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${p.id}.meta.json`), JSON.stringify({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, read_site: READ_SITE, ...meta, chars: text.length, chatter: text ? ocrReadProblem(text) : null }, null, 1));
  };

  /** Read a group of pages in one sealed call. Returns 'ok' | 'mismatch' | 'failed'. */
  const readGroup = async (group, attempt) => {
    const imgs = [];
    for (const p of group) {
      const im = await fetchImage(p);
      if (im.error) { writePage(p, '', { model: MODEL, exit: 1, error_class: im.error, started_at: new Date().toISOString(), finished_at: new Date().toISOString() }); console.log(`  ${p.book_id} p.${p.page_number}: ${im.error}`); return 'failed'; }
      imgs.push(im);
    }
    const callId = `${JOB}-${group[0].book_id}-${group[0].page_number}-${group.length}-${attempt}`;
    const dir = path.join(sealRoot, callId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    imgs.forEach((im, i) => fs.writeFileSync(path.join(dir, `${pageName(i)}.jpg`), im.buf));
    const sent = promptFor[group[0].book_id] + callInstruction(group.length);
    const sentHash = contentHash(sent);
    const promptFile = path.join('prompts', `${sentHash}.txt`);
    if (!fs.existsSync(path.join(OUT, promptFile))) fs.writeFileSync(path.join(OUT, promptFile), sent);
    const t0 = new Date();
    const r = await claudeCall(sent, MODEL, dir);
    fs.rmSync(dir, { recursive: true, force: true });
    const texts = r.cls ? null : splitPages(r.text, group.length);
    fs.appendFileSync(callLog, JSON.stringify({ ts: new Date().toISOString(), call_id: callId, book_id: group[0].book_id, pages: group.map((p) => p.page_number), model: r.model, secs: Math.round(r.secs), cls: r.cls || (texts ? null : 'page_count_mismatch'), usage: r.usage }) + '\n');
    if (r.cls === 'usage_limit') { stop = `usage limit: ${r.err || r.text.slice(0, 200)}`; return 'failed'; }
    const common = { model: r.model || MODEL, model_requested: MODEL, call_id: callId, call_pages: group.length, started_at: t0.toISOString(), finished_at: new Date().toISOString(), prompt_sent_chars: sent.length, prompt_sent_hash: sentHash, prompt_sent_file: promptFile, language: slotLanguage(books.get(group[0].book_id)?.language ?? null, LANGUAGE), book_language: books.get(group[0].book_id)?.language ?? null, language_override: !!LANGUAGE, call_usage: r.usage };
    if (r.cls || !texts) {
      if (attempt > 0) group.forEach((p, i) => writePage(p, '', { ...common, call_position: i + 1, exit: r.code === null ? -9 : (r.code || 1), error_class: r.cls || 'page_count_mismatch', stderr_tail: r.err, image_url: imgs[i].src, image_bytes: imgs[i].buf.length, image_sha256: imgs[i].sha }));
      console.log(`  ${group[0].book_id} p.${group[0].page_number}-${group[group.length - 1].page_number}: ${r.cls || 'page markers do not match: call refused'} (${Math.round(r.secs)}s)`);
      return r.cls ? 'failed' : 'mismatch';
    }
    group.forEach((p, i) => writePage(p, texts[i], { ...common, call_position: i + 1, exit: 0, error_class: null, image_url: imgs[i].src, image_bytes: imgs[i].buf.length, image_sha256: imgs[i].sha }));
    const bad = texts.filter((t) => ocrReadProblem(t)).length;
    console.log(`  ${group[0].book_id} p.${group[0].page_number}-${group[group.length - 1].page_number}: ok ${texts.map((t) => t.length).join('/')} chars${bad ? `, ${bad} fail the chatter guard` : ''} (${Math.round(r.secs)}s)`);
    return 'ok';
  };

  const queue = [...calls];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length && !stop) {
      const group = queue.shift();
      let r = await readGroup(group, 0);
      if (r !== 'ok' && !stop) r = await readGroup(group, 1);
      // Still refused: each page alone, so one hard page does not cost its neighbours.
      if (r !== 'ok' && !stop && group.length > 1) for (const p of group) { if (stop) break; await readGroup([p], 2); }
      // A page whose text fails the chatter guard is read once more alone (#6420 rule 4); apply refuses it otherwise.
      for (const p of group) {
        if (stop || !fs.existsSync(path.join(OUT, `${p.id}.txt`))) continue;
        const t = fs.readFileSync(path.join(OUT, `${p.id}.txt`), 'utf8');
        if (t && ocrReadProblem(t) && !JSON.parse(fs.readFileSync(path.join(OUT, `${p.id}.meta.json`), 'utf8')).call_id?.endsWith('-3')) await readGroup([p], 3);
      }
    }
  }));
  const metas = todo.map((p) => path.join(OUT, `${p.id}.meta.json`)).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  console.log(`\nread ${metas.filter((m) => m.exit === 0).length} ok, ${metas.filter((m) => m.exit !== 0).length} failed, ${todo.length - metas.length} not reached`);
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
