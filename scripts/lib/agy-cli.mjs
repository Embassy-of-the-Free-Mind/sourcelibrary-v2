// PRIOR ART: scripts/batch/cli-ocr.mjs — this is its call, tool gate and marker unwrap (#6523), moved here unchanged
// so the CLI translation runner (scripts/batch/cli-translate.mjs) uses the same code rather than a second copy.
// The block split (splitPageBlocks, #7522) follows claude-ocr.mjs splitPages, which lives in a script with no
// sentinel markers and reads `===== PAGE pNN =====` lines.
// scripts/eval/run-cli-arm.py is the eval runner's Python copy of the same call (install_gate, call()).
/**
 * agy-cli.mjs — one headless `agy -p` call, the way the #6523 dev rounds settled it:
 *   - plan mode, never auto-approve (#6345; tests/unit/no-cli-auto-approve.test.ts sweeps for the flag);
 *   - a PreToolUse hook (scripts/lib/agy-tool-gate.py) in the call's own workspace allows view_file inside it and
 *     denies every other tool WITH A REASON, so the turn goes on to the answer instead of ending empty;
 *   - the answer between <<<BEGIN>>> / <<<END>>> markers, nothing outside them (cli-chatter.mjs holds the wording);
 *   - at --print-timeout agy returns the PARTIAL reply with exit 0: that is a timeout, never a read.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { unwrapSentinels, TRANSLATION_SENTINEL_INSTRUCTION } from './cli-chatter.mjs';
import { agyBlocked, agyLimitLane, agyResetFromText, noteLimitHit } from './model-limits.mjs';

export const CLI = 'agy';
export const QUOTA = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b/i;
// agy-guard's refusal for a setup mistake (an AGY_HOME with no login, a model that account may not run). It reads as
// quota so the caller stops once, but the account's pool is not spent, so no limit stop is written for it.
export const GUARD_CONFIG_REFUSAL = /agy-guard: quota reached \(refused \(config\)\)/;
// Where a quota error can appear: stderr and agy's JSON envelope — never the model's own reply, unless the reply is
// short enough to BE an error message. A transcription is long and can say "429" (a year, a folio): on 2026-10-12
// one Latin page matched `\b429\b`, was taken for a quota stop 39 times, and held the whole read run for 6.5 h.
const QUOTA_REPLY_MAX = 400;
export function isQuotaError({ out = '', err = '', j = {}, text = '' }) {
  // The envelope's counters are numbers, not errors: a page whose usage.input_tokens was 429 matched `\b429\b` on
  // every retry and stopped its whole read (#6559, 2026-10-18).
  const envelope = j && Object.keys(j).length ? JSON.stringify({ ...j, response: undefined, usage: undefined, duration_seconds: undefined, num_turns: undefined, conversation_id: undefined }) : out;
  if (QUOTA.test(err) || QUOTA.test(envelope)) return true;
  return text.length > 0 && text.length <= QUOTA_REPLY_MAX && QUOTA.test(text);
}
// #6523: 300 s, not 120: at high thinking 3.8 Flash takes 70–240 s on a dense page, and at the limit agy returns a cut reply.
export const CLI_SAFE_ARGS = ['--mode', 'plan', '--print-timeout', '300s', '--output-format', 'json'];
/**
 * The same call with the prompt on STDIN (#7628). One argv string is capped at 128 KB (MAX_ARG_STRLEN), so a whole
 * book cannot ride in `-p`. agy reads one NDJSON message per line with --input-format stream-json, which requires
 * --output-format stream-json; `-p ''` turns print mode on and the message is the prompt. Measured 2026-10-28, agy 1.4.8:
 * the message shape is {"event":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}, and the reply
 * ends with one {"event":"result","result":{status, response, usage, …}} line, the `json` envelope's fields.
 */
