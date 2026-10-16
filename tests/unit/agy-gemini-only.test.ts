/**
 * agy (the Gemini CLI) can also reach Claude models. Claude runs only through the Claude subscription (`claude -p`,
 * subagents), never through agy: Derek, 2026-10-14, after the #6721 dating run dated 6,452 books with claude-sonnet via agy.
 * Every place that launches agy must refuse a non-Gemini --model (assertGeminiModel in scripts/lib/agy-cli.mjs).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { assertGeminiModel } from '../../scripts/lib/agy-cli.mjs';

describe('agy runs Gemini models only', () => {
  it('refuses a Claude model and accepts a Gemini one', () => {
    expect(() => assertGeminiModel(['-p', 'x', '--model', 'claude-sonnet-5-5-low'])).toThrow(/Gemini models only/);
    expect(() => assertGeminiModel(['-p', 'x'])).toThrow();
    expect(() => assertGeminiModel(['-p', 'x', '--model', 'gemini-3.8-flash-low'])).not.toThrow();
  });

  it('every script that spawns agy goes through the guard', () => {
    const root = path.resolve(__dirname, '../..');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'results' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (/\.(mjs|js|ts|py)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const spawnsAgy = /spawn\(\s*['"]agy['"]|\[\s*['"]agy['"]\s*,\s*['"]-p['"]/;
    const offenders = walk(path.join(root, 'scripts'))
      .filter((f) => spawnsAgy.test(fs.readFileSync(f, 'utf8')))
      .filter((f) => !/assertGeminiModel|startswith\('gemini-'\)/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
