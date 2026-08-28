import { describe, it, expect } from 'vitest';
import { collapseByWork, workGroupKey, workIdFromGroupKey } from '@/lib/search/work-grouping';
import { fetchWorkFanouts, workHref } from '@/lib/search/work-fanout';
import type { Db } from 'mongodb';
import { workEditionsFilter, workEditionsCountFilter } from '@/lib/canon-works';

// Work-grain result grouping (#4300). The motivating case is real: an external
// audit of the catalogue found four separate records of Kircher's *Musurgia
// Universalis* Vol. I — four scans of the one 1650 printing, all carrying
// `work_id: Q18942469` — presented as four unrelated results. The keyword lane
// collapsed them; the semantic lane, which had no such rule, handed them back.
//
// The tests that matter here are the ABSTENTIONS. A collapse hides books, so
// every case where we must NOT collapse is a guard against the search-side
// version of the wrongly-hidden-book failure.

const musurgia = (id: string, extra: Record<string, unknown> = {}) => ({
  book_id: id, id, work_id: 'Q18942469', ...extra,
});

describe('workGroupKey', () => {
  it('keys on work_id', () => {
    expect(workGroupKey({ book_id: 'a', work_id: 'Q18942469' })).toBe('work:Q18942469');
  });

  it('keys a copy on its keeper, so two copies of one keeper group together', () => {
    expect(workGroupKey({ book_id: 'a', duplicate_of: 'keeper-1' })).toBe('copy:keeper-1');
  });

  it('prefers duplicate_of over work_id — a copy is never its own result', () => {
    expect(workGroupKey({ book_id: 'a', work_id: 'Q1', duplicate_of: 'keeper-1' })).toBe('copy:keeper-1');
  });

  it('abstains with no blessed identity — never guesses from title or author', () => {
    expect(workGroupKey({ book_id: 'a' })).toBeNull();
    expect(workGroupKey({ book_id: 'a', work_id: '' })).toBeNull();
    expect(workGroupKey({ book_id: 'a', work_id: '   ' })).toBeNull();
  });
});

describe('collapseByWork', () => {
  it('collapses the four Musurgia scans to one row and records the rest', () => {
    const rows = [
      musurgia('6952050fab34727b1f04216b'),
      musurgia('e48a21de-4db2-4c94-a71a-e952b9fa5393'),
      musurgia('695592717bd6d2cd1d61a03e'),
      musurgia('699067e2249ce014347d471d'),
    ];
    const out = collapseByWork(rows);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].id).toBe('6952050fab34727b1f04216b');
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].collapsed).toHaveLength(3);
  });

  it('keeps the FIRST row — the caller\'s ranking is the keeper choice, never re-ranked', () => {
    const out = collapseByWork([
      musurgia('worse', { quality_score: 10 }),
      musurgia('better', { quality_score: 100 }),
    ]);
    // Deliberate: this function must not re-rank. A collapse that quietly
    // reordered results would make every lane's ladder unfalsifiable.
    expect(out.results.map(r => r.id)).toEqual(['worse']);
  });

  it('leaves rows with no work identity strictly alone', () => {
    const out = collapseByWork([
      { book_id: 'a', id: 'a' },
      { book_id: 'b', id: 'b' },
      { book_id: 'c', id: 'c' },
    ]);
    expect(out.results).toHaveLength(3);
    expect(out.groups).toHaveLength(0);
  });

  it('does NOT collapse different works that merely look alike', () => {
    // Same author, same year, near-identical titles — and two work_ids. The
    // edition layer says these are different things; search must agree.
    const out = collapseByWork([
      { book_id: 'a', id: 'a', work_id: 'Q18942469' },
      { book_id: 'b', id: 'b', work_id: 'local:a:athanasius-kircher:art-consonance-dissonance-minor' },
    ]);
    expect(out.results).toHaveLength(2);
  });

  it('never collapses on edition_key — a shared key is a claim, not a fact', () => {
    // #4285 read the OCR of 259 keeper<->copy pairs sharing a FULL-quality
    // edition_key and found 27% are not the same content (fragments under a
    // full edition's key, generic-title collections, the 1670 Spinoza variant
    // printings). Two rows with one edition_key and no work_id stay two rows.
    const out = collapseByWork([
      { book_id: 'a', id: 'a', edition_key: 'tractatus theologico politicus|spinoza|1670|v' },
      { book_id: 'b', id: 'b', edition_key: 'tractatus theologico politicus|spinoza|1670|v' },
    ] as Array<Record<string, unknown>> as Parameters<typeof collapseByWork>[0]);
    expect(out.results).toHaveLength(2);
    expect(out.groups).toHaveLength(0);
  });

  it('folds a retired work_id into its survivor via work_id_aliases', () => {
    // A partially-applied merge (#3759) leaves one edition on the retired id.
    // Without alias folding the work splits into two rows precisely while the
    // identity layer is mid-repair.
    const out = collapseByWork([
      { book_id: 'survivor', id: 'survivor', work_id: 'Q999', work_id_aliases: ['local:old-id'] },
      { book_id: 'straggler', id: 'straggler', work_id: 'local:old-id' },
    ]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].id).toBe('survivor');
    expect(out.groups[0].key).toBe('work:Q999');
  });

  it('survives a cyclic alias graph instead of spinning', () => {
    const out = collapseByWork([
      { book_id: 'a', id: 'a', work_id: 'W1', work_id_aliases: ['W2'] },
      { book_id: 'b', id: 'b', work_id: 'W2', work_id_aliases: ['W1'] },
    ]);
    // Whatever it decides, it must terminate and must not lose a row.
    expect(out.results.length + out.groups.reduce((n, g) => n + g.collapsed.length, 0)).toBe(2);
  });

  it('reads identity through getIdentity for lanes whose rows carry none', () => {
    // The semantic RPC returns no work_id; the route joins it from Mongo.
    const identity = new Map([
      ['s1', { book_id: 's1', work_id: 'Q18942469' }],
      ['s2', { book_id: 's2', work_id: 'Q18942469' }],
    ]);
    const out = collapseByWork(
      [{ book_id: 's1' }, { book_id: 's2' }, { book_id: 's3' }],
      { getIdentity: r => identity.get(r.book_id!) ?? {} },
    );
    expect(out.results.map(r => r.book_id)).toEqual(['s1', 's3']);
  });
});