// agy CUTS one stdin message at ~190K characters, silently: asked about a 265K-character message the model said the
// text ended at line 2540 "at the truncation limit" (probe, 2026-10-28, agy 1.4.9). A longer prompt goes as several
// messages of one conversation (one turn each: a request each); 150K characters a message leaves room.
export const STDIN_MESSAGE_MAX = 150_000;
export const stdinArgs = (printTimeoutS = 300) => ['-p', '', '--mode', 'plan', '--print-timeout', `${printTimeoutS}s`, '--input-format', 'stream-json', '--output-format', 'stream-json'];
export const stdinMessage = (text) => JSON.stringify({ event: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
/** How many turns of a stream-json reply have finished (their `result` events). */
export const resultCount = (out) => String(out || '').split('{"event":"result"').length - 1;
/** Token counts summed over every turn's `result` event (a multi-message call), or null when there are none. */
export function streamUsage(out) {
  let u = null;
  for (const part of String(out || '').split('{"event":"result"').slice(1)) {
    let e;
    try { e = JSON.parse('{"event":"result"' + part.split('\n')[0]); } catch { continue; }
    const x = e?.result?.usage;
    if (!x) continue;
    u ??= {};
    for (const [k, v] of Object.entries(x)) if (typeof v === 'number') u[k] = (u[k] || 0) + v;
  }
  return u;
}
/** The final envelope of a stream-json reply (its `result` event), or of a json reply; {} when there is none yet. */
export function replyEnvelope(out) {
  const s = String(out || '').trim();
  if (!s) return {};
  try { const j = JSON.parse(s); return j?.event === 'result' ? j.result || {} : j; } catch { /* stream-json: one event per line */ }
  const at = s.lastIndexOf('{"event":"result"');
  if (at < 0) return {};
  try { return JSON.parse(s.slice(at).split('\n')[0]).result || {}; } catch { return {}; /* a partial line */ }
}

// What the CLI translation runner appends to the translation prompt (part of the prompt SENT, so of what is hashed).
export const TRANSLATE_SUFFIX = `\n\nDo not open, read or write any file and do not use any tool: the text is above. ${TRANSLATION_SENTINEL_INSTRUCTION}\n`;

const TOOL_GATE = path.join(path.dirname(new URL(import.meta.url).pathname), 'agy-tool-gate.py');
/**
 * Install the tool gate in `dir` (the call's workspace). `task` picks the denial reason the model reads: 'ocr' points
 * it at view_file on the attached image; 'translate' says the text is in the prompt and no tool is needed.
 * Returns the gate's log (one row per tool call and decision; gateCalls() reads it).
 */
export function installToolGate(dir, { task = 'ocr' } = {}) {
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  const log = path.join(dir, '.agents', 'gate.jsonl');
  const command = `AGY_GATE_ROOT='${dir}' AGY_GATE_LOG='${log}' AGY_GATE_TASK='${task}' python3 '${TOOL_GATE}'`;
  fs.writeFileSync(path.join(dir, '.agents', 'hooks.json'), JSON.stringify({ [`${task}-tool-gate`]: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }] } }));
  return log;
}
export const gateCalls = (log) => { try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return r.tool + (r.decision === 'allow' ? '' : ':deny'); }); } catch { return []; } };

/** The answer inside the markers, and why the reply is not a clean one (null when it is). */
export function unwrapRead(raw) {
  const u = unwrapSentinels(raw);
  if (u.inside == null) return { text: String(raw || '').trim(), problem: String(raw || '').trim() ? 'no <<<BEGIN>>> marker' : null };
  const problem = u.outside ? 'text outside the markers' : !u.closed ? 'reply cut before <<<END>>>' : null;
  return { text: u.inside, problem };
}

/**
 * An OCR call of several page images (cli-ocr.mjs read --per-call=N, #7522). The images sit in the call's workspace
 * under neutral names (p01.jpg …), so no page id or number in a file name can be read as text. The wrapper below is
 * part of the prompt SENT, so of what is hashed; it follows the live OCR prompt in place of the one-page sentence.
 */
