// claude-job.sh landing contract (#90): a `Lands:` header names its issue with one to five digits,
// because v3 issue numbers began at #1 on 2026-11-12. The job-name and first-number guesses are unchanged.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
// Source the wrapper's functions, stub issue_repo (it calls gh), run landing_contract on a brief.
const contract = (name: string, brief: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-lands-'));
  const f = path.join(dir, 'brief.txt');
  fs.writeFileSync(f, brief);
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; issue_repo() { echo "repo:$2"; }; landing_contract "${name}" "${f}"; echo "$LC_ISSUE|$LC_ISSUE_SRC|$LC_ISSUE_REPO|$LC_PR"`],
    { encoding: 'utf8' });
  return r.stdout.trim();
};

describe('claude-job.sh Lands header', () => {
  it('reads a one- or two-digit v3 issue', () => {
    expect(contract('job-x', 'Lands: #90\nPR: yes\n')).toBe('90|Lands header|repo:|yes');
    expect(contract('job-x', 'Lands: #7\n')).toBe('7|Lands header|repo:|auto');
  });
  it('drops leading zeros', () => {
    expect(contract('job-x', 'Lands: #090 (this is v3 issue 90)\n')).toBe('90|Lands header|repo:|auto');
  });
  it('takes the number after # in a v2 reference, not the 2', () => {
    expect(contract('job-x', 'Lands: v2#7860\n')).toBe('7860|Lands header|repo:v2|auto');
  });
  it('still reads four- and five-digit headers and bare numbers', () => {
    expect(contract('job-x', 'Lands: #6223\n')).toBe('6223|Lands header|repo:|auto');
    expect(contract('job-x', 'Lands: 12345\n')).toBe('12345|Lands header|repo:|auto');
  });
  it('keeps none', () => {
    expect(contract('job-x', 'Lands: none\n')).toBe('none|Lands header||auto');
  });
  it('leaves the job-name and first-number guesses at four to five digits', () => {
    expect(contract('fix-6223', 'no header here, see #90 and #7001\n')).toBe('6223|job name|repo:|auto');
    expect(contract('job-x', 'no header here, see #90 and #7001\n')).toBe('7001|first number in brief|repo:|auto');
  });
});
