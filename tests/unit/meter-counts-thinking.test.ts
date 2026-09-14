/**
 * Output tokens means CANDIDATES PLUS THINKING, on every path that meters.
 *
 * Gemini 3.x bills `thoughtsTokenCount` at the output rate and the SDK's
 * `UsageMetadata` type does not declare the field, so a meter that reads
 * `candidatesTokenCount` alone under-reports the bill and never errors. That is
 * how August 2026 metered $499.74 against $8,389.32 billed (#4581).
 *
 * The definition was fixed in two shared helpers, and then the same defect was
 * found again on 2026-09-14 in twenty-four call sites under `src/app` — the
 * request path, billing every day — because the standing guard walked four
 * directories and `src/app` was not one of them. A guard's coverage is the list
 * of directories it walks, and nothing announces the ones it skips.
 *
 * So this pins both halves:
 *   1. the two helper definitions agree and count thinking;
 *   2. the guard still walks every directory that can call Gemini, and finds no
 *      NEW candidates-only meter line anywhere in them.
 *
 * (2) is what catches the next `src/app`: a fresh call site that meters the
 * visible half only fails here, in unit tests, before it can bill anything.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

import { outputTokensFrom as tsOutputTokensFrom } from '@/lib/gemini-logger';
// @ts-expect-error — the worker stack's twin of the same helper, plain .mjs
import { outputTokensFrom as mjsOutputTokensFrom } from '../../scripts/workers/lib/supabase-usage-logger.mjs';

const root = path.join(__dirname, '..', '..');
const usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 300 };

describe('outputTokensFrom counts what Google bills', () => {
  it('adds thinking tokens to the visible ones', () => {
    expect(tsOutputTokensFrom(usage)).toBe(320);
    expect(mjsOutputTokensFrom(usage)).toBe(320);
  });

  it('survives a response with no usage metadata at all', () => {
    expect(tsOutputTokensFrom(undefined)).toBe(0);
    expect(mjsOutputTokensFrom(undefined)).toBe(0);
  });

  it('does not double-count when thinking is absent', () => {
    const noThoughts = { candidatesTokenCount: 20 };
    expect(tsOutputTokensFrom(noThoughts)).toBe(20);
    expect(mjsOutputTokensFrom(noThoughts)).toBe(20);
  });
});

describe('the standing guard covers every directory that can call Gemini', () => {
  const guard = path.join(root, 'scripts/audit/gemini-thinking-and-meter.mjs');

  it('walks src/app and src/workers — the two that were missing until 2026-09-14', () => {
    const src = readFileSync(guard, 'utf8');
    const dirs = src.match(/const SCAN_DIRS = \[([^\]]*)\]/)?.[1] ?? '';
    for (const d of ['src/app', 'src/workers', 'src/lib', 'scripts/workers', 'scripts/batch', 'scripts/lib']) {
      expect(dirs, `SCAN_DIRS must include ${d}`).toContain(`'${d}'`);
    }
  });

  it('reports no NEW candidates-only meter line', () => {
    // Exit 0 = clean. On failure the guard's own output names file and line,
    // which is more useful than anything this assertion could reconstruct.
    let out = '';
    let code = 0;
    try {
      out = execFileSync('node', [guard], { cwd: root, encoding: 'utf8' });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      code = e.status ?? 1;
      out = e.stdout ?? '';
    }
    expect(out, out).not.toMatch(/^METER/m);
    expect(code, out).toBe(0);
  });
});