export const pageBlockFile = (i) => `p${String(i + 1).padStart(2, '0')}.jpg`;
// #7558: the model sees an image only through its own read_file turn (`@./file` attaches nothing in agy -p). Said up
// front, so the call does not spend a turn on a denied shell first (cli-ocr.mjs --prompt-variant=read-file-7558).
export const OCR_READ_FILE_INSTRUCTION = 'Open it with read_file (or view_file): that is the only tool available here, and running commands, cropping or any other tool is disabled.';
export function ocrBlockInstruction(n, { variant = 'sentinels-6523' } = {}) {
  if (variant === 'read-file-7558') {
    const files = Array.from({ length: n }, (_, i) => `page ${i + 1}: ./${pageBlockFile(i)}`).join(', ');
    return `\n\nThis call: ${n} page images, consecutive pages of one book, in page order, as files in this directory: ${files}. ${OCR_READ_FILE_INSTRUCTION.replace('Open it', 'Open each')} ${BLOCK_RULES(n)}\n`;
  }
  const list = Array.from({ length: n }, (_, i) => `page ${i + 1}: @./${pageBlockFile(i)}`).join(', ');
  return `\n\nThis call: ${n} page images, consecutive pages of one book, in page order: ${list}. ${BLOCK_RULES(n)}\n`;
}
const BLOCK_RULES = (n) => `Transcribe each page separately and completely in the format above, following every rule above as if it were the only page: never carry text, a header or a heading over from a neighbouring page, and where a word or sentence runs over a page break, end that page with its last printed word and begin the next page with its own first printed word. Write each page between its own two marker lines: <<<PAGE 1 BEGIN>>> and <<<PAGE 1 END>>> around page 1, then <<<PAGE 2 BEGIN>>> and <<<PAGE 2 END>>> around page 2, and so on up to page ${n}. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.`;

/**
 * A CORRECTION of N consecutive pages in one call (#7701 arm C, `cli-ocr.mjs read --correct-prompt --per-call=N`). The
 * one-page correction template (#5924 fc template, fc-prompt.mjs) is the live OCR prompt, then a "This call: correct
 * one existing transcription" paragraph, its {draft} slot and the image line. The block prompt keeps everything before
 * that paragraph byte for byte and replaces the rest: the same three answers (UNCHANGED, CONTAIN, the corrected page)
 * asked PER PAGE, each draft between its own numbered DRAFT lines, each answer between the <<<PAGE n BEGIN>>> /
 * <<<PAGE n END>>> markers splitPageBlocks reads, then the images in page order. Returns null when the template has no
 * such paragraph (a template this cannot rebuild is never guessed at).
 */
export const CORRECT_ONE_PAGE_MARK = '**This call: correct one existing transcription against the page image.**';
export function correctBlockPrompt(template, drafts) {
  const at = String(template).indexOf(CORRECT_ONE_PAGE_MARK);
  const n = drafts.length;
  if (at < 0 || !(n >= 2) || !String(template).includes('{draft}')) return null;
  const marks = Array.from({ length: n }, (_, i) => `<<<PAGE ${i + 1} BEGIN>>> and <<<PAGE ${i + 1} END>>> around page ${i + 1}`);
  const images = Array.from({ length: n }, (_, i) => `page ${i + 1}: @./${pageBlockFile(i)}`).join(', ');
  return `${String(template).slice(0, at)}**This call: correct ${n} existing transcriptions, one a page, against their page images.** The ${n} images, attached at the end of this message, are consecutive pages of one book, in page order. For each page n, the draft between the lines DRAFT n START and DRAFT n END below is the transcription a library currently gives readers for page n, made by an OCR engine. It may contain misread words, letters or numbers, dropped or repeated lines, a missed column or marginal note, or text that is not on the page. Open each image. The IMAGE is the authority.
Check each draft against ITS OWN page image line by line and answer, for each page separately, with exactly one of:
- \`UNCHANGED\` (that word alone) — the draft is a faithful transcription of its leaf: any differences from the image are spacing, punctuation, line breaks or conventions (tags, abbreviation expansion, the long s) that do not change what a reader learns.
- \`CONTAIN: <one sentence>\` — the draft is not its leaf's text (another page's text, a different work, an invention), or the leaf cannot be read; say which and why.
- The complete corrected transcription of the page, not a list of changes, in the format above: its metadata tags as the format above defines them, always including <page-type>, even where the draft uses older tags (such as <lang>). Keep the draft's conventions and layout where the image does not contradict them; change what the image contradicts, add what the draft left out, remove what the page does not print. Do not change a word the image supports, even where another reading would be more usual. Transcribe each page on its own: never carry text, a header or a heading over from a neighbouring page or its draft, and where a word or sentence runs over a page break, end that page with its last printed word and begin the next page with its own first printed word.
Write each page's one answer (UNCHANGED, CONTAIN: …, or the corrected transcription) between its own two marker lines: ${marks.join(', then ')}. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.

${drafts.map((d, i) => `DRAFT ${i + 1} START\n${d}\nDRAFT ${i + 1} END`).join('\n\n')}

The page images, in page order: ${images}`;
}

