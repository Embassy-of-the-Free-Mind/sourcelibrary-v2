// box-rpc.sh job verbs (#8614): what jobs did on another box over a raw ssh, as logged verbs that stay in the job trees.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/box-rpc.sh');
const setup = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-')));
  const jobs = path.join(dir, 'jobs');
  fs.mkdirSync(path.join(jobs, 'j1'), { recursive: true });
  fs.writeFileSync(path.join(jobs, 'j1', 'log.txt'), 'a\nb\nc\n');
  fs.writeFileSync(path.join(dir, 'secret'), 'nope');
  fs.symlinkSync(dir, path.join(jobs, 'j1', 'up'));
  const rpc = (cmd: string, input = '') => spawnSync('bash', [SCRIPT], { input, encoding: 'utf8',
    env: { ...process.env, SSH_ORIGINAL_COMMAND: cmd, SSH_CLIENT: '10.0.0.9 1 22', BOX_RPC_LOG: path.join(dir, 'rpc.log'), BOX_RPC_TEST_ROOT: jobs } });
  return { dir, jobs, rpc };
};

describe('box-rpc job verbs', () => {
  it('tail and ls read inside the job trees', () => {
    const { jobs, rpc } = setup();
    expect(rpc(`tail ${jobs}/j1/log.txt 2`).stdout).toBe('b\nc\n');
    expect(rpc(`ls ${jobs}/j1`).stdout).toMatch(/log\.txt/);
  });
  it('refuses paths outside them, by .. or by symlink', () => {
    const { dir, jobs, rpc } = setup();
    for (const p of [`${dir}/secret`, `${jobs}/../secret`, `${jobs}/j1/up/secret`, '/etc/passwd']) {
      const r = rpc(`tail ${p}`);
      expect([p, r.status]).toEqual([p, 3]);
      expect(r.stdout).toBe('');
    }
  });
  it('put writes a file inside a job dir, logged with its hash; never outside or onto the root itself', () => {
    const { dir, jobs, rpc } = setup();
    expect(rpc(`put ${jobs}/j1/code/x.mjs`, 'hello').stdout).toMatch(/^ok /);
    expect(fs.readFileSync(path.join(jobs, 'j1', 'code', 'x.mjs'), 'utf8')).toBe('hello');
    expect(fs.readFileSync(path.join(dir, 'rpc.log'), 'utf8')).toMatch(/put .*x\.mjs 5B sha [0-9a-f]{12}/);
    expect(rpc(`put ${jobs}/j1/up/evil`, 'x').status).toBe(3);
    expect(rpc(`put ${jobs}`, 'x').status).toBe(3);
    expect(fs.existsSync(path.join(dir, 'evil'))).toBe(false);
  });
  it('decisions-mark marks exact unmarked rows in place and touches nothing else (#90)', () => {
    const { dir, rpc } = setup();
    const jd = path.join(dir, 'jd'); fs.mkdirSync(jd);
    const rows = [
      '2026-11-01 | job-a | DECISION: spend $40 on X? — default: no (#7001)',
      '2026-11-02 | job-b | DECISION: rerun Y? — default: yes (#7002)',
      '[TRIAGED 2026-11-05 main] 2026-11-03 | job-c | DECISION: Z? — default: no (#7003)',
    ];
    fs.writeFileSync(path.join(jd, 'decisions.txt'), rows.join('\n') + '\n');
    const env = (cmd: string, input: string) => spawnSync('bash', [SCRIPT], { input, encoding: 'utf8',
      env: { ...process.env, SSH_ORIGINAL_COMMAND: cmd, SSH_CLIENT: '10.0.0.9 1 22', BOX_RPC_LOG: path.join(dir, 'rpc.log'), BOX_RPC_TEST_JD: jd } });
    const marks = `[TRIAGED 2026-11-13 #90] ${rows[1]}\n[TRIAGED 2026-11-13 #90] 2026-11-09 | job-z | DECISION: not here (#1)\n`;
    const r = env('decisions-mark', marks);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/marked 1, not found 1/);
    expect(r.stdout).toMatch(/NOTFOUND 2026-11-09 \| job-z/);
    const after = fs.readFileSync(path.join(jd, 'decisions.txt'), 'utf8').split('\n');
    expect(after).toEqual([rows[0], `[TRIAGED 2026-11-13 #90] ${rows[1]}`, rows[2], '']);
    // A line that is not a marked row is refused, and the file is left as it was.
    expect(env('decisions-mark', 'rm -rf /\n').status).toBe(2);
    expect(fs.readFileSync(path.join(jd, 'decisions.txt'), 'utf8').split('\n')).toEqual(after);
    void rpc;
  });
  it('start refuses a brief with no Lands header before running anything, and accepts a short v3 number (#90)', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-start-')));
    // The wrapper is /bin/true and the job dir a temp dir: a test must never start a real job on the box CI runs on.
    const start = (name: string, input: string) => spawnSync('bash', [SCRIPT], { input, encoding: 'utf8',
      env: { ...process.env, SSH_ORIGINAL_COMMAND: `start ${name}`, SSH_CLIENT: '10.0.0.9 1 22', BOX_RPC_LOG: path.join(dir, 'rpc.log'),
        BOX_RPC_TEST_JD: dir, BOX_RPC_TEST_CJ: '/bin/true' } });
    expect(start('test-job-a', 'PR: no\nhello\n').status).toBe(2);
    let i = 0;
    for (const lands of ['Lands: #90', 'Lands: #7', 'Lands: v2#7860', 'Lands: #6223', 'Lands: none']) {
      expect([lands, start(`test-job-b${i++}`, `${lands}\nPR: no\nhello\n`).status]).toEqual([lands, 0]);
    }
  });
  it('only tail takes a third word', () => {
    const { jobs, rpc } = setup();
    expect(rpc(`ls ${jobs} extra`).status).toBe(2);
    expect(rpc(`tail ${jobs}/j1/log.txt 1 extra`).status).toBe(2);
  });
});
