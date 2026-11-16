// agy-guard.sh's box-wide cap on agy calls running at once (v3 #70): a call that finds the box full waits for room,
// runs anyway after the wait limit, and the free /quota read never waits. Runs the real script with a stub CLI.
// PRIOR ART: tests/unit/claude-pace-guard.test.ts — same shape (real script, stub CLI), but that guard holds lock
// files per account; this one counts live processes, which needs Linux /proc, so the suite skips elsewhere.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/agy-guard.sh');
const has = (bin: string) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
// The guard tells a running CLI from a waiting copy of itself by the executable: the stub must not be bash.
const canRun = fs.existsSync('/proc/self/exe') && has('pgrep') && has('flock') && !/bash$/.test(fs.realpathSync('/bin/sh'));

const live: ChildProcess[] = [];
afterEach(() => { for (const c of live.splice(0)) c.kill('SIGKILL'); });

const setup = (extra: NodeJS.ProcessEnv = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agyslots-'));
  // Its own process name, so calls from other tests and the box's real agy calls are not counted (CI runs on a job box).
  const real = path.join(root, `agyt${process.pid % 100000}${Math.floor(Math.random() * 1e5)}`);
  const log = path.join(root, 'calls.log');
  fs.writeFileSync(real, '#!/bin/sh\necho "$STUB_ID start" >> "$STUB_LOG"\nsleep "${STUB_SLEEP:-0}"\necho "$STUB_ID end" >> "$STUB_LOG"\n', { mode: 0o755 });
  const env = { ...process.env, HOME: root, AGY_HOME: '', AGY_REAL: real, AGY_GUARD_DIR: path.join(root, 'heavy'), AGY_SLOT_DIR: path.join(root, 'slots'),
    AGY_BOX_SLOTS: '1', AGY_SLOT_POLL_S: '1', STUB_LOG: log, ...extra };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  const waits = () => (fs.existsSync(env.AGY_SLOT_DIR) ? fs.readdirSync(env.AGY_SLOT_DIR).filter((f) => f.endsWith('.log')).map((f) => fs.readFileSync(path.join(env.AGY_SLOT_DIR, f), 'utf8')).join('') : '');
  const args = (prompt: string) => ['-p', prompt, '--model', 'gemini-3.8-flash-low'];
  const start = async (id: string, sleepS: number) => {
    const c = spawn('bash', [SCRIPT, ...args('hi')], { env: { ...env, STUB_ID: id, STUB_SLEEP: String(sleepS) }, stdio: 'ignore' });
    live.push(c);
    const done = new Promise((res) => c.on('close', res));
    for (let i = 0; i < 100 && !calls().includes(`${id} start`); i++) await new Promise((r) => setTimeout(r, 50));
    expect(calls()).toContain(`${id} start`);
    return { done };   // an object: an async function that returns a promise would make the caller wait for the close
  };
  const run = (id: string, prompt = 'hi', more: NodeJS.ProcessEnv = {}) => spawnSync('bash', [SCRIPT, ...args(prompt)], { encoding: 'utf8', env: { ...env, STUB_ID: id, ...more } });
  return { calls, waits, start, run, env };
};

describe.skipIf(!canRun)('agy-guard box-wide cap', () => {
  it('runs a call at once when the box has room, and logs no wait', () => {
    const { calls, waits, run } = setup();
    expect(run('A').status).toBe(0);
    expect(calls()).toEqual(['A start', 'A end']);
    expect(waits()).toBe('');
  });

  it('holds a call while the box is full and starts it when the running one ends', async () => {
    const { calls, waits, start, run } = setup();
    const a = await start('A', 3);
    expect(run('B').status).toBe(0);
    await a.done;
    expect(calls()).toEqual(['A start', 'A end', 'B start', 'B end']);
    expect(waits()).toMatch(/ waited=\d+s running=0 slots=1 overflow=0 ppid=\d+\n$/);
  }, 30e3);

  it('does not hand one freed place to every waiter at once', async () => {
    const { calls, start, env } = setup({ AGY_BOX_SLOTS: '2' });
    const first = [await start('A', 2), await start('B', 2)];
    const rest = Array.from({ length: 6 }, (_, i) => new Promise((res) => {
      const c = spawn('bash', [SCRIPT, '-p', 'hi', '--model', 'gemini-3.8-flash-low'], { env: { ...env, STUB_ID: `W${i}`, STUB_SLEEP: '2' }, stdio: 'ignore' });
      live.push(c); c.on('close', res);
    }));
    await Promise.all([...first.map((f) => f.done), ...rest]);
    let running = 0, peak = 0;
    for (const line of calls()) { running += line.endsWith(' start') ? 1 : -1; peak = Math.max(peak, running); }
    expect(calls().filter((l) => l.endsWith(' end'))).toHaveLength(8);
    expect(peak).toBe(2);
  }, 90e3);

  it('runs the call anyway after the wait limit, and says so', async () => {
    const { calls, waits, start, run } = setup({ AGY_SLOT_WAIT_S: '2' });
    const a = await start('A', 8);
    expect(run('B').status).toBe(0);
    expect(calls()).toEqual(['A start', 'B start', 'B end']);
    expect(waits()).toMatch(/ waited=2s running=1 slots=1 overflow=1 /);
    await a.done;
  }, 30e3);

  it('never holds the free /quota read', async () => {
    const { calls, waits, start, run } = setup();
    const a = await start('A', 4);
    expect(run('Q', '/quota').status).toBe(0);
    expect(calls()).toEqual(['A start', 'Q start', 'Q end']);
    expect(waits()).toBe('');
    await a.done;
  }, 30e3);

  it('has no cap when the slot count is 0', async () => {
    const { calls, start, run } = setup({ AGY_BOX_SLOTS: '0' });
    const a = await start('A', 4);
    expect(run('B').status).toBe(0);
    expect(calls()).toEqual(['A start', 'B start', 'B end']);
    await a.done;
  }, 30e3);

  it('lets a kill from the caller land on the CLI itself', async () => {
    const { calls, start } = setup();
    const a = await start('A', 10);
    const c = live[live.length - 1];
    const closed = new Promise<[number | null, string | null]>((res) => c.on('close', (code, sig) => res([code, sig])));
    c.kill('SIGKILL');
    expect(await closed).toEqual([null, 'SIGKILL']);
    await a.done;
    // The kill landed on the CLI itself (the guard had exec'd into it): it never reached its last line.
    await new Promise((r) => setTimeout(r, 300));
    expect(calls()).toEqual(['A start']);
  }, 30e3);
});
