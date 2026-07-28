import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h, Fragment } from 'react';
import TranslationSafe from '@/components/layout/TranslationSafe';

/**
 * TranslationSafe wraps lists React cannot reconcile while a browser
 * translator is rewriting the page (see the component, and #3314).
 *
 * SCOPE — read before trusting this file. The repo's vitest environment is
 * `node` with no jsdom or testing-library, so the REMOUNT behaviour (which
 * needs a DOM, an effect pass and a simulated translator) is NOT covered here;
 * adding a DOM test runner is a tooling change that does not belong in a bug
 * fix. What IS covered is the other half of the contract, equally easy to
 * regress and silent when it breaks:
 *
 *   the wrapper must be TRANSPARENT — no extra element, no changed markup.
 *
 * Both call sites sit inside CSS grid/flex containers (CollectionAllBooks'
 * results grid, /search's results main). Wrapping children in a <div> would
 * not throw, would pass typecheck, and would quietly break both layouts.
 * Changing Fragment to any host element fails these assertions.
 *
 * The remount half is verified post-deploy by the locale split — the es-ES
 * crash rate falling toward the en-US rate. That is stated in the PR because
 * it is the check that can actually fail.
 *
 * (No jsx here: the runner's include glob is tests/**\/*.test.ts.)
 */

describe('TranslationSafe', () => {
  it('renders children with no wrapper element', () => {
    const html = renderToStaticMarkup(
      h(TranslationSafe, { identity: 'a' }, h('span', null, 'one'), h('span', null, 'two')),
    );
    expect(html).toBe('<span>one</span><span>two</span>');
  });

  it('is byte-identical to rendering the children directly', () => {
    const kids = [h('li', { key: 1 }, 'Atalanta fugiens'), h('li', { key: 2 }, 'Utriusque Cosmi Historia')];
    const wrapped = renderToStaticMarkup(h(TranslationSafe, { identity: 'x' }, ...kids));
    const bare = renderToStaticMarkup(h(Fragment, null, ...kids));
    expect(wrapped).toBe(bare);
  });

  it('never leaks identity into the markup', () => {
    // Identity drives the remount key only. If it reached the DOM it would
    // appear in server HTML and in crawler-visible markup.
    const a = renderToStaticMarkup(h(TranslationSafe, { identity: 'sort=year' }, h('p', null, 'x')));
    const b = renderToStaticMarkup(h(TranslationSafe, { identity: 'sort=title|page=7' }, h('p', null, 'x')));
    expect(a).toBe(b);
    expect(a).not.toContain('sort');
  });
});
