/**
 * No script may run an agent CLI with tool permissions auto-approved.
 *
 * The Gemini subscription CLI (`agy`) and Claude Code are AGENTS: asked to read a page, the model
 * may decide to run a shell command instead. On 2026-10-08 `scripts/batch/cli-ocr.mjs` and
 * `cli-translate.mjs` passed the auto-approve flag, the jobs ran as root on the Hetzner box, the
 * CLI logged 305 auto-approved sessions, and the model wrote its own crop images to /tmp while
 * reading a Chinese page. Nothing bad happened; nothing was checking either. It also made the
 * reads agentic (several steps, tools), so they were not comparable to a single model call.
 *
 * The safe shape is `--mode plan` (no tools) with the image attached as `@./file`. This test
 * sweeps tracked code for the flags; it fails on a new call site, not just on these two.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

// Built from parts so this file does not match itself.
const FLAGS = [['--dangerously', 'skip', 'permissions'].join('-'), ['--allow', 'dangerously', 'skip', 'permissions'].join('-')];
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|sh|py|ya?ml)$/;
const ROOTS = /^(scripts|src|\.github|infrastructure)\//;

export function autoApproveLines(text: string): number[] {
  return text.split('\n').flatMap((line, i) => (FLAGS.some(f => line.includes(f)) ? [i + 1] : []));
}

describe('autoApproveLines', () => {
  it('finds the flag in an argument list', () => {
    expect(autoApproveLines(`spawnSync(CLI, ['-p', x, '${FLAGS[0]}'])`)).toEqual([1]);
  });
  it('does not flag plan mode', () => {
    expect(autoApproveLines("spawnSync(CLI, ['-p', x, '--mode', 'plan'])")).toEqual([]);
  });
});

describe('tracked code', () => {
  it('never auto-approves an agent CLI\'s tool permissions', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(f => ROOTS.test(f) && CODE_EXT.test(f));
    const hits: string[] = [];
    for (const f of files) {
      let text: string;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      for (const n of autoApproveLines(text)) hits.push(`${f}:${n}`);
    }
    expect(hits, 'use `--mode plan` and attach files with `@./file` instead').toEqual([]);
  });
});
