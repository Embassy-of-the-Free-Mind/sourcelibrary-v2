// job-ledger.sh (#8606): a job's start is recorded with who launched it and why, and pushed to a git repo.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/job-ledger.sh');
const sh = (cmd: string, env: Record<string, string> = {}) =>
  spawnSync('bash', ['-c', cmd], { encoding: 'utf8', env: { ...process.env, ...env } });

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  sh(`git init -q --bare -b main ${dir}/ops.git && git clone -q ${dir}/ops.git ${dir}/seed 2>/dev/null && cd ${dir}/seed &&
      echo x > README && git add . && git -c user.name=t -c user.email=t@t commit -qm init && git push -q origin main`);
  fs.mkdirSync(path.join(dir, 'jd'));
  fs.writeFileSync(path.join(dir, 'boxes.sh'), '#!/bin/sh\nBOXES="main=10.0.0.1 gex45=10.0.0.9"\n[ "$1" = self ] && echo main\n', { mode: 0o755 });
  const brief = path.join(dir, 'b.txt');
  fs.writeFileSync(brief, 'Lands: #6948\nPR: yes\nRoute: x → opus-cli 27/30\n\n# Finish the Kangyur\n\nWHY: Derek published them.\n\nDispatched-by: gex45 session abc job planner\n');
  const env = {
    JOB_LEDGER_JD: path.join(dir, 'jd'), JOB_LEDGER_URL: `file://${dir}/ops.git`, JOB_LEDGER_CLONE: path.join(dir, 'clone'),
    JOB_LEDGER_BOXES: path.join(dir, 'boxes.sh'), JOB_LEDGER_NO_BG: '1', JOB_LEDGER_BACKOFF: '0', SSH_CLIENT: '10.0.0.9 5000 22', SSH_ORIGINAL_COMMAND: '', CLAUDE_CODE_SESSION_ID: '',
  };
  return { dir, brief, env };
};

describe('job-ledger.sh', () => {
  it('records a start with launcher, route and why, and pushes one file per record', () => {
    const { dir, brief, env } = setup();
    expect(sh(`bash ${SCRIPT} record start kf-1 ${brief} && bash ${SCRIPT} flush`, env).status).toBe(0);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'jd', 'ledger.jsonl'), 'utf8').trim());
    expect(rec).toMatchObject({
      event: 'start', job: 'kf-1', box: 'main', lands: '#6948', route: 'x → opus-cli 27/30', why: 'Derek published them.',
      title: 'Finish the Kangyur', launcher: { via: 'ssh', from_box: 'gex45', dispatched_by: 'gex45 session abc job planner' },
    });
    const files = sh(`git --git-dir=${dir}/ops.git ls-tree -r --name-only main jobs/ledger`).stdout.trim().split('\n');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^jobs\/ledger\/\d{4}-\d{2}\/\d{8}T\d{6}Z_main_kf-1_start\.json$/);
    expect(fs.readdirSync(path.join(dir, 'jd', 'ledger-spool'))).toHaveLength(0);
    const why = sh(`bash ${SCRIPT} why kf-1`, env).stdout;
    expect(why).toMatch(/start\s+kf-1 on main \(ssh from gex45; gex45 session abc job planner\) -> #6948/);
    expect(why).toMatch(/why: Derek published them\./);
  });
  it('keeps the record spooled when the repo cannot be reached, and never fails the caller', () => {
    const { dir, brief, env } = setup();
    const r = sh(`bash ${SCRIPT} record start kf-2 ${brief}; echo rc=$?; bash ${SCRIPT} flush`, { ...env, JOB_LEDGER_URL: `file://${dir}/nope.git` });
    expect(r.stdout).toMatch(/rc=0/);
    expect(fs.readdirSync(path.join(dir, 'jd', 'ledger-spool'))).toHaveLength(1);
  });
});
