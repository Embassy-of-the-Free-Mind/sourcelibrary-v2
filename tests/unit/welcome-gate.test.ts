import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldFireWelcomeGate, isApexHost } from '../../src/lib/welcome-gate';

const base = {
  status: 'authenticated',
  needsWelcome: true,
  pathname: '/collections',
  hostname: 'sourcelibrary.org',
  alreadyFired: false,
};

describe('shouldFireWelcomeGate', () => {
  it('interrupts a gated reader on an ordinary page', () => {
    expect(shouldFireWelcomeGate(base)).toBe(true);
  });

  // The lockout. A reader saves the form, the session's needsWelcome flag stays
  // stale-true, they land back on their page — and before this rule the gate sent
  // them to /welcome again, forever, on every page.
  it('never interrupts twice, even while needsWelcome is still true', () => {
    expect(shouldFireWelcomeGate({ ...base, alreadyFired: true })).toBe(false);
  });

  it('does not interrupt a reader who has already been welcomed', () => {
    expect(shouldFireWelcomeGate({ ...base, needsWelcome: false })).toBe(false);
  });

  it('does not interrupt an unauthenticated visitor', () => {
    expect(shouldFireWelcomeGate({ ...base, status: 'loading' })).toBe(false);
    expect(shouldFireWelcomeGate({ ...base, status: 'unauthenticated' })).toBe(false);
  });

  it('does not interrupt the welcome page itself (that would be its own loop)', () => {
    expect(shouldFireWelcomeGate({ ...base, pathname: '/welcome' })).toBe(false);
    expect(shouldFireWelcomeGate({ ...base, pathname: '/welcome?from=%2F' })).toBe(false);
  });

  it('stays out of the auth flow, the API, admin, and embed surfaces', () => {
    for (const pathname of ['/auth/signin', '/api/me/welcome', '/admin/users', '/embed/bph']) {
      expect(shouldFireWelcomeGate({ ...base, pathname })).toBe(false);
    }
  });

  it('never fires on a tenant subdomain', () => {
    expect(shouldFireWelcomeGate({ ...base, hostname: 'bph.sourcelibrary.org' })).toBe(false);
    expect(isApexHost('bph.sourcelibrary.org')).toBe(false);
    expect(isApexHost('sourcelibrary.org')).toBe(true);
    expect(isApexHost('www.sourcelibrary.org')).toBe(true);
  });

  it('tolerates a null pathname', () => {
    expect(shouldFireWelcomeGate({ ...base, pathname: null })).toBe(false);
  });
});

describe('WelcomeForm session refresh', () => {
  // A source assertion, deliberately, and only because deletion IS the failure
  // mode here (see the "a test that greps source is not a guard" rule in
  // CLAUDE.md). next-auth's update() sends a GET when called with no argument —
  // lib/client.js only sets method:'POST' when a body is present — and a GET does
  // not run the jwt callback with trigger:'update', so the token keeps
  // needsWelcome:true and the reader is bounced back to the form. The behavioural
  // consequence is covered above; this pins the one-character regression that
  // reintroduces it, which no test in a node environment can otherwise reach.
  it('calls update() with a payload so the token is actually re-minted', () => {
    const src = readFileSync(
      join(__dirname, '../../src/components/welcome/WelcomeForm.tsx'),
      'utf8'
    );
    expect(src).toContain('update({ welcomed: true })');
    // The prose above this call mentions `update()` by name, so match the call
    // site rather than the bare token.
    expect(src).not.toMatch(/await\s+update\(\s*\)/);
  });
});
