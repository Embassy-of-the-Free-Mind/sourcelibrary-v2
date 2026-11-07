/**
 * A `claude -p` call with no tools says so with `--tools ''`, not `--allowedTools ''` (#8330).
 *
 * `--allowedTools ''` stops a tool running; every tool definition, skill and setting is still sent. Measured 2026-11-07
 * on a one-word prompt, Opus, empty folder: 36,630 input tokens on the laptop and about 20,600 on the main box, against
 * 2,193 and 1,787 for `--restricted --tools '' --strict-mcp-config`. Nothing fails, so the only symptom is the bill.
 * The sweep fails on a new call site.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|sh|py)$/;
// Built from parts so this file does not match itself.
const EMPTY_ALLOWED = new RegExp(['--allowedTools', `['"]?,?\\s*['"]{2}`].join(''));

export const unsealedLines = (text: string): number[] => text.split('\n').flatMap((line, i) => (EMPTY_ALLOWED.test(line) ? [i + 1] : []));

describe('unsealedLines', () => {
  it('finds the empty allow-list', () => {
    expect(unsealedLines(`execFile(CLAUDE, ['-p', '--allowed${'Tools'}', ''])`)).toEqual([1]);
  });
  it('passes a sealed call, and an allow-list that names a tool', () => {
    expect(unsealedLines(`spawn('claude', ['-p', '--restricted', '--tools', 'Read', '--allowed${'Tools'}', 'Read'])`)).toEqual([]);
  });
});

describe('claude calls with no tools', () => {
  it('none uses an empty --allowedTools', () => {
    const files = execFileSync('git', ['ls-files', 'scripts'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter((f) => CODE_EXT.test(f));
    const bad = files.flatMap((f) => { try { return unsealedLines(readFileSync(f, 'utf8')).map((n) => `${f}:${n}`); } catch { return []; } });
    expect(bad).toEqual([]);
  });
});
