import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs, installed apart from the app (scripts/workers/keyword-search/README.md)
import { tokenize, indexText, queryTerms, parseQuery, withinOneEdit, pageRow, SCHEMA_SQL, SCHEMA_INDEXES_SQL, NON_CONTENT_PAGE_TYPES as WORKER_NON_CONTENT } from '../../scripts/workers/keyword-search/lib.mjs';
// @ts-expect-error — plain .mjs
import { Engine } from '../../scripts/workers/keyword-search/engine.mjs';
import { NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';

// The keyword page service (#6852) stands in for Atlas `pages_search` (lucene.standard) in the
// /api/search page lane. What must hold:
//   - the analyzer splits and lowercases as StandardTokenizer does, folds nothing, and keeps
//     "Drebbel's" whole (Atlas does not match "Drebbel" there either);
//   - Han/Hiragana are one token per character, so a two-character Chinese word matches;
//   - the lane's shapes: ANY word, the quoted phrase, fuzzy for one long word, non-content pages
//     dropped, live books only, an allow-list that is empty returns NOTHING (#2760);
//   - the roll-up counts pages printing EVERY term and adds one page per unreached book.

describe('tokenizer (lucene.standard approximation)', () => {
  it('splits on punctuation and space, lowercases, keeps diacritics', () => {
    expect(tokenize('Mercurius, Philosophorum!  Ætna')).toEqual(['mercurius', 'philosophorum', 'ætna']);
    expect(tokenize('Müller über')).toEqual(['müller', 'über']);
  });
  it("keeps an apostrophe or period between letters (UAX#29 MidLetter/MidNumLet)", () => {
    expect(tokenize("Drebbel's furnace")).toEqual(["drebbel's", 'furnace']);
    expect(tokenize('e.g. U.S.A.')).toEqual(['e.g', 'u.s.a']);
    expect(tokenize("philosophers' stone")).toEqual(['philosophers', 'stone']);
  });
  it('joins digits across a comma, not words', () => {
    expect(tokenize('1,000 men,women')).toEqual(['1,000', 'men', 'women']);
  });
  it('emits Han and Hiragana one character at a time, Katakana and Hangul as runs', () => {
    expect(tokenize('道德經')).toEqual(['道', '德', '經']);
    expect(tokenize('ひらがな カタカナ 한국어')).toEqual(['ひ', 'ら', 'が', 'な', 'カタカナ', '한국어']);
  });
  it('keeps Devanagari and Tibetan marks inside the word', () => {
    expect(tokenize('योगः सूत्र')).toEqual(['योगः', 'सूत्र']);
    expect(tokenize('योग')).toEqual(['योग']);
    expect(tokenize('བྱང་ཆུབ')).toEqual(['བྱང', 'ཆུབ']);
  });
  it('indexText is the tokens joined by single spaces', () => {
    expect(indexText('<meta>A b</meta>')).toBe('meta a b meta');
  });
});

describe('query parsing', () => {
  it('detects a quoted phrase and drops stopwords only when something is left', () => {
    expect(parseQuery('"prima materia"')).toEqual({ isPhrase: true, text: 'prima materia' });
    expect(queryTerms('the philosophers stone')).toEqual(['philosophers', 'stone']);
    expect(queryTerms('the one')).toEqual(['one']);
    expect(queryTerms('of the')).toEqual(['of', 'the']);
  });
  it('withinOneEdit is Levenshtein ≤ 1 with transposition', () => {
    expect(withinOneEdit('masturbation', 'masturbator')).toBe(false);
    expect(withinOneEdit('alchemy', 'alchymy')).toBe(true);
    expect(withinOneEdit('alchemy', 'alchmey')).toBe(true);
    expect(withinOneEdit('alchemy', 'alchemyx')).toBe(true);
    expect(withinOneEdit('alchemy', 'alkhemi')).toBe(false);
  });
  it("the worker's non-content list is the app's", () => {
    expect([...WORKER_NON_CONTENT].sort()).toEqual([...NON_CONTENT_PAGE_TYPES].sort());
  });
  it('pageRow skips pages the lane cannot match', () => {
    expect(pageRow({ id: 'p', book_id: 'b', page_number: 0, ocr: { data: 'x' } })).toBeNull();
    expect(pageRow({ id: 'p', book_id: 'b', page_number: 3 })).toBeNull();
    expect(pageRow({ id: 'p', book_id: 'b', page_number: 3, ocr: { data: 'x' } })).toMatchObject({ i: 'p', b: 'b', n: 3, o: 'x', tr: '' });
  });
});

describe('Engine.lane', () => {
  let engine: any;
  const P = (id: string, book: string, n: number, tr: string, ocr = '', type = '') => ({ id, book, n, tr, ocr, type });
  const pages = [
    P('p1', 'b1', 1, 'The alchemy of the philosophers stone is a great work.'),
    P('p2', 'b1', 2, 'Of the stone and the prima materia.', 'De lapide et prima materia'),
    P('p3', 'b2', 1, 'Nothing about it here, only the alchymy of old.'),
    P('p4', 'b2', 2, 'Cornelius Drebbel built a furnace.', 'Drebbelius fornacem construxit'),
    P('p5', 'b3', 1, 'Alchemy alchemy alchemy, the stone.'),                 // hidden book
    P('p6', 'b4', 1, 'A title page that says alchemy.', '', 'title-page'),   // non-content
    P('p7', 'b4', 2, '', 'materia prima, sine forma'),
    P('p8', 'b5', 1, '道德經 第一章'),
    P('p9', 'b6', 1, 'prima materia stone'), P('p10', 'b6', 2, 'prima materia again, stone'), P('p11', 'b6', 3, 'prima materia, stone, third'),
  ];
  beforeAll(() => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'kw-')), 'k.sqlite');
    const db = new DatabaseSync(file);
    db.exec(SCHEMA_SQL);
    const books = [...new Set(pages.map(p => p.book))];
    books.forEach((b, i) => db.prepare('INSERT INTO books(idx, id) VALUES(?, ?)').run(i, b));
    pages.forEach((p, i) => {
      db.prepare('INSERT INTO pages(rowid, page_id, book, page_number, content, u) VALUES(?, ?, ?, ?, ?, 0)')
        .run(i + 1, p.id, books.indexOf(p.book), p.n, NON_CONTENT_PAGE_TYPES.includes(p.type as any) ? 0 : 1);
      db.prepare('INSERT INTO fts(rowid, tr, ocr) VALUES(?, ?, ?)').run(i + 1, indexText(p.tr), indexText(p.ocr));
    });
    db.exec(SCHEMA_INDEXES_SQL);
    // b3 is hidden: not in the live set.
    for (const b of books.filter(b => b !== 'b3')) db.prepare('INSERT INTO live_books(id) VALUES(?)').run(b);
    db.close();
    engine = new Engine(file);
  });
  const ids = (rows: any[]) => rows.map(r => r.page_id);

  it('matches ANY word, translation weighted over OCR, live content pages only', () => {
    const r = engine.lane({ query: 'alchemy stone', k: 25 });
    expect(r.match).toBe('"alchemy" OR "stone"');
    expect(ids(r.main)).toContain('p1');
    expect(ids(r.main)).toContain('p2');
    expect(ids(r.main)).not.toContain('p5'); // hidden book
    expect(ids(r.main)).not.toContain('p6'); // title page
  });
  it('a quoted query is a phrase', () => {
    const r = engine.lane({ query: '"prima materia"', k: 25 });
    expect(ids(r.main).sort()).toEqual(['p10', 'p11', 'p2', 'p9']);
    expect(ids(r.main)).not.toContain('p7'); // "materia prima" is the other order
  });
  it('one word of 6+ characters is fuzzy (1 edit, 4-character prefix)', () => {
    const r = engine.lane({ query: 'alchemy', k: 25 });
    expect(r.fuzzy).toBe(true);
    expect(ids(r.main)).toContain('p3'); // alchymy
    expect(ids(r.main)[0]).not.toBe('p3'); // but the exact word is in the ranking too
  });
  it('a two-character Chinese word matches its characters', () => {
    expect(ids(engine.lane({ query: '道德', k: 5 }).main)).toEqual(['p8']);
  });
  it('an allow-list confines the lane, and an EMPTY allow-list returns nothing (#2760)', () => {
    expect(ids(engine.lane({ query: 'stone', k: 25, book_ids: ['b6'] }).main).sort()).toEqual(['p10', 'p11', 'p9']);
    expect(engine.lane({ query: 'stone', k: 25, book_ids: [] }).main).toEqual([]);
  });
  it('name variants are their own list, minus pages already in main', () => {
    const r = engine.lane({ query: 'Drebbel', k: 25, variants: ['Drebbelius'], topic_words: [] });
    expect(ids(r.main)).toEqual(['p4']);
    expect(r.variants).toEqual([]); // p4 prints both spellings and is already in main
    const r2 = engine.lane({ query: 'xyzzy', k: 5, variants: ['Drebbelius'], topic_words: ['fornacem'] });
    expect(ids(r2.variants)).toEqual(['p4']);
  });
  it('the roll-up counts pages printing EVERY term per live book and adds one page per unreached book', () => {
    const r = engine.lane({ query: 'prima materia', k: 1, rollup: { terms: ['prima', 'materia'], buckets: 200, max_books: 30 } });
    expect(r.counts).toEqual([{ book_id: 'b6', pages: 3 }, { book_id: 'b1', pages: 1 }, { book_id: 'b4', pages: 1 }]);
    const reached = new Set(r.main.map((x: any) => x.book_id));
    expect(r.extra.every((x: any) => !reached.has(x.book_id))).toBe(true);
    expect(r.extra.map((x: any) => x.src)).toEqual(r.extra.map(() => 'rollup'));
  });
  it('setLive changes the results without touching the index', () => {
    engine.setLive(['b1', 'b2', 'b4', 'b5', 'b6', 'b3']);
    expect(ids(engine.lane({ query: 'alchemy stone', k: 25 }).main)).toContain('p5');
    engine.setLive(['b1', 'b2', 'b4', 'b5', 'b6']);
    expect(ids(engine.lane({ query: 'alchemy stone', k: 25 }).main)).not.toContain('p5');
  });
});
