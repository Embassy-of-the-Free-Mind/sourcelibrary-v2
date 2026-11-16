// claude-job.sh start's claim guard (#239): refuse when the Lands issue carries another job's or session's
// "taking this" comment from the last 12 h. On 2026-11-13 a second job was started on #244 48 min after
// error-zoo-site-244 claimed it. GitHub is stubbed (issue_claim_lines) so the test stays offline.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
const guard = (name: string, claims: string[], brief = 'Lands: #244\nPR: yes\n', env: Record<string, string> = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cjc-'));
  const f = path.join(root, 'b.txt');
  const c = path.join(root, 'claims.tsv');
  fs.writeFileSync(f, brief);
  fs.writeFileSync(c, claims.map((l) => `2026-11-13T13:22:33Z\t${l}\n`).join(''));
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; issue_repo() { echo repo; }
    issue_claim_lines() { cat "${c}"; }; landing_contract "${name}" "${f}"; claim_guard "${name}" "${f}"; echo "rc=$?"`],
    { encoding: 'utf8', env: { ...process.env, JOB_FORCE_CLAIM: '', ...env } });
  return r.stdout.trim();
};

describe('claude-job claim guard', () => {
  it('refuses when another job claimed the Lands issue, and names it', () => {
    const out = guard('second-try-244', ['Taking step 2 (job `error-zoo-site-244` on l7a)']);
    expect(out).toMatch(/REFUSED: #244/);
    expect(out).toContain('error-zoo-site-244');
    expect(out).toContain('2026-11-13T13:22:33Z');
    expect(out).toMatch(/rc=10$/);
  });
  it('lets the claiming job itself, and its -mv move, start', () => {
    expect(guard('error-zoo-site-244', ['taking this (job error-zoo-site-244 on l7a)'])).toBe('rc=0');
    expect(guard('error-zoo-site-244-mv', ['taking this (job error-zoo-site-244 on l7a)'])).toBe('rc=0');
  });
  it('does not take a longer name as this job (fix vs fix-euro)', () => {
    expect(guard('fix', ['taking this (job fix-euro)'])).toMatch(/rc=10$/);
  });
  it('starts with no claims, with Lands: none, and with --force-claim or a Force-claim header', () => {
    expect(guard('a-244', [])).toBe('rc=0');
    expect(guard('a-244', ['taking this (job b)'], 'Lands: none\nPR: no\n')).toBe('rc=0');
    expect(guard('a-244', ['taking this (job b)'], undefined, { JOB_FORCE_CLAIM: '1' })).toMatch(/rc=0$/);
    expect(guard('a-244', ['taking this (job b)'], 'Lands: #244\nForce-claim: b stopped, see #244\n')).toMatch(/rc=0$/);
  });
  it('fails open when GitHub cannot be read', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cjc-'));
    const f = path.join(root, 'b.txt');
    fs.writeFileSync(f, 'Lands: #244\n');
    const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; issue_repo() { echo repo; }
      issue_claim_lines() { return 1; }; landing_contract x "${f}"; claim_guard x "${f}"; echo "rc=$?"`], { encoding: 'utf8' });
    expect(r.stdout).toMatch(/claim not checked/);
    expect(r.stdout.trim()).toMatch(/rc=0$/);
  });
});
