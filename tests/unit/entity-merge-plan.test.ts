import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script library, no types
import { planClusterMerge, chooseSurvivor, normalizeEntityBook } from '../../scripts/lib/entity-merge-plan.mjs';
// @ts-expect-error — plain .mjs audit script, no types
import { nameKeys } from '../../scripts/audit/person-entity-name-collisions.mjs';

// #5888: merging a split person cluster must lose no book, invent no page citation, delete
// nothing — and the planner itself must write nothing (it has no database handle at all).

const book = (id: string, extra: Record<string, unknown> = {}) => ({ book_id: id, book_title: id, book_author: '', pages: [], ...extra });

const cluster = () => [
  { _id: 'a', type: 'person', name: 'Cornelius Drebbel', wikidata_id: 'Q365463', aliases: ['Cornelis Drebbel'], book_count: 2,
    books: [book('b1', { pages: [15], page_precision: 'page' }), book('b2', { page_precision: 'section', page_range: { start: 1, end: 9 } })] },
  { _id: 'b', type: 'person', name: 'Drebelius', book_count: 2, total_mentions: 3,
    books: [book('b1', { pages: [15, 16], page_precision: 'page' }), book('b3', { pages: [40, 41, 42] })] }, // b3: legacy, unmarked
  { _id: 'c', type: 'person', name: 'Cornelis Drebbel', wikidata_id: 'Q365463', viaf_id: '47116869', aliases: ['Drebbel', 'Cornelis Drebber'], book_count: 1,
    books: [book('b2', { pages: [4], page_precision: 'page' })] },
];

describe('planClusterMerge', () => {
  it('picks the record with the most distinct books; a duplicated entry does not count twice', () => {
    const docs = cluster();
    expect(chooseSurvivor(docs).name).toBe('Cornelius Drebbel'); // tie on 2 books → has a QID
    docs[1].books.push(book('b1'), book('b1'));
    expect(chooseSurvivor(docs).name).toBe('Cornelius Drebbel');
  });

  it('unions books one entry per book and recomputes the counters', () => {
    const { survivor } = planClusterMerge(cluster());
    expect(survivor.set.books.map((b: any) => b.book_id).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(survivor.set.book_count).toBe(3);
    expect(survivor.booksGained).toBe(1);
    const b1 = survivor.set.books.find((b: any) => b.book_id === 'b1');
    expect(b1.pages).toEqual([15, 16]);
    // b2: the survivor knew only a section; a loser had a verified page — the verified page wins.
    const b2 = survivor.set.books.find((b: any) => b.book_id === 'b2');
    expect(b2).toMatchObject({ pages: [4], page_precision: 'page' });
    expect(survivor.set.total_mentions).toBe(3); // 15, 16, 4 — and nothing from b3
  });

  it('never turns an unverified legacy page list into page citations', () => {
    expect(normalizeEntityBook(book('x', { pages: [40, 41, 42] }))).toMatchObject({ pages: [], page_precision: 'section', page_range: { start: 40, end: 42 } });
    const { survivor } = planClusterMerge(cluster());
    const b3 = survivor.set.books.find((b: any) => b.book_id === 'b3');
    expect(b3).toMatchObject({ pages: [], page_precision: 'section', page_range: { start: 40, end: 42 } });
  });

  it('unions names and aliases, without the survivor\'s own name', () => {
    const { survivor } = planClusterMerge(cluster());
    expect(survivor.set.aliases).toEqual(['Cornelis Drebbel', 'Drebelius', 'Drebbel', 'Cornelis Drebber']);
    expect(survivor.filled.viaf_id).toEqual({ value: '47116869', from: 'Cornelis Drebbel' });
  });

  it('keeps every loser as a redirect, with what it held recorded for undo', () => {
    const { losers } = planClusterMerge(cluster());
    expect(losers.map((l: any) => l.name)).toEqual(['Drebelius', 'Cornelis Drebbel']);
    for (const l of losers) {
      expect(l.set).toEqual({ merged_into: 'a', books: [], book_count: 0, total_mentions: 0 });
      expect(l.undo.books.length).toBeGreaterThan(0);
    }
  });

  it('plans the alias rows the index writers resolve through, and leaves a conflicting row alone', () => {
    const plan = planClusterMerge(cluster(), { aliasRows: [{ alias_lower: 'drebbel', canonical_name: 'Jacob Drebbel' }] });
    expect(plan.aliasRows.map((r: any) => r.alias_lower).sort()).toEqual(['cornelis drebbel', 'cornelis drebber', 'drebelius']);
    expect(plan.aliasRows.every((r: any) => r.canonical_name === 'Cornelius Drebbel' && r.type === 'person')).toBe(true);
    expect(plan.aliasConflicts).toEqual([{ alias_lower: 'drebbel', existing: 'Jacob Drebbel' }]);
  });

  it('refuses a cluster that cannot be one person, or is not all persons, or was merged already', () => {
    const two = cluster(); two[1].wikidata_id = 'Q1';
    expect(() => planClusterMerge(two)).toThrow(/two different Wikidata ids/);
    const place = cluster(); place[1].type = 'place';
    expect(() => planClusterMerge(place)).toThrow(/not person/);
    const done = cluster(); (done[1] as any).merged_into = 'a';
    expect(() => planClusterMerge(done)).toThrow(/already merged/);
    expect(() => planClusterMerge([cluster()[0]])).toThrow(/at least two/);
  });

  it('does not mutate the documents it was given', () => {
    const docs = cluster();
    const snapshot = JSON.stringify(docs);
    planClusterMerge(docs);
    expect(JSON.stringify(docs)).toBe(snapshot);
  });
});

describe('nameKeys (collision detector)', () => {
  it('folds case, diacritics and Latin case endings', () => {
    expect(nameKeys('Küffler')!.fold).toBe(nameKeys('KUFFLER')!.fold);
    expect(nameKeys('Drebbelius')!.latin).toBe(nameKeys('Drebbel')!.latin);
    expect(nameKeys('Cornelius Drebbelius')!.latin).toBe(nameKeys('Cornelio Drebbelio')!.latin);
    expect(nameKeys('Drebbel')!.fold).not.toBe(nameKeys('Drebel')!.fold);
  });

  it('reports what it cannot compare as unjudgeable, never as a key', () => {
    for (const name of ['', '   ', 'Dee', 'Unknown', 'Anonymous', '?', null, undefined, 42]) expect(nameKeys(name as any), String(name)).toBeNull();
  });

  it('keeps non-Latin names comparable at the fold level and never strips them to nothing', () => {
    for (const name of ['薛己', 'Πλάτων', 'أفلاطون', 'אפלטון', 'शंकर']) {
      const k = nameKeys(name)!;
      expect(k, name).not.toBeNull();
      expect(k.fold.length).toBeGreaterThan(2);
      expect(k.latin).toBeNull();
    }
    expect(nameKeys('薛己')!.fold).not.toBe(nameKeys('薛已')!.fold);
  });
});
