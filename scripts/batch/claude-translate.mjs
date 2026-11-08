#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-ocr.mjs — the sealed `claude -p` call, the subscription env strip and the usage-limit
// stop are copied from it; it reads IMAGES and cannot translate. scripts/batch/cli-translate.mjs — its read stage is
// the one-call-per-page Gemini twin of this, and its `apply` stage is THE writer for these reads too (it learns
// `cli: 'claude'` here, as cli-ocr.mjs apply did in #6600): this script writes no page. scripts/lib/translate-batch-seam.mjs
// — the block plan (planBlocks) used here; its parse (parseBlockResponse) falls back by POSITION when page numbers do
// not match, which a reply attributed only by its markers must not do, so splitBlockReply below is strict.
/**
 * Translate pages with Anthropic's Opus through the Claude CLI, on the subscription (#6559: Derek switched the
 * Nahuatl and Mayan-language books to Opus after #6545 measured it +0.5/5 over Gemini 3.8 Flash in all five
 * languages under a cross-family judge). READ stage only; `cli-translate.mjs apply` writes.
 *
 *   node --env-file=.env.production.local scripts/batch/claude-translate.mjs read --page-ids-file=F --out=DIR [--ocr-checked="..."]
 *        [--model=opus] [--per-call=10] [--job=NAME] [--instructions-file=F] [--cli=claude|agy] [--ocr-file=F (eval only)]
 *   node --env-file=.env.production.local scripts/batch/cli-translate.mjs apply --out=DIR --reason="..." [--apply]
 *
 * --cli=agy (#7503): the same blocks, prompt, split and guards, but each call goes to Gemini (default
 * gemini-3.8-flash-low) through `agy -p` in an empty, tool-gated workspace (scripts/lib/agy-cli.mjs gatedTextCall,
 * one attempt per call; this script's own retry ladder applies). Its reads carry `cli: 'agy'` and their own
 * prompt_variant, so they are never reused as Opus reads, and `apply` records a gemini engine for them. Up to 4 pages
 * per call: agy takes the prompt as one argv string, and Linux caps one argument at 128 KB.
 *
 * WHAT A CALL IS. Up to --per-call consecutive translatable pages of ONE book (translate-batch-seam planBlocks: a
 * short page or 20K chars of OCR ends a block early) go to `claude -p --model opus --tools ""` in an empty folder, on
 * translate-core's production block prompt (buildBlockTranslationPrompt: the live translation prompt, the book's
 * source-work line, the scoped page-break devices), seeded with the English of the page before the block, which is
 * the read just made in DIR if there is one, else the stored translation, exactly as cli-translate.mjs seeds. Calls
 * run ONE at a time, in page order, so every block's seed exists. The reply must hold one
 * `<translation page="N">` for each page, in order, and nothing else; anything else refuses the call whole. A
 * refused call is retried once, then each of its pages is read alone. A page whose clause moved across an in-block
 * break (block-drift.mjs) or whose leaf seam was bridged (leaf-break.mjs) is read again alone. The exact prompt
 * sent is saved under DIR/prompts/<hash>.txt, and `apply` checks the meta's hash against it; each call's whole reply
 * is kept under DIR/raw/<call id>.txt.
 *
 * --folio-markers=1 (#8399, --cli=agy, text reads): a block of Latin-script pages goes as ONE continuous text with
 * `<pb n="N"/>` where each page begins (translate-core FOLIO_MARKER_RULE, the #7118 lane extended to the block) and is
 * split at the markers (folio-markers.mjs splitMarkedReply: every page turn within the balance bound); the wrong-leaf
 * checks (absorption, number vote) and the leaf-seam check apply, not the clause-drift test (a sentence may cross a
 * marker). An unusable or unbalanced split reads the block one page per call. No call of the run is sent the previous
 * page's English. Reads carry prompt_variant agy-block-7503-folio-8399, context.folio_markers and folio_block.
 * --block-chars=N: the source-character budget of one call (planBlocks maxChars; default its 20,000), so dense pages go
 * fewer to a call (#8399).
 *
 * --images-dir=D (#6948, image-attached reads): D/<page_id>/ holds that page's images, already cut (t1.jpg, t2.jpg, ... in
 * reading order: full-resolution strips of the leaf; scripts/eval/tib-concept-opus-6948/prep-images.mjs makes them).
 * Each call's sealed folder gets its pages' images as p<N>-t<k>.jpg, the CLI is allowed the Read tool and nothing
 * else (still --restricted to that folder), and the prompt tells it to open every image and to follow the leaf, with
 * a bracketed note, where the leaf plainly differs from the transcription. The image line is part of the prompt sent,
 * so it is in the hash; each page's meta lists its images by sha256. Its own prompt_variant, so these reads are never
 * reused as text-only reads, or the other way round. A page with no image in D is not read. Claude only.
 *
 * --instructions-file=F: JSON { page_id: "one line" }, as in cli-translate.mjs read; a call appends each distinct line
 * of its pages once, before the reply rules (#6865: one column instruction given to every arm of a comparison).
 *
 * KEPT AND REUSED (#7075, scripts/lib/candidate-reads.mjs): every usable page read is copied to R2 candidate-reads/
 * (with the exact prompt its call sent) when it is made. Before planning the calls, each page asks for a kept read
 * by the same --model on the same prompt template and variant, the same OCR (by hash) and the same instruction line,
 * and uses it instead of calling (meta `reused_from`); the page-before context is not part of that key. `--fresh`
 * always calls: a repeat-noise eval needs fresh reads.
 *
 * WRONG-LEAF GUARD (#5021, scripts/lib/block-page-guard.mjs). A call of 2+ pages asks each page's section to open on an
 * anchor: the first and last 12 characters of THAT page's source, copied. --reply=json (the default for --cli=agy):
 * one JSON array, one {page, anchor_first, anchor_last, translation} per page in the order sent (splitJsonReply);
 * --reply=tags (the default for --cli=claude): <anchor-first>/<anchor-last> at the head of each <translation> tag. A
 * count, order or page-number mismatch refuses the call. Then each page is checked: its anchor against its own source
 * and its neighbours', the call's absorption test (k from the book's stored English when the call is short) and the
 * single-page number vote; a refused page is read again alone and the refusal is logged in calls.jsonl (`guard`).
 * Measured 2026-11-03 on 200 agy blocks of 4 (Latin, German, Italian, French, Chinese): 0 of 804 pages refused by the
 * anchor; 4 pages (one block) refused by absorption, a real overlap (p.4's English carries p.5's opening).
 *
 * HOW IT FAILS. A usage-limit reply stops the run (exit 3) with the pages done so far saved; re-running skips them.
 * Any other failed page gets an empty .txt and a non-zero `exit` in its meta, which `apply` skips and counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readPageIdsFile } from '../lib/ocr-targeting.mjs';
import { ocrFirstGate } from '../lib/ocr-first-gate.mjs';
import { PAGE_BREAK_SCOPED, pageBreakVariant, buildBlockTranslationPrompt, loadTranslationPrompts, isTranslatablePage, sameLanguageReason, sanitizeTranslationTags, dropLeafSeamBreaches, contentHash } from '../lib/translate-core.mjs';
import { leafNumberOf } from '../lib/split-stage.mjs';
import { planBlocks } from '../lib/translate-batch-seam.mjs';
import { dropDriftedPages } from '../lib/block-drift.mjs';
import { anchorRule, takeAnchors, lengthRatioK, blockPageRefusals } from '../lib/block-page-guard.mjs';
import { splitMarkedReply } from '../lib/folio-markers.mjs';
import { sourceProse } from '../lib/block-drift.mjs';
import { dominantScript } from '../lib/page-integrity.mjs';
import { cliChatterReason } from '../lib/cli-chatter.mjs';
import { checkWrittenText } from '../lib/write-text-guard.mjs';
import { claudeBlocked, noteLimitHit } from '../lib/model-limits.mjs';
import { gatedTextCall, agyUsage } from '../lib/agy-cli.mjs';
import { engineNameForCli } from '../lib/write-provenance.mjs';
import { laneForWrite } from '../lib/lanes.mjs';
import { recordLaneBooks, laneJob } from '../lib/lane-book-list.mjs';
import { keepRead, findRead, reuseInto, translationReuseKey, wantsFresh } from '../lib/candidate-reads.mjs';

const READ_SITE = 'scripts/batch/claude-translate.mjs';
const PROMPT_VARIANTS = { claude: 'claude-block-6559-unclear', agy: 'agy-block-7503' };
// One argv string carries an agy prompt; Linux refuses an argument over 128 KB (MAX_ARG_STRLEN).
const AGY_MAX_PROMPT_CHARS = 120_000;
/** Part of the prompt SENT, so part of what is hashed: the CLI is an agent and must answer with text only. */
// The <unclear> line: on the #6559 paired check Opus copied doubtful Nahuatl words through untranslated inside
// <unclear> tags (Promptuario p. 67), where Gemini translated them. Translate the best reading and keep the doubt.
/**
 * The --folio-markers suffix (#8399): a marked block answers with ONE <translation> wrapper holding the whole block's
 * English with a <pb n="N"/> where each page begins (translate-core FOLIO_MARKER_RULE), then one summary and keywords.
 */
