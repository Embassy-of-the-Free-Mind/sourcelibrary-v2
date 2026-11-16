// agy-guard.sh keeps each agy login's last good token and puts it back when a refresh race leaves the file as
// {"token":null} (v3 #69). Runs the real script with a stub CLI on a non-print call, so no /proc is needed.
// PRIOR ART: tests/unit/agy-guard-box-slots.test.ts — same shape (real script, stub CLI) for the box-wide slots.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/agy-guard.sh');
const GOOD = JSON.stringify({ auth_method: 'consumer', id_token_email: 'x@example.com', token: { access_token: 'a'.repeat(80), refresh_token: 'r'.repeat(80), expiry: '2026-11-13T09:05:10Z' } });
const NULL = '{"token":null}';

const setup = (env: NodeJS.ProcessEnv = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agykeep-'));
  const real = path.join(root, 'agy-stub');
  fs.writeFileSync(real, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const dir = path.join(root, '.gemini/antigravity-cli');
  fs.mkdirSync(dir, { recursive: true });
  const tok = path.join(dir, 'antigravity-oauth-token');
  const run = (more: NodeJS.ProcessEnv = {}) => spawnSync('bash', [SCRIPT, '--version'], { encoding: 'utf8',
    env: { ...process.env, HOME: root, AGY_HOME: '', AGY_REAL: real, AGY_GUARD_DIR: path.join(root, 'q/heavy'), ...env, ...more } });
  const log = () => { const f = path.join(root, 'q/token-keeper.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
  return { root, tok, run, log };
};

describe('agy-guard keeps the login (v3 #69)', () => {
  it('copies a good token aside, then restores it over a null one', () => {
    const { tok, run, log } = setup();
    fs.writeFileSync(tok, GOOD);
    expect(run().status).toBe(0);
    expect(fs.readFileSync(`${tok}.good`, 'utf8')).toBe(GOOD);
    expect((fs.statSync(`${tok}.good`).mode & 0o077)).toBe(0);   // a credential: owner-only

    fs.writeFileSync(tok, NULL);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/restored its last good token/);
    expect(fs.readFileSync(tok, 'utf8')).toBe(GOOD);
    expect(fs.readFileSync(`${tok}.lost`, 'utf8')).toBe(NULL);
    expect(log()).toMatch(/default restored the last good token over a 14-byte file/);
  });

  it('restores at most once per window, so a revoked login still reaches the page', () => {
    const { tok, run } = setup();
    fs.writeFileSync(tok, GOOD); run();
    fs.writeFileSync(tok, NULL); run();
    fs.writeFileSync(tok, NULL);
    expect(run().stderr).not.toMatch(/restored/);
    expect(fs.readFileSync(tok, 'utf8')).toBe(NULL);
    const old = new Date(Date.now() - 11 * 60e3);
    fs.utimesSync(`${tok}.restored`, old, old);   // the 10-minute window is over
    expect(run().stderr).toMatch(/restored/);
  });

  it('never saves a null or truncated file as the good copy', () => {
    const { tok, run } = setup();
    fs.writeFileSync(tok, NULL); run();
    expect(fs.existsSync(`${tok}.good`)).toBe(false);
    fs.writeFileSync(tok, GOOD.slice(0, 200)); run();   // a write caught half done
    expect(fs.existsSync(`${tok}.good`)).toBe(false);
    expect(fs.readFileSync(tok, 'utf8')).toBe(GOOD.slice(0, 200));   // nothing to restore from: left alone
    fs.writeFileSync(tok, GOOD.slice(0, GOOD.indexOf('}') + 1)); run();   // cut off right after the inner "}"
    expect(fs.existsSync(`${tok}.good`)).toBe(false);
  });

  it('keeps a second login under AGY_HOME and names it', () => {
    const { root, run, log } = setup();
    const home = path.join(root, '.agy-james');
    const tok = path.join(home, '.gemini/antigravity-cli/antigravity-oauth-token');
    fs.mkdirSync(path.dirname(tok), { recursive: true });
    fs.writeFileSync(tok, GOOD); run({ AGY_HOME: home });
    fs.writeFileSync(tok, NULL); run({ AGY_HOME: home });
    expect(fs.readFileSync(tok, 'utf8')).toBe(GOOD);
    expect(log()).toMatch(/\.agy-james restored/);
  });

  it('AGY_TOKEN_KEEP=0 turns it off', () => {
    const { tok, run } = setup();
    fs.writeFileSync(tok, GOOD); run({ AGY_TOKEN_KEEP: '0' });
    expect(fs.existsSync(`${tok}.good`)).toBe(false);
  });
});