/**
 * Split a block OCR reply into its n pages. Returns the n texts in page order, or null unless the reply is exactly
 * <<<PAGE 1 BEGIN>>> … <<<PAGE 1 END>>> … <<<PAGE n END>>>, in order, each page non-empty, nothing but whitespace
 * outside them and no other marker inside them. Strict on purpose: a reply is attributed to pages ONLY by its markers,
 * so a dropped, merged, repeated, renumbered or reordered page refuses the whole call (its pages are then read one per
 * call) rather than putting one page's text on another.
 */
export function splitPageBlocks(reply, n) {
  const s = String(reply || '');
  const re = /<<<\s*PAGE\s+(\d+)\s+(BEGIN|END)\s*>>>/g;
  const marks = [...s.matchAll(re)];
  if (!(n >= 1) || marks.length !== 2 * n) return null;
  const texts = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const b = marks[2 * i], e = marks[2 * i + 1];
    if (Number(b[1]) !== i + 1 || b[2] !== 'BEGIN' || Number(e[1]) !== i + 1 || e[2] !== 'END') return null;
    if (s.slice(at, b.index).trim()) return null;
    const inside = s.slice(b.index + b[0].length, e.index);
    if (/<<<\s*(?:BEGIN|END)\s*>>>/.test(inside)) return null;
    const t = inside.trim();
    if (!t) return null;
    texts.push(t);
    at = e.index + e[0].length;
  }
  if (s.slice(at).trim()) return null;
  return texts;
}

/**
 * An agy account's pools, read from `agy -p "/quota" --output-format json` (free: no model turn). Each account has two
 * groups, Gemini and "Claude and GPT", each with a weekly and a 5-hour bucket. Returns
 * { gemini: {weekly, h5}, claude: {weekly, h5} } as remaining fractions (0..1), or null when unreadable.
 * Cached ~10 min per account in AGY_QUOTA_CACHE/<account>.json (the raw reply; agy-guard.sh reads and writes the same
 * file), so a lane does not ask before every call, and a reset is seen within one cache period.
 */
