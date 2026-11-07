/**
 * #7912: a lane STOP gets an owner — a ticket, a registry row, one page a day while it stands.
 * The fake lane lives in a tmp dir; gh and ntfy are injected fakes that record their calls.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { writeLaneStop, checkStops, pagePayload, readRegistry } from '../../scripts/lib/lane-stop.mjs';
import { parseEvidence } from '../../scripts/maintenance/lane-stops.mjs';
import { collectStops } from '../../scripts/maintenance/work-board-push.mjs';
import { buildBoard, type BoxDoc } from '@/lib/work-board';

const NOW = new Date('2026-11-02T08:15:00Z');
const BOX = 'testbox';
let dir: string, stop: string, registry: string;
type Call = { args: string[]; input?: string };

function fakeGh(calls: Call[], { existing = [] as { number: number; title: string; url: string }[] } = {}) {
  return (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === 'issue' && args[1] === 'list') return { status: 0, stdout: JSON.stringify(existing), stderr: '' };
    if (args[0] === 'issue' && args[1] === 'create') return { status: 0, stdout: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/9001', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
}
function fakeSend(sent: { url: string; init: { headers: Record<string, string>; body: string } }[]) {
  return async (url: string, init: { headers: Record<string, string>; body: string }) => { sent.push({ url, init }); return { ok: true }; };
}
const base = () => ({
  lane: 'fake-lane (#1)', stopPath: stop, reason: 'paused by spot check T1: 1 invented page(s)', kind: 'containment' as const,
  laneIssue: 1, evidence: [{ label: 'Some Book p.12', url: 'https://sourcelibrary.org/book/b1?page=12', note: 'invented: “…”' }],
  pagesWaiting: 1350000, box: BOX, registryPath: registry, now: NOW,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-stop-'));
  stop = path.join(dir, 'lane', 'STOP');
  registry = path.join(dir, 'lane-stops.json');
});

describe('lane-stop: dry run on a fake lane', () => {
  it('produces the ticket body, the registry row and one page payload — and writes nothing', async () => {
    const calls: Call[] = [];
    const r = await writeLaneStop({ ...base(), dryRun: true, gh: fakeGh(calls) });
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(stop)).toBe(false);
    expect(fs.existsSync(registry)).toBe(false);

    expect(r.title).toBe('Lane STOP: fake-lane (#1) — paused by spot check T1: 1 invented page(s)');
    expect(r.body).toContain(`\`${stop}\` on \`${BOX}\``);
    expect(r.body).toContain('[Some Book p.12](https://sourcelibrary.org/book/b1?page=12): invented');
    expect(r.body).toContain(`\`rm ${stop}\``);
    expect(r.body).toContain('Pages waiting: 1,350,000');
    expect(r.body).toContain('`contained`');

    expect(r.row).toMatchObject({ id: `${BOX}:${stop}`, lane: 'fake-lane (#1)', kind: 'containment', stop_path: stop, lane_issue: 1, pages_waiting: 1350000, released_at: null, last_paged_at: null });

    const p = pagePayload({ ...r.row, stopped_at: '2026-10-30T14:06:00Z' }, NOW);
    expect(p.url).toBe('https://ntfy.sh/sourcelibrary-uptime');
    expect(p.headers.Title).toBe('Lane STOP standing 2 d: fake-lane (#1)');
    expect(p.body).toContain('Pages waiting: 1,350,000');
    expect(p.body).toContain(`Release: rm ${stop}`);
  });
});

describe('lane-stop: live on a fake lane (fake gh, fake ntfy)', () => {
  it('writes the STOP, opens one labelled ticket, comments on the lane issue, registers, pages once a day, sees the release', async () => {
    const calls: Call[] = [];
    const r = await writeLaneStop({ ...base(), gh: fakeGh(calls) });
    expect(fs.readFileSync(stop, 'utf8')).toBe('paused by spot check T1: 1 invented page(s)\n');
    const create = calls.find(c => c.args[0] === 'issue' && c.args[1] === 'create')!;
    expect(create.args).toContain('lane-stop,contained');
    expect(create.input).toBe(r.body);
    expect(calls.some(c => c.args[1] === 'comment' && c.args[2] === '1' && c.input?.includes('/issues/9001'))).toBe(true);
    const reg = readRegistry(registry);
    expect(reg.stops).toHaveLength(1);
    expect(reg.stops[0].ticket).toEqual({ number: 9001, url: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/9001' });

    const sent: Parameters<ReturnType<typeof fakeSend>>[] = [];
    const send = fakeSend(sent as never);
    const one = await checkStops({ registryPath: registry, now: NOW, send, gh: fakeGh([]), box: BOX });
    expect(one.pages).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await checkStops({ registryPath: registry, now: new Date('2026-11-02T20:00:00Z'), send, box: BOX })).pages).toHaveLength(0);
    expect((await checkStops({ registryPath: registry, now: new Date('2026-11-03T08:15:00Z'), send, box: BOX })).pages).toHaveLength(1);

    fs.rmSync(stop);
    const relCalls: Call[] = [];
    const rel = await checkStops({ registryPath: registry, now: new Date('2026-11-04T08:15:00Z'), send, gh: fakeGh(relCalls), box: BOX });
    expect(rel.released).toEqual([`${BOX}:${stop}`]);
    expect(rel.pages).toHaveLength(0);
    expect(relCalls[0].args.slice(0, 3)).toEqual(['issue', 'comment', '9001']);
    expect(readRegistry(registry).stops[0].released_at).toBe('2026-11-04T08:15:00.000Z');
  });

  it('reuses the lane\'s open ticket instead of opening a second', async () => {
    const calls: Call[] = [];
    const existing = [{ number: 77, title: 'Lane STOP: fake-lane (#1) — earlier', url: 'https://github.com/x/y/issues/77' }];
    const r = await writeLaneStop({ ...base(), gh: fakeGh(calls, { existing }) });
    expect(calls.some(c => c.args[0] === 'issue' && c.args[1] === 'create')).toBe(false);
    expect(calls.some(c => c.args[1] === 'comment' && c.args[2] === '77')).toBe(true);
    expect(r.row.ticket?.number).toBe(77);
  });

  it('register leaves an existing STOP untouched, dates it from the file, refuses a missing one', async () => {
    await expect(writeLaneStop({ ...base(), writeFile: false, gh: fakeGh([]) })).rejects.toThrow(/does not exist/);
    fs.mkdirSync(path.dirname(stop), { recursive: true });
    fs.writeFileSync(stop, 'paused by a person\n');
    const t = new Date('2026-10-30T14:06:32Z');
    fs.utimesSync(stop, t, t);
    const r = await writeLaneStop({ ...base(), writeFile: false, commentLaneIssue: false, gh: fakeGh([]) });
    expect(fs.readFileSync(stop, 'utf8')).toBe('paused by a person\n');
    expect(r.row.stopped_at).toBe('2026-10-30T14:06:32.000Z');
  });

  it('a check on another box leaves the row alone', async () => {
    await writeLaneStop({ ...base(), gh: fakeGh([]) });
    const sent: never[] = [];
    const r = await checkStops({ registryPath: registry, now: NOW, send: fakeSend(sent), box: 'otherbox' });
    expect(r.pages).toHaveLength(0);
  });
});

describe('lane-stop: CLI and /admin/work', () => {
  it('parses label|url|note evidence', () => {
    expect(parseEvidence('Book p.3|https://x/y|invented | twice')).toEqual({ label: 'Book p.3', url: 'https://x/y', note: 'invented | twice' });
    expect(parseEvidence('contact sheets: /tmp/w/sheet-*.jpg')).toEqual({ label: 'contact sheets: /tmp/w/sheet-*.jpg', url: null, note: null });
  });

  it('the box pusher carries standing STOPs; the board lists them with the blocked work, linked to the ticket', async () => {
    await writeLaneStop({ ...base(), gh: fakeGh([]) });
    const stops = collectStops(registry);
    expect(stops).toEqual([expect.objectContaining({ lane: 'fake-lane (#1)', ticket: 9001, pages_waiting: 1350000, stop_exists: true })]);
    const doc: BoxDoc = { _id: 'work-board:hetzner', type: 'work-board', box: 'hetzner', generated_at: NOW.toISOString(), jobs: [], chains: [], stops };
    const b = buildBoard([doc], NOW);
    expect(b.dead).toHaveLength(1);
    expect(b.dead[0]).toMatchObject({ kind: 'stop', state: 'stopped', name: 'fake-lane (#1)', issue: { number: 9001 } });
    expect(b.dead[0].why).toContain('1,350,000 pages waiting');
  });
});