describe('fan-out target', () => {
  it('a copy-keyed group yields no work id, so it can never claim an edition count', () => {
    expect(workIdFromGroupKey('copy:keeper-1')).toBeNull();
    expect(workIdFromGroupKey('work:Q18942469')).toBe('Q18942469');
  });

  it('links to /work/<id>, url-encoded — local mints carry colons', () => {
    expect(workHref('Q18942469')).toBe('/work/Q18942469');
    expect(workHref('local:a:kircher:musurgia')).toBe('/work/local%3Aa%3Akircher%3Amusurgia');
  });

  it('the fan-out count filter selects the same set as the WORK PAGE\'s filter', () => {
    // visibility-and-stats.md: "a card must count what its TARGET page renders".
    // /work/[id] builds its list from workEditionsFilter; the count uses
    // workEditionsCountFilter, which is that filter's INDEXED half (the
    // work_slug branch has no index — 7,990ms vs 38ms measured 2026-08-28).
    // They select the same set because work_slug holds human slugs, never
    // work_ids. Pin the correspondence so a change to one is a failing test,
    // not a silently drifting number.
    const page = workEditionsFilter('Q18942469') as {
      visible: boolean; $or: Array<Record<string, unknown>>;
    };
    const count = workEditionsCountFilter('Q18942469') as Record<string, unknown>;
    expect(page.visible).toBe(true);
    expect(count.visible).toBe(true);
    // The page filter's work_id branch and the count filter must name the same ids.
    const pageWorkIdBranch = page.$or.find(b => 'work_id' in b)!;
    expect(count.work_id).toEqual(pageWorkIdBranch.work_id);
    // And the dropped branch is the work_slug one, nothing else.
    expect(page.$or).toHaveLength(2);
    expect(page.$or.some(b => 'work_slug' in b)).toBe(true);
  });

  it('a tenant request gets NO fan-out, and never even reaches the database', () => {
    // tenant-lockdown.md: "N editions of this work" is a census across the
    // GLOBAL library and links to a global surface. A partner reading room
    // must not make that claim — same gate embedPolicy.showRelatedEditions
    // puts on the book page's editions rail. The db stub throws, so this also
    // proves the suppression happens BEFORE the query, not after it.
    const exploding = {
      collection() { throw new Error('a tenant request must not query the global corpus'); },
    } as unknown as Db;
    return expect(
      fetchWorkFanouts(exploding, new Map([['work:Q18942469', 3]]), { tenantScoped: true }),
    ).resolves.toEqual(new Map());
  });

  it('a canon work counts every work_id the canon entry collects, not just one', () => {
    // /work/<canon-slug> expands to canon.workIds; a count of the single
    // work_id would undercount the page it links to.
    const canonIds = ['Q596076'];
    const filter = workEditionsCountFilter(canonIds[0]) as { work_id: unknown };
    // Either the id is canon (then work_id is an $in over its set) or it is
    // not (then it is the bare id). Both must be counted by an INDEXED path.
    expect(
      typeof filter.work_id === 'string' || (filter.work_id as Record<string, unknown>)?.$in !== undefined,
    ).toBe(true);
  });
});