export const AGY_QUOTA_CACHE = process.env.AGY_QUOTA_CACHE || '/root/agy-quota/quota';
export const AGY_QUOTA_TTL_MS = 10 * 60_000;
export function parseAgyQuota(raw) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const groups = j?.command?.data?.groups;
  if (!Array.isArray(groups)) return null;
  const pick = (re) => {
    const g = groups.find((x) => re.test(x?.name || ''));
    const b = (w) => { const f = g?.buckets?.find((x) => x.window === w)?.remaining_fraction; return typeof f === 'number' && f >= 0 && f <= 1 ? f : null; };
    return { weekly: b('weekly'), h5: b('5h') };
  };
  const q = { gemini: pick(/^gemini/i), claude: pick(/claude/i) };
  return q.gemini.weekly == null ? null : q;
}
const quotaMem = new Map();
export function agyQuota(agyHome = process.env.AGY_HOME || '', { now = Date.now(), dir = AGY_QUOTA_CACHE, ttlMs = AGY_QUOTA_TTL_MS } = {}) {
  const acct = agyHome ? path.basename(agyHome) : 'main';
  const file = path.join(dir, `${acct}.json`);
  const mem = quotaMem.get(acct);
  if (mem && now - mem.at < ttlMs) return mem.q;
  try {
    const st = fs.statSync(file);
    // A file dated in the future is not fresh: it would hold the gate open past a reset. A minute of clock skew is
    // allowed (a file's mtime carries sub-millisecond digits that Date.now() drops).
    const age = now - st.mtimeMs;
    const q = age >= -60_000 && age < ttlMs ? parseAgyQuota(fs.readFileSync(file, 'utf8')) : null;
    if (q) { quotaMem.set(acct, { at: st.mtimeMs, q }); return q; }
  } catch { /* no cache yet */ }
  // Through agy-guard, on the same account (AGY_HOME), with a model so the guard adds none. /quota spends nothing.
  const r = spawnSync(CLI, ['-p', '/quota', '--output-format', 'json', '--model', 'gemini-3.8-flash-low'], { encoding: 'utf8', timeout: 90_000, env: { ...process.env, ...(agyHome ? { AGY_HOME: agyHome } : {}) } });
  const q = r.status === 0 ? parseAgyQuota(r.stdout) : null;
  if (!q) return null; // unreadable: not cached, so the next call asks again
  quotaMem.set(acct, { at: now, q });
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(`${file}.tmp${process.pid}`, r.stdout); fs.renameSync(`${file}.tmp${process.pid}`, file); } catch { /* memory only */ }
  return q;
}
/** The one model an AGY_HOME account is held to (its allowed-model file, agy-guard.sh), or null. */
export const agyAllowedModel = (agyHome = process.env.AGY_HOME || '') => { try { return agyHome ? fs.readFileSync(path.join(agyHome, 'allowed-model'), 'utf8').trim() || null : null; } catch { return null; } };
// The Claude group is left alone below this much of either bucket (#7545): the fallback stops before the pool is dry.
export const AGY_CLAUDE_FLOOR = 0.10;
// "Empty" is below this, not exactly 0: a spent pool reads a residue such as 0.00028 (shown as 0% by /quota) and never
// reaches 0 exactly, so a strict zero test kept the gate shut on 2026-10-30 with the pool spent (#7545).
export const AGY_GEMINI_EMPTY = 0.005;
/**
 * May this account run Claude through agy right now? Only when its Gemini WEEKLY bucket is empty (under AGY_GEMINI_EMPTY) and both of its Claude
 * buckets are at or above AGY_CLAUDE_FLOOR (#7545; Derek 2026-10-27/28). Fails CLOSED: an unreadable quota is "no".
 * Returns { ok, reason, quota }.
 */
export function agyClaudeGate(agyHome = process.env.AGY_HOME || '', { quota, held = agyAllowedModel(agyHome) } = {}) {
  const acct = agyHome ? path.basename(agyHome) : 'main';
  // An account held to one model (AGY_HOME/allowed-model, agy-guard.sh) runs that model only, Claude included.
  if (held && !/^claude-/.test(held)) return { ok: false, reason: `${acct} is held to ${held} (allowed-model)`, quota: null };
  if (quota === undefined) quota = agyQuota(agyHome);
  if (!quota) return { ok: false, reason: `quota for ${acct} unreadable`, quota };
  if (quota.gemini.weekly >= AGY_GEMINI_EMPTY) return { ok: false, reason: `${acct} Gemini weekly ${(quota.gemini.weekly * 100).toFixed(1)}% left`, quota };
  const low = ['weekly', 'h5'].find((k) => !(quota.claude[k] >= AGY_CLAUDE_FLOOR));
  if (low) return { ok: false, reason: `${acct} Claude ${low} ${quota.claude[low] == null ? 'unreadable' : `${(quota.claude[low] * 100).toFixed(1)}% left`} (< ${AGY_CLAUDE_FLOOR * 100}%)`, quota };
  return { ok: true, reason: `${acct} Gemini weekly empty; Claude weekly ${(quota.claude.weekly * 100).toFixed(0)}%, 5h ${(quota.claude.h5 * 100).toFixed(0)}%`, quota };
}
export const agyGeminiExhausted = (agyHome = process.env.AGY_HOME || '', opts = {}) => agyClaudeGate(agyHome, opts).ok;

