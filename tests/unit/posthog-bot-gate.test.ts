import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

/**
 * Pins the automated-browser gate in the inline `posthog-init` script
 * (src/components/providers/AnalyticsScripts.tsx).
 *
 * A headless fleet executing our reader was producing ~35K "users"/day of
 * one-hit sessions — enough that PostHog reported traffic TRIPLING over a month
 * in which real human traffic actually fell 4x (#3400). Server-side filtering
 * cannot reach it: those loads never hit /api/track, and the fleet spoofs
 * desktop Chrome, so user-agent matching is useless too.
 *
 * The gate keys on navigator.webdriver, the W3C flag every automation driver
 * sets and no ordinary browser sets. There is no DOM in the unit environment,
 * so this evaluates the REAL script (extracted from source) inside a vm against
 * minimal stubs, and asserts on whether posthog.init was actually reached.
 *
 * Deleting the gate makes the first test fail; making the gate too aggressive
 * makes the "ordinary browser" tests fail.
 */

const SRC = join(process.cwd(), 'src/components/providers/AnalyticsScripts.tsx');

function extractPosthogInit(): string {
  const src = readFileSync(SRC, 'utf8');
  const start = src.indexOf('<Script id="posthog-init"');
  if (start === -1) throw new Error('posthog-init Script block not found');
  const open = src.indexOf('{`', start);
  const close = src.indexOf('`}', open);
  if (open === -1 || close === -1) throw new Error('posthog-init template literal not found');
  return src
    .slice(open + 2, close)
    .replace(/\$\{POSTHOG_KEY\}/g, 'phc_test')
    .replace(/\$\{POSTHOG_HOST\}/g, 'https://eu.i.posthog.com');
}

/** Run the real init script with a stubbed navigator; report whether posthog.init was reached. */
function runInit(navigatorStub: Record<string, unknown>): { initCalls: number } {
  const scriptEl: Record<string, unknown> = {};
  const firstScript = { parentNode: { insertBefore: () => {} } };

  const documentStub = {
    createElement: () => scriptEl,
    getElementsByTagName: () => [firstScript],
  };

  const sandbox: Record<string, unknown> = {
    navigator: navigatorStub,
    document: documentStub,
    Math,
  };
  vm.createContext(sandbox);
  // In a browser `window` IS the global object, so the loader's
  // `window.posthog = e` also defines a bare global `posthog`. Model that
  // exactly — a plain {} stub here would make the script throw on a code path
  // that works fine in production.
  sandbox.window = sandbox;

  vm.runInContext(extractPosthogInit(), sandbox);

  const ph = (sandbox as { posthog?: { _i?: unknown[] } }).posthog;
  return { initCalls: ph?._i?.length ?? 0 };
}

const ORDINARY = { webdriver: false, languages: ['en-GB', 'en'] };

describe('posthog-init automated-browser gate', () => {
  it('does NOT initialise PostHog when navigator.webdriver is true', () => {
    expect(runInit({ ...ORDINARY, webdriver: true }).initCalls).toBe(0);
  });

  it('does NOT initialise PostHog when navigator.languages is empty (headless tell)', () => {
    expect(runInit({ ...ORDINARY, languages: [] }).initCalls).toBe(0);
  });

  it('DOES initialise PostHog for an ordinary browser', () => {
    expect(runInit(ORDINARY).initCalls).toBe(1);
  });

  it('DOES initialise when navigator.webdriver is undefined (older browsers)', () => {
    expect(runInit({ languages: ['fr'] }).initCalls).toBe(1);
  });
});
