/**
 * #4848: the enrich worker's collection tagger (Phase 7.6) must leave a curated collection
 * alone when it says so, and name the memberships it creates.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { autoAssignTargets, addedSlugs, isClosedToAutoAssign } from '../../scripts/lib/collection-auto-assign.mjs';

describe('autoAssignTargets', () => {
  it('closes only collections that say auto_assign: false', () => {
    const { open, closed } = autoAssignTargets([
      { slug: 'alchemy' },
      { slug: 'forum-of-conscience', auto_assign: false },
      { slug: 'medicine', auto_assign: true },
      { slug: 'odd', auto_assign: 'false' }, // only the boolean closes; a string is a typo, not a decision
    ]);
    expect(open.map((c: any) => c.slug)).toEqual(['alchemy', 'medicine', 'odd']);
    expect(closed).toEqual(['forum-of-conscience']);
  });
  it('an absent flag leaves behaviour unchanged', () => {
    expect(isClosedToAutoAssign({ slug: 'x' })).toBe(false);
    expect(isClosedToAutoAssign(null)).toBe(false);
  });
});

describe('addedSlugs', () => {
  it('names only memberships the pass creates, not ones a curator already gave', () => {
    expect(addedSlugs(['alchemy'], ['alchemy', 'medicine', 'medicine'])).toEqual(['medicine']);
    expect(addedSlugs(undefined, ['alchemy'])).toEqual(['alchemy']);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/workers/enrich-worker.mjs'), 'utf8');
  it('Phase 7.6 builds its prompt and validSlugs from the open collections only', () => {
    expect(src).toMatch(/const \{ open, closed \} = autoAssignTargets\(collections\)/);
    expect(src).toMatch(/collections = open\s*\n\s*\.map/);
  });
  it('Phase 7.6 records the memberships it added and reads the book\'s current collections', () => {
    expect(src).toMatch(/added: addedSlugs\(book\.collections, slugs\)/);
    expect(src).toMatch(/collections: 1, collection_scores: 1/);
  });
});
