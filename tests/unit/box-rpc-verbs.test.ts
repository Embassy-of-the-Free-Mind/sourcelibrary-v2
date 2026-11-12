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
  it('only tail takes a third word', () => {
    const { jobs, rpc } = setup();
    expect(rpc(`ls ${jobs} extra`).status).toBe(2);
    expect(rpc(`tail ${jobs}/j1/log.txt 1 extra`).status).toBe(2);
  });
});
