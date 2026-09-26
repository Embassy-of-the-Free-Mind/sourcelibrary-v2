/**
 * The idle rule that lets the GPU lease watchdog power off a rented GPU inside a live lease
 * (scripts/lib/gpu-idle.mjs). Why: September 2026's Scaleway GPUs billed ~12x their busy-rate
 * cost, mostly idle time a lease could not see.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
// @ts-expect-error — plain .mjs module without type declarations
import { idleDecision, parseProgressTag } from '../../scripts/lib/gpu-idle.mjs';

const now = new Date('2026-09-26T12:00:00Z');
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);

describe('idleDecision', () => {
  it('keeps a box in its start-up grace even with no output', () => {
    expect(idleDecision({ now, runningSince: minsAgo(10), lastOutputAt: null }).action).toBe('keep');
  });
  it('keeps a box that wrote output recently', () => {
    expect(idleDecision({ now, runningSince: minsAgo(300), lastOutputAt: minsAgo(5) }).action).toBe('keep');
  });
  it('stops a box whose output stopped longer ago than the idle window', () => {
    const d = idleDecision({ now, runningSince: minsAgo(300), lastOutputAt: minsAgo(45) });
    expect(d.action).toBe('stop');
  });
  it('gives a box that just left grace a full window to produce its first page', () => {
    expect(idleDecision({ now, runningSince: minsAgo(25), lastOutputAt: null }).action).toBe('keep');
    expect(idleDecision({ now, runningSince: minsAgo(60), lastOutputAt: null }).action).toBe('stop');
  });
  it('honours overrides', () => {
    expect(idleDecision({ now, runningSince: minsAgo(300), lastOutputAt: minsAgo(45), idleMinutes: 60 }).action).toBe('keep');
  });
});

describe('parseProgressTag', () => {
  it('reads mongo:<ocr.source>', () => {
    expect(parseProgressTag('mongo:bdrc')).toEqual({ kind: 'mongo', source: 'bdrc' });
  });
  it('flags anything else instead of guessing', () => {
    expect(parseProgressTag('r2:txt/')?.kind).toBe('invalid');
    expect(parseProgressTag(undefined)).toBeNull();
  });
});

describe('the on-box watcher script', () => {
  it('parses as bash', () => {
    expect(() => execSync('bash -n scripts/gpu/idle-poweroff.sh')).not.toThrow();
  });
});
