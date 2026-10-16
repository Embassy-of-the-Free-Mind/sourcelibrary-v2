#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/mongol-ocr-probe-5664.mjs (the 2026-10-04 probe: same 10 pages, same hint, paid Flash API —
 * this runs the subscription CLIs instead, so it cannot reuse its callGemini loop); scripts/batch/cli-ocr.mjs and
 * scripts/lib/agy-cli.mjs (the agy call, tool gate, @file attachment and marker unwrap — used); scripts/batch/claude-ocr.mjs
 * (the sealed `claude -p --restricted --tools Read` call and claudeEnv — copied, it is not exported).
 *
 * Mongolian Kanjur re-probe (#5664): can Gemini 4 Argon (low / high, via agy) or Opus (via claude -p) read the
 * Uighur-Mongol script of BDRC W4CZ5370? One page per call, two prompts (the live OCR prompt on auto-detect, and the
 * same prompt with the 2026-10-04 language hint), each read translated by the same arm with the live translation prompt.
 * Then two sealed judges (claude -p opus, agy gemini-3.8-flash-high) score each English against the Derge Tibetan.
 *
 * $0: subscription CLIs only. Reads Mongo (prompts) only; writes files only, under scripts/eval/results/mongol-argon-probe-5664/.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/mongol-argon-probe-5664.mjs read --arm=argon-low|argon-high|opus [--prompt=production|hinted]
 *   node ... scripts/eval/mongol-argon-probe-5664.mjs judge --judge=opus|flash [--controls]
 *   node ... scripts/eval/mongol-argon-probe-5664.mjs score
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { liveOcrPrompt } from '../lib/live-ocr-prompt.mjs';
import { buildTranslationPrompt, loadTranslationPrompts } from '../lib/translate-core.mjs';
import { CLI_SAFE_ARGS, agyCall, installToolGate, gateCalls, unwrapRead, gatedTextCall, TRANSLATE_SUFFIX } from '../lib/agy-cli.mjs';
import { OCR_SENTINEL_INSTRUCTION, TRANSLATION_SENTINEL_INSTRUCTION } from '../lib/cli-chatter.mjs';

const DIR = 'scripts/eval/results/mongol-argon-probe-5664';
const OLD = 'scripts/eval/results/mongol-ocr-probe-5664';
const SCRATCH = process.env.JOB_SCRATCH || '/mnt/HC_Volume_105839809/jobs/mongol-argon-5664';
const IMG = path.join(SCRATCH, 'images'); // images.sourcelibrary.org/pages/<book_id>/<page>.jpg, the pages' archived scans
const STAGE = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const ARMS = { 'argon-low': { cli: 'agy', model: 'gemini-4-argon-low' }, 'argon-high': { cli: 'agy', model: 'gemini-4-argon-high' }, opus: { cli: 'claude', model: 'opus' }, 'opus-tiles': { cli: 'claude', model: 'opus', tiles: 4 } };
// opus-tiles (beyond the brief, labelled): the Read tool downsamples the 5079 px leaf to ~1.5K px, and Opus declined the
// whole page as "too low resolution"; so the same page is also given as 4 overlapping full-resolution vertical strips.
// Same words as the 2026-10-04 hinted arm (scripts/eval/mongol-ocr-probe-5664.mjs HINT).
const HINT = '**Source language:** Classical (literary) Mongolian in the traditional Uighur-Mongol vertical script, printed from woodblocks (Beijing Kanjur, 1718–20). It is NOT Manchu. Columns run top to bottom and are read from LEFT to RIGHT. Transcribe in Mongolian script (Unicode U+1800 block), one source column per line, in reading order. The margin carries a Chinese section/volume/folio label. Report the primary language in the <language> tag.';
// --print-timeout=900s: argon-high on the hinted prompt timed out at agy's 300 s on most pages (0 chars back), so its
// timed-out reads were re-run with a longer limit; the read file records the limit used.
const PRINT_TIMEOUT = arg('print-timeout');
const SAFE_ARGS = PRINT_TIMEOUT ? CLI_SAFE_ARGS.map((a, i, xs) => (xs[i - 1] === '--print-timeout' ? PRINT_TIMEOUT : a)) : CLI_SAFE_ARGS;
const KILL = { killAfterMs: PRINT_TIMEOUT ? (parseInt(PRINT_TIMEOUT, 10) + 60) * 1000 : 360_000 };
const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const logCall = (row) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: 'mongol-argon-5664', ...row }) + '\n'); } catch { /* advisory */ } };
const pages = JSON.parse(fs.readFileSync(path.join(OLD, 'pages.json'), 'utf8'));
const derge = JSON.parse(fs.readFileSync(path.join(DIR, 'derge-passages.json'), 'utf8'));
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|resets? (?:at )?\d/i;
function claudeCall(prompt, cwd, model = 'opus') {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('/usr/bin/claude', ['-p', prompt, '--model', model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000); // claude only
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'quota' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text, model: Object.keys(j.modelUsage || {})[0] || null, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens } : null, code, cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

/** One call with retries; on quota, wait for the reset (never fall back to the API). */
async function withQuotaWait(fn, label) {
  for (let i = 0; i < 6; i++) {
    const r = await fn();
    if (r.cls === 'quota') { console.log(`  ${label}: quota, waiting 30 min`); await sleep(1800); continue; }
    if (r.cls && i < 2) { console.log(`  ${label}: ${r.cls}, retrying`); continue; }
    return r;
  }
  throw new Error(`${label}: still failing`);
}

async function ocrCall(arm, base, key) {
  const ws = fs.mkdtempSync(path.join(SCRATCH, `ws-${arm}-${key}-`));
  fs.copyFileSync(path.join(IMG, `${key}.jpg`), path.join(ws, `${key}.jpg`));
  const { cli, model } = ARMS[arm];
  let r;
  if (cli === 'agy') {
    const log = installToolGate(ws, { task: 'ocr' });
    const sent = `${base}\n\nThe page image to transcribe is attached: @./${key}.jpg Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
    r = await withQuotaWait(() => agyCall(['-p', sent, '--model', model, ...SAFE_ARGS], ws, KILL), `${arm} ocr ${key}`);
    if (!r.text && r.denied?.length && r.conversation) r = await agyCall(['-p', NUDGE, '--conversation', r.conversation, '--model', model, ...SAFE_ARGS], ws, KILL);
    r.tool_calls = gateCalls(log);
    logCall({ kind: 'ocr', model, key, cls: r.cls, secs: r.secs });
  } else if (ARMS[arm].tiles) {
    const n = ARMS[arm].tiles;
    const py = `from PIL import Image\nim=Image.open('${key}.jpg');W,H=im.size;w=W/${n};o=int(w*0.06)\nfor i in range(${n}):\n  im.crop((max(0,int(i*w)-o),0,min(W,int((i+1)*w)+o),H)).save('${key}-t%d.jpg'%(i+1),quality=92)\n`;
    const { spawnSync } = await import('node:child_process');
    spawnSync('python3', ['-c', py], { cwd: ws });
    fs.rmSync(path.join(ws, `${key}.jpg`));
    const names = Array.from({ length: n }, (_, i) => `./${key}-t${i + 1}.jpg`).join(', ');
    const sent = `${base}\n\nThe page image is given as ${n} files in this folder, ${names}: vertical strips of ONE page at full resolution, in order from left to right, each overlapping its neighbour slightly. Open each with the Read tool, then transcribe the page once, as one page, in the format above (do not repeat the columns that appear twice in an overlap). ${OCR_SENTINEL_INSTRUCTION}\n`;
    r = await withQuotaWait(() => claudeCall(sent, ws), `${arm} ocr ${key}`);
  } else {
    const sent = `${base}\n\nThe page image to transcribe is the file ./${key}.jpg in this folder. Open it with the Read tool, then transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
    r = await withQuotaWait(() => claudeCall(sent, ws), `${arm} ocr ${key}`);
  }
  fs.rmSync(ws, { recursive: true, force: true });
  return r;
}

async function textCall(arm, sent, label, task = 'translate') {
  const { cli, model } = ARMS[arm] || { cli: arm === 'flash-judge' ? 'agy' : 'claude', model: arm === 'flash-judge' ? 'gemini-3.8-flash-high' : 'opus' };
  if (cli === 'agy') {
    const r = await withQuotaWait(async () => { const x = await gatedTextCall(sent, { model, task, tmp: SCRATCH }); return x; }, label);
    logCall({ kind: task, model, key: label, cls: r.cls, secs: r.secs });
    return r;
  }
  const ws = fs.mkdtempSync(path.join(SCRATCH, 'ws-text-'));
  const r = await withQuotaWait(() => claudeCall(sent, ws), label);
  fs.rmSync(ws, { recursive: true, force: true });
  return { ...r, ...(() => { const u = unwrapRead(r.text); return { answer: u.text, problem: u.problem }; })() };
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

if (STAGE === 'read') {
  const arm = arg('arm');
  if (!ARMS[arm]) throw new Error(`--arm must be one of ${Object.keys(ARMS)}`);
  const which = arg('prompt') ? [arg('prompt')] : ['production', 'hinted'];
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const prod = await liveOcrPrompt(db);
  const hinted = await liveOcrPrompt(db, HINT);
  const trPrompts = await loadTranslationPrompts(db);
  await c.close();
  const jobs = which.flatMap((pr) => pages.map((p) => ({ pr, p })));
  await pool(jobs, Number(arg('concurrency', 2)), async ({ pr, p }) => {
    const out = path.join(DIR, `${arm}-${pr}`, `${p.key}.json`);
    if (fs.existsSync(out) && !(process.argv.includes('--redo-timeouts') && JSON.parse(fs.readFileSync(out, 'utf8')).ocr.cls === 'timeout')) return;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const base = pr === 'hinted' ? hinted : prod;
    const ocr = await ocrCall(arm, base.base, p.key);
    const read = unwrapRead(ocr.text);
    const { prompt: trBuilt } = buildTranslationPrompt({ prompts: trPrompts, book: { language: 'Mongolian' }, ocrText: read.text });
    const tr = read.text.trim() ? await textCall(arm, trBuilt + TRANSLATE_SUFFIX, `${arm} tr ${p.key}`) : { answer: '', problem: 'no read to translate' };
    fs.writeFileSync(out, JSON.stringify({
      key: p.key, arm, model: ARMS[arm].model, resolved_model: ocr.model || null, prompt: pr, ocr_prompt_ref: base.ref,
      language_instruction: pr === 'hinted' ? HINT : 'production auto-detect', translation_prompt_ref: trPrompts.translation ? { name: trPrompts.translation.ref?.name, version: trPrompts.translation.ref?.version } : null,
      ocr: { text: read.text, problem: read.problem, cls: ocr.cls, print_timeout: ARMS[arm].cli === 'agy' ? (PRINT_TIMEOUT || '300s') : null, secs: ocr.secs, usage: ocr.usage || null, tool_calls: ocr.tool_calls || null },
      translation: { text: tr.answer, problem: tr.problem, cls: tr.cls || null, secs: tr.secs || null },
    }, null, 1));
    console.log(`${arm} ${pr} ${p.key}: ocr ${read.text.length}ch ${ocr.cls || 'ok'} ${Math.round(ocr.secs)}s; tr ${tr.answer.length}ch`);
  });
}

// ---- judging ----------------------------------------------------------------------------------------------------
const VERDICTS = ['matches', 'partial', 'wrong text', 'unreadable'];
function judgePrompt(key, english, passageKey = key) {
  const d = derge[passageKey];
  return `You are checking a machine reading of one page of the Mongolian Kanjur (Beijing xylograph, 1718–20). The Mongolian page is a translation of a Tibetan canonical text. Below are (1) the Tibetan text of the Derge Kanjur passage that the page should correspond to (${d.toh}, ${d.skt}; Derge sides ${d.sides.join(', ')} — the Mongolian page covers roughly ONE of these sides, its exact position is uncertain), and (2) an English translation of what a model transcribed from the Mongolian page image.

Judge only MEANING: does the English say what some contiguous stretch of this Tibetan says? Generic Buddhist phrases that could appear in almost any sūtra or tantra (homage formulas, "bodhisattvas and great beings", "all rejoiced") do NOT count as a match unless the specific content (names, numbers, the particular argument, list or ritual) also matches.

Verdicts:
- matches: most of the English corresponds, sentence by sentence, to a stretch of the Tibetan (specific content agrees).
- partial: some specific content agrees (several names, a particular sentence or list), but much of the English is missing, garbled or does not correspond.
- wrong text: the English is coherent text but its specific content is not in this Tibetan passage (another text, another passage, or invented).
- unreadable: the English is empty, a refusal, a placeholder ("not transcribed"), only margin/page labels, or incoherent/looped fragments.

(1) Tibetan, Derge:
${d.tibetan}

(2) English of the machine reading:
${english.trim() || '(empty)'}

Answer with exactly two lines between marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
VERDICT: <matches|partial|wrong text|unreadable>
WHY: <one sentence naming the specific content that agrees or does not>`;
}
const parseVerdict = (t) => { const m = /VERDICT:\s*(matches|partial|wrong text|unreadable)/i.exec(t || ''); return m ? m[1].toLowerCase() : null; };
const why = (t) => (/WHY:\s*(.+)/i.exec(t || '') || [])[1]?.trim() || null;
const readDirs = () => fs.readdirSync(DIR).filter((d) => /^(argon-low|argon-high|opus|opus-tiles)-(production|hinted)$/.test(d));

if (STAGE === 'judge') {
  const judge = arg('judge');
  const label = judge === 'flash' ? 'flash-judge' : 'opus-judge';
  const outPath = path.join(DIR, `judge-${judge}.json`);
  const done = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const items = [];
  for (const d of readDirs()) for (const p of pages) {
    const f = path.join(DIR, d, `${p.key}.json`);
    if (fs.existsSync(f)) items.push({ id: `${d}/${p.key}`, key: p.key, passage: p.key, english: JSON.parse(fs.readFileSync(f, 'utf8')).translation.text });
  }
  if (process.argv.includes('--controls')) {
    // False-alarm control: reads paired with the WRONG page's Derge passage (the next page's in the list).
    for (const id of (arg('control-ids') || '').split(',').filter(Boolean)) {
      const [d, key] = id.split('/');
      const i = pages.findIndex((p) => p.key === key);
      const wrong = pages[(i + 5) % pages.length].key;
      items.push({ id: `control:${id}->${wrong}`, key, passage: wrong, english: JSON.parse(fs.readFileSync(path.join(DIR, d, `${key}.json`), 'utf8')).translation.text });
    }
  }
  await pool(items.filter((it) => !done[it.id]), Number(arg('concurrency', 2)), async (it) => {
    const r = await textCall(label, judgePrompt(it.key, it.english, it.passage), `${label} ${it.id}`, 'judge');
    done[it.id] = { verdict: parseVerdict(r.answer), why: why(r.answer), raw: r.answer?.slice(0, 600), cls: r.cls || null };
    fs.writeFileSync(outPath, JSON.stringify(done, null, 1));
    console.log(label, it.id, done[it.id].verdict);
  });
}

// ---- mechanical scoring ---------------------------------------------------------------------------------------------
function scriptOf(t) {
  const n = (re) => (t.match(re) || []).length;
  return { mongol_basic: n(/[ᠠ-ᡂ]/g), todo_sibe_manchu: n(/[ᡃ-ᢪ]/g), tibetan: n(/[ༀ-࿿]/g), cjk: n(/[一-鿿]/g), latin: n(/[A-Za-z]/g) };
}
function loopOf(t) {
  // A loop: one phrase (a line, or a 6-word run) repeated more than 3 times.
  const lines = t.split('\n').map((l) => l.replace(/<[^>]+>/g, '').trim()).filter((l) => l.length > 8);
  const cnt = {}; for (const l of lines) cnt[l] = (cnt[l] || 0) + 1;
  const words = t.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
  const g = {}; for (let i = 0; i + 6 <= words.length; i++) { const k = words.slice(i, i + 6).join(' '); g[k] = (g[k] || 0) + 1; }
  const maxLine = Math.max(0, ...Object.values(cnt)); const maxGram = Math.max(0, ...Object.values(g));
  return { loop: maxLine > 3 || maxGram > 3, max_line_repeat: maxLine, max_6gram_repeat: maxGram, distinct_lines: Object.keys(cnt).length };
}
function marginRead(t, margin) {
  const want = (margin.match(/[一-鿿]+/) || [''])[0];
  const got = (t.match(/[一-鿿]{4,}/g) || []).sort((a, b) => b.length - a.length)[0] || '';
  if (!got) return { got: '', exact: false, edits: null };
  // character-level Levenshtein against the by-eye margin reading
  const a = [...want], b = [...got]; const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return { got, exact: got === want, edits: dp[a.length][b.length] };
}

if (STAGE === 'score') {
  const jo = fs.existsSync(path.join(DIR, 'judge-opus.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'judge-opus.json'), 'utf8')) : {};
  const jf = fs.existsSync(path.join(DIR, 'judge-flash.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'judge-flash.json'), 'utf8')) : {};
  const ties = fs.existsSync(path.join(DIR, 'tiebreaks.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'tiebreaks.json'), 'utf8')) : {};
  const rows = [];
  for (const d of readDirs()) for (const p of pages) {
    const f = path.join(DIR, d, `${p.key}.json`);
    if (!fs.existsSync(f)) continue;
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    const body = r.ocr.text.replace(/<[^>]+>[^<]*<\/[^>]+>/g, (m) => (/^<(language|page-number|header|page-type)/.test(m) ? '' : m));
    const mongolLines = body.split('\n').filter((l) => /[ᠠ-ᢪ]/.test(l)).length;
    const id = `${d}/${p.key}`;
    const o = jo[id]?.verdict, fl = jf[id]?.verdict;
    rows.push({ id, arm: d, key: p.key, cols_on_image: null, lines_emitted_mongol: mongolLines, chars: r.ocr.text.length, script: scriptOf(r.ocr.text), ...loopOf(r.ocr.text),
      tr_loop: loopOf(r.translation.text).loop, margin: marginRead(r.ocr.text, derge[p.key].margin), ocr_cls: r.ocr.cls, ocr_problem: r.ocr.problem,
      judge_opus: o, judge_flash: fl, agree: o && fl ? o === fl : null, final: o && fl && o === fl ? o : ties[id]?.verdict || null });
  }
  const old = JSON.parse(fs.readFileSync(path.join(OLD, 'verdicts.json'), 'utf8'));
  for (const r of rows) r.cols_on_image = old.pages.find((p) => p.key === r.key)?.columns_on_image ?? null;
  fs.writeFileSync(path.join(DIR, 'scores.json'), JSON.stringify(rows, null, 1));
  const byArm = {};
  for (const r of rows) { const a = (byArm[r.arm] ||= { n: 0, matches: 0, partial: 0, wrong: 0, unreadable: 0, undecided: 0, loops: 0, margin_exact: 0 }); a.n++; a.loops += r.loop || r.tr_loop ? 1 : 0; a.margin_exact += r.margin.exact ? 1 : 0; const v = r.final; if (v === 'matches') a.matches++; else if (v === 'partial') a.partial++; else if (v === 'wrong text') a.wrong++; else if (v === 'unreadable') a.unreadable++; else a.undecided++; }
  console.table(byArm);
  console.log('disagreements:', rows.filter((r) => r.agree === false).map((r) => `${r.id} opus=${r.judge_opus} flash=${r.judge_flash}`).join('\n'));
}