// Gemini, and Claude only once the account's Gemini pool is empty. agy can also reach Claude models. Claude runs
// through the Claude subscription (`claude -p`, subagents), and through agy only on an account whose Gemini weekly
// pool reads 0 (Derek, 2026-10-14 after #6721 dated 6,452 books with claude-sonnet via agy; amended 2026-10-27, #7545).
// agyClaudeGate is re-read every cache period, so a reset switches the account back to Gemini.
export function assertGeminiModel(args, { agyHome = process.env.AGY_HOME || '', gate = agyClaudeGate } = {}) {
  const i = args.indexOf('--model');
  const model = i >= 0 ? String(args[i + 1] || '') : '';
  if (/^gemini-/.test(model)) return;
  if (/^claude-/.test(model)) {
    const g = gate(agyHome);
    if (g.ok) return;
    throw new Error(`agy-cli: refusing --model "${model}": agy runs Gemini models only until the account's Gemini pool is empty (${g.reason}); use claude -p for Claude (#7545)`);
  }
  throw new Error(`agy-cli: refusing --model "${model}": agy runs Gemini models only; use claude -p for Claude`);
}

/**
 * The per-job call ledger and the heavy-model daily cap (#7118). Every agy call made through here appends
 * `at,job,model` to JOB_LEDGER/<UTC date>.csv, so the meter can say WHICH job spent the shared Google account. A job on
 * a heavy model (argon, pro, any *-high tier) stops at AGY_HEAVY_DAILY_CAP calls per UTC day: on 2026-10-19 one
 * argon-high re-OCR locked every model, the cheap one that seam repair and translation run on included, for 4.5 days.
 * The refusal is cls 'quota', so every caller already treats it as "stop spending, wait". The job is AGY_JOB, else
 * the script's file name. No ledger dir (a laptop): no ledger, no cap.
 */
export const JOB_LEDGER = process.env.AGY_JOB_LEDGER || '/root/agy-quota/jobs';
export const HEAVY_MODEL = /argon|-pro|-high$/;
export const HEAVY_DAILY_CAP = Number(process.env.AGY_HEAVY_DAILY_CAP || 300);
export const agyJob = () => (process.env.AGY_JOB || path.basename(process.argv[1] || 'unknown').replace(/\.[cm]?js$/, '')).replace(/[^\w.-]/g, '_');
export function jobCallsToday(job, { heavyOnly = true, dir = JOB_LEDGER, now = new Date() } = {}) {
  let rows = [];
  try { rows = fs.readFileSync(path.join(dir, `${now.toISOString().slice(0, 10)}.csv`), 'utf8').split('\n'); } catch { return 0; }
  return rows.filter((l) => { const [, j, m] = l.split(','); return j === job && (!heavyOnly || HEAVY_MODEL.test(m || '')); }).length;
}
/** null when the call may go, else the refusal message. Records the call when it may. */
export function ledgerGate(model, { dir = JOB_LEDGER, cap = HEAVY_DAILY_CAP, job = agyJob(), now = new Date() } = {}) {
  if (!fs.existsSync(path.dirname(dir))) return null;
  fs.mkdirSync(dir, { recursive: true });
  if (HEAVY_MODEL.test(model) && jobCallsToday(job, { dir, now }) >= cap) return `agy-cli: job ${job} reached its daily cap of ${cap} calls on heavy models (${model}); set AGY_HEAVY_DAILY_CAP to change it (#7118)`;
  fs.appendFileSync(path.join(dir, `${now.toISOString().slice(0, 10)}.csv`), `${now.toISOString()},${job},${model}\n`);
  return null;
}