export const MARKED_CALL_SUFFIX = '\n\nWhere the source marks a word <unclear>, translate your best reading of it into English and keep the <unclear> tag around the English; never copy the source word through untranslated.\n\nAnswer with the one <translation> wrapper, the page markers inside it, then the one <summary> and the one <keywords>, and nothing before, between or after them: no commentary, no code fence. Do not use any tool: the text is above.\n';
export const CALL_SUFFIX = '\n\nWhere the source marks a word <unclear>, translate your best reading of it into English and keep the <unclear> tag around the English; never copy the source word through untranslated.\n\nAnswer with the translation tags only, one per page in the order given, and nothing before, between or after them: no commentary, no code fence. Do not use any tool: the text is above.\n';

/**
 * The --images-dir suffix (#6948). The 10-24 Opus gate failed mostly on the transcription (18 of 28 bad Tibetan pages:
 * seam lines invented or duplicated, lines cut short), which a text-only reader cannot see; this one is shown the leaf.
 * `files` is [[page_number, [file, ...]], ...] in page order. The summary line: the base prompt's "END with <summary>"
 * read as once per reply on 5 of the first 8 image calls (#6948), which the strict split refuses.
 */
export function imageCallSuffix(files) {
  const list = files.map(([n, fs_]) => `page ${n}: ${fs_.map((f) => `./${f}`).join(', ')}`).join('\n');
  return `\n\nWhere the source marks a word <unclear>, translate your best reading of it into English and keep the <unclear> tag around the English; never copy the source word through untranslated.

THE PAGE IMAGES. The scans of these pages are in your working folder, each leaf cut into overlapping full-resolution strips, left to right:
${list}
Open every one of them with the Read tool before you translate. The transcription above is machine OCR of these leaves and can be wrong: a line repeated, a line invented or carried over from another leaf, a line cut short or skipped, a letter or syllable misread. Translate what the LEAF says. Where the leaf plainly differs from the transcription in a way that changes the English (a repeated, invented, skipped or cut line, a misread word), follow the leaf and say so in a short bracketed note at that place, for example [the transcription repeats this line; the leaf has it once] or [leaf: X; the transcription reads Y]. Where the leaf is too faint or damaged to tell, translate the transcription. Do not describe the images otherwise.

Answer with the translation tags only, one per page in the order given, and nothing before, between or after them: no commentary, no code fence. Each page's own <summary> and <keywords> go INSIDE that page's <translation> tag, just before its </translation>; never one summary for the whole reply. Use no tool except Read, and Read only the image files listed above.\n`;
}

