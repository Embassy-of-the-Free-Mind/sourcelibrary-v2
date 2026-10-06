/**
 * Moving mentions off a bare-surname record (#5950): the pure half of `--apply`.
 *
 * What these pin: a moved page leaves the bare record and reaches exactly one person; pages the
 * plan did not decide stay; nothing unverified is ever marked as a verified page on the target.
 */
import { describe, it, expect } from 'vitest';

import { applyPlanToBooks, decidePage, SURNAMES, fold } from '../../scripts/audit/shared-surname-reattribution-plan.mjs';
import { entityCounters } from '../../scripts/lib/entity-page-match.mjs';

const entry = (book_id: string, pages: number[], extra: Record<string, unknown> = {}) => ({
  book_id, book_title: `Title ${book_id}`, book_author: 'Someone', book_year: 1700, pages, page_precision: 'page', ...extra,
});
const row = (book_id: string, page: number | null, person: string | null, tier = 'printed') => ({ book_id, page, person, tier });

describe('applyPlanToBooks', () => {
  it('splits one book between two people and keeps the undecided page on the bare record', () => {
    const out = applyPlanToBooks({
      bareBooks: [entry('b1', [3, 7, 9])],
      targetBooks: { roger: [], francis: [] },
      rows: [row('b1', 3, 'roger'), row('b1', 7, 'francis', 'note'), row('b1', 9, null, 'no-evidence')],
    });
    expect(out.bare).toEqual([entry('b1', [9])]);
    expect(out.targets.roger).toEqual([entry('b1', [3])]);
    expect(out.targets.francis).toEqual([entry('b1', [7])]);
    expect(out.moves.map(m => [m.person, m.pages, m.tiers])).toEqual([['roger', [3], ['printed']], ['francis', [7], ['note']]]);
  });

  it('drops the bare entry when every page moved, and unions pages into a page-precise target entry', () => {
    const out = applyPlanToBooks({
      bareBooks: [entry('b1', [12, 4]), entry('b2', [1])],
      targetBooks: { roger: [entry('b1', [4, 30]), entry('b9', [2])], francis: [] },
      rows: [row('b1', 12, 'roger'), row('b1', 4, 'roger', 'same-book')],
    });
    expect(out.bare).toEqual([entry('b2', [1])]);
    expect(out.targets.roger).toEqual([entry('b1', [4, 12, 30]), entry('b9', [2])]);
    // Every mention is still counted once: 3 before on the bare record + 3 on Roger, 1 shared page.
    expect(entityCounters(out.bare).total_mentions + entityCounters(out.targets.roger).total_mentions).toBe(1 + 4);
  });

  it('replaces a section range on the target with the verified pages', () => {
    const section = { book_id: 'b1', book_title: 'T', book_author: 'A', pages: [], page_precision: 'section', page_range: { start: 1, end: 50 } };
    const out = applyPlanToBooks({
      bareBooks: [entry('b1', [8])], targetBooks: { roger: [section], francis: [] }, rows: [row('b1', 8, 'roger', 'same-book')],
    });
    expect(out.targets.roger).toEqual([{ book_id: 'b1', book_title: 'T', book_author: 'A', pages: [8], page_precision: 'page' }]);
  });

  it('moves a section-precision entry whole, and adds nothing where the person already has the book', () => {
    const sec = (id: string) => ({ book_id: id, book_title: 'T', book_author: 'A', pages: [], page_precision: 'section', page_range: { start: 1, end: 9 } });
    const out = applyPlanToBooks({
      bareBooks: [sec('b1'), sec('b2')],
      targetBooks: { roger: [entry('b1', [5])], francis: [] },
      rows: [row('b1', null, 'roger', 'same-book'), row('b2', null, 'francis', 'same-book')],
    });
    expect(out.bare).toEqual([]);
    expect(out.targets.roger).toEqual([entry('b1', [5])]);
    expect(out.targets.francis).toEqual([sec('b2')]);
  });

  it('refuses to merge into an unmarked legacy entry: its pages were never verified', () => {
    const legacy = { book_id: 'b1', book_title: 'T', book_author: 'A', pages: [1, 2, 3, 4] };
    expect(() => applyPlanToBooks({
      bareBooks: [entry('b1', [2])], targetBooks: { roger: [legacy], francis: [] }, rows: [row('b1', 2, 'roger')],
    })).toThrow(/unmarked legacy entry/);
  });

  it('ignores a planned page the bare entry no longer claims, and refuses a duplicated bare book', () => {
    const out = applyPlanToBooks({
      bareBooks: [entry('b1', [2])], targetBooks: { roger: [], francis: [] }, rows: [row('b1', 99, 'roger')],
    });
    expect(out.bare).toEqual([entry('b1', [2])]);
    expect(out.targets.roger).toEqual([]);
    expect(out.moves).toEqual([]);
    expect(() => applyPlanToBooks({
      bareBooks: [entry('b1', [2]), entry('b1', [3])], targetBooks: { roger: [], francis: [] }, rows: [],
    })).toThrow(/twice/);
  });

  it('does not change its inputs', () => {
    const bareBooks = [entry('b1', [3, 7])];
    const roger = [entry('b1', [1])];
    const before = JSON.stringify({ bareBooks, roger });
    applyPlanToBooks({ bareBooks, targetBooks: { roger, francis: [] }, rows: [row('b1', 3, 'roger')] });
    expect(JSON.stringify({ bareBooks, roger })).toBe(before);
  });
});

describe('decidePage (Bacon)', () => {
  const rule = SURNAMES.Bacon;
  it('a printed cue decides; a date alone only excludes', () => {
    expect(decidePage(rule, { printed: fold('as Rogerius Bacon saith'), editorial: '', bookYear: 1650, sameBook: [] })).toEqual({ person: 'roger', tier: 'printed' });
    expect(decidePage(rule, { printed: fold('Bacon, serjeant'), editorial: '', bookYear: 1329, sameBook: [] }).tier).toBe('date');
    expect(decidePage(rule, { printed: fold('Bacon'), editorial: '', bookYear: 1700, sameBook: ['roger', 'francis'] }).person).toBeNull();
  });
});
