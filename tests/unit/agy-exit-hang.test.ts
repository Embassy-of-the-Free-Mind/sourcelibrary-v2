/**
 * agy 1.4.8 sometimes prints its whole final JSON reply and then never exits (#7503, 2026-10-27: 13 of ~570 Siku
 * block calls). The 360 s kill classed those complete replies as timeouts and threw them away. A reply printed whole
 * with status SUCCESS is now the call's result: the CLI gets a short grace to exit, then is ended.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hang-'));
const bin = path.join(tmp, 'bin');
let agyCall: (args: string[], cwd: string, opts?: { killAfterMs?: number; exitGraceMs?: number }) => Promise<{ text: string; cls: string | null; hung_after_reply?: boolean; usage: unknown }>;

/** A fake `agy` on PATH: prints `stdout` and then sleeps (the hang), or exits at once. */
function fakeAgy(stdout: string, hang: boolean) {
  fs.writeFileSync(path.join(bin, 'agy'), `#!/bin/sh\nprintf '%s' '${stdout.replace(/'/g, `'\\''`)}'\n${hang ? 'exec sleep 30\n' : ''}`, { mode: 0o755 });
}

beforeAll(async () => {
  fs.mkdirSync(bin);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.AGY_JOB_LEDGER = path.join(tmp, 'ledger', 'jobs');   // never the box's shared ledger
  process.env.MODEL_LIMITS_DIR = path.join(tmp, 'limits');
  // @ts-expect-error — plain .mjs helper, no types
  ({ agyCall } = await import('../../scripts/lib/agy-cli.mjs'));
});

const reply = JSON.stringify({ conversation_id: 'c1', status: 'SUCCESS', response: '<translation page="1">Text.</translation>', usage: { input_tokens: 10, output_tokens: 5 } });
const args = ['-p', 'x', '--model', 'gemini-3.8-flash-low'];

describe('agyCall when the CLI hangs after its reply', () => {
  it('keeps a whole SUCCESS reply printed before the hang', async () => {
    fakeAgy(reply, true);
    const r = await agyCall(args, tmp, { killAfterMs: 20_000, exitGraceMs: 300 });
    expect(r.cls).toBeNull();
    expect(r.hung_after_reply).toBe(true);
    expect(r.text).toContain('<translation page="1">');
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  }, 15_000);

  it('a hang with no complete reply is still a timeout', async () => {
    fakeAgy('{"status":"SUCC', true);
    const r = await agyCall(args, tmp, { killAfterMs: 500, exitGraceMs: 300 });
    expect(r.cls).toBe('timeout');
    expect(r.hung_after_reply).toBeUndefined();
  }, 15_000);

  it('a CLI that exits normally is unchanged', async () => {
    fakeAgy(reply, false);
    const r = await agyCall(args, tmp, { killAfterMs: 5_000, exitGraceMs: 300 });
    expect(r.cls).toBeNull();
    expect(r.hung_after_reply).toBeUndefined();
  }, 15_000);
});
