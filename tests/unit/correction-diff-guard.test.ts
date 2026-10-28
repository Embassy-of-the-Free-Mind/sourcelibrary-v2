import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper
import { correctionDiffs, applyDiffVerdicts, longSPass, numberKey, tokens } from '../../scripts/lib/correction-diff-guard.mjs';

type Flag = { kind: string; i: number; draft: string; next: string };
const kinds = (d: string, n: string, lang: string) => correctionDiffs(d, n, { lang }).flags.map((f: Flag) => f.kind);

describe('correction diff guard (#7567 E3)', () => {
  it('passes a correction that only fixes letters', () => {
    expect(kinds('<page-type>text</page-type>\nQuod non eft verum, dixit Cicero.', '<page-type>text</page-type>\nQuod non est verum, dixit Cicero.', 'la')).toEqual([]);
  });
  it('flags a negation dropped or added, in each language', () => {
    expect(kinds('Quod non est verum.', 'Quod est verum.', 'la')).toEqual(['negation']);
    expect(kinds('Das ist wahr.', 'Das ist nicht wahr.', 'de')).toEqual(['negation']);
    expect(kinds("Il n'est pas vrai.", 'Il est vrai.', 'fr')).toEqual(['negation', 'negation']);   // n' and pas: two hunks
    expect(kinds('It is not so.', 'It is so.', 'en')).toEqual(['negation']);
    expect(kinds('Questo non è vero.', 'Questo è vero.', 'it')).toEqual(['negation']);
  });
  it('flags a negation prefix flip on one word', () => {
    expect(kinds('res possibilis est', 'res impossibilis est', 'la')).toEqual(['negation']);
  });
  it('flags a changed number or Roman numeral, not a moved one', () => {
    expect(kinds('Anno 1584 excudebat', 'Anno 1548 excudebat', 'la')).toEqual(['number']);
    expect(kinds('Cap. XII. de rebus', 'Cap. XVII. de rebus', 'la')).toEqual(['number']);
    expect(kinds('folio xij. verso', 'folio xiij. verso', 'la')).toEqual(['number']);
    expect(kinds('pag. 12 et', 'pag. 12 et', 'la')).toEqual([]);
  });
  it('treats a Roman numeral, digits and a lower-case xij as numbers, a capital word as not', () => {
    expect(numberKey('MDLXXXIV')).toBe('MDLXXXIV');
    expect(numberKey('1,584')).toBe('1584');
    expect(numberKey('xij')).toBe('XII');
    expect(numberKey('DEO')).toBeNull();
    expect(numberKey('di')).toBeNull();
  });
  it('flags an abbreviation expanded into a word that does not contain it', () => {
    expect(kinds('dñs dixit', 'dominus dixit', 'la')).toEqual([]);
    expect(kinds('dñs dixit', 'magister dixit', 'la')).toEqual(['expansion']);
  });
  it('ignores the transcription header and markup', () => {
    expect(tokens('<page-num>12</page-num>\n<header>LIBER</header>\ntext').map((t: { t: string }) => t.t)).toEqual(['LIBER', 'text']);
    expect(kinds('<page-num>12</page-num>\nverba', '<page-num>13</page-num>\nverba', 'la')).toEqual([]);
  });
  it('keeps confirmed changes, puts back the draft where the image check gives it the draft, holds when undecided', () => {
    const d = 'Quod non est verum anno 1584.';
    const n = 'Quod est verum anno 1548.';
    const { flags } = correctionDiffs(d, n, { lang: 'la' });
    expect(flags.map((f: Flag) => f.kind).sort()).toEqual(['negation', 'number']);
    const neg = flags.find((f: Flag) => f.kind === 'negation'), num = flags.find((f: Flag) => f.kind === 'number');
    const r = applyDiffVerdicts(d, n, flags, [{ i: neg.i, winner: 'draft' }, { i: num.i, winner: 'next' }]);
    expect(r.text).toBe('Quod non est verum anno 1548.');
    expect(applyDiffVerdicts(d, n, flags, [{ i: neg.i, winner: 'draft' }]).text).toBeNull();
    expect(applyDiffVerdicts(d, n, flags, [{ i: neg.i, winner: 'neither' }, { i: num.i, winner: 'next' }]).text).toBeNull();
  });
  it('long-s pass: repairs only never-word f-forms, keeps case, folds ſ when the library text has none', () => {
    expect(longSPass('Hoc eft verum, fed fit. Eft.', { lang: 'la' }).text).toBe('Hoc est verum, sed fit. Est.');
    expect(longSPass('Das ift fein Haus.', { lang: 'de' }).text).toBe('Das ist fein Haus.');
    expect(longSPass('He fhall fay it.', { lang: 'en' }).text).toBe('He shall fay it.');
    expect(longSPass('<meta>eft</meta>\nquod eſt', { lang: 'la', convention: 'quod est' }).text).toBe('<meta>eft</meta>\nquod est');
    expect(longSPass('quod eſt', { lang: 'la', convention: 'quod eſt' }).text).toBe('quod eſt');
  });
});