const EXIT_GRACE_MS = 10_000;
/** One `agy -p` call, async so several pages can be in flight. Resolves {text, conversation, denied, code, cls, err, secs}. */
export function agyCall(args, cwd, { killAfterMs = 360_000, exitGraceMs = EXIT_GRACE_MS, input = null, turns = 1 } = {}) {
  assertGeminiModel(args);
  const model = String(args[args.indexOf('--model') + 1] || '');
  // `turns`: messages on stdin, one model request each; every turn is a row of the job ledger.
  let capped = null;
  for (let t = 0; t < turns && !capped; t++) capped = ledgerGate(model);
  if (capped) return Promise.resolve({ text: '', conversation: null, denied: [], code: null, cls: 'quota', err: capped, secs: 0, usage: null, capped: true });
  // A locked model is never called, not even to see whether it has reset (model-limits.mjs): the reply is a quota
  // result made here, with `locked_until`, and agy is not started.
  const blocked = agyBlocked(model);
  if (blocked) return Promise.resolve({ text: '', conversation: null, denied: [], code: null, cls: 'quota', err: blocked.reason, secs: 0, usage: null, locked_until: blocked.until || null, not_called: true });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLI, args, { cwd, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input != null) { child.stdin.on('error', () => { /* the CLI exited first: its own error says why */ }); child.stdin.end(input); }
    let out = '', err = '', printed = false, grace = null;
    child.stdout.on('data', (d) => {
      out += d;
      // #7503: agy 1.4.8 sometimes prints its whole final JSON (status SUCCESS, usage and all) and then never exits.
      // The 360 s kill then threw a complete reply away as a timeout (13 of ~570 Siku block calls on 2026-10-27, each
      // retried and hung again). Once the reply is printed, give the CLI a few seconds to exit, then end it.
      if (!printed && /\}\s*$/.test(out)) {
        printed = replyEnvelope(out)?.status === 'SUCCESS' && (input == null || resultCount(out) >= turns);
        if (printed) grace = setTimeout(() => child.kill('SIGKILL'), exitGraceMs);
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), killAfterMs); // past --print-timeout: a caller raising it raises this too
    child.on('close', (code) => {
      clearTimeout(timer); clearTimeout(grace);
      // Not JSON: an error or an old CLI. A stream-json reply's envelope is its last `result` event.
      const j = replyEnvelope(out);
      const text = String((j && j.response) ?? (Object.keys(j).length || input != null ? '' : out)).trim();
      const denied = (j.denied_actions || []).map((d) => d.action);
      // Killed only after it printed a whole SUCCESS reply: that reply is the call's result, not a timeout.
      const hungAfterReply = code === null && printed;
      // #6523: at --print-timeout agy returns the PARTIAL reply with exit 0 ("print timeout … returning partial output").
      // A stream-json reply carries the model's text in step_update deltas: never read those as a quota error.
      const envOut = input == null ? out : out.split('\n').filter((l) => !l.includes('"step_update"')).join('\n');
      const cls = isQuotaError({ out: envOut, err, j, text }) ? 'quota' : (code === null && !hungAfterReply) || /print timeout/i.test(envOut + err) ? 'timeout' : code !== 0 && !hungAfterReply ? `exit_${code}` : !text ? (denied.length ? 'denied_tool' : 'empty') : null;
      // `usage`: agy's own token counts ({input_tokens, output_tokens, thinking_tokens, …}), null on an old CLI (#6728).
      // The first quota reply stops every later call on this box until Google's quoted reset (or one hour).
      if (cls === 'quota' && !GUARD_CONFIG_REFUSAL.test(err)) noteLimitHit(agyLimitLane(model), { until: agyResetFromText(out + err + text), reason: (err || text).slice(-200) });
      // Every turn's result is not the last turn's: a reply with fewer results than turns was cut short.
      const short = input != null && turns > 1 && resultCount(out) < turns && !cls;
      resolve({ text, conversation: j.conversation_id || null, denied, code, cls: short ? 'timeout' : cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000, usage: (input != null ? streamUsage(out) : null) || j.usage || null, ...(input != null && { turns_done: resultCount(out) }), ...(hungAfterReply && { hung_after_reply: true }) });
    });
  });
}

/** agy's usage envelope in the shape claude-translate.mjs records (`call_usage`), or null when the CLI gave none. */
export function agyUsage(u) {
  if (!u) return null;
  return { input: u.input_tokens ?? null, output: u.output_tokens ?? null, thinking: u.thinking_tokens ?? null, cache_read: u.cache_read_tokens ?? null, total: u.total_tokens ?? null };
}