/**
 * Split a block reply into pages. Returns Map<page_number, text>, or null when the tags are not exactly one
 * `<translation page="N">` per page in the given order with nothing but whitespace (or a code fence) around them.
 * Strict on purpose: a reply is attributed to pages ONLY by its markers, so a dropped, merged, repeated, renumbered
 * or reordered page refuses the whole call rather than putting one page's English on another.
 */
export function splitBlockReply(reply, pageNumbers) {
  let s = String(reply || '').replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '');
  // #6865: Opus sometimes closes the tag before the page's <summary>/<keywords>. With ONE page there is no other page
  // they could belong to, so they are moved inside; a block reply that does it is still refused.
  if (pageNumbers.length === 1) {
    const tail = s.match(/<\/translation>((?:\s*<(summary|keywords)>[\s\S]*?<\/\2>)+)\s*$/);
    if (tail) s = s.slice(0, tail.index) + tail[1] + '\n</translation>';
  }
  const re = /<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g;
  const found = [...s.matchAll(re)];
  if (found.length !== pageNumbers.length) return null;
  if (found.some((m, i) => Number(m[1]) !== Number(pageNumbers[i]))) return null;
  if (s.replace(re, '').trim()) return null;
  const out = new Map();
  for (const m of found) {
    const text = m[2].trim();
    if (!text) return null;
    out.set(Number(m[1]), text);
  }
  return out;
}

/**
 * --reply=json (#5021, Derek 2026-11-03: "require structured output", for agy "a strict JSON block the parser
 * validates"). A call of 2+ pages answers with ONE JSON array, one object per page in the order sent:
 * {"page": N, "anchor_first": "...", "anchor_last": "...", "translation": "..."}. Part of the prompt SENT.
 */
export function jsonReplySuffix(pageNumbers) {
  return `\n\nWhere the source marks a word <unclear>, translate your best reading of it into English and keep the <unclear> tag around the English; never copy the source word through untranslated.\n\nTHE REPLY FORMAT. Instead of <translation> tags, answer with ONE JSON array and nothing before or after it: exactly ${pageNumbers.length} objects, one per page, in the order ${pageNumbers.join(', ')}:\n[{"page": ${pageNumbers[0]}, "anchor_first": "FIRST", "anchor_last": "LAST", "translation": "..."}, ...]\n"page" is the page number. "anchor_first" is a copy of the first ${12} characters and "anchor_last" a copy of the last ${12} characters of THAT page's source text as printed under its "--- Page N ---" heading (not counting spaces or tags), in the original script, untranslated: copy them from the page before you translate it. "translation" is that page's translation and only that page's, in the format the instructions above ask for (its own <summary> and <keywords> included), as a JSON string. Never carry text over from the page before or after. Do not use any tool: the text is above.\n`;
}

/**
 * Split a --reply=json block reply. Returns { texts: Map<page_number, text>, anchors: Map<page_number, {first,last}> },
 * or null — the whole call refused — unless the reply is one JSON array (a code fence around it is allowed) of
 * exactly one object per page, in the order sent, each with a non-empty string translation.
 */
