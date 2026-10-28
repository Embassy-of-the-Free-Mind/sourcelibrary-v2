// Pins the self-locating-alarm contract of scripts/lib/ntfy-send.mjs (#6181).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain .mjs helper
import { ntfyPost, srcTag } from '../../scripts/lib/ntfy-send.mjs';

const topic = 'https://ntfy.sh/sourcelibrary-uptime';
const mkFetch = () => vi.fn(async (..._a: unknown[]) => ({ ok: true, status: 200 }));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ntfy-'));

describe('ntfyPost', () => {
  it('appends the src tag to the body and keeps title/priority', async () => {
    const fetchImpl = mkFetch();
    const logPath = path.join(tmp(), 'a.jsonl');
    await ntfyPost(topic, { headers: { Title: 'T', Priority: 'high' }, body: 'hello' }, { src: 'x.mjs', fetchImpl, logPath });
    const [url, init] = fetchImpl.mock.calls[0] as [string, any];
    expect(url).toBe(topic);
    expect(init.method).toBe('POST');
    expect(init.headers.Title).toBe('T');
    expect(init.body).toBe(`hello\n— src: ${srcTag('x.mjs')}`);
    expect(init.body).toContain(`x.mjs@${os.hostname()}`);
  });

  it('writes one JSONL line per alarm', async () => {
    const fetchImpl = mkFetch();
    const logPath = path.join(tmp(), 'sub', 'a.jsonl');
    await ntfyPost(topic, { headers: { Title: 'vector service: down', Priority: 'high' }, body: 'b' }, { src: 'freshness-check.mjs', fetchImpl, logPath });
    await ntfyPost(topic, { headers: { Title: 'second' }, body: 'c' }, { src: 'freshness-check.mjs', fetchImpl, logPath });
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ title: 'vector service: down', priority: 'high', topic: 'sourcelibrary-uptime' });
    expect(lines[0].src).toContain('freshness-check.mjs@');
  });

  it('still sends when the log path is unwritable', async () => {
    const fetchImpl = mkFetch();
    const file = path.join(tmp(), 'f');
    fs.writeFileSync(file, '');
    const res = await ntfyPost(topic, { body: 'b' }, { src: 's', fetchImpl, logPath: path.join(file, 'nope', 'a.jsonl') });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
