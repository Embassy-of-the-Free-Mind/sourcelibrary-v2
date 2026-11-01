// claude-job.sh job-session thrift (#7869): fresh session per stage at ~150K context, Sonnet subagents.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
// Source the wrapper's functions (CLAUDE_JOB_LIB=1: no command, no mkdir), point its dirs at a temp tree, run `body`.
const lib = (root: string, body: string, env: Record<string, string> = {}) => {
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; JD="${root}/jd"; WT="${root}/wt"; WT_OLD="${root}/old"; ${body}`],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(root, 'cfg'), ...env } });
  return r.stdout.trim();
};
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-'));
  fs.mkdirSync(path.join(root, 'jd')); fs.mkdirSync(path.join(root, 'wt', 'job-j1'), { recursive: true });
  return root;
};
const turn = (ctx: number, sidechain = false) => JSON.stringify({
  type: 'assistant', isSidechain: sidechain,
  message: { id: `m${ctx}`, usage: { input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000 } },
});
const HEAD = JSON.stringify({ type: 'user', message: { content: 'HEADLESS RULES (prepended by claude-job.sh; they override anything below):' } });
const transcript = (root: string, lines: string[], file = 's1.jsonl', head = HEAD) => {
  const slug = path.join(root, 'wt', 'job-j1').replace(/[^A-Za-z0-9]/g, '-');
  const d = path.join(root, 'cfg', 'projects', slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), [head, ...lines].join('\n') + '\n');
};

describe('claude-job.sh fresh session per stage', () => {
  it('reads the last main-chain turn, not a subagent turn', () => {
    const root = setup();
    transcript(root, [turn(40000), turn(160000), turn(900000, true)]);
    expect(lib(root, 'session_ctx j1')).toBe('160000');
    expect(lib(root, 'ctx_verdict j1')).toMatch(/^context 160K >= 150K: FRESH/);
  });
  it('skips a newer per-call transcript that is not the job session', () => {
    const root = setup();
    transcript(root, [turn(200000)]);
    transcript(root, [turn(5000)], 'percall.jsonl', JSON.stringify({ type: 'user', message: { content: 'Translate this page.' } }));
    expect(lib(root, 'session_ctx j1')).toBe('200000');
  });
  it('says continue under the limit, when no transcript exists, and when switched off', () => {
    const root = setup();
    expect(lib(root, 'ctx_verdict j1')).toBe('context unknown (no transcript found): continue');
    transcript(root, [turn(90000)]);
    expect(lib(root, 'ctx_verdict j1')).toBe('context 90K < 150K: continue');
    transcript(root, [turn(400000)]);
    expect(lib(root, 'ctx_verdict j1', { JOB_FRESH_CTX: '0' })).toMatch(/: continue$/);
  });
  it('is due only when the state file is newer than the session mark', () => {
    const root = setup();
    const jd = path.join(root, 'jd');
    expect(lib(root, 'fresh_due j1 && echo due || echo no')).toBe('no');
    lib(root, 'session_mark j1');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(jd, 'j1.session'), old, old);
    fs.writeFileSync(path.join(jd, 'j1.state.md'), 'done: step 1\nnext: step 2\n');
    expect(lib(root, 'fresh_due j1 && echo due || echo no')).toBe('due');
    lib(root, 'session_mark j1');  // the fresh session started: the same file is no longer due
    expect(lib(root, 'fresh_due j1 && echo due || echo no')).toBe('no');
  });
  it('builds the fresh prompt from rules, brief and state file', () => {
    const root = setup();
    const jd = path.join(root, 'jd');
    fs.writeFileSync(path.join(jd, 'j1.brief.txt'), 'Lands: #1\nPR: no\nDo the thing.\n');
    fs.writeFileSync(path.join(jd, 'j1.state.md'), 'done: step 1 (PR #9)\n');
    const p = lib(root, 'fresh_prompt j1 2');
    expect(p).toMatch(/^HEADLESS RULES/);
    expect(p).toContain('Do the thing.');
    expect(p).toContain('## Fresh session 2');
    expect(p.endsWith('done: step 1 (PR #9)')).toBe(true);
  });
});

describe('claude-job.sh subagent model', () => {
  it('is sonnet unless the brief header says opus', () => {
    const root = setup();
    const b = path.join(root, 'b.txt');
    fs.writeFileSync(b, 'Lands: #1\nPR: no\n');
    expect(lib(root, `subagent_model ${b}`)).toBe('sonnet');
    fs.writeFileSync(b, 'Lands: #1\nSubagents: opus — judge must match the production reader\n');
    expect(lib(root, `subagent_model ${b}`)).toBe('opus');
    fs.writeFileSync(b, 'Lands: #1\n' + '\n'.repeat(20) + 'Subagents: opus\n');
    expect(lib(root, `subagent_model ${b}`)).toBe('sonnet');
  });
});
