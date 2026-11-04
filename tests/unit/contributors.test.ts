/**
 * `books.contributors[]` (#7787): the splitter, the given-name guard, drift,
 * and the writer's refusals. Every case is a real string from the corpus or
 * a wrong-person match the first dry runs produced.
 */
import { describe, it, expect, vi } from 'vitest';
import { contributorsDrift, givenNameConflict, writeContributors } from '../../scripts/lib/contributors.mjs';
import { splitContributors } from '../../scripts/lib/variant-shape.mjs';

describe('splitContributors', () => {
  it('a trailing bracketed role after "&" covers every name', () => {
    expect(splitContributors('Philip Schaff & Henry Wace (eds.)')).toEqual([
      { name: 'Philip Schaff', role: 'edt' }, { name: 'Henry Wace', role: 'edt' },
    ]);
  });

  it('after ";" each part keeps its own role', () => {
    expect(splitContributors('Euclid; T.L. Heath (trans.)')).toEqual([
      { name: 'Euclid', role: null }, { name: 'T.L. Heath', role: 'trl' },
    ]);
  });

  it('a mid-string ", tr. Name" is a second person', () => {
    expect(splitContributors('Niccolò Machiavelli, tr. W.K. Marriott')).toEqual([
      { name: 'Niccolò Machiavelli', role: null }, { name: 'W.K. Marriott', role: 'trl' },
    ]);
  });

  it('"(Rivinus ed.)" names a second person; "(李栻, compiler)" is the first person in their script', () => {
    expect(splitContributors('Kiranus (Rivinus ed.)')).toEqual([
      { name: 'Kiranus', role: null }, { name: 'Rivinus', role: 'edt' },
    ]);
    expect(splitContributors('Li Shi (李栻, compiler)')).toEqual([{ name: 'Li Shi (李栻)', role: 'ctb' }]);
  });

  it('one person with two roles keeps both', () => {
    expect(splitContributors('Menudier, Jean [Übers.] [Hrsg.]')).toEqual([
      { name: 'Menudier, Jean', role: 'trl' }, { name: 'Menudier, Jean', role: 'edt' },
    ]);
  });
});

describe('givenNameConflict', () => {
  it('a different full given name on the same surname is a different person', () => {
    expect(givenNameConflict('Lionel Giles', 'Herbert Allen Giles')).toBe(true);
  });
  it('initials, reordering and a shared given name are compatible', () => {
    expect(givenNameConflict('T. W. Rhys Davids', 'Thomas William Rhys Davids')).toBe(false);
    expect(givenNameConflict('Philipp Melanchthon', 'Melanchthon, Philipp')).toBe(false);
    expect(givenNameConflict('Henri II Estienne', 'Henri Estienne')).toBe(false);
    expect(givenNameConflict('Galen', 'Galen of Pergamon')).toBe(false);
  });
});

describe('contributorsDrift', () => {
  const list = [
    { author_id: 'euclid', name: 'Euclid', role: 'aut', source: 'books.author', method: 'split-v1' },
    { author_id: 'thomas-heath', name: 'T.L. Heath', role: 'trl', source: 'books.author', method: 'split-v1' },
  ];
  it('agrees when the byline still yields the list', () => {
    expect(contributorsDrift({ author: 'Euclid; T.L. Heath (trans.)', author_id: 'euclid', contributors: list })).toBeNull();
  });
  it('flags an author_id the list does not name', () => {
    expect(contributorsDrift({ author: 'Euclid; T.L. Heath (trans.)', author_id: 'proclus', contributors: list }))
      .toBe('author_id-not-in-contributors');
  });
  it('flags a byline edited after the list was written', () => {
    expect(contributorsDrift({ author: 'Euclid', author_id: 'euclid', contributors: list })).toBe('author-string-changed');
  });
});

describe('writeContributors', () => {
  const db = () => {
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const insertOne = vi.fn().mockResolvedValue({});
    return { updateOne, collection: (n: string) => (n === 'books' ? { updateOne } : { insertOne }) };
  };
  const book = { _id: 'b1', author: 'Katherine Tingley (editor)', author_id: null };

  it('refuses an unlinked contributor, so it cannot mint a person', async () => {
    const d = db();
    await expect(writeContributors(d, book, [{ author_id: null, name: 'X', role: 'edt' }], { sweep: 's' })).rejects.toThrow(/unlinked/);
    expect(d.updateOne).not.toHaveBeenCalled();
  });
  it('refuses a role outside the vocabulary', async () => {
    const d = db();
    await expect(writeContributors(d, book, [{ author_id: 'x', name: 'X', role: 'owner' }], { sweep: 's' })).rejects.toThrow(/vocabulary/);
    expect(d.updateOne).not.toHaveBeenCalled();
  });
  it('leaves author_id alone unless asked, and filters on the byline it was given', async () => {
    const d = db();
    await writeContributors(d, book, [{ author_id: 'katherine-tingley', name: 'Katherine Tingley', role: 'edt' }], { sweep: 's' });
    const [filter, update] = d.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'b1', author: 'Katherine Tingley (editor)' });
    expect(update.$set).not.toHaveProperty('author_id');
  });
});
