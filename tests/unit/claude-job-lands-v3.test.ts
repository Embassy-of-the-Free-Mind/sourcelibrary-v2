// claude-job.sh after the 2026-11-12 move to sourcelibrary-v3: issue numbers there are short (#99), and old issues are
// written v2#N. The Lands parser took only 3–5 digits, so `Lands: #99` fell through to a guess (it guessed v2#8550
// from the brief's first long number), and a `Model: fable` line ran on Opus.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
const run = (brief: string, body: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cjl-'));
  const f = path.join(root, 'b.txt');
  fs.writeFileSync(f, brief);
  // issue_repo would ask GitHub; stub it so the test stays offline.
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; issue_repo() { echo "repo:$2"; }; ${body.replace(/BRIEF/g, f)}`],
    { encoding: 'utf8' });
  return r.stdout.trim();
};
const lands = (brief: string) => run(brief, 'landing_contract job-x BRIEF; echo "$LC_ISSUE|$LC_ISSUE_SRC|$LC_ISSUE_REPO"');

describe('claude-job Lands header after the v3 move', () => {
  it('reads a short v3 issue number', () => {
    expect(lands('Lands: #99\nPR: yes\nSee v2#8550 for background.\n')).toBe('99|Lands header|repo:');
  });
  it('reads v2#N as the old issue, not the 2 in "v2"', () => {
    expect(lands('Lands: v2#8550\nPR: no\n')).toBe('8550|Lands header|repo:v2');
  });
  it('still reads a bare long number and none', () => {
    expect(lands('Lands: #6948\n')).toBe('6948|Lands header|repo:');
    expect(lands('Lands: none\n').split('|')[0]).toBe('none');
  });
});

describe('claude-job Model header', () => {
  const model = (line: string) => run(`${line}\nLands: #1\n`, 'main_model BRIEF');
  it('maps fable, sonnet, and defaults to opus', () => {
    expect(model('Model: fable')).toBe('claude-fable-5-2');
    expect(model('Model: Sonnet')).toBe('sonnet');
    expect(model('')).toBe('opus');
  });
});
