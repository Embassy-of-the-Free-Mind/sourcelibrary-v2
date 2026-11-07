/**
 * #7628: a whole book goes to agy on STDIN as stream-json messages, because one argv string is capped at 128 KB and
 * agy itself cuts one message at ~190K characters. One conversation, a turn per message: the call is done only when
 * every turn has its `result` event, usage is the sum over turns, and the model's own text (stream deltas) is never
 * read as a quota error. A fake `agy` on PATH plays the CLI.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-stdin-'));
const bin = path.join(tmp, 'bin');
type Call = { text: string; cls: string | null; usage: Record<string, number> | null; turns_done?: number };
let agyCall: (args: string[], cwd: string, opts?: { killAfterMs?: number; exitGraceMs?: number; input?: string; turns?: number }) => Promise<Call>;
let gatedTextCall: (sent: string | string[], opts: { model: string; attempts?: number; stdin?: boolean; printTimeoutS?: number }) => Promise<Call & { requests: number; answer: string }>;
let stdinArgs: (s?: number) => string[];
let stdinMessage: (t: string) => string;
let replyEnvelope: (out: string) => Record<string, unknown>;
let streamUsage: (out: string) => Record<string, number> | null;

const ev = (o: unknown) => JSON.stringify(o);
const result = (response: string, usage: Record<string, number>) => ev({ event: 'result', result: { status: 'SUCCESS', response, usage } });
const delta = (t: string) => ev({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: t } });

/** A fake `agy`: copies stdin to stdin.txt in its cwd, then prints `lines` (one per line), optionally hanging after. */
function fakeAgy(lines: string[], hang = false) {
  const body = lines.map((l) => `printf '%s\\n' '${l.replace(/'/g, `'\\''`)}'`).join('\n');
  fs.writeFileSync(path.join(bin, 'agy'), `#!/bin/sh\ncat > stdin.txt\n${body}\n${hang ? 'exec sleep 30\n' : ''}`, { mode: 0o755 });
}

beforeAll(async () => {
  fs.mkdirSync(bin);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.AGY_JOB_LEDGER = path.join(tmp, 'ledger', 'jobs');
  process.env.MODEL_LIMITS_DIR = path.join(tmp, 'limits');
  // @ts-expect-error — plain .mjs helper, no types
  ({ agyCall, gatedTextCall, stdinArgs, stdinMessage, replyEnvelope, streamUsage } = await import('../../scripts/lib/agy-cli.mjs'));
});

describe('agy stdin transport (#7628)', () => {
  it('the envelope of a stream-json reply is its last result event', () => {
    const out = [ev({ event: 'init' }), delta('x'), result('A', { input_tokens: 1 }), result('B', { input_tokens: 2 })].join('\n');
    expect(replyEnvelope(out).response).toBe('B');
    expect(replyEnvelope('{"status":"SUCCESS","response":"J"}').response).toBe('J');
    expect(replyEnvelope('not json')).toEqual({});
    expect(streamUsage(out)).toEqual({ input_tokens: 3 });
  });

  it('sends the message on stdin and reads the answer of the last turn, usage summed', async () => {
    fakeAgy([ev({ event: 'init' }), delta('OK'), result('OK', { input_tokens: 100, output_tokens: 1 }), delta('<<<BEGIN>>>'), result('<<<BEGIN>>>\n{"a":1}\n<<<END>>>', { input_tokens: 200, output_tokens: 9 })]);
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const r = await agyCall([...stdinArgs(60), '--model', 'gemini-3.8-flash-low'], ws, { input: stdinMessage('part 1') + stdinMessage('part 2'), turns: 2, killAfterMs: 10_000 });
    expect(r.cls).toBeNull();
    expect(r.text).toContain('{"a":1}');
    expect(r.usage).toMatchObject({ input_tokens: 300, output_tokens: 10 });
    const sent = fs.readFileSync(path.join(ws, 'stdin.txt'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ event: 'user', message: { role: 'user', content: [{ type: 'text', text: 'part 1' }] } });
  }, 15_000);

  it('a reply with fewer results than turns is cut short, not a read', async () => {
    fakeAgy([result('OK', { input_tokens: 1 })]);
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const r = await agyCall([...stdinArgs(60), '--model', 'gemini-3.8-flash-low'], ws, { input: stdinMessage('a') + stdinMessage('b'), turns: 2, killAfterMs: 10_000 });
    expect(r.cls).toBe('timeout');
  }, 15_000);

  it('does not end a multi-turn call at the first turn\'s result', async () => {
    // The first result is printed, then the CLI hangs: the grace kill must wait for the second turn, so this is a timeout.
    fakeAgy([result('OK', { input_tokens: 1 })], true);
    const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
    const r = await agyCall([...stdinArgs(60), '--model', 'gemini-3.8-flash-low'], ws, { input: stdinMessage('a') + stdinMessage('b'), turns: 2, killAfterMs: 1_500, exitGraceMs: 200 });
    expect(r.cls).toBe('timeout');
  }, 15_000);

  it('the model saying "429" in its own text is not a quota stop', async () => {
    fakeAgy([delta('In 1429 the council met.'), result('<<<BEGIN>>>\n{"year": 1429}\n<<<END>>>', { input_tokens: 5 })]);
    const r = await gatedTextCall(['the text'], { model: 'gemini-3.8-flash-low', attempts: 1, stdin: true, printTimeoutS: 30 });
    expect(r.cls).toBeNull();
    expect(r.answer).toContain('1429');
  }, 15_000);

  it('counts a request per message, refuses a message agy would cut, and sends arrays only on stdin', async () => {
    fakeAgy([result('OK', {}), result('OK', {}), result('<<<BEGIN>>>\n{}\n<<<END>>>', {})]);
    const r = await gatedTextCall(['a', 'b', 'c'], { model: 'gemini-3.8-flash-low', attempts: 1, stdin: true, printTimeoutS: 30 });
    expect(r.requests).toBe(3);
    await expect(gatedTextCall(['x'.repeat(200_000)], { model: 'gemini-3.8-flash-low', stdin: true })).rejects.toThrow(/cut by agy/);
    await expect(gatedTextCall(['a', 'b'], { model: 'gemini-3.8-flash-low' })).rejects.toThrow(/only on stdin/);
  }, 15_000);
});
