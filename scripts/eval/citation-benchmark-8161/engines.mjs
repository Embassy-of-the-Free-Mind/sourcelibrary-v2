/**
 * The assistants under test, each with web tools and nothing else: no connector, no user context,
 * an empty working directory. Subscription CLIs only.
 *
 * Both get the same short framing, because a coding agent's default prompt does not behave like an
 * assistant answering a person. The framing asks for links in general and never names us, so it
 * raises the level of citing and not who gets cited.
 *
 * PRIOR ART: scripts/eval/mcp-trigger-8154/run.mjs spawns `claude -p` the same way but denies the web tools.
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const FRAMING = 'You are a helpful assistant answering a person. You can search the web and open pages. '
  + 'When you rely on a source, link to it.';

// A chat assistant has no shell. `--mode plan` lets agy search and auto-denies its shell, and this line
// keeps it from spending turns on denied commands. score.mjs counts any run that tried one anyway.
const AGY_WEB_ONLY = 'Use only your web search and page-reading tools. Do not run commands, write code or write files.';

const TIMEOUT_MS = 300_000;

const COMMANDS = {
  claude: (q) => ['claude', [
    '-p', q, '--model', 'sonnet', '--system-prompt', FRAMING,
    '--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch', '--strict-mcp-config', '--setting-sources', '',
    '--disable-slash-commands', '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose', '--max-turns', '12',
  ]],
  agy: (q) => ['agy', [
    '-p', `${FRAMING} ${AGY_WEB_ONLY}\n\n${q}`, '--model', 'gemini-3.8-flash-low', '--disable-slash-commands',
    '--output-format', 'stream-json', '--print-timeout', '280s', '--mode', 'plan',
  ]],
};

/** Runs one prompt. Returns { engine, code, ms, answer, raw }; `raw` is the whole event stream. */
export function invokeEngine(engine, question) {
  const [bin, args] = COMMANDS[engine](question);
  const cwd = mkdtempSync(join(tmpdir(), 'citation-bench-'));
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let raw = '';
    let err = '';
    child.stdout.on('data', (d) => { raw += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      resolve({ engine, code, ms: Date.now() - started, answer: finalAnswer(raw), raw, err: err.slice(-500) });
    });
  });
}

/** The last result or assistant text in a stream-json transcript. */
export function finalAnswer(raw) {
  let answer = '';
  const agySteps = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const step = ev.step_update;
    if (step?.step_type === 'agent_response' && step.text_delta) {
      agySteps.set(step.step_index, (agySteps.get(step.step_index) || '') + step.text_delta);
      answer = agySteps.get(step.step_index);
      continue;
    }
    if (ev.type === 'result' && typeof ev.result === 'string') { answer = ev.result; continue; }
    const content = ev.message?.content ?? ev.content;
    if (typeof content === 'string' && (ev.role === 'assistant' || ev.message?.role === 'assistant')) answer = content;
    if (Array.isArray(content)) {
      const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text && (ev.type === 'assistant' || ev.role === 'assistant')) answer = text;
    }
  }
  return answer;
}
