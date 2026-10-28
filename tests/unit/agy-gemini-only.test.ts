/**
 * agy (the Gemini CLI) can also reach Claude models. Claude runs only through the Claude subscription (`claude -p`,
 * subagents), never through agy: Derek, 2026-10-14, after the #6721 dating run dated 6,452 books with claude-sonnet via agy.
 * Amended 2026-10-27 (#7545): Claude through agy once THAT account's Gemini weekly bucket reads 0, and only while its
 * Claude buckets hold 10%. Every place that launches agy must go through assertGeminiModel (scripts/lib/agy-cli.mjs).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { assertGeminiModel, agyClaudeGate, agyQuota, parseAgyQuota } from '../../scripts/lib/agy-cli.mjs';
import os from 'os';
import { spawnSync } from 'child_process';

// The shape `agy -p "/quota" --output-format json` returns (agy 1.4, 2026-10-28), trimmed.
const quotaReply = (gemini: number, claudeWeekly = 1, claude5h = 1) => JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: gemini }, { id: 'gemini-5h', window: '5h', remaining_fraction: 0.9 }] },
  { name: 'Claude and GPT models', buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: claudeWeekly }, { id: '3p-5h', window: '5h', remaining_fraction: claude5h }] },
] } } });
const gateOn = (raw: string | null) => (home: string) => agyClaudeGate(home, { quota: raw == null ? null : parseAgyQuota(raw), held: null });

describe('agy runs Gemini models only', () => {
  it('refuses a Claude model and accepts a Gemini one', () => {
    const gate = gateOn(quotaReply(0.42));
    expect(() => assertGeminiModel(['-p', 'x', '--model', 'claude-sonnet-5-5-low'], { gate })).toThrow(/Gemini models only/);
    expect(() => assertGeminiModel(['-p', 'x'], { gate })).toThrow();
    expect(() => assertGeminiModel(['-p', 'x', '--model', 'gpt-oss-120b'], { gate: gateOn(quotaReply(0)) })).toThrow();
    expect(() => assertGeminiModel(['-p', 'x', '--model', 'gemini-3.8-flash-low'], { gate })).not.toThrow();
  });

  it('allows Claude only once the Gemini weekly bucket reads 0, and only while the Claude buckets hold 10%', () => {
    const args = ['-p', 'x', '--model', 'claude-opus-5-5-low'];
    expect(() => assertGeminiModel(args, { gate: gateOn(quotaReply(0)) })).not.toThrow();
    expect(() => assertGeminiModel(args, { gate: gateOn(quotaReply(0.0001)) })).toThrow(/Gemini weekly/);
    expect(() => assertGeminiModel(args, { gate: gateOn(quotaReply(0, 0.09)) })).toThrow(/Claude weekly/);
    expect(() => assertGeminiModel(args, { gate: gateOn(quotaReply(0, 1, 0.05)) })).toThrow(/Claude h5/);
  });

  it('keeps an account held to one model (allowed-model) off Claude', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-held-'));
    fs.writeFileSync(path.join(home, 'allowed-model'), 'gemini-3.8-flash-low\n');
    expect(agyClaudeGate(home, { quota: parseAgyQuota(quotaReply(0)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/held to gemini-3\.8-flash-low/) });
    fs.rmSync(path.join(home, 'allowed-model'));
    expect(agyClaudeGate(home, { quota: parseAgyQuota(quotaReply(0)) }).ok).toBe(true);
  });

  it('fails closed when the quota cannot be read', () => {
    const args = ['-p', 'x', '--model', 'claude-opus-5-5-low'];
    expect(() => assertGeminiModel(args, { gate: gateOn(null) })).toThrow(/unreadable/);
    expect(() => assertGeminiModel(args, { gate: gateOn('not json') })).toThrow(/unreadable/);
    expect(() => assertGeminiModel(args, { gate: gateOn(JSON.stringify({ command: { data: { groups: [] } } })) })).toThrow(/unreadable/);
    // No agy on PATH and no cache: agyQuota reads nothing, and the gate says no.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-quota-'));
    const PATH = process.env.PATH;
    process.env.PATH = dir;
    try { expect(agyQuota('/nonexistent/.agy-test', { dir })).toBeNull(); } finally { process.env.PATH = PATH; }
  });

  it('reads a fresh cache file and ignores a stale one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-quota-'));
    fs.writeFileSync(path.join(dir, '.agy-cache-test.json'), quotaReply(0, 0.8, 0.7));
    expect(agyQuota('/x/.agy-cache-test', { dir })).toEqual({ gemini: { weekly: 0, h5: 0.9 }, claude: { weekly: 0.8, h5: 0.7 } });
    const PATH = process.env.PATH;
    process.env.PATH = dir;
    try { expect(agyQuota('/x/.agy-cache-test', { dir, now: Date.now() + 11 * 60_000 })).toBeNull(); } finally { process.env.PATH = PATH; }
    // A cache dated in the future is not fresh either.
    fs.writeFileSync(path.join(dir, '.agy-cache-future.json'), quotaReply(0));
    fs.utimesSync(path.join(dir, '.agy-cache-future.json'), new Date(Date.now() + 86_400_000), new Date(Date.now() + 86_400_000));
    process.env.PATH = dir;
    try { expect(agyQuota('/x/.agy-cache-future', { dir })).toBeNull(); } finally { process.env.PATH = PATH; }
  });

  it('agy-guard.sh holds the same gate for ad-hoc calls', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-guard-'));
    const fake = path.join(dir, 'agy');
    fs.writeFileSync(fake, '#!/bin/bash\nif [ "$2" = /quota ]; then cat "$FAKE_Q"; exit 0; fi\necho "RAN $*"\n', { mode: 0o755 });
    const guard = path.resolve(__dirname, '../../scripts/workers/agy-guard.sh');
    const run = (reply: string, model: string, agyHome = '') => {
      fs.rmSync(path.join(dir, 'quota'), { recursive: true, force: true });
      fs.writeFileSync(path.join(dir, 'q.json'), reply);
      return spawnSync('bash', [guard, '-p', 'hi', '--model', model], { encoding: 'utf8', env: { ...process.env, AGY_HOME: agyHome, FAKE_Q: path.join(dir, 'q.json'), AGY_REAL: fake, AGY_GUARD_DIR: path.join(dir, 'heavy'), AGY_QUOTA_CACHE: path.join(dir, 'quota') } });
    };
    const refused = run(quotaReply(0.42), 'claude-opus-5-5-low');
    expect(refused.status).toBe(75);
    expect(refused.stderr).toMatch(/refused \(config\).*Gemini weekly 42\.0% left/);
    expect(run(quotaReply(0), 'claude-opus-5-5-low').stdout).toMatch(/^RAN -p hi --model claude-opus-5-5-low/);
    expect(run(quotaReply(0, 1, 0.05), 'claude-opus-5-5-low').status).toBe(75);
    expect(run('not json', 'claude-opus-5-5-low').stderr).toMatch(/unreadable/);
    expect(run('not json', 'gemini-3.8-flash-low').stdout).toMatch(/^RAN/);
    // An account held to one model (allowed-model) runs that model only, even with its Gemini pool empty.
    const held = path.join(dir, '.agy-held');
    fs.mkdirSync(path.join(held, '.gemini/antigravity-cli'), { recursive: true });
    fs.writeFileSync(path.join(held, '.gemini/antigravity-cli/antigravity-oauth-token'), 'x');
    fs.writeFileSync(path.join(held, 'allowed-model'), 'gemini-3.8-flash-low\n');
    expect(run(quotaReply(0), 'claude-opus-5-5-low', held).stderr).toMatch(/runs gemini-3\.8-flash-low only/);
    fs.rmSync(path.join(held, 'allowed-model'));
    expect(run(quotaReply(0), 'claude-opus-5-5-low', held).stdout).toMatch(/^RAN/);
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
