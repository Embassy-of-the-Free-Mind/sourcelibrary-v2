import { describe, it, expect } from 'vitest';

/**
 * The work-vs-commentary rung in /api/search's relevance ladder.
 *
 * Measured failure: searching "Aristotle Metaphysics" put Bekker's 1831 Greek
 * critical edition 7th and Taylor's translation 9th, behind commentaries by
 * Aquinas (1480), Asclepius (1550) and Tartaretus (1499). Every one of those
 * carries both query words in its title, so the word-count rung tied and the
 * tie fell through to "older editions rank higher" — a rule that is correct
 * between editions of one work and meaningless across different works.
 *
 * The ladder lives inline in the route, so this pins the comparator's SHAPE
 * rather than importing it: if someone reorders the rungs, the ordering these
 * cases assert is what must survive.
 */

interface Row { title: string; author: string; year: number }

/** The tie-break chain as ordered in src/app/api/search/route.ts. */
function compare(queryWords: string[], queryLower: string) {
  const all = (r: Row) => `${r.title.toLowerCase()} ${r.author.toLowerCase()}`;
  const authorHits = (r: Row) => {
    const a = r.author.toLowerCase();
    return a ? queryWords.filter((w) => a.includes(w)).length : 0;
  };
  return (a: Row, b: Row): number => {
    const aw = queryWords.filter((w) => all(a).includes(w)).length;
    const bw = queryWords.filter((w) => all(b).includes(w)).length;
    if (aw !== bw) return bw - aw;
    if (authorHits(a) !== authorHits(b)) return authorHits(b) - authorHits(a);
    const at = a.title.toLowerCase().includes(queryLower);
    const bt = b.title.toLowerCase().includes(queryLower);
    if (at !== bt) return at ? -1 : 1;
    return a.year - b.year;
  };
}

const rank = (rows: Row[], q: string) =>
  [...rows].sort(compare(q.toLowerCase().split(/\s+/), q.toLowerCase())).map((r) => r.author);

describe('a commentary ON an author does not outrank the author', () => {
  const rows: Row[] = [
    { title: 'Commentary on the Metaphysics of Aristotle', author: 'Thomas Aquinas', year: 1480 },
    { title: 'Asclepius of Tralles, Commentary on Aristotle Metaphysics', author: 'Asclepius of Tralles', year: 1550 },
    { title: 'Questions on the Philosophy and Metaphysics of Aristotle', author: 'Tartaretus, Petrus', year: 1499 },
    { title: 'Works of Aristotle, Vol. 2 — Bekker Edition (1831): Metaphysics, Nicomachean Ethics, Politics', author: 'Aristotle', year: 1831 },
  ];

  it('puts Aristotle first even though every commentary is older', () => {
    expect(rank(rows, 'Aristotle Metaphysics')[0]).toBe('Aristotle');
  });

  it('beats a commentary whose title contains the query as a literal phrase', () => {
    // Asclepius's title reads "…Commentary on Aristotle Metaphysics", so it won
    // the exact-phrase rung by coincidence. Authorship must rank above that,
    // which is why the rung sits ABOVE the phrase rung and not below it.
    const two = rows.filter((r) => r.author === 'Aristotle' || r.author === 'Asclepius of Tralles');
    expect(rank(two, 'Aristotle Metaphysics')[0]).toBe('Aristotle');
  });

  it('is inert when the query names no person', () => {
    // A pure title query leaves every author count at zero, so the rung must
    // not perturb the existing order — here, oldest first.
    const titleOnly: Row[] = [
      { title: 'Nicomachean Ethics', author: 'Aristotle', year: 1559 },
      { title: 'Nicomachean Ethics (with Averroes)', author: 'Aristotle', year: 1521 },
    ];
    expect([...titleOnly].sort(compare(['nicomachean', 'ethics'], 'nicomachean ethics'))[0].year).toBe(1521);
  });

  it('does NOT fix a commentary that names both the author and the work in its title', () => {
    // Known limitation, asserted so it is not mistaken for a regression later.
    // "Averroes' Paraphrase of Plato's Republic" carries both query words and so
    // clears the word-count rung ABOVE this one, where Plato's own untitled
    // manuscripts score only one. Fixing it needs the work/commentary relation
    // in the data, not inferred from title strings.
    const platoRows: Row[] = [
      { title: "Averroes' Paraphrase of Plato's Republic", author: 'Averroes', year: 1539 },
      { title: 'Urb.gr.31', author: 'Plato', year: 1000 },
    ];
    expect(rank(platoRows, 'Plato Republic')[0]).toBe('Averroes');
  });
});
