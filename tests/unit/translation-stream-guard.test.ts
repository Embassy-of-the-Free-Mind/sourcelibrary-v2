import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

/**
 * Pins the SECOND half of the inline guard in src/app/layout.tsx: the wrapper
 * around React's streaming-SSR inline helpers ($RS, $RC, $RM, …).
 *
 * Diagnosed from production stacks, not guessed. Every one of 120 sampled
 * `Cannot read properties of null (reading 'parentNode')` exceptions carried
 * `$RS` in its frames, with `filename` pointing at the HTML DOCUMENT rather
 * than a JS bundle — i.e. the throw is inside React's inline bootstrap, not
 * in our client bundle.
 *
 * React's $RS replaces a streamed Suspense segment, roughly:
 *
 *     $RS = function (a, b) {
 *       a = document.getElementById(a);
 *       b = document.getElementById(b);
 *       for (a.parentNode.removeChild(a); a.firstChild; ) b.parentNode.insertBefore(a.firstChild, b);
 *       ...
 *     }
 *
 * A browser translator rewrites the DOM while the response is still
 * streaming, so the placeholder React is about to look up is gone,
 * getElementById returns null, and `a.parentNode` throws — blanking the page
 * at the nearest error boundary. Collection pages stream several Suspense
 * boundaries each, which is why they crashed at roughly one per pageview
 * while the reader did not.
 *
 * The DOM-guard half (removeChild/insertBefore) cannot help here: nothing is
 * being called on a Node, a property is being read off null. Hence a separate
 * mechanism, and a separate test.
 *
 * Evaluated against the REAL script extracted from layout.tsx.
 */

const LAYOUT = join(process.cwd(), 'src/app/layout.tsx');

function extractGuardScript(): string {
  const src = readFileSync(LAYOUT, 'utf8');
  const m = src.match(/const TRANSLATION_DOM_GUARD_SCRIPT = `([^`]*)`/);
  if (!m) throw new Error('TRANSLATION_DOM_GUARD_SCRIPT not found in src/app/layout.tsx');
  return m[1];
}

/** Run the guard in a sandbox whose global doubles as `window`, as in a browser. */
function runGuard(): Record<string, unknown> {
  const sandbox: Record<string, unknown> = { Object, document: { getElementById: () => null } };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  // Node.prototype patching is exercised by translation-dom-guard.test.ts; here
  // the first IIFE simply returns early because there is no Node in scope.
  vm.runInContext(extractGuardScript(), sandbox);
  return sandbox;
}

describe('streaming-SSR guard ($RS and friends)', () => {
  it('swallows the null-placeholder throw instead of letting it blank the page', () => {
    const w = runGuard();
    // Assign exactly what React's inline bootstrap assigns.
    (w as { $RS: unknown }).$RS = function (a: string) {
      const el = (w.document as { getElementById: (id: string) => null }).getElementById(a);
      // Reproduces the production failure: getElementById returned null.
      return (el as unknown as { parentNode: unknown }).parentNode;
    };

    const call = () => (w as { $RS: (a: string, b: string) => void }).$RS('S:0', 'P:0');
    expect(call).not.toThrow();
    expect(w.__slStreamGuardHits).toBe(1);
  });

  it('does not disturb a call that succeeds', () => {
    const w = runGuard();
    let ran = 0;
    (w as { $RC: unknown }).$RC = function (a: number, b: number) { ran++; return a + b; };
    const out = (w as { $RC: (a: number, b: number) => number }).$RC(2, 3);
    expect(out).toBe(5);
    expect(ran).toBe(1);
    expect(w.__slStreamGuardHits).toBe(0);
  });

  it('wraps every helper React may define', () => {
    const w = runGuard();
    for (const k of ['$RS', '$RC', '$RM', '$RX', '$RB', '$RT']) {
      (w as Record<string, unknown>)[k] = () => { throw new Error('boom'); };
      expect(() => (w as Record<string, () => void>)[k]()).not.toThrow();
    }
    expect(w.__slStreamGuardHits).toBe(6);
  });

  it('leaves non-function assignments alone', () => {
    const w = runGuard();
    (w as Record<string, unknown>).$RM = 'not-a-function';
    expect((w as Record<string, unknown>).$RM).toBe('not-a-function');
  });
});
