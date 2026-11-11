// claude-job.sh: each new DECISION line is also posted on the issue it names (#8551).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
// Source the wrapper's functions, point JD/LOGD at a temp tree, and put a fake `gh` first on PATH that
// writes each call's issue number and body to calls/<n>.<i>.
const setup = (logLines: string[], brief = 'Lands: #9000\nPR: no\n') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cjd-'));
  for (const d of ['jd', 'log', 'bin', 'calls']) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, 'jd', 'j1.brief.txt'), brief);
  fs.writeFileSync(path.join(root, 'log', 'j1.log'), logLines.join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'bin', 'gh'),
    `#!/bin/bash\n[ "$1 $2" = "issue comment" ] || exit 0\nn=$3; shift 3\nwhile [ $# -gt 0 ]; do [ "$1" = --body ] && b=$2; shift; done\n` +
    `i=$(ls "${root}/calls" | wc -l); printf '%s' "$b" > "${root}/calls/$n.$i"\n`, { mode: 0o755 });
  return root;
};
const run = (root: string, env: Record<string, string> = {}) => {
  const r = spawnSync('bash', ['-c', `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; JD="${root}/jd"; LOGD="${root}/log"; collect_decisions j1`],
    { encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ...env } });
  return r.status;
};
const calls = (root: string) => fs.readdirSync(path.join(root, 'calls')).sort()
  .map((f) => ({ issue: f.split('.')[0], body: fs.readFileSync(path.join(root, 'calls', f), 'utf8') }));

describe('claude-job.sh collect_decisions posts each new DECISION on its issue', () => {
  it('groups lines by the last #NNNN in the line, falling back to the Lands issue', () => {
    const root = setup([
      'DECISION: merge PR #8116 first? — default: yes (#7263)',
      'DECISION: second question — default: no (#7263)',
      'DECISION: a line with no issue — default: wait',
    ]);
    expect(run(root)).toBe(0);
    const c = calls(root);
    expect(c.map((x) => x.issue).sort()).toEqual(['7263', '9000']);
    const main = c.find((x) => x.issue === '7263')!.body;
    expect(main).toContain('- DECISION: merge PR #8116 first? — default: yes (#7263)');
    expect(main).toContain('- DECISION: second question — default: no (#7263)');
    expect(c.find((x) => x.issue === '9000')!.body).toContain('a line with no issue');
    expect(fs.readFileSync(path.join(root, 'jd', 'decisions.txt'), 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
  });
  it('posts nothing for a line already in decisions.txt (a resumed job re-reads its whole log)', () => {
    const root = setup(['DECISION: q — default: yes (#7263)']);
    run(root);
    run(root);
    expect(calls(root)).toHaveLength(1);
  });
  it('posts nothing when DECISION_COMMENTS=0, and still records the line', () => {
    const root = setup(['DECISION: q — default: yes (#7263)']);
    run(root, { DECISION_COMMENTS: '0' });
    expect(calls(root)).toHaveLength(0);
    expect(fs.readFileSync(path.join(root, 'jd', 'decisions.txt'), 'utf8')).toContain('| j1 | DECISION: q');
  });
  it('a line with no issue and `Lands: none` is recorded but not posted', () => {
    const root = setup(['DECISION: q — default: wait'], 'Lands: none\n');
    run(root);
    expect(calls(root)).toHaveLength(0);
  });
});