/**
 * A text-only task (a translation) in a fresh, EMPTY, gated workspace: nothing to wander into, and a denied tool
 * comes back with a reason instead of ending the turn. Up to `attempts` calls while the reply is empty or the call
 * failed (never on quota: the caller decides). Resolves agyCall()'s result plus { calls, requests (model turns: a
 * stdin call of n messages is n), tool_calls, answer, problem }:
 * `answer` is the text between the markers and `problem` why the reply is not a clean one (unwrapRead).
 */
export async function gatedTextCall(sent, { model, task = 'translate', attempts = 3, tmp = os.tmpdir(), onCall, stdin = false, printTimeoutS = 300 } = {}) {
  // stdin: `sent` may be an array of messages, each under STDIN_MESSAGE_MAX: one conversation, a turn per message.
  const messages = Array.isArray(sent) ? sent : [sent];
  if (Array.isArray(sent) && !stdin) throw new Error('agy-cli: several messages go only on stdin');
  if (stdin && messages.some((m) => m.length > STDIN_MESSAGE_MAX + 30_000)) throw new Error(`agy-cli: a stdin message over ${STDIN_MESSAGE_MAX + 30_000} characters would be cut by agy`);
  let r, calls = 0, requests = 0, tools = [];
  while (calls < attempts) {
    const ws = fs.mkdtempSync(path.join(tmp, `agy-${task}-`));
    const log = installToolGate(ws, { task });
    // stdin: the prompt goes in as a stream-json message (stdinArgs), for a prompt past the 128 KB argv cap.
    r = stdin
      ? await agyCall([...stdinArgs(printTimeoutS), '--model', model], ws, { input: messages.map(stdinMessage).join(''), turns: messages.length, killAfterMs: (printTimeoutS + 60) * 1000 })
      : await agyCall(['-p', sent, '--model', model, ...CLI_SAFE_ARGS], ws); calls++;
    requests += stdin ? messages.length : 1;
    tools = tools.concat(gateCalls(log));
    fs.rmSync(ws, { recursive: true, force: true });
    if (onCall) onCall(r);
    if (!r.cls || r.cls === 'quota') break;
  }
  const { text: answer, problem } = unwrapRead(r.text);
  return { ...r, calls, requests, tool_calls: tools, answer, problem };
}

/**
 * One question about one image (a gutter, leaf boxes, a page frame) in a fresh gated workspace: the JPEG is written
 * there as `image.jpg` and attached with `@./image.jpg`, which `promptFor(name)` places in its prompt. Retries like
 * gatedTextCall(); the reply is NOT unwrapped (these prompts ask for one line of JSON), so `text` is the raw answer.
 * Measured for splitting 2026-10-28 (#5771): 3.8 Flash low got 80/80 pecha leaf counts and 33/33 spreads, cuts a
 * median 3/1000 from the reviewed ones, ~16 s a call.
 */
export async function gatedImageCall(promptFor, jpegBuf, { model = 'gemini-3.8-flash-low', attempts = 2, tmp = os.tmpdir(), onCall } = {}) {
  let r, calls = 0;
  while (calls < attempts) {
    const ws = fs.mkdtempSync(path.join(tmp, 'agy-image-'));
    fs.writeFileSync(path.join(ws, 'image.jpg'), jpegBuf);
    installToolGate(ws, { task: 'ocr' });
    r = await agyCall(['-p', promptFor('image.jpg'), '--model', model, ...CLI_SAFE_ARGS], ws); calls++;
    fs.rmSync(ws, { recursive: true, force: true });
    if (onCall) onCall(r);
    if (!r.cls || r.cls === 'quota') break;
  }
  return { ...r, calls };
}

/** The first `{…}` or `[…]` JSON value in a reply, or null. */
export function firstJson(text, open = '{') {
  const re = open === '[' ? /\[[\s\S]*\]/ : /\{[^{}]*\}/;
  const m = String(text || '').match(re);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