export function splitJsonReply(reply, pageNumbers) {
  const s = String(reply || '').trim().replace(/^```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '').trim();
  let arr;
  try { arr = JSON.parse(s); } catch { return null; }
  if (!Array.isArray(arr) || arr.length !== pageNumbers.length) return null;
  const texts = new Map(), anchors = new Map();
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o || typeof o !== 'object' || Number(o.page) !== Number(pageNumbers[i]) || typeof o.translation !== 'string' || !o.translation.trim()) return null;
    texts.set(Number(o.page), o.translation.trim());
    anchors.set(Number(o.page), { first: typeof o.anchor_first === 'string' ? o.anchor_first : null, last: typeof o.anchor_last === 'string' ? o.anchor_last : null });
  }
  return { texts, anchors };
}

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;

// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

/**
 * One block through agy, in the shape claudeCall resolves: a quota stop is reported as `usage_limit` so the run stops
 * the same way. `text` is the whole reply (the block split reads the page tags, not agy's <<<BEGIN>>> markers).
 */
async function agyBlockCall(prompt, model, cwd) {
  if (prompt.length > AGY_MAX_PROMPT_CHARS) return { text: '', model, usage: null, code: 1, cls: 'prompt_too_long', err: `${prompt.length} chars > ${AGY_MAX_PROMPT_CHARS}`, secs: 0 };
  const r = await gatedTextCall(prompt, { model, task: 'translate', attempts: 1, tmp: cwd });
  return { text: r.text, model, usage: agyUsage(r.usage), code: r.code, cls: r.cls === 'quota' ? 'usage_limit' : r.cls, err: r.err, secs: r.secs, tool_calls: r.tool_calls };
}

/** One sealed text-only `claude -p` call, the prompt on stdin. Resolves {text, model, usage, code, cls, err, secs}. */
export function claudeCall(prompt, model, cwd, { readImages = false } = {}) {
  // A spent account is not called (model-limits.mjs): the caller gets the usage_limit it would have got, with no call.
  const blocked = claudeBlocked();
  if (blocked) return Promise.resolve({ text: '', model: null, usage: null, code: null, cls: 'usage_limit', err: blocked.reason, secs: 0, not_called: true, until: blocked.until });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tools = readImages ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''];
    const child = spawn('claude', ['-p', '--model', model, '--restricted', ...tools, '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON: an error before the session */ }
      const text = String(j.result ?? '').trim();
      const models = Object.keys(j.modelUsage || {});
      const resolved = models.find((m) => m.includes(String(model).replace(/^claude-/, ''))) || models[0] || null;
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}${j.subtype ? `_${j.subtype}` : ''}` : !text ? 'empty' : null;
      if (cls === 'usage_limit') noteLimitHit('claude', { reason: (err || text).slice(-200) });
      resolve({ text, model: resolved, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, cache_creation: j.usage.cache_creation_input_tokens, turns: j.num_turns, list_cost_usd: j.total_cost_usd } : null, code, cls, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

async function main() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const OUT = arg('out') && path.resolve(arg('out'));
  const CLI = arg('cli') || 'claude';
  if (!(CLI in PROMPT_VARIANTS)) { console.error(`--cli must be one of ${Object.keys(PROMPT_VARIANTS).join(', ')}`); process.exit(2); }
  const IMAGES = arg('images-dir') && path.resolve(arg('images-dir'));
  if (IMAGES && CLI !== 'claude') { console.error('--images-dir is for --cli=claude only'); process.exit(2); }
  // agy blocks answer in the validated JSON array by default (#5021, Derek 2026-11-03; measured 2026-11-03 on 50 blocks:
  // 49 parsed, 1 refused and re-read, translations within 1% of the tag reply's length); Opus keeps the tags.
  const REPLY = arg('reply') || (CLI === 'agy' && !IMAGES ? 'json' : 'tags');
  if (!['tags', 'json'].includes(REPLY) || (REPLY === 'json' && IMAGES)) { console.error('--reply is tags or json (json: text-only reads)'); process.exit(2); }
  // --folio-markers (#8399, agy text reads only): a block of Latin-script pages goes as ONE continuous text with a
  // folio marker at each page turn and is split at the markers (the #7118 lane extended from 2 pages to the block);
  // no call of the run is sent the previous page's English, the marked block's or a page read alone. An unusable or
  // unbalanced split reads the block's pages one per call.
  const MARKED = CLI === 'agy' && !IMAGES && (arg('folio-markers') ?? '0') !== '0';
  const PROMPT_VARIANT = PROMPT_VARIANTS[CLI] + (IMAGES ? '-image' : '') + (MARKED ? '-folio-8399' : REPLY === 'json' ? '-json' : '');
  /** A page's prepared images, in reading order, or [] (#6948). */
  const imagesOf = (p) => { const d = IMAGES && path.join(IMAGES, p.id); return d && fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^t\d+\.jpg$/.test(f)).sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4))) : []; };
  const MODEL = arg('model') || (CLI === 'agy' ? 'gemini-3.8-flash-low' : 'opus');
  const PER_CALL = Math.max(1, Math.min(CLI === 'agy' ? 4 : 10, Number(arg('per-call') || (CLI === 'agy' ? 2 : 10))));
  const JOB = arg('job') || 'claude-translate';
  const INSTRUCTIONS = arg('instructions-file') ? JSON.parse(fs.readFileSync(arg('instructions-file'), 'utf8')) : {};
  if (process.argv[2] !== 'read' || !OUT || !arg('page-ids-file')) { console.error('usage: claude-translate.mjs read --page-ids-file=F --out=DIR (see the header)'); process.exit(2); }
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  if (CLI === 'claude' && !/--restricted/.test(spawnSync(CLI, ['--help'], { encoding: 'utf8' }).stdout || '')) { console.error('this claude CLI has no --restricted: refusing to run an unsealed reader'); process.exit(2); }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, staged_split: 1 };
  const ids = readPageIdsFile(arg('page-ids-file'));
  const prompts = await loadTranslationPrompts(db);
  const found = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: PROJ }).toArray()).map((p) => [p.id, p]));
  // --ocr-file=F (eval only): JSON { page_id: text }, read IN PLACE OF the stored OCR of those pages, e.g. a correction
  // that was never written (#6560 translation router test). The meta's ocr_hash is then the override's, which no stored
  // page matches, so `cli-translate.mjs apply` refuses these reads as written over another OCR.
  const OCR_OVERRIDE = arg('ocr-file') ? JSON.parse(fs.readFileSync(arg('ocr-file'), 'utf8')) : {};
  const override = (p) => { if (p && OCR_OVERRIDE[p.id]) p.ocr = { ...(p.ocr || {}), data: OCR_OVERRIDE[p.id], override: true }; return p; };
  for (const p of found.values()) override(p);
  // Check the transcription before paying for a translation on top of it (#6865).
  const gate = ocrFirstGate([...found.values()], arg('ocr-checked'));
  console.log(gate.message);
  if (!gate.ok) { await client.close(); process.exit(2); }
  // The job's book list, recorded with the job for the lane registry (#7301 item 5). The lane is the one that will
  // stamp these pages when cli-translate.mjs apply writes them (anthropic, or gemini for --cli=agy). No page or book is written here.
  await recordLaneBooks(db, { lane: laneForWrite('translation', { call_site: 'scripts/batch/cli-translate.mjs', name: engineNameForCli(CLI) }), ...laneJob(JOB), pages: [...found.values()] });
  const bookIds = [...new Set([...found.values()].map((p) => p.book_id))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }).toArray()).map((b) => [b.id, b]));
  // Every page of these books, for the neighbours: the seed page before a block and the next page's OCR.
  const byNum = new Map();
  for (const p of await db.collection('pages').find({ book_id: { $in: bookIds } }, { projection: PROJ }).toArray()) byNum.set(`${p.book_id}:${p.page_number}`, found.get(p.id) ?? override(p));

  fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
  const readOf = (id) => { try { return fs.readFileSync(path.join(OUT, `${id}.txt`), 'utf8').trim(); } catch { return ''; } };
  const done = (p) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `${p.id}.meta.json`), 'utf8')).exit === 0 && readOf(p.id).length > 5; } catch { return false; } };
  const todo = [];
  for (const id of ids) {   // the file's order, which is page order
    const p = found.get(id);
    if (!p || done(p)) continue;
    const tr = isTranslatablePage(p);
    if (!tr.ok) { console.log(`  ${p.page_number} not translatable (${tr.reason}); skipped`); continue; }
    const same = sameLanguageReason({ book: books.get(p.book_id), page: p });
    if (same) { console.log(`  ${p.page_number} skipped: ${same}`); continue; }
    if (IMAGES && !imagesOf(p).length) { console.log(`  ${p.page_number} skipped: no image in ${IMAGES}`); continue; }
    todo.push(p);
  }
  // A kept read of the same page, model, prompt template, OCR and instruction is used instead of a call (#7075).
  const FRESH = wantsFresh();
  const refOf = new Map();
  const reuseKeyOf = (p) => {
    if (!refOf.has(p.book_id)) refOf.set(p.book_id, buildBlockTranslationPrompt({ prompts, book: books.get(p.book_id), pages: [p], pageBreak: PAGE_BREAK_SCOPED }).promptRef);
    return translationReuseKey({ prompt_ref: refOf.get(p.book_id), ocr_hash: contentHash(p.ocr.data), prompt_variant: PROMPT_VARIANT, instruction: INSTRUCTIONS[p.id] || null });
  };
  let reused = 0;
  if (!FRESH) {
    for (const p of [...todo]) {
      const hit = await findRead({ page_id: p.id, book_id: p.book_id, field: 'translation', model: MODEL, prompt_hash: reuseKeyOf(p), derive: (m) => (m.cli === CLI ? translationReuseKey(m) : null) });
      if (hit && await reuseInto(OUT, p.id, hit)) { reused++; todo.splice(todo.indexOf(p), 1); console.log(`  ${p.page_number} reused a kept read (${hit.body.job ?? '?'}, ${hit.body.read_at?.slice(0, 10) ?? '?'}): no call`); }
    }
  }
  // Blocks: consecutive runs of one book (a gap in page numbers or a new book starts a run), cut by planBlocks.
  const runs = [];
  for (const p of todo) {
    const run = runs[runs.length - 1], last = run?.[run.length - 1];
    if (last && last.book_id === p.book_id && last.page_number + 1 === p.page_number) run.push(p); else runs.push([p]);
  }
  // --block-chars=N (#8399): the source-character budget of one call, so dense pages go fewer to a call.
  const BLOCK_CHARS = Number(arg('block-chars')) || undefined;
  const blocks = runs.flatMap((r) => planBlocks(r, { blockSize: PER_CALL, ...(BLOCK_CHARS && { maxChars: BLOCK_CHARS }) }));
  console.log(`${found.size} of ${ids.length} page ids found; ${todo.length} to translate in ${blocks.length} calls; model ${MODEL}; ${CLI} ${version}`);

  const sealRoot = path.join(process.env.TMPDIR || os.tmpdir(), 'claude-translate-sealed', path.basename(OUT));
  const callLog = path.join(OUT, 'calls.jsonl');
  let stop = null;
  const writePage = (p, text, meta) => {
    fs.writeFileSync(path.join(OUT, `${p.id}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${p.id}.meta.json`), JSON.stringify({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, read_site: READ_SITE, prompt_variant: PROMPT_VARIANT, ...meta, chars: text.length, wrapper: null, chatter: text ? cliChatterReason(text) : null }, null, 1));
  };

  // The book's median log(EN/SRC) over its stored translations, for a call too short to measure its own (#5021).
  const kOf = new Map();
  const bookK = (bookId) => {
    if (!kOf.has(bookId)) kOf.set(bookId, lengthRatioK([...byNum.entries()].filter(([key]) => key.startsWith(`${bookId}:`)).map(([, p]) => ({ src: p.ocr?.data, en: p.translation?.data, type: p.page_type })), { min: 5 }));
    return kOf.get(bookId);
  };
  /** Translate one group of consecutive pages in one sealed call. Returns the pages to read again alone, or null on a refused call. */
  const readGroup = async (group, attempt) => {
    const book = books.get(group[0].book_id);
    const first = group[0], lastP = group[group.length - 1];
    const prev = byNum.get(`${first.book_id}:${first.page_number - 1}`), next = byNum.get(`${lastP.book_id}:${lastP.page_number + 1}`);
    const prevRead = prev ? readOf(prev.id) : '';
    const previousTranslation = MARKED ? null : prevRead && !cliChatterReason(prevRead) ? sanitizeTranslationTags(prevRead) : prev?.translation?.data || null;
    const marked = MARKED && group.length > 1 && dominantScript(group.map((p) => sourceProse(p.ocr?.data || '')).join(' ')) === 'latin';
    const nums = group.map((p) => leafNumberOf(p));
    // A staged split leaf (#7605) is shown, and split back, by the number it will have once swapped in, not "-999983".
    const built = buildBlockTranslationPrompt({ prompts, book, pages: group.map((p) => ({ ...p, page_number: leafNumberOf(p) })), previousTranslation, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED, folioMarkers: marked });
    const instruction = [...new Set(group.map((p) => INSTRUCTIONS[p.id]).filter(Boolean))].join('\n\n') || null;
    const imgFiles = IMAGES ? group.map((p) => [p, imagesOf(p)]) : null;
    // #5021: a call of 2+ pages asks each page's section to open on an anchor copied from its own source.
    const anchored = group.length > 1 && !marked;
    const json = anchored && REPLY === 'json';
    const sent = marked ? built.prompt + (instruction ? `\n\n${instruction}` : '') + MARKED_CALL_SUFFIX : json ? built.prompt + (instruction ? `\n\n${instruction}` : '') + jsonReplySuffix(group.map((p) => leafNumberOf(p)))
      : built.prompt + (instruction ? `\n\n${instruction}` : '') + (anchored ? anchorRule(group.map((p) => leafNumberOf(p))) : '') + (imgFiles ? imageCallSuffix(imgFiles.map(([p, fs_]) => [p.page_number, fs_.map((f) => `p${p.page_number}-${f}`)])) : CALL_SUFFIX);
    const sentHash = contentHash(sent);
    const promptFile = path.join('prompts', `${sentHash}.txt`);
    if (!fs.existsSync(path.join(OUT, promptFile))) fs.writeFileSync(path.join(OUT, promptFile), sent);
    const callId = `${JOB}-${first.book_id}-${first.page_number}-${group.length}-${attempt}`;
    const dir = path.join(sealRoot, callId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const imgMeta = new Map();
    for (const [p, fs_] of imgFiles || []) {
      imgMeta.set(p.id, fs_.map((f) => { const b = fs.readFileSync(path.join(IMAGES, p.id, f)); fs.writeFileSync(path.join(dir, `p${p.page_number}-${f}`), b); return { file: `p${p.page_number}-${f}`, sha256: createHash('sha256').update(b).digest('hex') }; }));
    }
    const t0 = new Date();
    const r = CLI === 'agy' ? await agyBlockCall(sent, MODEL, dir) : await claudeCall(sent, MODEL, dir, { readImages: !!imgFiles });
    fs.rmSync(dir, { recursive: true, force: true });
    const jsonShown = json && !r.cls ? splitJsonReply(r.text, group.map((p) => leafNumberOf(p))) : null;
    const markedSplit = marked && !r.cls ? splitMarkedReply(r.text, nums, { sources: group.map((p) => p.ocr.data) }) : null;
    const shown = r.cls ? null : marked ? (markedSplit.ok ? new Map(nums.map((n, i) => [n, markedSplit.texts[i]])) : null) : json ? jsonShown?.texts ?? null : splitBlockReply(r.text, nums);
    const texts = shown && new Map(group.map((p) => [p.page_number, shown.get(leafNumberOf(p))]));
    // The anchors come off every section before anything else reads it (a one-page reply has none to give); a JSON
    // reply carries them as fields.
    const tagAnchors = texts && !marked ? takeAnchors(texts) : null;
    const anchors = jsonShown ? new Map(group.map((p) => [p.page_number, jsonShown.anchors.get(leafNumberOf(p))])) : tagAnchors;
    fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'raw', `${callId}.txt`), r.text);   // the whole reply, so a refused call can be read
    fs.appendFileSync(callLog, JSON.stringify({ ts: new Date().toISOString(), call_id: callId, book_id: first.book_id, pages: group.map((p) => p.page_number), model: r.model, secs: Math.round(r.secs), cls: r.cls || (texts ? null : marked ? 'folio_split_refused' : 'page_tags_mismatch'), ...(markedSplit && { folio: { ok: markedSplit.ok, reading: markedSplit.reading, why: markedSplit.why } }), usage: r.usage }) + '\n');
    if (r.cls === 'usage_limit') { stop = `usage limit: ${r.err || r.text.slice(0, 200)}`; return null; }
    // #8399 (as #7118): a marked reply that does not split cleanly, or splits out of balance, is not retried as a
    // block: each of its pages is read alone.
    if (markedSplit && !markedSplit.ok) { console.log(`  ${first.book_id} p.${first.page_number}-${lastP.page_number}: marked block not usable (${markedSplit.why}): one page per call`); return [...group]; }
    const common = {
      model: r.model || MODEL, model_requested: MODEL, call_id: callId, call_pages: group.length, attempts: attempt + 1, started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      prompt_ref: built.promptRef, is_english_book: built.isEnglish, prompt_sent_chars: sent.length, prompt_sent_hash: sentHash, prompt_sent_file: promptFile, call_usage: r.usage, ...(instruction && { instruction }),
      context: { previous_translation: !!previousTranslation, previous_from: prevRead && previousTranslation !== prev?.translation?.data ? 'cli-read' : previousTranslation ? 'stored' : null, prev_ocr: !!prev?.ocr?.data, next_ocr: !!next?.ocr?.data, page_break: pageBreakVariant(PAGE_BREAK_SCOPED), prompt_variant: PROMPT_VARIANT, block: group.map((p) => p.page_number), ...(marked && { folio_markers: true }) },
      ...(marked && { folio_block: { pages: group.map((p) => p.page_number), page_ids: group.map((p) => p.id), reading: markedSplit.reading } }),
    };
    const pageMeta = (p, i) => ({ ...common, call_position: i + 1, ocr_hash: contentHash(p.ocr.data), ocr_updated_at: p.ocr.updated_at ?? null, ...(imgMeta.has(p.id) && { images: imgMeta.get(p.id), tool_turns: r.usage?.turns ?? null }) });
    if (r.cls || !texts) {
      if (attempt > 0) group.forEach((p, i) => writePage(p, '', { ...pageMeta(p, i), exit: r.code === null ? -9 : (r.code || 1), error_class: r.cls || 'page_tags_mismatch', stderr_tail: r.err }));
      console.log(`  ${first.book_id} p.${first.page_number}-${lastP.page_number}: ${r.cls || 'translation tags do not match the pages: call refused'} (${Math.round(r.secs)}s)`);
      return null;
    }
    // #5055: the write guard on each page as returned, before sanitizeTranslationTags closes a cut tail tag. Its verdict
    // goes in the meta (`write_guard`), which `cli-translate.mjs apply` refuses; a cut page of a block is read alone.
    const cut = new Map();
    for (const p of group) {
      const raw = texts.get(p.page_number);
      if (raw == null) continue;
      const g = checkWrittenText(raw, { kind: 'translation', source: p.ocr?.data, lang: book?.language, type: p.page_type });
      if (g.verdict === 'truncated') cut.set(p.page_number, g.reasons);
    }
    for (const [n, t] of texts) texts.set(n, sanitizeTranslationTags(t));
    // The production block guards: a clause moved across an in-block break, or a bridged leaf seam, leaves both pages
    // of that boundary to be read again alone rather than written from this block.
    const again = new Set();
    if (group.length > 1) for (const n of cut.keys()) again.add(n);
    if (group.length > 1) {
      // caseless: the Han test (#7503) runs here, on the subscription; the paid block lanes have not opted in.
      // #5021 (block-page-guard.mjs): the anchors, the call's absorption check (k from the book's stored English
      // when the call has too few text pages) and the single-page number vote, each refused page read alone.
      // A marked block carries a sentence across a turn on purpose, so the clause-drift test does not apply; the
      // wrong-leaf checks (absorption, number vote) do, as on cli-translate.mjs's marked pairs (#7118).
      if (marked) {
        const refused = blockPageRefusals(group.map((p) => ({ page_number: p.page_number, page_type: p.page_type, ocr: p.ocr })), texts, { prevOcr: prev?.ocr?.data ?? null, nextOcr: next?.ocr?.data ?? null, k: bookK(first.book_id) });
        for (const w of refused) again.add(w.page_number);
        if (refused.length) fs.appendFileSync(callLog, JSON.stringify({ ts: new Date().toISOString(), call_id: callId, guard: refused.map((w) => ({ page: w.page_number, kind: w.reason, detail: w.detail })) }) + '\n');
      } else {
        const guard = dropDriftedPages(group, texts, { caseless: true, anchors: anchored ? anchors : null, prevOcr: prev?.ocr?.data ?? null, nextOcr: next?.ocr?.data ?? null, k: bookK(first.book_id) }).drifted;
        for (const d of guard) { again.add(d.prev); again.add(d.next); }
        if (guard.length) fs.appendFileSync(callLog, JSON.stringify({ ts: new Date().toISOString(), call_id: callId, guard: guard.map((d) => ({ prev: d.prev, next: d.next, kind: d.kind, fragment: String(d.fragment || '').slice(0, 160) })) }) + '\n');
      }
      for (const b of dropLeafSeamBreaches(group, texts).breached) again.add(b.page);
    }
    const redo = [], kept = [];
    group.forEach((p, i) => {
      if (again.has(p.page_number) || !texts.has(p.page_number)) { redo.push(p); return; }
      writePage(p, texts.get(p.page_number), { ...pageMeta(p, i), exit: 0, error_class: null, ...(cut.has(p.page_number) && { write_guard: 'truncated', write_guard_reasons: cut.get(p.page_number) }) });
      kept.push(p);
    });
    // Kept the moment they are paid for (#7075), with the prompt the call sent; best effort, never fails the read.
    for (const p of kept) {
      const meta = JSON.parse(fs.readFileSync(path.join(OUT, `${p.id}.meta.json`), 'utf8'));
      await keepRead({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, field: 'translation', text: texts.get(p.page_number), model: MODEL, prompt_hash: reuseKeyOf(p), job: JOB, meta, prompt_text: sent, source_path: path.join(OUT, `${p.id}.txt`) });
    }
    console.log(`  ${first.book_id} p.${first.page_number}-${lastP.page_number}: ok ${group.map((p) => (texts.get(p.page_number) || '').length).join('/')} chars${redo.length ? `; ${redo.length} to read alone (drift or seam)` : ''} (${Math.round(r.secs)}s)`);
    return redo;
  };

  for (const group of blocks) {
    if (stop) break;
    let redo = await readGroup(group, 0);
    if (redo === null && !stop) redo = await readGroup(group, 1);
    // Still refused: each page alone, so one hard page does not cost its neighbours.
    if (redo === null && !stop && group.length > 1) redo = group;
    for (const p of redo || []) { if (stop) break; if (!done(p)) await readGroup([p], 2); }
    // #5055: a page read alone whose read is still cut gets one more alone read (attempt 3); apply refuses it otherwise.
    for (const p of group) {
      if (stop) break;
      const f = path.join(OUT, `${p.id}.meta.json`);
      const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
      if (m?.write_guard === 'truncated' && m.call_pages === 1 && !/-[23]$/.test(m.call_id || '')) await readGroup([p], 3);
    }
  }
  await client.close();
  const metas = todo.map((p) => path.join(OUT, `${p.id}.meta.json`)).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  console.log(`\nread ${metas.filter((m) => m.exit === 0).length} ok, ${metas.filter((m) => m.exit !== 0).length} failed, ${todo.length - metas.length} not reached; reused ${reused} kept read(s) instead of calling${FRESH ? ' (--fresh: none looked up)' : ''}`);
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
