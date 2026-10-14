// PRIOR ART: scripts/batch/cli-ocr.mjs — this is its call, tool gate and marker unwrap (#6523), moved here unchanged
// so the CLI translation runner (scripts/batch/cli-translate.mjs) uses the same code rather than a second copy.
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

export const CLI = 'agy';
export const QUOTA = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b/i;
// Where a quota error can appear: stderr and agy's JSON envelope — never the model's own reply, unless the reply is
// short enough to BE an error message. A transcription is long and can say "429" (a year, a folio): on 2026-10-12
// one Latin page matched `\b429\b`, was taken for a quota stop 39 times, and held the whole read run for 6.5 h.
const QUOTA_REPLY_MAX = 400;
export function isQuotaError({ out = '', err = '', j = {}, text = '' }) {
  const envelope = j && Object.keys(j).length ? JSON.stringify({ ...j, response: undefined }) : out;
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

// Gemini only. agy can also reach Claude models; Claude runs only through the Claude subscription (`claude -p`,
// subagents), never through agy (Derek, 2026-10-14, after #6721 dated 6,452 books with claude-sonnet via agy).
export function assertGeminiModel(args) {
  const i = args.indexOf('--model');
  const model = i >= 0 ? String(args[i + 1] || '') : '';
  if (!/^gemini-/.test(model)) throw new Error(`agy-cli: refusing --model "${model}": agy runs Gemini models only; use claude -p for Claude`);
}

/** One `agy -p` call, async so several pages can be in flight. Resolves {text, conversation, denied, code, cls, err, secs}. */
export function agyCall(args, cwd) {
  assertGeminiModel(args);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLI, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 360_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON: an error or an old CLI */ }
      const text = String((j && j.response) ?? (Object.keys(j).length ? '' : out)).trim();
      const denied = (j.denied_actions || []).map((d) => d.action);
      // #6523: at --print-timeout agy returns the PARTIAL reply with exit 0 ("print timeout … returning partial output").
      const cls = isQuotaError({ out, err, j, text }) ? 'quota' : code === null || /print timeout/i.test(out + err) ? 'timeout' : code !== 0 ? `exit_${code}` : !text ? (denied.length ? 'denied_tool' : 'empty') : null;
      resolve({ text, conversation: j.conversation_id || null, denied, code, cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
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
