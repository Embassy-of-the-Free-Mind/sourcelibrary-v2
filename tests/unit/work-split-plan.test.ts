import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no type declarations
import { planSplits, identityOf } from '../../scripts/lib/work-split-plan.mjs';

// #8293: splitting an over-merged work_id. These pin the alias rule — the
// source id stays live for the stayers and must never start redirecting — and
// the refusals that keep a stale or malformed review row from writing anything.

const SRC = 'local:a:galen:de-usu-partium';
type B = { id: string; work_id: string; work_title?: string; work_slug?: string; work_id_aliases?: string[]; author?: string; author_id?: string; visible?: boolean };
const bk = (id: string, extra: Partial<B> = {}): B => ({ id, work_id: SRC, work_title: 'De usu partium', work_slug: 'galen-de-usu-partium', author: 'Galen', author_id: 'galen', visible: true, ...extra });
const none = () => ({ ids: new Set<string>([SRC]), slugs: new Set<string>(['galen-de-usu-partium']), aliases: new Set<string>() });
const row = (moves: unknown[], seen = ['b1', 'b2', 'b3']) => ({ work_id: SRC, label: 'different_work', bar: 'clear', moves, seen });

describe('planSplits', () => {
  it('moves the named books to a new minted id and leaves the source id off their aliases', () => {
    const carriers = new Map([[SRC, [bk('b1'), bk('b2'), bk('b3')]]]);
    const { clusters, refused } = planSplits([row([{ books: ['b3'], to: 'new', title: 'De sanitate tuenda' }])], carriers, none());
    expect(refused).toEqual([]);
    const [c] = clusters;
    expect(c.stays).toEqual(['b1', 'b2']);
    expect(c.moves[0].to).toBe('local:a:galen:sanitate-tuenda');
    expect(c.moves[0].to_existed).toBe(false);
    expect(c.moves[0].work_slug).toBe('galen-de-sanitate-tuenda');
    expect(c.moves[0].books[0].after.work_id_aliases).not.toContain(SRC);
  });

  it('suffixes a new id or slug that a book already carries or aliases', () => {
    const carriers = new Map([[SRC, [bk('b1'), bk('b2'), bk('b3')]]]);
    const taken = none();
    taken.aliases.add('local:a:galen:sanitate-tuenda');
    taken.slugs.add('galen-de-sanitate-tuenda');
    const { clusters } = planSplits([row([{ books: ['b3'], to: 'new', title: 'De sanitate tuenda' }])], carriers, taken);
    expect(clusters[0].moves[0].to).toBe('local:a:galen:sanitate-tuenda-2');
    expect(clusters[0].moves[0].work_slug).toBe('galen-de-sanitate-tuenda-2');
  });

  it("restores the moved books' own retired local id when only they hold it", () => {
    const OLD = 'local:a:galen:sanitate-tuenda-old';
    const carriers = new Map([[SRC, [bk('b1'), bk('b2'), bk('b3', { work_id_aliases: [OLD] })]]]);
    const taken = none(); taken.aliases.add(OLD);
    const { clusters } = planSplits([row([{ books: ['b3'], to: 'new', title: 'De sanitate tuenda' }])], carriers, taken);
    expect(clusters[0].moves[0].to).toBe(OLD);
    expect(clusters[0].moves[0].restored).toBe(OLD);
    expect(clusters[0].moves[0].books[0].after.work_id_aliases).toEqual([]);
  });

  it('keeps an alias the stayers also hold on the stayers only (and drops the stayers\' slug)', () => {
    const SHARED = 'local:n:galenus:de-usu-partium';
    const carriers = new Map([[SRC, [bk('b1', { work_id_aliases: [SHARED] }), bk('b2'), bk('b3', { work_id_aliases: [SHARED, 'galen-de-usu-partium'] })]]]);
    const { clusters } = planSplits([row([{ books: ['b3'], to: 'new', title: 'De sanitate tuenda' }])], carriers, none());
    const moved = clusters[0].moves[0].books[0];
    expect(moved.after.work_id_aliases).toEqual([]);
    expect(moved.aliases_dropped.sort()).toEqual([SHARED, 'galen-de-usu-partium'].sort());
  });

  it('joins an existing work with its title and slug, and drops that id from the aliases', () => {
    const T = 'Q12345';
    const carriers = new Map([
      [SRC, [bk('b1'), bk('b2'), bk('b3', { work_id_aliases: [T] })]],
      [T, [{ id: 't1', work_id: T, work_title: 'De sanitate tuenda', work_slug: 'galen-de-sanitate-tuenda' }]],
    ]);
    const { clusters } = planSplits([row([{ books: ['b3'], to: T, title: 'x' }])], carriers, none());
    const m = clusters[0].moves[0];
    expect([m.to, m.to_existed, m.title, m.work_slug]).toEqual([T, true, 'De sanitate tuenda', 'galen-de-sanitate-tuenda']);
    expect(m.books[0].after.work_id_aliases).toEqual([]);
  });

  it('gives an alias held by two moved groups to the larger group only', () => {
    const A = 'galen-old-fused-slug'; // an old slug: not a local id, so never restored as the new id
    const carriers = new Map([[SRC, ['b1', 'b2', 'b3', 'b4'].map((id) => bk(id, id === 'b1' ? {} : { work_id_aliases: [A] }))]]);
    const { clusters } = planSplits([row([
      { books: ['b2'], to: 'new', title: 'De sanitate tuenda' },
      { books: ['b3', 'b4'], to: 'new', title: 'De methodo medendi' },
    ], ['b1', 'b2', 'b3', 'b4'])], carriers, none());
    const [g1, g2] = clusters[0].moves;
    expect(g1.books[0].after.work_id_aliases).toEqual([]);
    expect(g2.books.map((b: { after: { work_id_aliases: string[] } }) => b.after.work_id_aliases)).toEqual([[A], [A]]);
  });

  it.each([
    ['carriers changed since review', row([{ books: ['b3'], to: 'new', title: 'x y' }], ['b1', 'b3'])],
    ['not on', row([{ books: ['zz'], to: 'new', title: 'x y' }])],
    ['moves twice', row([{ books: ['b3'], to: 'new', title: 'x y' }, { books: ['b3'], to: 'new', title: 'z w' }])],
    ['nothing keeps', row([{ books: ['b1', 'b2', 'b3'], to: 'new', title: 'x y' }])],
    ['carried by no book', row([{ books: ['b3'], to: 'Q999', title: 'x y' }])],
  ])('refuses a cluster when %s', (why, r) => {
    const carriers = new Map([[SRC, [bk('b1'), bk('b2'), bk('b3')]]]);
    const { clusters, refused } = planSplits([r], carriers, none());
    expect(clusters).toEqual([]);
    expect(refused[0].why).toContain(why);
  });

  it('refuses a target that is itself split in the same run', () => {
    const OTHER = 'local:a:galen:other';
    const carriers = new Map([[SRC, [bk('b1'), bk('b2'), bk('b3')]], [OTHER, [bk('o1', { work_id: OTHER }), bk('o2', { work_id: OTHER })]]]);
    const { refused } = planSplits([
      row([{ books: ['b3'], to: OTHER, title: 'x' }]),
      { work_id: OTHER, label: 'different_work', bar: 'clear', seen: ['o1', 'o2'], moves: [{ books: ['o2'], to: 'new', title: 'y z' }] },
    ], carriers, none());
    expect(refused.map((r: { why: string }) => r.why)).toContain(`target ${OTHER} is itself split in this run`);
  });

  it('identityOf ignores alias order but sees any slug change', () => {
    expect(identityOf(bk('b1', { work_id_aliases: ['x', 'y'] }))).toBe(identityOf(bk('b1', { work_id_aliases: ['y', 'x'] })));
    expect(identityOf(bk('b1'))).not.toBe(identityOf(bk('b1', { work_slug: 'other' })));
  });
});
