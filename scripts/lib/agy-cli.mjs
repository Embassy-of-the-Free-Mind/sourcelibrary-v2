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
import { spawn } from 'node:child_process';
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

// Gemini only. agy can also reach Claude models; Claude runs only through the Claude subscription (`claude -p`,
// subagents), never through agy (Derek, 2026-10-14, after #6721 dated 6,452 books with claude-sonnet via agy).
export function assertGeminiModel(args) {
  const i = args.indexOf('--model');
  const model = i >= 0 ? String(args[i + 1] || '') : '';
  if (!/^gemini-/.test(model)) throw new Error(`agy-cli: refusing --model "${model}": agy runs Gemini models only; use claude -p for Claude`);
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
export function agyCall(args, cwd, { killAfterMs = 360_000, exitGraceMs = EXIT_GRACE_MS } = {}) {
  assertGeminiModel(args);
  const model = String(args[args.indexOf('--model') + 1] || '');
  const capped = ledgerGate(model);
  if (capped) return Promise.resolve({ text: '', conversation: null, denied: [], code: null, cls: 'quota', err: capped, secs: 0, usage: null, capped: true });
  // A locked model is never called, not even to see whether it has reset (model-limits.mjs): the reply is a quota
  // result made here, with `locked_until`, and agy is not started.
  const blocked = agyBlocked(model);
  if (blocked) return Promise.resolve({ text: '', conversation: null, denied: [], code: null, cls: 'quota', err: blocked.reason, secs: 0, usage: null, locked_until: blocked.until || null, not_called: true });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLI, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', printed = false, grace = null;
    child.stdout.on('data', (d) => {
      out += d;
      // #7503: agy 1.4.8 sometimes prints its whole final JSON (status SUCCESS, usage and all) and then never exits.
      // The 360 s kill then threw a complete reply away as a timeout (13 of ~570 Siku block calls on 2026-10-27, each
      // retried and hung again). Once the reply is printed, give the CLI a few seconds to exit, then end it.
      if (!printed && /\}\s*$/.test(out)) {
        try { printed = JSON.parse(out)?.status === 'SUCCESS'; } catch { /* not complete yet */ }
        if (printed) grace = setTimeout(() => child.kill('SIGKILL'), exitGraceMs);
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), killAfterMs); // past --print-timeout: a caller raising it raises this too
    child.on('close', (code) => {
      clearTimeout(timer); clearTimeout(grace);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON: an error or an old CLI */ }
      const text = String((j && j.response) ?? (Object.keys(j).length ? '' : out)).trim();
      const denied = (j.denied_actions || []).map((d) => d.action);
      // Killed only after it printed a whole SUCCESS reply: that reply is the call's result, not a timeout.
      const hungAfterReply = code === null && printed;
      // #6523: at --print-timeout agy returns the PARTIAL reply with exit 0 ("print timeout … returning partial output").
      const cls = isQuotaError({ out, err, j, text }) ? 'quota' : (code === null && !hungAfterReply) || /print timeout/i.test(out + err) ? 'timeout' : code !== 0 && !hungAfterReply ? `exit_${code}` : !text ? (denied.length ? 'denied_tool' : 'empty') : null;
      // `usage`: agy's own token counts ({input_tokens, output_tokens, thinking_tokens, …}), null on an old CLI (#6728).
      // The first quota reply stops every later call on this box until Google's quoted reset (or one hour).
      if (cls === 'quota' && !GUARD_CONFIG_REFUSAL.test(err)) noteLimitHit(agyLimitLane(model), { until: agyResetFromText(out + err + text), reason: (err || text).slice(-200) });
      resolve({ text, conversation: j.conversation_id || null, denied, code, cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000, usage: j.usage || null, ...(hungAfterReply && { hung_after_reply: true }) });
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
 * failed (never on quota: the caller decides). Resolves agyCall()'s result plus { calls, tool_calls, answer, problem }:
 * `answer` is the text between the markers and `problem` why the reply is not a clean one (unwrapRead).
 */
export async function gatedTextCall(sent, { model, task = 'translate', attempts = 3, tmp = os.tmpdir(), onCall } = {}) {
  let r, calls = 0, tools = [];
  while (calls < attempts) {
    const ws = fs.mkdtempSync(path.join(tmp, `agy-${task}-`));
    const log = installToolGate(ws, { task });
    r = await agyCall(['-p', sent, '--model', model, ...CLI_SAFE_ARGS], ws); calls++;
    tools = tools.concat(gateCalls(log));
    fs.rmSync(ws, { recursive: true, force: true });
    if (onCall) onCall(r);
    if (!r.cls || r.cls === 'quota') break;
  }
  const { text: answer, problem } = unwrapRead(r.text);
  return { ...r, calls, tool_calls: tools, answer, problem };
}
