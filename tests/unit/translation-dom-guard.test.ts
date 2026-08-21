import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

/**
 * Pins the browser-translation crash guard shipped as an inline <head> script by
 * the root layout (see TRANSLATION_DOM_GUARD_SCRIPT in src/app/layout.tsx).
 *
 * Chrome/Edge's built-in translator replaces every text node with a nested
 * <font> pair. React keeps a reference to the original node, so its next commit
 * calls removeChild/insertBefore with a node that is no longer a child of the
 * parent React recorded — the DOM throws NotFoundError and the nearest error
 * boundary blanks the page. In the reader that reads as "turn a few pages, then
 * it breaks" (reported 2026-07-22).
 *
 * There is no DOM in the unit environment, so this evaluates the real script
 * against a minimal Node.prototype stand-in. That is enough to pin the two
 * things that matter: mismatched calls are swallowed, matching calls still run.
 */

const LAYOUT = join(process.cwd(), 'src/app/layout.tsx');

function extractGuardScript(): string {
  const src = readFileSync(LAYOUT, 'utf8');
  const m = src.match(/const TRANSLATION_DOM_GUARD_SCRIPT = `([^`]*)`/);
  if (!m) throw new Error('TRANSLATION_DOM_GUARD_SCRIPT not found in src/app/layout.tsx');
  return m[1];
}

interface FakeNode {
  parentNode: FakeNode | null;
  removeChild(child: FakeNode): FakeNode;
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode;
}

/** Evaluate the guard over a fake Node.prototype whose originals throw on mismatch, like a real DOM. */
function runGuard() {
  const calls = { remove: 0, insert: 0 };

  function NodeCtor(this: FakeNode) {}
  NodeCtor.prototype.removeChild = function (this: FakeNode, child: FakeNode) {
    if (child.parentNode !== this) throw new Error("NotFoundError: Failed to execute 'removeChild' on 'Node'");
    calls.remove++;
    child.parentNode = null;
    return child;
  };
  NodeCtor.prototype.insertBefore = function (this: FakeNode, node: FakeNode, ref: FakeNode | null) {
    if (ref && ref.parentNode !== this) throw new Error("NotFoundError: Failed to execute 'insertBefore' on 'Node'");
    calls.insert++;
    node.parentNode = this;
    return node;
  };

  const sandbox: Record<string, unknown> = { Node: NodeCtor };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractGuardScript(), sandbox);

  const make = (parent: FakeNode | null = null): FakeNode =>
    Object.assign(Object.create(NodeCtor.prototype), { parentNode: parent });

  return { make, calls, sandbox };
}

describe('translation DOM guard', () => {
  it('swallows removeChild when the translator has re-parented the node', () => {
    const { make, calls, sandbox } = runGuard();
    const parent = make();
    const orphan = make(make()); // node React thinks is ours, actually moved elsewhere

    expect(() => parent.removeChild(orphan)).not.toThrow();
    expect(parent.removeChild(orphan)).toBe(orphan);
    expect(calls.remove).toBe(0);
    expect(sandbox.__slTranslateGuardHits).toBe(2);
  });

  it('swallows insertBefore when the reference node has been re-parented', () => {
    const { make, calls, sandbox } = runGuard();
    const parent = make();
    const newNode = make();
    const staleRef = make(make());

    expect(() => parent.insertBefore(newNode, staleRef)).not.toThrow();
    expect(calls.insert).toBe(0);
    expect(sandbox.__slTranslateGuardHits).toBe(1);
  });

  it('leaves well-formed DOM calls untouched', () => {
    const { make, calls, sandbox } = runGuard();
    const parent = make();
    const child = make(parent);
    const ref = make(parent);
    const fresh = make();

    parent.insertBefore(fresh, ref);
    parent.removeChild(child);
    // insertBefore(node, null) — append — must still reach the real implementation
    parent.insertBefore(make(), null);

    expect(calls.remove).toBe(1);
    expect(calls.insert).toBe(2);
    expect(sandbox.__slTranslateGuardHits).toBe(0);
  });

  it('is shipped as an inline head script by the root layout', () => {
    const src = readFileSync(LAYOUT, 'utf8');
    expect(src).toMatch(/__html: TRANSLATION_DOM_GUARD_SCRIPT/);
  });
});
